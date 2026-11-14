package main

import (
	"database/sql"
	"errors"
	"strings"
	"time"
)

// User 是 users 表的一行。
type User struct {
	ID           int64  `json:"id"`
	Username     string `json:"username"`
	PasswordHash string `json:"-"`
	IsAdmin      bool   `json:"is_admin"`
	Disabled     bool   `json:"disabled"`
	CreatedAt    string `json:"created_at"`
}

// Item 是 items 表的一行。Body 只在取单条文本/链接时填充，列表里用 Snippet。
type Item struct {
	ID                 string `json:"id"`
	OwnerID            int64  `json:"-"`
	Type               string `json:"type"` // text / link / image / file
	Title              string `json:"title"`
	Snippet            string `json:"snippet"`
	Body               string `json:"body,omitempty"`
	Mime               string `json:"mime"`
	Size               int64  `json:"size"`
	SHA256             string `json:"sha256"`
	Filename           string `json:"filename"`
	BlobPath           string `json:"-"`
	CreatedAt          string `json:"created_at"`
	UpdatedAt          string `json:"updated_at"`
	ShareToken         string `json:"share_token,omitempty"`
	SharedFromUserID   *int64 `json:"-"`
	SharedFromItemID   string `json:"-"`
	SharedFromUsername string `json:"shared_from_username,omitempty"`
	Width              int    `json:"width"`
	Height             int    `json:"height"`
}

// HasBlob 表示内容在磁盘文件里（文件/图片，或超长文本）。
func (it *Item) HasBlob() bool { return it.BlobPath != "" }

// APIToken 是 api_tokens 表的一行（哈希不输出）。
type APIToken struct {
	ID         int64  `json:"id"`
	Prefix     string `json:"prefix"` // token 前 8 位，仅用于列表里辨认
	Name       string `json:"name"`
	CreatedAt  string `json:"created_at"`
	LastUsedAt string `json:"last_used_at,omitempty"`
}

// FastPin 是 fast_pins 表的一行。
type FastPin struct {
	UserID    int64
	ItemID    string
	ExpiresAt string
}

var errNotFound = errors.New("not found")

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// ---------- 用户 ----------

func (s *Store) CountUsers() (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

func (s *Store) CreateUser(username, passwordHash string, isAdmin bool) (*User, error) {
	res, err := s.db.Exec(
		`INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?)`,
		username, passwordHash, boolToInt(isAdmin), nowStr())
	if err != nil {
		return nil, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	return s.GetUserByID(id)
}

func scanUser(row *sql.Row) (*User, error) {
	u := &User{}
	var admin, disabled int
	err := row.Scan(&u.ID, &u.Username, &u.PasswordHash, &admin, &disabled, &u.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errNotFound
	}
	if err != nil {
		return nil, err
	}
	u.IsAdmin = admin != 0
	u.Disabled = disabled != 0
	return u, nil
}

func (s *Store) GetUserByUsername(username string) (*User, error) {
	return scanUser(s.db.QueryRow(
		`SELECT id, username, password_hash, is_admin, disabled, created_at FROM users WHERE username = ?`, username))
}

func (s *Store) GetUserByID(id int64) (*User, error) {
	return scanUser(s.db.QueryRow(
		`SELECT id, username, password_hash, is_admin, disabled, created_at FROM users WHERE id = ?`, id))
}

func (s *Store) ListUsers() ([]*User, error) {
	rows, err := s.db.Query(
		`SELECT id, username, password_hash, is_admin, disabled, created_at FROM users ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*User
	for rows.Next() {
		u := &User{}
		var admin, disabled int
		if err := rows.Scan(&u.ID, &u.Username, &u.PasswordHash, &admin, &disabled, &u.CreatedAt); err != nil {
			return nil, err
		}
		u.IsAdmin = admin != 0
		u.Disabled = disabled != 0
		out = append(out, u)
	}
	return out, rows.Err()
}

func (s *Store) SetUserDisabled(id int64, disabled bool) error {
	_, err := s.db.Exec(`UPDATE users SET disabled = ? WHERE id = ?`, boolToInt(disabled), id)
	return err
}

func (s *Store) SetUserPassword(id int64, hash string) error {
	_, err := s.db.Exec(`UPDATE users SET password_hash = ? WHERE id = ?`, hash, id)
	return err
}

// ---------- 会话 ----------

func (s *Store) CreateSession(userID int64) (string, error) {
	id := randHex(32)
	expires := time.Now().UTC().Add(sessionDays * 24 * time.Hour).Format(time.RFC3339Nano)
	_, err := s.db.Exec(
		`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
		id, userID, expires, nowStr())
	return id, err
}

// GetSessionUser 校验 session：存在、未过期、用户未被禁用。
func (s *Store) GetSessionUser(sessionID string) (*User, error) {
	u := &User{}
	var admin, disabled int
	err := s.db.QueryRow(
		`SELECT u.id, u.username, u.password_hash, u.is_admin, u.disabled, u.created_at
		 FROM sessions s JOIN users u ON u.id = s.user_id
		 WHERE s.id = ? AND s.expires_at > ?`, sessionID, nowStr()).
		Scan(&u.ID, &u.Username, &u.PasswordHash, &admin, &disabled, &u.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errNotFound
	}
	if err != nil {
		return nil, err
	}
	u.IsAdmin = admin != 0
	u.Disabled = disabled != 0
	if u.Disabled {
		return nil, errNotFound
	}
	return u, nil
}

func (s *Store) DeleteSession(sessionID string) error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE id = ?`, sessionID)
	return err
}

func (s *Store) DeleteExpiredSessions() {
	// 顺手清理，失败也无所谓
	s.db.Exec(`DELETE FROM sessions WHERE expires_at <= ?`, nowStr())
}

// DeleteUserSessions 吊销某用户全部会话（改密码/重置密码后调用）。
func (s *Store) DeleteUserSessions(userID int64) {
	s.db.Exec(`DELETE FROM sessions WHERE user_id = ?`, userID)
}

// ---------- API token ----------

func (s *Store) CreateAPIToken(userID int64, name, token string) (*APIToken, error) {
	res, err := s.db.Exec(
		`INSERT INTO api_tokens (user_id, token_hash, prefix, name, created_at) VALUES (?, ?, ?, ?, ?)`,
		userID, sha256Hex(token), token[:8], name, nowStr())
	if err != nil {
		return nil, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	return &APIToken{ID: id, Prefix: token[:8], Name: name, CreatedAt: nowStr()}, nil
}

func (s *Store) ListAPITokens(userID int64) ([]*APIToken, error) {
	rows, err := s.db.Query(
		`SELECT id, prefix, name, created_at, COALESCE(last_used_at, '') FROM api_tokens
		 WHERE user_id = ? ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*APIToken
	for rows.Next() {
		t := &APIToken{}
		if err := rows.Scan(&t.ID, &t.Prefix, &t.Name, &t.CreatedAt, &t.LastUsedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Store) DeleteAPIToken(userID, tokenID int64) error {
	res, err := s.db.Exec(`DELETE FROM api_tokens WHERE id = ? AND user_id = ?`, tokenID, userID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errNotFound
	}
	return nil
}

// GetTokenUser 由 Bearer token 找用户，并更新 last_used_at。
func (s *Store) GetTokenUser(token string) (*User, error) {
	u := &User{}
	var admin, disabled int
	var tokenID int64
	err := s.db.QueryRow(
		`SELECT u.id, u.username, u.password_hash, u.is_admin, u.disabled, u.created_at, t.id
		 FROM api_tokens t JOIN users u ON u.id = t.user_id
		 WHERE t.token_hash = ?`, sha256Hex(token)).
		Scan(&u.ID, &u.Username, &u.PasswordHash, &admin, &disabled, &u.CreatedAt, &tokenID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errNotFound
	}
	if err != nil {
		return nil, err
	}
	u.IsAdmin = admin != 0
	u.Disabled = disabled != 0
	if u.Disabled {
		return nil, errNotFound
	}
	s.db.Exec(`UPDATE api_tokens SET last_used_at = ? WHERE id = ?`, nowStr(), tokenID)
	return u, nil
}

// ---------- 条目 ----------

const itemColumns = `i.id, i.owner_id, i.type, i.title, i.snippet, i.body, i.mime, i.size,
	i.sha256, i.filename, i.blob_path, i.created_at, i.updated_at, i.share_token,
	i.shared_from_user_id, i.shared_from_item_id, i.width, i.height,
	COALESCE(u.username, '')`

func scanItem(row interface{ Scan(...any) error }) (*Item, error) {
	it := &Item{}
	var sharedFrom sql.NullInt64
	err := row.Scan(&it.ID, &it.OwnerID, &it.Type, &it.Title, &it.Snippet, &it.Body,
		&it.Mime, &it.Size, &it.SHA256, &it.Filename, &it.BlobPath, &it.CreatedAt,
		&it.UpdatedAt, &it.ShareToken, &sharedFrom, &it.SharedFromItemID,
		&it.Width, &it.Height, &it.SharedFromUsername)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errNotFound
	}
	if err != nil {
		return nil, err
	}
	if sharedFrom.Valid {
		v := sharedFrom.Int64
		it.SharedFromUserID = &v
	}
	return it, nil
}

func (s *Store) CreateItem(it *Item) error {
	_, err := s.db.Exec(
		`INSERT INTO items (id, owner_id, type, title, snippet, body, mime, size, sha256,
			filename, blob_path, created_at, updated_at, share_token,
			shared_from_user_id, shared_from_item_id, width, height)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		it.ID, it.OwnerID, it.Type, it.Title, it.Snippet, it.Body, it.Mime, it.Size,
		it.SHA256, it.Filename, it.BlobPath, it.CreatedAt, it.UpdatedAt, it.ShareToken,
		it.SharedFromUserID, it.SharedFromItemID, it.Width, it.Height)
	return err
}

func (s *Store) GetItem(id string) (*Item, error) {
	return scanItem(s.db.QueryRow(
		`SELECT `+itemColumns+` FROM items i LEFT JOIN users u ON u.id = i.shared_from_user_id WHERE i.id = ?`, id))
}

func (s *Store) GetItemByShareToken(token string) (*Item, error) {
	return scanItem(s.db.QueryRow(
		`SELECT `+itemColumns+` FROM items i LEFT JOIN users u ON u.id = i.shared_from_user_id WHERE i.share_token = ? AND i.share_token != ''`, token))
}

func (s *Store) GetLatestItem(ownerID int64) (*Item, error) {
	return scanItem(s.db.QueryRow(
		`SELECT `+itemColumns+` FROM items i LEFT JOIN users u ON u.id = i.shared_from_user_id
		 WHERE i.owner_id = ? ORDER BY i.created_at DESC LIMIT 1`, ownerID))
}

// ListFilter 是历史列表的查询条件。
type ListFilter struct {
	Type    string // 全部 / text / link / image / file
	Query   string // 关键词，查 title + snippet + 文本 body
	Sort    string // newest / oldest / size / type
	Page    int
	PerPage int
}

func likeEscape(q string) string {
	// LIKE 通配符转义，避免用户输入的 % _ 改变语义
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return "%" + r.Replace(q) + "%"
}

func (s *Store) ListItems(ownerID int64, f ListFilter) ([]*Item, int, error) {
	where := `i.owner_id = ?`
	args := []any{ownerID}
	if f.Type != "" && f.Type != "all" {
		where += ` AND i.type = ?`
		args = append(args, f.Type)
	}
	if f.Query != "" {
		where += ` AND (i.title LIKE ? ESCAPE '\' OR i.snippet LIKE ? ESCAPE '\' OR i.body LIKE ? ESCAPE '\')`
		like := likeEscape(f.Query)
		args = append(args, like, like, like)
	}
	var total int
	countArgs := append([]any{}, args...)
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM items i WHERE `+where, countArgs...).Scan(&total); err != nil {
		return nil, 0, err
	}
	order := `i.created_at DESC`
	switch f.Sort {
	case "oldest":
		order = `i.created_at ASC`
	case "size":
		order = `i.size DESC, i.created_at DESC`
	case "type":
		order = `i.type ASC, i.created_at DESC`
	}
	if f.PerPage <= 0 || f.PerPage > 200 {
		f.PerPage = 50
	}
	if f.Page < 1 {
		f.Page = 1
	}
	offset := (f.Page - 1) * f.PerPage
	query := `SELECT ` + itemColumns + ` FROM items i LEFT JOIN users u ON u.id = i.shared_from_user_id
		WHERE ` + where + ` ORDER BY ` + order + ` LIMIT ? OFFSET ?`
	args = append(args, f.PerPage, offset)
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []*Item{}
	for rows.Next() {
		it, err := scanItem(rows)
		if err != nil {
			return nil, 0, err
		}
		// 只有内容在 blob 文件里（超长文本/文件/图片）才不带 body；
		// 短文本的 body 在 DB 里，列表要带上——点按复制必须同步拿到全文，
		// 现取会丢 iOS 手势导致复制失败。
		if it.BlobPath != "" {
			it.Body = ""
		}
		out = append(out, it)
	}
	return out, total, rows.Err()
}

// FindItemByHash 找同一用户下内容与类型都相同的最新条目（去重用）。
// 没有返回 errNotFound。
func (s *Store) FindItemByHash(ownerID int64, sha, typ string) (*Item, error) {
	return scanItem(s.db.QueryRow(
		`SELECT `+itemColumns+` FROM items i LEFT JOIN users u ON u.id = i.shared_from_user_id
		 WHERE i.owner_id = ? AND i.sha256 = ? AND i.type = ? ORDER BY i.created_at DESC LIMIT 1`,
		ownerID, sha, typ))
}

// TouchItem 把条目的创建/更新时间刷新到 now（重复粘贴时把旧卡顶到最前面）。
func (s *Store) TouchItem(id, now string) error {
	_, err := s.db.Exec(`UPDATE items SET created_at = ?, updated_at = ? WHERE id = ?`, now, now, id)
	return err
}

// dupGroup 是一组重复内容：同一用户的同类型同哈希条目。
type dupGroup struct {
	OwnerID int64
	SHA256  string
	Type    string
}

// DuplicateGroups 返回内容重复的分组（每组至少两条）。
func (s *Store) DuplicateGroups() ([]dupGroup, error) {
	rows, err := s.db.Query(
		`SELECT owner_id, sha256, type FROM items GROUP BY owner_id, sha256, type HAVING COUNT(*) > 1`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []dupGroup
	for rows.Next() {
		var g dupGroup
		if err := rows.Scan(&g.OwnerID, &g.SHA256, &g.Type); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// ListItemsByHash 返回该重复分组的全部条目（最新在前）。
func (s *Store) ListItemsByHash(ownerID int64, sha, typ string) ([]*Item, error) {
	rows, err := s.db.Query(
		`SELECT `+itemColumns+` FROM items i LEFT JOIN users u ON u.id = i.shared_from_user_id
		 WHERE i.owner_id = ? AND i.sha256 = ? AND i.type = ? ORDER BY i.created_at DESC`,
		ownerID, sha, typ)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Item
	for rows.Next() {
		it, err := scanItem(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// IsItemPinned 查条目是否被置顶到 fast（去重合并时优先保留）。
func (s *Store) IsItemPinned(itemID string) (bool, error) {
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM fast_pins WHERE item_id = ?`, itemID).Scan(&n); err != nil {
		return false, err
	}
	return n > 0, nil
}

// TotalSize 返回某用户全部条目的总字节数（历史页页脚展示）。
func (s *Store) TotalSize(ownerID int64) (int64, error) {
	var n sql.NullInt64
	err := s.db.QueryRow(`SELECT SUM(size) FROM items WHERE owner_id = ?`, ownerID).Scan(&n)
	if err != nil {
		return 0, err
	}
	return n.Int64, nil
}

// UpdateItemText 原地修改文本/链接条目（不产生新记录，不留旧版本）。
func (s *Store) UpdateItemText(id, body, title, snippet string, size int64, sha string) error {
	_, err := s.db.Exec(
		`UPDATE items SET body = ?, title = ?, snippet = ?, size = ?, sha256 = ?, updated_at = ? WHERE id = ?`,
		body, title, snippet, size, sha, nowStr(), id)
	return err
}

// UpdateItemBlobPath 用于超长文本改短后落回 DB（或反之）时更新 blob 路径。
func (s *Store) UpdateItemBlobPath(id, blobPath string) error {
	_, err := s.db.Exec(`UPDATE items SET blob_path = ? WHERE id = ?`, blobPath, id)
	return err
}

func (s *Store) DeleteItem(id string) error {
	// 先删置顶引用，再删条目本身
	s.db.Exec(`DELETE FROM fast_pins WHERE item_id = ?`, id)
	res, err := s.db.Exec(`DELETE FROM items WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return errNotFound
	}
	return nil
}

func (s *Store) SetShareToken(id, token string) error {
	_, err := s.db.Exec(`UPDATE items SET share_token = ? WHERE id = ?`, token, id)
	return err
}

// ---------- Fast 置顶 ----------

func (s *Store) GetPin(userID int64) (*FastPin, error) {
	p := &FastPin{}
	err := s.db.QueryRow(
		`SELECT user_id, item_id, expires_at FROM fast_pins WHERE user_id = ?`, userID).
		Scan(&p.UserID, &p.ItemID, &p.ExpiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errNotFound
	}
	return p, err
}

// SetPin 置顶（每用户一条，新置顶替换旧的）。
func (s *Store) SetPin(userID int64, itemID string, expires time.Time) error {
	_, err := s.db.Exec(
		`INSERT INTO fast_pins (user_id, item_id, expires_at) VALUES (?, ?, ?)
		 ON CONFLICT(user_id) DO UPDATE SET item_id = excluded.item_id, expires_at = excluded.expires_at`,
		userID, itemID, expires.UTC().Format(time.RFC3339Nano))
	return err
}

func (s *Store) DeletePin(userID int64) error {
	_, err := s.db.Exec(`DELETE FROM fast_pins WHERE user_id = ?`, userID)
	return err
}
