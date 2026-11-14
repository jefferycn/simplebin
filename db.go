package main

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

// schema 是全部表结构。v2 从空库开始，不做 v1 迁移。
const schema = `
CREATE TABLE IF NOT EXISTS users (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	username TEXT NOT NULL UNIQUE,
	password_hash TEXT NOT NULL,
	is_admin INTEGER NOT NULL DEFAULT 0,
	disabled INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
	id TEXT PRIMARY KEY,
	owner_id INTEGER NOT NULL REFERENCES users(id),
	type TEXT NOT NULL,
	title TEXT NOT NULL DEFAULT '',
	snippet TEXT NOT NULL DEFAULT '',
	body TEXT NOT NULL DEFAULT '',
	mime TEXT NOT NULL DEFAULT '',
	size INTEGER NOT NULL DEFAULT 0,
	sha256 TEXT NOT NULL DEFAULT '',
	filename TEXT NOT NULL DEFAULT '',
	blob_path TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	share_token TEXT NOT NULL DEFAULT '',
	shared_from_user_id INTEGER REFERENCES users(id),
	shared_from_item_id TEXT NOT NULL DEFAULT '',
	width INTEGER NOT NULL DEFAULT 0,
	height INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_share_token ON items(share_token) WHERE share_token != '';
CREATE INDEX IF NOT EXISTS idx_items_owner_created ON items(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_owner_type ON items(owner_id, type);

CREATE TABLE IF NOT EXISTS api_tokens (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL REFERENCES users(id),
	token_hash TEXT NOT NULL UNIQUE,
	prefix TEXT NOT NULL DEFAULT '',
	name TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL,
	last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tokens_user ON api_tokens(user_id);

CREATE TABLE IF NOT EXISTS fast_pins (
	user_id INTEGER PRIMARY KEY REFERENCES users(id),
	item_id TEXT NOT NULL REFERENCES items(id),
	expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
	id TEXT PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES users(id),
	expires_at TEXT NOT NULL,
	created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`

// Store 封装数据库与数据目录。
type Store struct {
	db      *sql.DB
	dataDir string // /data：放 simplebin.db 与 blobs/
}

// openStore 打开（或新建）数据库并建表。
func openStore(dataDir string) (*Store, error) {
	if err := os.MkdirAll(filepath.Join(dataDir, "blobs"), 0o755); err != nil {
		return nil, err
	}
	dbPath := filepath.Join(dataDir, "simplebin.db")
	// WAL + busy_timeout：读写并发时少报错；foreign_keys 打开外键约束。
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(ON)", dbPath)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // SQLite 单连接，避免写锁冲突
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db, dataDir: dataDir}, nil
}

func (s *Store) Close() error { return s.db.Close() }

// blobFile 由相对路径得到磁盘绝对路径。
func (s *Store) blobFile(rel string) string {
	return filepath.Join(s.dataDir, filepath.FromSlash(rel))
}

// blobPathFor 由条目 id 算出分片路径：blobs/ab/cd/<id>，每级取 id 前两位。
func blobPathFor(id string) string {
	return "blobs/" + id[0:2] + "/" + id[2:4] + "/" + id
}
