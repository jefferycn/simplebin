package main

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"math/big"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	maxUploadSize = 100 << 20 // 上传上限 100MB（与 v1 一致）
	maxInlineText = 64 << 10  // 文本小于 64KB 直接存 DB，否则存 blob 文件
	sessionDays   = 30        // 会话有效期 30 天
)

// nowStr 返回 UTC 的 RFC3339Nano 时间字符串；同一精度下可直接按字符串排序。
func nowStr() string { return time.Now().UTC().Format(time.RFC3339Nano) }

func parseTime(s string) (time.Time, error) { return time.Parse(time.RFC3339Nano, s) }

const base62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

// randBase62 生成 n 位随机 base62 字符串（crypto/rand），用于条目 id 与分享 token。
func randBase62(n int) string {
	var b strings.Builder
	for i := 0; i < n; i++ {
		v, err := rand.Int(rand.Reader, big.NewInt(int64(len(base62))))
		if err != nil {
			panic(err) // 随机源不可用是致命错误，不应继续
		}
		b.WriteByte(base62[v.Int64()])
	}
	return b.String()
}

// randHex 生成 n 字节随机数的 hex 字符串，用于 session id。
func randHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

// sha256Hex 对 token 做哈希：库里只存哈希，原文只在生成时显示一次。
func sha256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

var usernameRe = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,31}$`)

// validUsername：小写字母/数字/-/下划线，1–32 位，以字母或数字开头。
func validUsername(s string) bool { return usernameRe.MatchString(s) }

// validPassword：最短 8 位。不做复杂度要求，自建小工具够用。
func validPassword(s string) bool { return len(s) >= 8 }

// truncateRunes 按 rune 截断字符串，超长加省略号。
func truncateRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return string(r[:n]) + "…"
}

// firstLine 取文本首行（去掉首尾空白），用于标题。
func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	return strings.TrimSpace(s)
}

// looksText 判断文件头是不是文本：不含 NUL 字节，且 UTF-8 有效
// （允许末尾被截断的多字节字符）。
func looksText(b []byte) bool {
	if len(b) == 0 || bytes.IndexByte(b, 0) >= 0 {
		return false
	}
	if utf8.Valid(b) {
		return true
	}
	for i := 1; i <= 3 && i < len(b); i++ {
		if utf8.Valid(b[:len(b)-i]) {
			return true
		}
	}
	return false
}

// textPreview 从文件头取文本预览（最多 200 字）：非文本返回 ""。
// 用于 md/txt 等文本文件的卡片预览。
func textPreview(b []byte) string {
	if !looksText(b) {
		return ""
	}
	for !utf8.Valid(b) { // 去掉末尾截断的多字节字符（最多 3 字节）
		b = b[:len(b)-1]
	}
	return truncateRunes(strings.TrimSpace(string(b)), 200)
}

// isURL 判断整段文本是否就是一个 http(s) 链接；是则返回 host。
func isURL(s string) (string, bool) {
	t := strings.TrimSpace(s)
	if t == "" || strings.ContainsAny(t, " \t\r\n") {
		return "", false
	}
	u, err := url.Parse(t)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", false
	}
	return u.Host, true
}
