# SimpleBin v2

A very simple self-hosted clipboard: save text, links, images, or any file, and
pick them up on another device. You host it, so you own the data.

v2 is a from-scratch rewrite in Go (v1 was Spring Boot + Kotlin). See
[DESIGN.md](DESIGN.md) for the full product design.

## Features

- **Multi-user**: the first registered user becomes admin; admins create other
  users. Each user only sees their own items.
- **Web-first client**: one mobile-friendly web page. Home shows only the two
  things you use most — copy latest, paste new. A history page sorts, filters,
  searches, and manages everything.
- **Fast page**: pin one item to a public page (`/fast/<username>`) for 1, 5,
  or 10 minutes — handy when you're on a fresh computer without your password
  manager. Expired pins return 404.
- **Sharing**: per-item public links (`/s/<token>`), and share a copy to
  another user (the copy becomes their latest item).
- **Image viewer**: PhotoSwipe with swipe-down-to-close, pinch zoom, and
  swipe-through-all-images gestures.
- **SQLite + files**: metadata in one SQLite file, uploads in sharded
  directories. Back up by copying the whole data directory.
- **Tiny footprint**: ~21MB static binary, ~10–25MB RAM. No JVM, no runtime.

## Install

### Docker (recommended)

```shell
docker compose up -d --build
```

Or plain docker:

```shell
docker build -t simplebin:2.0 .
docker run -d -p 8080:8080 -v /path/to/data:/data simplebin:2.0
```

Then open http://localhost:8080 and register the first user — that user
automatically becomes the admin. Registration closes after that; admins create
further users on the Admin page.

### Build from source

Go 1.23 or newer required.

```shell
go build -o simplebin .
DATA_DIR=./data PORT=8080 ./simplebin
```

### Configuration

| Variable | Default | Description |
|---|---|---|
| `DATA_DIR` | `./data` | Data directory (`simplebin.db` + `blobs/`) |
| `PORT` | `8080` | Listen port |
| `SECURE_COOKIES` | `true` | Set session cookies `Secure` (keep `true` behind an HTTPS reverse proxy; use `false` only for plain-HTTP local debugging) |

### Reverse proxy

Put it behind HTTPS as usual (DSM reverse proxy, nginx, Caddy…). No special
headers are required; the app serves everything, including the frontend.

## Usage

### Web

- `/` — home: copy latest / paste (type, paste an image with Ctrl+V, or drag
  and drop a file).
- `/history` — sort, filter, search, edit, delete, share, pin to Fast.
- `/settings` — API tokens, change password, Fast pin status.
- `/admin` — user management (admins only).

### API tokens

Each user generates their own tokens on the Settings page. A token is shown
only once — store it in your password manager. Scripts use it as
`Authorization: Bearer <token>`.

### curl

Create a text item:

```shell
curl -X POST 'http://localhost:8080/' \
  --header 'Authorization: Bearer sb_...' \
  --header 'Content-Type: text/plain' \
  --data-raw 'Made by Jeffery'
```

Create a link (a body that is just a URL is stored as a link):

```shell
curl -X POST 'http://localhost:8080/' \
  --header 'Authorization: Bearer sb_...' \
  --header 'Content-Type: text/plain' \
  --data-raw 'https://youjf.com'
```

Upload a file:

```shell
curl -X POST 'http://localhost:8080/' \
  --header 'Authorization: Bearer sb_...' \
  --form 'file=@"/path/to/your/file.ext"'
```

Get the latest item (JSON / plain text):

```shell
curl 'http://localhost:8080/json' --header 'Authorization: Bearer sb_...'
curl 'http://localhost:8080/plain' --header 'Authorization: Bearer sb_...'
```

The JSON API lives under `/api/v1/` (items, tokens, admin, Fast pins). The
legacy routes above (`POST /`, `GET /`, `/plain`, `/json`) are kept for the
old shell scripts and Shortcuts, but now require a per-user Bearer token.

### iOS / desktop

The web page is the official client — add it to the Home Screen. The old iOS
Shortcuts and tray apps are legacy; see
[integrations/iPhone/Readme.md](integrations/iPhone/Readme.md).

## Backup

Copy the whole data directory (`simplebin.db`, `simplebin.db-wal`,
`simplebin.db-shm`, `blobs/`). To restore, copy it back and restart.

## Upgrading from v1

v2 starts with an empty database — there is no migration of v1 data, by
design. The old `/{id}` public links no longer work. Keep the old container
around for reference until you are sure nothing in it matters, then remove it.
