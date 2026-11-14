package main

import (
	"crypto/sha256"
	"encoding/hex"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// newItemID 生成 12 位随机 base62 id；冲突概率极低，冲突时调用方重试即可。
func newItemID() string { return randBase62(12) }

// createTextItem 新建文本/链接条目。整段是 URL 则判为 link。
// 文本小于 64KB 存 DB，否则存 blob 文件（body 置空，读取时从文件取）。
func (a *App) createTextItem(ownerID int64, text string) (*Item, error) {
	now := nowStr()
	it := &Item{
		ID:        newItemID(),
		OwnerID:   ownerID,
		CreatedAt: now,
		UpdatedAt: now,
	}
	trimmed := strings.TrimSpace(text)
	if host, ok := isURL(trimmed); ok {
		it.Type = "link"
		it.Title = host
		it.Snippet = trimmed
		it.Body = trimmed
	} else {
		it.Type = "text"
		it.Title = truncateRunes(firstLine(text), 100)
		it.Snippet = truncateRunes(text, 200)
		it.Body = text
	}
	sum := sha256.Sum256([]byte(it.Body))
	it.SHA256 = hex.EncodeToString(sum[:])
	it.Size = int64(len(it.Body))
	it.Mime = "text/plain; charset=utf-8"
	if len(it.Body) >= maxInlineText {
		// 超长文本落盘
		it.BlobPath = blobPathFor(it.ID)
		if err := a.writeBlob(it.BlobPath, strings.NewReader(it.Body)); err != nil {
			return nil, err
		}
		it.Body = ""
	}
	if err := a.store.CreateItem(it); err != nil {
		if it.BlobPath != "" {
			os.Remove(a.store.blobFile(it.BlobPath))
		}
		return nil, err
	}
	return it, nil
}

// createFileItem 新建文件/图片条目：流式落盘，边写边算 sha256。
func (a *App) createFileItem(ownerID int64, filename string, src io.Reader) (*Item, error) {
	now := nowStr()
	it := &Item{
		ID:        newItemID(),
		OwnerID:   ownerID,
		CreatedAt: now,
		UpdatedAt: now,
		Filename:  filename,
		Title:     filename,
	}
	it.BlobPath = blobPathFor(it.ID)
	// 先写临时文件，写完再移到最终位置，避免半截文件被读到
	tmpPath := filepath.Join(a.store.dataDir, "blobs", ".tmp-"+it.ID)
	if err := os.MkdirAll(filepath.Dir(tmpPath), 0o755); err != nil {
		return nil, err
	}
	tmp, err := os.Create(tmpPath)
	if err != nil {
		return nil, err
	}
	h := sha256.New()
	size, err := io.Copy(io.MultiWriter(tmp, h), src)
	tmp.Close()
	if err != nil {
		os.Remove(tmpPath)
		return nil, err
	}
	it.Size = size
	it.SHA256 = hex.EncodeToString(h.Sum(nil))

	// MIME：先嗅探前 512 字节，嗅不出来再看扩展名
	f, err := os.Open(tmpPath)
	if err != nil {
		os.Remove(tmpPath)
		return nil, err
	}
	head := make([]byte, 512)
	n, _ := io.ReadFull(f, head)
	it.Mime = http.DetectContentType(head[:n])
	if it.Mime == "application/octet-stream" {
		if ext := mime.TypeByExtension(strings.ToLower(filepath.Ext(filename))); ext != "" {
			it.Mime = ext
		}
	}
	// 图片读宽高（PhotoSwipe 用；读不出来就留 0，前端按原图实测）
	if strings.HasPrefix(it.Mime, "image/") {
		it.Type = "image"
		if _, err := f.Seek(0, io.SeekStart); err == nil {
			if cfg, _, err := image.DecodeConfig(f); err == nil {
				it.Width, it.Height = cfg.Width, cfg.Height
			}
		}
	} else {
		it.Type = "file"
	}
	f.Close()
	final := a.store.blobFile(it.BlobPath)
	if err := os.MkdirAll(filepath.Dir(final), 0o755); err != nil {
		os.Remove(tmpPath)
		return nil, err
	}
	if err := os.Rename(tmpPath, final); err != nil {
		os.Remove(tmpPath)
		return nil, err
	}
	if err := a.store.CreateItem(it); err != nil {
		os.Remove(final)
		return nil, err
	}
	return it, nil
}

// writeBlob 把内容写入分片路径（超长文本用）。
func (a *App) writeBlob(rel string, r io.Reader) error {
	p := a.store.blobFile(rel)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	f, err := os.Create(p)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, r)
	return err
}

// itemBody 取文本/链接条目的全文（DB 里没有就从 blob 文件读）。
func (a *App) itemBody(it *Item) (string, error) {
	if it.Type != "text" && it.Type != "link" {
		return "", nil
	}
	if it.BlobPath == "" {
		return it.Body, nil
	}
	b, err := os.ReadFile(a.store.blobFile(it.BlobPath))
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// loadFullBody 把全文填回 it.Body（单条读取、复制、编辑时用）。
func (a *App) loadFullBody(it *Item) error {
	if it.Type != "text" && it.Type != "link" {
		return nil
	}
	body, err := a.itemBody(it)
	if err != nil {
		return err
	}
	it.Body = body
	return nil
}

// updateTextItem 原地修改文本/链接条目：类型不变（链接改后仍是链接，
// 即使新内容不再是 URL——避免编辑后类型乱跳；真想换类型就新建一条）。
func (a *App) updateTextItem(it *Item, text string) error {
	sum := sha256.Sum256([]byte(text))
	sha := hex.EncodeToString(sum[:])
	size := int64(len(text))
	var title, snippet string
	if it.Type == "link" {
		host, _ := isURL(strings.TrimSpace(text))
		if host == "" {
			host = truncateRunes(firstLine(text), 100)
		}
		title, snippet = host, text
	} else {
		title, snippet = truncateRunes(firstLine(text), 100), truncateRunes(text, 200)
	}
	if len(text) >= maxInlineText {
		// 改后仍超长：写 blob，DB body 置空
		blobPath := it.BlobPath
		if blobPath == "" {
			blobPath = blobPathFor(it.ID)
		}
		if err := a.writeBlob(blobPath, strings.NewReader(text)); err != nil {
			return err
		}
		if err := a.store.UpdateItemBlobPath(it.ID, blobPath); err != nil {
			return err
		}
		it.BlobPath = blobPath
		text = ""
	} else {
		// 改短了：落回 DB，删掉旧 blob 文件
		if it.BlobPath != "" {
			os.Remove(a.store.blobFile(it.BlobPath))
			a.store.UpdateItemBlobPath(it.ID, "")
			it.BlobPath = ""
		}
	}
	return a.store.UpdateItemText(it.ID, text, title, snippet, size, sha)
}

// deleteItem 硬删除条目：DB 记录与磁盘文件一起删。
func (a *App) deleteItem(it *Item) error {
	if err := a.store.DeleteItem(it.ID); err != nil {
		return err
	}
	if it.BlobPath != "" {
		os.Remove(a.store.blobFile(it.BlobPath))
	}
	return nil
}

// shareItemToUser 把条目分享给另一个用户：复制语义，新记录归对方所有，
// created_at 为当前时间（自然成为对方最新条目），并记下来源。
func (a *App) shareItemToUser(it *Item, from *User, to *User) (*Item, error) {
	now := nowStr()
	cp := &Item{
		ID:               newItemID(),
		OwnerID:          to.ID,
		Type:             it.Type,
		Title:            it.Title,
		Snippet:          it.Snippet,
		Body:             it.Body,
		Mime:             it.Mime,
		Size:             it.Size,
		SHA256:           it.SHA256,
		Filename:         it.Filename,
		CreatedAt:        now,
		UpdatedAt:        now,
		SharedFromUserID: &from.ID,
		SharedFromItemID: it.ID,
		Width:            it.Width,
		Height:           it.Height,
	}
	if it.BlobPath != "" {
		// 文件/超长文本：复制 blob 文件（副本独立，原条目删除不影响副本）
		cp.BlobPath = blobPathFor(cp.ID)
		src, err := os.Open(a.store.blobFile(it.BlobPath))
		if err != nil {
			return nil, err
		}
		defer src.Close()
		if err := a.writeBlob(cp.BlobPath, src); err != nil {
			return nil, err
		}
	}
	if err := a.store.CreateItem(cp); err != nil {
		if cp.BlobPath != "" {
			os.Remove(a.store.blobFile(cp.BlobPath))
		}
		return nil, err
	}
	cp.SharedFromUsername = from.Username
	return cp, nil
}
