package main

import (
	"embed"
	"errors"
	"html/template"
	"io/fs"
	"net/http"
	"strings"
	"time"
)

//go:embed web
var webFS embed.FS

var (
	// 公开页模板（/fast 与 /s 共用一个版式，服务端渲染，内容由 html/template 自动转义）。
	publicTmpl = template.Must(template.ParseFS(webFS, "web/templates/public.html"))
)

// servePage 发送 web/pages 下的静态 HTML（登录后页面，内容由前端 JS 调 API 填充）。
func servePage(name string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		b, err := webFS.ReadFile("web/pages/" + name)
		if err != nil {
			http.Error(w, "页面不存在", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(b)
	}
}

// staticFS 是 /static/ 的文件源（CSS/JS/PhotoSwipe），从 embed 里取。
func staticFS() http.Handler {
	sub, err := fs.Sub(webFS, "web/static")
	if err != nil {
		panic(err)
	}
	return http.StripPrefix("/static/", http.FileServer(http.FS(sub)))
}

// ---------- 公开页（/fast 与 /s） ----------

// publicPageData 是公开页模板的数据。
type publicPageData struct {
	Title     string // 页标题（条目标题）
	Type      string // text / link / image / file
	Body      string // 文本/链接全文
	URL       string // 链接地址（type=link 时）
	ImgSrc    string // 图片地址（type=image 时）
	FileName  string // 文件名（type=file 时）
	FileSize  int64
	Download  string // 文件下载地址
	ExpiresAt string // /fast 的过期时间（RFC3339），分享页为空
	IsFast    bool
}

func (a *App) renderPublic(w http.ResponseWriter, data publicPageData) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	// 公开内容不缓存、不收录
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Robots-Tag", "noindex")
	publicTmpl.Execute(w, data)
}

func publicData(it *Item, body, imgSrc, download, expiresAt string, isFast bool) publicPageData {
	d := publicPageData{
		Title:     it.Title,
		Type:      it.Type,
		Body:      body,
		FileName:  it.Filename,
		FileSize:  it.Size,
		Download:  download,
		ExpiresAt: expiresAt,
		IsFast:    isFast,
	}
	if it.Type == "link" {
		d.URL = body
	}
	if it.Type == "image" {
		d.ImgSrc = imgSrc
	}
	return d
}

// fastHandler 公开快取页：/fast/<用户名>，无鉴权，只显示该用户当前置顶的一条。
// 未置顶、已过期、用户不存在时一律 404（不区分原因，避免探测用户名）。
func (a *App) fastHandler(w http.ResponseWriter, r *http.Request) {
	username := r.PathValue("username")
	u, err := a.store.GetUserByUsername(username)
	if err != nil || u.Disabled {
		http.NotFound(w, r)
		return
	}
	pin, err := a.store.GetPin(u.ID)
	if errors.Is(err, errNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		http.Error(w, "数据库错误", http.StatusInternalServerError)
		return
	}
	expires, err := parseTime(pin.ExpiresAt)
	if err != nil || time.Now().UTC().After(expires) {
		a.store.DeletePin(u.ID) // 过期顺手删掉
		http.NotFound(w, r)
		return
	}
	it, err := a.store.GetItem(pin.ItemID)
	if err != nil || it.OwnerID != u.ID {
		a.store.DeletePin(u.ID)
		http.NotFound(w, r)
		return
	}
	body, err := a.itemBody(it)
	if err != nil {
		http.Error(w, "读取内容失败", http.StatusInternalServerError)
		return
	}
	base := "/fast/" + username
	a.renderPublic(w, publicData(it, body, base+"/blob", base+"/blob?download=1", pin.ExpiresAt, true))
}

// fastBlobHandler 是 /fast 页里图片与文件的取用地址，走同样的置顶校验。
func (a *App) fastBlobHandler(w http.ResponseWriter, r *http.Request) {
	username := r.PathValue("username")
	u, err := a.store.GetUserByUsername(username)
	if err != nil || u.Disabled {
		http.NotFound(w, r)
		return
	}
	pin, err := a.store.GetPin(u.ID)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	expires, err := parseTime(pin.ExpiresAt)
	if err != nil || time.Now().UTC().After(expires) {
		a.store.DeletePin(u.ID)
		http.NotFound(w, r)
		return
	}
	it, err := a.store.GetItem(pin.ItemID)
	if err != nil || it.OwnerID != u.ID {
		http.NotFound(w, r)
		return
	}
	a.serveBlob(w, r, it)
}

// shareHandler 公开分享页：/s/<token>，只读，不暴露历史列表。
func (a *App) shareHandler(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	it, err := a.store.GetItemByShareToken(token)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	body, err := a.itemBody(it)
	if err != nil {
		http.Error(w, "读取内容失败", http.StatusInternalServerError)
		return
	}
	base := "/s/" + token
	a.renderPublic(w, publicData(it, body, base+"/blob", base+"/blob?download=1", "", false))
}

// shareBlobHandler 是分享页里图片与文件的取用地址。
func (a *App) shareBlobHandler(w http.ResponseWriter, r *http.Request) {
	it, err := a.store.GetItemByShareToken(r.PathValue("token"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	a.serveBlob(w, r, it)
}

// ---------- 首页分流 ----------

// homeHandler 处理 GET /：浏览器（Accept 含 text/html）进网页首页，
// 否则按旧 API 处理（取最新一条 JSON，见 legacy.go）。
func (a *App) homeHandler(w http.ResponseWriter, r *http.Request) {
	if strings.Contains(r.Header.Get("Accept"), "text/html") {
		u, _ := a.currentUser(r)
		if u == nil {
			http.Redirect(w, r, "/login", http.StatusFound)
			return
		}
		servePage("index.html")(w, r)
		return
	}
	a.legacyLatestJSON(w, r)
}
