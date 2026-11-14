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

// legacyAuth 只接受 Bearer token（旧客户端没有会话 Cookie）。
func (a *App) legacyAuth(r *http.Request) *User {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		return nil
	}
	u, err := a.store.GetTokenUser(strings.TrimPrefix(h, "Bearer "))
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
	writeJSON(w, http.StatusOK, legacyContent(it, r))
}

// legacyContent 是 v1 的 Content 形状：id / type / body（文本是内容，文件是地址）。
func legacyContent(it *Item, r *http.Request) map[string]string {
	body := it.Body
	if it.Type == "image" || it.Type == "file" {
		body = "/api/v1/items/" + it.ID + "/blob"
	}
	return map[string]string{"id": it.ID, "type": it.Type, "body": body}
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
		writeJSON(w, http.StatusCreated, legacyContent(it, r))
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
	writeJSON(w, http.StatusCreated, legacyContent(it, r))
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
