// SimpleBin v2：自建多用户剪贴板。
// Go 重写，SQLite 存元数据，文件存磁盘分片目录，单二进制部署。
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"time"
)

// App 汇集全部依赖，handler 都挂在它上面。
type App struct {
	store         *Store
	limiter       *loginLimiter
	secureCookies bool
}

func main() {
	// 配置全走环境变量，默认值方便本地开发；Docker 里由 compose 传入。
	dataDir := getenv("DATA_DIR", "./data")
	port := getenv("PORT", "8080")
	secureCookies := getenv("SECURE_COOKIES", "true") != "false"

	store, err := openStore(dataDir)
	if err != nil {
		log.Fatalf("打开数据库失败: %v", err)
	}
	defer store.Close()

	app := &App{store: store, limiter: newLoginLimiter(), secureCookies: secureCookies}
	if n := app.deduplicateExisting(); n > 0 {
		log.Printf("去重：合并了 %d 张重复卡片", n)
	}
	if n := app.backfillFileSnippets(); n > 0 {
		log.Printf("预览摘要：补了 %d 个文本文件的摘要", n)
	}
	mux := app.routes()

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           app.securityHeaders(mux),
		ReadHeaderTimeout: 10 * time.Second,
	}
	// 优雅停机：收到 SIGINT/SIGTERM 后等手头请求处理完再退出
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(shutdownCtx)
	}()
	log.Printf("SimpleBin v2 启动：端口 %s，数据目录 %s", port, dataDir)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalf("服务退出: %v", err)
	}
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// securityHeaders 给所有响应加安全头。
func (a *App) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		// 不缓存：每次都向服务器确认新版。否则主屏幕 PWA 会一直用旧的
		// CSS/JS，部署了新版手机上还不见效（公开页自己会改成 no-store）。
		w.Header().Set("Cache-Control", "no-cache")
		// 不允许被嵌进 iframe；脚本/样式只允许本站与内联（内联用于少量页面脚本）
		w.Header().Set("Content-Security-Policy",
			"default-src 'self'; img-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; "+
				"style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; "+
				"base-uri 'self'; form-action 'self'")
		next.ServeHTTP(w, r)
	})
}

func (a *App) routes() *http.ServeMux {
	mux := http.NewServeMux()

	// ---- 页面（需登录的走 requirePage） ----
	mux.HandleFunc("GET /{$}", a.homeHandler) // 浏览器进首页，API 客户端走旧接口
	mux.HandleFunc("GET /login", servePage("login.html"))
	mux.HandleFunc("GET /register", servePage("register.html"))
	mux.HandleFunc("GET /history", a.requirePage(func(w http.ResponseWriter, r *http.Request, u *User) {
		servePage("history.html")(w, r)
	}))
	mux.HandleFunc("GET /new", a.requirePage(func(w http.ResponseWriter, r *http.Request, u *User) {
		servePage("new.html")(w, r)
	}))
	mux.HandleFunc("GET /item/{id}", a.requirePage(func(w http.ResponseWriter, r *http.Request, u *User) {
		servePage("item.html")(w, r)
	}))
	mux.HandleFunc("GET /settings", a.requirePage(func(w http.ResponseWriter, r *http.Request, u *User) {
		servePage("settings.html")(w, r)
	}))
	mux.HandleFunc("GET /admin", a.requirePage(func(w http.ResponseWriter, r *http.Request, u *User) {
		if !u.IsAdmin {
			http.Redirect(w, r, "/", http.StatusFound)
			return
		}
		servePage("admin.html")(w, r)
	}))
	mux.Handle("GET /static/", staticFS())

	// ---- 公开页（无鉴权） ----
	mux.HandleFunc("GET /fast/{username}", a.fastHandler)
	mux.HandleFunc("GET /fast/{username}/blob", a.fastBlobHandler)
	mux.HandleFunc("GET /s/{token}", a.shareHandler)
	mux.HandleFunc("GET /s/{token}/blob", a.shareBlobHandler)

	// ---- 旧 API 兼容（必须带 Bearer token） ----
	mux.HandleFunc("POST /{$}", a.legacyCreate)
	mux.HandleFunc("GET /plain", a.legacyPlain)
	mux.HandleFunc("GET /json", a.legacyLatestJSON)
	mux.HandleFunc("GET /{id}", a.legacyGetByID)
	// GET /{id}/json 不直接注册：会与 GET /static/ 冲突导致启动 panic，
	// 改在下面的 catch-all 里按路径形状分发。

	// ---- 新 API ----
	mux.HandleFunc("GET /api/v1/status", a.statusHandler)
	mux.HandleFunc("POST /api/v1/register", a.registerHandler)
	mux.HandleFunc("POST /api/v1/login", a.loginHandler)
	mux.HandleFunc("POST /api/v1/logout", a.requireAPI(a.logoutHandler))
	mux.HandleFunc("GET /api/v1/me", a.requireAPI(a.meHandler))
	mux.HandleFunc("POST /api/v1/me/password", a.requireAPI(a.changePasswordHandler))
	mux.HandleFunc("GET /api/v1/users", a.requireAPI(a.listUsersHandler))

	mux.HandleFunc("GET /api/v1/items", a.requireAPI(a.listItemsHandler))
	mux.HandleFunc("POST /api/v1/items", a.requireAPI(a.createItemHandler))
	mux.HandleFunc("GET /api/v1/items/latest", a.requireAPI(a.latestItemHandler))
	mux.HandleFunc("GET /api/v1/items/{id}", a.requireAPI(a.getItemHandler))
	mux.HandleFunc("PUT /api/v1/items/{id}", a.requireAPI(a.updateItemHandler))
	mux.HandleFunc("DELETE /api/v1/items/{id}", a.requireAPI(a.deleteItemHandler))
	mux.HandleFunc("GET /api/v1/items/{id}/blob", a.requireAPI(a.blobHandler))
	mux.HandleFunc("POST /api/v1/items/{id}/share-link", a.requireAPI(a.createShareLinkHandler))
	mux.HandleFunc("DELETE /api/v1/items/{id}/share-link", a.requireAPI(a.deleteShareLinkHandler))
	mux.HandleFunc("POST /api/v1/items/{id}/share", a.requireAPI(a.shareToUserHandler))
	mux.HandleFunc("POST /api/v1/items/{id}/fast", a.requireAPI(a.pinFastHandler))
	mux.HandleFunc("GET /api/v1/fast", a.requireAPI(a.getFastHandler))
	mux.HandleFunc("DELETE /api/v1/fast", a.requireAPI(a.unpinFastHandler))

	mux.HandleFunc("GET /api/v1/tokens", a.requireAPI(a.listTokensHandler))
	mux.HandleFunc("POST /api/v1/tokens", a.requireAPI(a.createTokenHandler))
	mux.HandleFunc("DELETE /api/v1/tokens/{id}", a.requireAPI(a.deleteTokenHandler))

	mux.HandleFunc("GET /api/v1/admin/users", a.requireAdmin(a.adminListUsersHandler))
	mux.HandleFunc("POST /api/v1/admin/users", a.requireAdmin(a.adminCreateUserHandler))
	mux.HandleFunc("POST /api/v1/admin/users/{id}/reset-password", a.requireAdmin(a.adminResetPasswordHandler))
	mux.HandleFunc("POST /api/v1/admin/users/{id}/disable", a.requireAdmin(a.adminSetDisabledHandler(true)))
	mux.HandleFunc("POST /api/v1/admin/users/{id}/enable", a.requireAdmin(a.adminSetDisabledHandler(false)))

	// 未匹配的路径：先看是不是旧 API 的 GET /{id}/json，再按浏览器/API 分流
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
			if len(parts) == 2 && parts[1] == "json" && parts[0] != "" {
				r.SetPathValue("id", parts[0])
				a.legacyGetJSONByID(w, r)
				return
			}
		}
		if strings.Contains(r.Header.Get("Accept"), "text/html") {
			http.Redirect(w, r, "/", http.StatusFound)
			return
		}
		writeErr(w, http.StatusNotFound, "不存在")
	})
	return mux
}
