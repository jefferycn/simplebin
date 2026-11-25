package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// ---------- JSON 工具 ----------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func decodeJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20)) // JSON body 上限 1MB
	return dec.Decode(v)
}

// ---------- 状态 / 注册 / 登录 ----------

// statusHandler 供登录页判断是否首次使用（库里还没有任何用户）。
func (a *App) statusHandler(w http.ResponseWriter, r *http.Request) {
	n, err := a.store.CountUsers()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "数据库错误")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"needs_setup": n == 0})
}

// registerHandler 首个用户注册：仅当库里没有任何用户时可用，注册者自动成为管理员。
func (a *App) registerHandler(w http.ResponseWriter, r *http.Request) {
	n, err := a.store.CountUsers()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "数据库错误")
		return
	}
	if n > 0 {
		writeErr(w, http.StatusForbidden, "注册已关闭，请联系管理员创建账号")
		return
	}
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	req.Username = strings.ToLower(strings.TrimSpace(req.Username))
	if !validUsername(req.Username) {
		writeErr(w, http.StatusBadRequest, "用户名只允许小写字母、数字、-、_，1–32 位")
		return
	}
	if !validPassword(req.Password) {
		writeErr(w, http.StatusBadRequest, "密码最短 8 位")
		return
	}
	hash, err := hashPassword(req.Password)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "密码处理失败")
		return
	}
	u, err := a.store.CreateUser(req.Username, hash, true)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "创建用户失败")
		return
	}
	a.startSession(w, u)
	writeJSON(w, http.StatusCreated, u)
}

// startSession 建会话并写 Cookie（登录与注册共用）。
func (a *App) startSession(w http.ResponseWriter, u *User) {
	a.store.DeleteExpiredSessions() // 顺手清过期会话
	sid, err := a.store.CreateSession(u.ID)
	if err != nil {
		return
	}
	a.setSessionCookie(w, sid)
}

func (a *App) loginHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	username := strings.ToLower(strings.TrimSpace(req.Username))
	if a.limiter.isLocked(username) {
		writeErr(w, http.StatusTooManyRequests, "登录失败次数过多，请 15 分钟后再试")
		return
	}
	u, err := a.store.GetUserByUsername(username)
	if err != nil || u.Disabled {
		// 用户不存在或已禁用：也跑一次 bcrypt，避免用响应时间猜用户名
		checkPassword(string(dummyHash), req.Password)
		a.limiter.recordFailure(username)
		writeErr(w, http.StatusUnauthorized, "用户名或密码错误")
		return
	}
	if !checkPassword(u.PasswordHash, req.Password) {
		a.limiter.recordFailure(username)
		writeErr(w, http.StatusUnauthorized, "用户名或密码错误")
		return
	}
	a.limiter.reset(username)
	a.startSession(w, u)
	writeJSON(w, http.StatusOK, u)
}

func (a *App) logoutHandler(w http.ResponseWriter, r *http.Request, u *User) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		a.store.DeleteSession(c.Value)
	}
	a.clearSessionCookie(w)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *App) meHandler(w http.ResponseWriter, r *http.Request, u *User) {
	writeJSON(w, http.StatusOK, u)
}

func (a *App) changePasswordHandler(w http.ResponseWriter, r *http.Request, u *User) {
	var req struct {
		Current string `json:"current"`
		New     string `json:"new"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if !checkPassword(u.PasswordHash, req.Current) {
		writeErr(w, http.StatusUnauthorized, "当前密码错误")
		return
	}
	if !validPassword(req.New) {
		writeErr(w, http.StatusBadRequest, "新密码最短 8 位")
		return
	}
	hash, err := hashPassword(req.New)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "密码处理失败")
		return
	}
	if err := a.store.SetUserPassword(u.ID, hash); err != nil {
		writeErr(w, http.StatusInternalServerError, "保存失败")
		return
	}
	// 改密码后吊销全部会话（含当前），需要重新登录
	a.store.DeleteUserSessions(u.ID)
	a.clearSessionCookie(w)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// listUsersHandler 返回可选的分享对象：未禁用的其他用户（只给用户名）。
func (a *App) listUsersHandler(w http.ResponseWriter, r *http.Request, u *User) {
	users, err := a.store.ListUsers()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "数据库错误")
		return
	}
	out := []map[string]string{}
	for _, x := range users {
		if x.ID == u.ID || x.Disabled {
			continue
		}
		out = append(out, map[string]string{"username": x.Username})
	}
	writeJSON(w, http.StatusOK, out)
}

// ---------- 条目 ----------

func (a *App) listItemsHandler(w http.ResponseWriter, r *http.Request, u *User) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	perPage, _ := strconv.Atoi(q.Get("per_page"))
	f := ListFilter{
		Type:    q.Get("type"),
		Query:   strings.TrimSpace(q.Get("q")),
		Sort:    q.Get("sort"),
		Page:    page,
		PerPage: perPage,
	}
	items, total, err := a.store.ListItems(u.ID, f)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "数据库错误")
		return
	}
	totalSize, _ := a.store.TotalSize(u.ID)
	writeJSON(w, http.StatusOK, map[string]any{
		"items": items, "total": total,
		"page": f.Page, "per_page": f.PerPage, "total_size": totalSize,
	})
}

func (a *App) latestItemHandler(w http.ResponseWriter, r *http.Request, u *User) {
	it, err := a.store.GetLatestItem(u.ID)
	if errors.Is(err, errNotFound) {
		writeErr(w, http.StatusNotFound, "还没有任何条目")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "数据库错误")
		return
	}
	if err := a.loadFullBody(it); err != nil {
		writeErr(w, http.StatusInternalServerError, "读取内容失败")
		return
	}
	writeJSON(w, http.StatusOK, it)
}

func (a *App) getItemHandler(w http.ResponseWriter, r *http.Request, u *User) {
	it, err := a.ownItem(r, u)
	if err != nil {
		writeErr(w, http.StatusNotFound, "条目不存在")
		return
	}
	if err := a.loadFullBody(it); err != nil {
		writeErr(w, http.StatusInternalServerError, "读取内容失败")
		return
	}
	writeJSON(w, http.StatusOK, it)
}

// ownItem 取出属于当前用户的条目（id 来自路径），不是自己的按不存在处理。
func (a *App) ownItem(r *http.Request, u *User) (*Item, error) {
	it, err := a.store.GetItem(r.PathValue("id"))
	if err != nil {
		return nil, err
	}
	if it.OwnerID != u.ID {
		return nil, errNotFound
	}
	return it, nil
}

// createItemHandler 新建条目：multipart 是文件上传，JSON 是文本。
func (a *App) createItemHandler(w http.ResponseWriter, r *http.Request, u *User) {
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
		writeJSON(w, http.StatusCreated, it)
		return
	}
	var req struct {
		Text string `json:"text"`
	}
	if err := decodeJSON(r, &req); err != nil || strings.TrimSpace(req.Text) == "" {
		writeErr(w, http.StatusBadRequest, "内容不能为空")
		return
	}
	it, err := a.createTextItem(u.ID, req.Text)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "保存失败")
		return
	}
	writeJSON(w, http.StatusCreated, it)
}

func (a *App) updateItemHandler(w http.ResponseWriter, r *http.Request, u *User) {
	it, err := a.ownItem(r, u)
	if err != nil {
		writeErr(w, http.StatusNotFound, "条目不存在")
		return
	}
	if it.Type != "text" && it.Type != "link" {
		writeErr(w, http.StatusBadRequest, "只有文本和链接可以编辑")
		return
	}
	var req struct {
		Text string `json:"text"`
	}
	if err := decodeJSON(r, &req); err != nil || strings.TrimSpace(req.Text) == "" {
		writeErr(w, http.StatusBadRequest, "内容不能为空")
		return
	}
	if err := a.updateTextItem(it, req.Text); err != nil {
		writeErr(w, http.StatusInternalServerError, "保存失败")
		return
	}
	updated, _ := a.store.GetItem(it.ID)
	a.loadFullBody(updated)
	writeJSON(w, http.StatusOK, updated)
}

func (a *App) deleteItemHandler(w http.ResponseWriter, r *http.Request, u *User) {
	it, err := a.ownItem(r, u)
	if err != nil {
		writeErr(w, http.StatusNotFound, "条目不存在")
		return
	}
	if err := a.deleteItem(it); err != nil {
		writeErr(w, http.StatusInternalServerError, "删除失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// bulkDeleteHandler 批量删除：DELETE /api/v1/items，body {ids: [...]}。
// 只删自己的条目，不存在或不属于自己的跳过；返回实际删掉的张数。
func (a *App) bulkDeleteHandler(w http.ResponseWriter, r *http.Request, u *User) {
	var req struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.IDs) == 0 {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if len(req.IDs) > 200 {
		writeErr(w, http.StatusBadRequest, "一次最多删除 200 条")
		return
	}
	deleted := 0
	for _, id := range req.IDs {
		it, err := a.store.GetItem(id)
		if err != nil || it.OwnerID != u.ID {
			continue
		}
		if err := a.deleteItem(it); err == nil {
			deleted++
		}
	}
	writeJSON(w, http.StatusOK, map[string]int{"deleted": deleted})
}

// blobHandler 下载条目文件：图片默认 inline（查看器与 <img> 直接用），
// ?download=1 时强制 attachment。
func (a *App) blobHandler(w http.ResponseWriter, r *http.Request, u *User) {
	it, err := a.ownItem(r, u)
	if err != nil {
		writeErr(w, http.StatusNotFound, "条目不存在")
		return
	}
	a.serveBlob(w, r, it)
}

func (a *App) serveBlob(w http.ResponseWriter, r *http.Request, it *Item) {
	if it.BlobPath == "" {
		writeErr(w, http.StatusNotFound, "该条目没有文件")
		return
	}
	f, err := http.Dir(a.store.dataDir).Open(it.BlobPath)
	if err != nil {
		writeErr(w, http.StatusNotFound, "文件不存在")
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "读取文件失败")
		return
	}
	if r.URL.Query().Get("download") == "1" {
		w.Header().Set("Content-Disposition", "attachment; filename="+strconv.Quote(it.Filename))
	}
	// ServeContent 支持 Range 请求，不会把整个文件读进内存
	http.ServeContent(w, r, it.Filename, st.ModTime(), f)
}

// ---------- 分享链接 ----------

// ensureShareToken 取条目的分享 token，没有就生成并保存一个。
func (a *App) ensureShareToken(it *Item) (string, error) {
	if it.ShareToken != "" {
		return it.ShareToken, nil
	}
	token := randBase62(32)
	if err := a.store.SetShareToken(it.ID, token); err != nil {
		return "", err
	}
	it.ShareToken = token
	return token, nil
}

func (a *App) createShareLinkHandler(w http.ResponseWriter, r *http.Request, u *User) {
	it, err := a.ownItem(r, u)
	if err != nil {
		writeErr(w, http.StatusNotFound, "条目不存在")
		return
	}
	token, err := a.ensureShareToken(it)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "生成分享链接失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"share_token": token})
}

func (a *App) deleteShareLinkHandler(w http.ResponseWriter, r *http.Request, u *User) {
	it, err := a.ownItem(r, u)
	if err != nil {
		writeErr(w, http.StatusNotFound, "条目不存在")
		return
	}
	if err := a.store.SetShareToken(it.ID, ""); err != nil {
		writeErr(w, http.StatusInternalServerError, "关闭分享失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ---------- 分享给其他用户 ----------

func (a *App) shareToUserHandler(w http.ResponseWriter, r *http.Request, u *User) {
	it, err := a.ownItem(r, u)
	if err != nil {
		writeErr(w, http.StatusNotFound, "条目不存在")
		return
	}
	var req struct {
		Username    string `json:"username"`
		FastMinutes int    `json:"fast_minutes"` // 可选：1/5/10，设置后副本同时置顶到对方 Fast
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	target, err := a.store.GetUserByUsername(strings.ToLower(strings.TrimSpace(req.Username)))
	if err != nil || target.Disabled {
		writeErr(w, http.StatusNotFound, "用户不存在")
		return
	}
	if target.ID == u.ID {
		writeErr(w, http.StatusBadRequest, "不能分享给自己")
		return
	}
	if req.FastMinutes != 0 && req.FastMinutes != 1 && req.FastMinutes != 5 && req.FastMinutes != 10 {
		writeErr(w, http.StatusBadRequest, "置顶时长只能是 1、5 或 10 分钟")
		return
	}
	cp, err := a.shareItemToUser(it, u, target)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "分享失败")
		return
	}
	if req.FastMinutes != 0 {
		expires := time.Now().UTC().Add(time.Duration(req.FastMinutes) * time.Minute)
		if err := a.store.SetPin(target.ID, cp.ID, expires); err != nil {
			writeErr(w, http.StatusInternalServerError, "置顶失败")
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{
			"item": cp, "fast_expires_at": expires.Format(time.RFC3339Nano),
		})
		return
	}
	writeJSON(w, http.StatusCreated, cp)
}

// ---------- Fast 置顶 ----------

func (a *App) pinFastHandler(w http.ResponseWriter, r *http.Request, u *User) {
	it, err := a.ownItem(r, u)
	if err != nil {
		writeErr(w, http.StatusNotFound, "条目不存在")
		return
	}
	var req struct {
		Minutes int `json:"minutes"`
	}
	// body 可空，空则默认 10 分钟
	_ = decodeJSON(r, &req)
	if req.Minutes == 0 {
		req.Minutes = 10
	}
	if req.Minutes != 1 && req.Minutes != 5 && req.Minutes != 10 {
		writeErr(w, http.StatusBadRequest, "时长只能是 1、5 或 10 分钟")
		return
	}
	expires := time.Now().UTC().Add(time.Duration(req.Minutes) * time.Minute)
	if err := a.store.SetPin(u.ID, it.ID, expires); err != nil {
		writeErr(w, http.StatusInternalServerError, "置顶失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"item_id": it.ID, "expires_at": expires.Format(time.RFC3339Nano),
	})
}

func (a *App) getFastHandler(w http.ResponseWriter, r *http.Request, u *User) {
	pin, err := a.store.GetPin(u.ID)
	if errors.Is(err, errNotFound) {
		writeJSON(w, http.StatusOK, map[string]any{"pinned": false})
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "数据库错误")
		return
	}
	expires, err := parseTime(pin.ExpiresAt)
	if err != nil || time.Now().UTC().After(expires) {
		// 已过期：顺手删掉
		a.store.DeletePin(u.ID)
		writeJSON(w, http.StatusOK, map[string]any{"pinned": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"pinned": true, "item_id": pin.ItemID, "expires_at": pin.ExpiresAt,
	})
}

func (a *App) unpinFastHandler(w http.ResponseWriter, r *http.Request, u *User) {
	a.store.DeletePin(u.ID)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ---------- API token ----------

func (a *App) listTokensHandler(w http.ResponseWriter, r *http.Request, u *User) {
	tokens, err := a.store.ListAPITokens(u.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "数据库错误")
		return
	}
	if tokens == nil {
		tokens = []*APIToken{}
	}
	writeJSON(w, http.StatusOK, tokens)
}

func (a *App) createTokenHandler(w http.ResponseWriter, r *http.Request, u *User) {
	var req struct {
		Name string `json:"name"`
	}
	_ = decodeJSON(r, &req)
	token := "sb_" + randBase62(32)
	t, err := a.store.CreateAPIToken(u.ID, strings.TrimSpace(req.Name), token)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "生成 token 失败")
		return
	}
	// token 原文只返回这一次，之后无法再查看
	writeJSON(w, http.StatusCreated, map[string]any{"token": token, "id": t.ID, "prefix": t.Prefix, "name": t.Name})
}

func (a *App) deleteTokenHandler(w http.ResponseWriter, r *http.Request, u *User) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "id 错误")
		return
	}
	if err := a.store.DeleteAPIToken(u.ID, id); err != nil {
		writeErr(w, http.StatusNotFound, "token 不存在")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ---------- 管理员 ----------

func (a *App) adminListUsersHandler(w http.ResponseWriter, r *http.Request, u *User) {
	users, err := a.store.ListUsers()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "数据库错误")
		return
	}
	if users == nil {
		users = []*User{}
	}
	writeJSON(w, http.StatusOK, users)
}

func (a *App) adminCreateUserHandler(w http.ResponseWriter, r *http.Request, u *User) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
		IsAdmin  bool   `json:"is_admin"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	req.Username = strings.ToLower(strings.TrimSpace(req.Username))
	if !validUsername(req.Username) {
		writeErr(w, http.StatusBadRequest, "用户名只允许小写字母、数字、-、_，1–32 位")
		return
	}
	if !validPassword(req.Password) {
		writeErr(w, http.StatusBadRequest, "密码最短 8 位")
		return
	}
	if _, err := a.store.GetUserByUsername(req.Username); err == nil {
		writeErr(w, http.StatusConflict, "用户名已存在")
		return
	}
	hash, err := hashPassword(req.Password)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "密码处理失败")
		return
	}
	created, err := a.store.CreateUser(req.Username, hash, req.IsAdmin)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "创建用户失败")
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (a *App) adminUserID(r *http.Request) (int64, error) {
	return strconv.ParseInt(r.PathValue("id"), 10, 64)
}

func (a *App) adminResetPasswordHandler(w http.ResponseWriter, r *http.Request, u *User) {
	id, err := a.adminUserID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "id 错误")
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &req); err != nil || !validPassword(req.Password) {
		writeErr(w, http.StatusBadRequest, "新密码最短 8 位")
		return
	}
	if _, err := a.store.GetUserByID(id); err != nil {
		writeErr(w, http.StatusNotFound, "用户不存在")
		return
	}
	hash, err := hashPassword(req.Password)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "密码处理失败")
		return
	}
	if err := a.store.SetUserPassword(id, hash); err != nil {
		writeErr(w, http.StatusInternalServerError, "保存失败")
		return
	}
	a.store.DeleteUserSessions(id) // 重置后该用户需重新登录
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *App) adminSetDisabledHandler(disabled bool) func(w http.ResponseWriter, r *http.Request, u *User) {
	return func(w http.ResponseWriter, r *http.Request, u *User) {
		id, err := a.adminUserID(r)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "id 错误")
			return
		}
		if disabled && id == u.ID {
			writeErr(w, http.StatusBadRequest, "不能禁用自己")
			return
		}
		if _, err := a.store.GetUserByID(id); err != nil {
			writeErr(w, http.StatusNotFound, "用户不存在")
			return
		}
		if err := a.store.SetUserDisabled(id, disabled); err != nil {
			writeErr(w, http.StatusInternalServerError, "保存失败")
			return
		}
		if disabled {
			a.store.DeleteUserSessions(id)
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}
