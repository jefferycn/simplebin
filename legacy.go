package main

import (
	"errors"
	"io"
	"net/http"
	"strings"
)

// 旧 API 兼容（v1 的 curl/Shortcuts/shell 脚本继续可用）。
// 与 v1 的区别：从此必须带该用户的 Bearer token（v1 的读接口实际无鉴权，
// 这是已知漏洞，不再保留）；公开看最新一条的用法改由 /fast 承担。

// legacyAuth 校验旧客户端的 token（旧客户端没有会话 Cookie）。
// v1 的校验接受 "Bearer <token>" 与裸 token 两种形式，这里保持一致：
// 有些快捷指令的 Authorization 头不带 Bearer 前缀，只认 Bearer 会 401。
func (a *App) legacyAuth(r *http.Request) *User {
	h := strings.TrimSpace(r.Header.Get("Authorization"))
	if h == "" {
		return nil
	}
	if len(h) > 7 && strings.EqualFold(h[:7], "Bearer ") {
		h = strings.TrimSpace(h[7:])
	}
	if h == "" {
		return nil
	}
	u, err := a.store.GetTokenUser(h)
	if err != nil {
		return nil
	}
	return u
}

// legacyLatestJSON：GET /（非浏览器请求）与 GET /json，返回最新一条的 JSON。
// 文本/链接带全文；文件/图片只带元数据与下载地址。
func (a *App) legacyLatestJSON(w http.ResponseWriter, r *http.Request) {
	u := a.legacyAuth(r)
	if u == nil {
		writeErr(w, http.StatusUnauthorized, "需要 Bearer token")
		return
	}
	it, err := a.store.GetLatestItem(u.ID)
	if errors.Is(err, errNotFound) {
		writeErr(w, http.StatusNotFound, "还没有任何条目")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "数据库错误")
		return
	}
	a.loadFullBody(it)
	writeJSON(w, http.StatusOK, a.legacyContent(r, it))
}

// absURL 拼绝对地址：反代后的 Host 与协议取 X-Forwarded-* 头（与 v1 的
// ForwardedHeaderFilter 一致），直连时退回请求的 Host 与 TLS 状态。
func absURL(r *http.Request, path string) string {
	host := r.Header.Get("X-Forwarded-Host")
	if host == "" {
		host = r.Host
	}
	scheme := r.Header.Get("X-Forwarded-Proto")
	if scheme == "" {
		if r.TLS != nil {
			scheme = "https"
		} else {
			scheme = "http"
		}
	}
	return scheme + "://" + host + path
}

// legacyContent 是 v1 GET 接口的 Content 形状：id / type / body。
// 文本的 body 是内容本身；链接的 body 是分享链接（无分享链接时自动生成一个，
// 生成失败则退回原始链接）；文件/图片的 body 是该条目的绝对地址。
func (a *App) legacyContent(r *http.Request, it *Item) map[string]string {
	body := it.Body
	switch it.Type {
	case "link":
		// 链接默认给分享链接：对方无需登录就能打开。
		if token, err := a.ensureShareToken(it); err == nil {
			body = absURL(r, "/s/"+token)
		}
	case "image", "file":
		body = absURL(r, "/"+it.ID)
	}
	return map[string]string{"id": it.ID, "type": it.Type, "body": body}
}

// legacyCreatedContent 是 v1 POST 接口的返回形状：body 恒为该条目的绝对地址
// （快捷指令读 body 当链接用；v1 也是这样返回的）。
func legacyCreatedContent(it *Item, r *http.Request) map[string]string {
	return map[string]string{"id": it.ID, "type": it.Type, "body": absURL(r, "/"+it.ID)}
}

// legacyPlain：GET /plain，最新一条强制按纯文本返回。
// 非文本时返回该条目的地址（v1 行为）。
func (a *App) legacyPlain(w http.ResponseWriter, r *http.Request) {
	u := a.legacyAuth(r)
	if u == nil {
		writeErr(w, http.StatusUnauthorized, "需要 Bearer token")
		return
	}
	it, err := a.store.GetLatestItem(u.ID)
	if errors.Is(err, errNotFound) {
		writeErr(w, http.StatusNotFound, "还没有任何条目")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "数据库错误")
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	if it.Type == "text" || it.Type == "link" {
		body, err := a.itemBody(it)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "读取内容失败")
			return
		}
		w.Write([]byte(body))
		return
	}
	w.Write([]byte("/api/v1/items/" + it.ID + "/blob"))
}

// legacyCreate：POST /，文本（text/plain 原文）或 multipart 文件。
func (a *App) legacyCreate(w http.ResponseWriter, r *http.Request) {
	u := a.legacyAuth(r)
	if u == nil {
		writeErr(w, http.StatusUnauthorized, "需要 Bearer token")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)
	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		if err := r.ParseMultipartForm(32 << 20); err != nil {
			writeErr(w, http.StatusBadRequest, "文件太大或格式错误（上限 100MB）")
			return
		}
		f, hdr, err := r.FormFile("file")
		if err != nil {
			writeErr(w, http.StatusBadRequest, "没有收到文件（字段名应为 file）")
			return
		}
		defer f.Close()
		it, err := a.createFileItem(u.ID, hdr.Filename, f)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "保存文件失败")
			return
		}
		writeJSON(w, http.StatusCreated, legacyCreatedContent(it, r))
		return
	}
	// 其他 Content-Type 一律按纯文本读 body（v1 的 --data-raw 用法）
	body, err := readAllLimit(r, maxUploadSize)
	if err != nil || strings.TrimSpace(string(body)) == "" {
		writeErr(w, http.StatusBadRequest, "内容不能为空")
		return
	}
	it, err := a.createTextItem(u.ID, string(body))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "保存失败")
		return
	}
	writeJSON(w, http.StatusCreated, legacyCreatedContent(it, r))
}

// legacyGetByID：GET /{id}，取指定条目原文（v1 行为）。
// 链接 302 跳转，文本返回原文，图片/文件返回 blob。
// 与 v1 的区别：必须带该用户的 Bearer token，且只能取自己的条目。
func (a *App) legacyGetByID(w http.ResponseWriter, r *http.Request) {
	u := a.legacyAuth(r)
	if u == nil {
		writeErr(w, http.StatusUnauthorized, "需要 Bearer token")
		return
	}
	it, err := a.ownItem(r, u)
	if err != nil {
		writeErr(w, http.StatusNotFound, "条目不存在")
		return
	}
	switch it.Type {
	case "link":
		body, err := a.itemBody(it)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "读取内容失败")
			return
		}
		http.Redirect(w, r, body, http.StatusFound)
	case "text":
		body, err := a.itemBody(it)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "读取内容失败")
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Write([]byte(body))
	default:
		a.serveBlob(w, r, it)
	}
}

// legacyGetJSONByID：GET /{id}/json，取指定条目的 JSON（v1 形状）。
func (a *App) legacyGetJSONByID(w http.ResponseWriter, r *http.Request) {
	u := a.legacyAuth(r)
	if u == nil {
		writeErr(w, http.StatusUnauthorized, "需要 Bearer token")
		return
	}
	it, err := a.ownItem(r, u)
	if err != nil {
		writeErr(w, http.StatusNotFound, "条目不存在")
		return
	}
	a.loadFullBody(it)
	writeJSON(w, http.StatusOK, a.legacyContent(r, it))
}

// readAllLimit 读 body，超过上限返回错误。
func readAllLimit(r *http.Request, limit int64) ([]byte, error) {
	body, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > limit {
		return nil, errors.New("body too large")
	}
	return body, nil
}
