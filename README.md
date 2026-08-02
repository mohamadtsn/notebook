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

`docker compose up -d` starts `server` and runs `frontend-build` (which builds into `./dist` and
exits). It does **not** start a web server — see below.

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

### 2. Build the frontend

```bash
docker compose run --rm frontend-build      # writes ./dist
```

### 3. Start the backend

```bash
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

```bash
git pull
docker compose run --rm frontend-build
docker compose up -d --build server     # only if the backend changed
```

No Nginx reload needed — static files are picked up as they land. Open browsers show a
«نسخه جدید آماده است» toast and reload when the user accepts.

> **Cache headers matter here.** `sw.js` and `workbox-*.js` are served `no-cache`; the
> content-hashed assets are `immutable`. A cached service worker means the app can never learn a new
> version exists, so don't fold those rules into a generic `.js` block.

---

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