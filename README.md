# Notebook

دفترچه — a Persian-first, offline-first notebook. React 19 + TypeScript + Vite, installable as a
PWA, with an optional Fastify/SQLite backend for syncing notes across devices.

Sync is opt-in. With no account the app is fully local: notes live in `localStorage`, nothing leaves
the browser, and signing out later keeps every local note.

## Features

- **Offline-first**: works with no network and no account; the backend is optional.
- **PWA**: installable, precached app shell, update-on-demand (never reloads mid-sentence).
- **RTL/LTR per field**: direction is detected per title and body, defaulting to RTL.
- **Markdown preview**: hand-rolled renderer, no dependency, escape-first.
- **Soft delete**: deleted notes go to trash; only `permanentDelete` removes them.
- **Dark mode**, keyboard shortcuts, motion that honours `prefers-reduced-motion`.

## Tech stack

| Layer | Choice |
| --- | --- |
| Frontend | React 19, TypeScript, Vite 8 |
| Styling | Tailwind CSS 4 (configured in `src/index.css`, no config file) |
| UI | Radix UI (Tooltip), Lucide icons, `motion` |
| PWA | `vite-plugin-pwa` (Workbox) |
| Backend | Fastify 5, `node:sqlite`, JWT |
| Serving | Nginx |

## Prerequisites

- Node.js 24+ (the backend runs `.ts` sources directly via type stripping — no build step)
- Docker + Docker Compose (for the backend and production builds)

---

## Local development

### Frontend only (no sync)

```bash
npm install
npm run dev          # http://localhost:5173
```

That is the whole app. Skip the rest of this section unless you want sync.

### With the backend

```bash
cp .env.example .env
```

Edit `.env` — the server **refuses to boot** without a `JWT_SECRET` of at least 32 characters:

```bash
openssl rand -base64 48        # paste the result into JWT_SECRET
```

For local dev the browser talks to the API directly, so `CORS_ORIGIN` must match the Vite dev server
and `VITE_API_URL` must point at the published backend port:

```dotenv
CORS_ORIGIN=http://localhost:5173
BACKEND_PORT=3236
VITE_API_URL=http://localhost:3236
```

The container writes SQLite files into `./data`, so it has to run as the account that owns that
directory. Append your ids and create it before the first start:

```bash
printf 'UID=%s\nGID=%s\n' "$(id -u)" "$(id -g)" >> .env
mkdir -p data && chown "$(id -u):$(id -g)" data
```

Then:

```bash
docker compose up -d server
npm run dev
```

The SQLite file appears at `./data/` — a plain host directory, not a Docker volume, so no `docker`
command can wipe it.

Running the backend without Docker works too:

```bash
cd server && npm install && JWT_SECRET=... node src/index.ts
```

### Everything in Docker

`docker compose up -d --build` starts `server` and runs `frontend-build` (which builds into `./dist`
and exits). It does **not** start a web server — see below. Keep the `--build`: `frontend-build`
carries the source inside its image, so a plain `up -d` rebuilds whatever commit the image was made
from.

```bash
docker compose up -d --build frontend-serve    # opt-in Nginx on FRONTEND_PORT
```

`frontend-serve` sits behind the Compose profile `serve`, so a plain `docker compose up -d` never
starts it. Naming the service on the command line activates the profile automatically. In this mode
Nginx only serves static files; the browser reaches the API directly, so keep `VITE_API_URL` pointing
at `BACKEND_PORT` and `CORS_ORIGIN` at `FRONTEND_PORT`.

---

## Production

The recommended setup uses the server's **own Nginx** and skips the `frontend-serve` container
entirely — proxying one Nginx through another buys nothing and complicates cache headers.

### 1. Configure

```bash
cp .env.example .env
```

```dotenv
JWT_SECRET=<openssl rand -base64 48>
CORS_ORIGIN=https://yourdomain.com
BACKEND_PORT=3236
VITE_API_URL=/api
```

`VITE_API_URL=/api` makes the browser call the same origin; Nginx strips the `/api` prefix before
forwarding. **It is read at build time**, so changing it means rebuilding the frontend.

The AI proxy is optional and off unless all three of its variables are set:

```dotenv
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=<provider key>
AI_MODEL=gpt-4o-mini
AI_DAILY_LIMIT=300
```

With them unset, `/ai/complete` answers `503` and the app says so instead of failing — users can
still use «مستقیم» mode, where their own key stays in their own browser and is never synced. The
key, the model and the base URL are **only** ever read from this file: the endpoint takes none of
them from the client, because a client-supplied base URL would turn the server into an SSRF proxy.

### 2. Build the frontend

Create `./dist` yourself first. Both bind-mounted directories follow the same rule: if Docker has to
create one, it lands owned by `root` and the container — which runs as your uid — cannot write to it.

```bash
mkdir -p dist
docker compose run --rm --build frontend-build      # writes ./dist
```

**`--build` is not optional.** The source is `COPY`-ed into the image, so without it Compose reuses
the existing image and rebuilds the *old* source into `./dist` — the command succeeds, `./dist` is
rewritten, and none of your changes are in it. The npm layer is cached, so `--build` only costs a
`COPY` unless `package-lock.json` changed.

### 3. Start the backend

`./data` is gitignored, so a fresh clone does not have it. If you let Docker create it, it lands
owned by `root` and SQLite cannot write — create it yourself and record the ids compose should use:

```bash
printf 'UID=%s\nGID=%s\n' "$(id -u)" "$(id -g)" >> .env
mkdir -p data && chown "$(id -u):$(id -g)" data
docker compose up -d server
```

The port is published on `127.0.0.1` only. The API is reachable exclusively through Nginx, never raw
from the internet.

### 4. Install the Nginx config

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/notebook
sudo ln -s /etc/nginx/sites-available/notebook /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Edit two lines in it first: `server_name` and `root` (the absolute path to this repo's `./dist`).

Add TLS with `sudo certbot --nginx -d yourdomain.com`; certbot rewrites the config in place.

### Deploying an update

On the server, use the deployment script from the repository root:

```bash
./deploy/deploy.sh
```

It refuses a dirty working tree, updates the checked-out branch with a fast-forward-only pull,
builds the frontend, recreates the backend, and waits for `GET /health` to succeed. It also checks
that `.env` has the deploy user's `UID`/`GID` and that `data` and `dist` are writable before changing
the running application.

The equivalent manual commands are:

```bash
git pull
docker compose run --rm --build frontend-build   # --build or you ship the previous commit
docker compose up -d --build server              # only if the backend changed
```

No Nginx reload needed — static files are picked up as they land. Open browsers show a
«نسخه جدید آماده است» toast and reload when the user accepts.

> **Cache headers matter here.** `sw.js` and `workbox-*.js` are served `no-cache`; the
> content-hashed assets are `immutable`. A cached service worker means the app can never learn a new
> version exists, so don't fold those rules into a generic `.js` block.

---

## Troubleshooting

**`Error: unable to open database file` / `ERR_SQLITE_ERROR` errcode 14** — the `server` container's
uid does not own `./data`. Compose reads `UID`/`GID` from `.env` only; the shell does not export
`UID` and has no `GID` at all, so without them it falls back to `1000:1000`. Fix:

```bash
printf 'UID=%s\nGID=%s\n' "$(id -u)" "$(id -g)" >> .env
sudo chown -R "$(id -u):$(id -g)" data
docker compose up -d --force-recreate server
```

Verify with `docker compose config | grep user:` — it must show your real ids.

**403 Forbidden from nginx, and `./dist` is empty** — the build container could not write to the
mount. Check `stat -c '%U:%G' dist`; if it says `root:root`, Docker created it. Fix:

```bash
docker run --rm -v "$PWD/dist:/d" alpine chown -R "$(id -u):$(id -g)" /d
docker compose run --rm --build frontend-build
```

**403 Forbidden but `./dist` has files** — nginx cannot traverse the path. `namei -l
/srv/notebook/dist/index.html` shows the first directory missing `x` for others; a repo under
`/home/USER` is the usual culprit. On RHEL-family systems check SELinux instead:
`sudo chcon -R -t httpd_sys_content_t /srv/notebook/dist`.

**The app never picks up a new version** — check `./dist` before you suspect caching. If
`frontend-build` ran without `--build`, Compose reused the old image and rebuilt the previous
commit's source; the asset hashes in `dist/index.html` never change and there is nothing for the
service worker to update to:

```bash
grep -o 'assets/[^"]*\.js' dist/index.html   # must change between deploys
```

If the hashes did change, then check the caching layers: `curl -I https://yourdomain.com/sw.js` must
show `no-cache`, and a CDN in front must not cache `sw.js` or `index.html` — an `Age:` or a cache
`HIT` on `sw.js` pins the app to the old version permanently.

**API calls 404 in production** — Fastify serves `/auth/*` and `/sync/*` at the root. The trailing
slash in `proxy_pass http://127.0.0.1:3236/;` is what strips the `/api` prefix; without it the
backend receives `/api/sync/pull` and rejects it.

## Layout

```
src/            frontend
server/         Fastify + SQLite backend
docker/         Dockerfiles + the config for the opt-in frontend-serve container
deploy/         nginx.conf for the production host
data/           SQLite file (gitignored, host-owned)
dist/           build output (gitignored)
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | `tsc -b && vite build` — type errors fail the build |
| `npm run lint` | ESLint |
| `npm run preview` | Serve `dist/` locally |
| `npm run check` | Asserts the markdown-escaping and sync-merge invariants |
| `cd server && npm test` | Backend sync/auth tests (`node:test`) |
| `cd server && npm run typecheck` | Backend types |

## Docs

- `DESIGN.md` — the design system. Every visual, layout, and motion decision comes from a token here.
- `PLAN-V2.md` — current roadmap.
- `CLAUDE.md` — architecture notes and invariants.
