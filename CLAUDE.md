# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Runtime

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun install` instead of `npm install`
- Bun automatically loads `.env` — don't use dotenv.
- Use `Bun.serve()` for HTTP — don't use Express.
- Use `Bun.file` for file I/O — don't use `node:fs` readFile/writeFile.
- Use `bun:sqlite` for SQLite (don't use `better-sqlite3`), `Bun.sql` for Postgres (don't use `pg`).

## Commands

All backend commands run from `backend/`:

```bash
bun run dev          # hot-reload dev server
bun run start        # production server
bun run lint         # biome check (no writes)
bun run format       # biome check --write (formats + organizes imports)
bun run db:generate  # generate SQL migrations from schema changes
bun run db:migrate   # apply migrations to postgres
bun run db:seed      # seed owner user and default policies
```

From the repo root:
```bash
docker compose up -d  # start nginx, postgres, backend, certbot
```

## Architecture

This is a personal portfolio site with a terminal/hacker aesthetic (dark theme, green accents, scanline animation).

### Request flow

```
Client → nginx (SSL termination) → Bun server (port 8613)
```

The single Bun server (`backend/server.ts`) handles everything:
1. **API routes** (`/title`, `/projects`) — defined directly in `Bun.serve({ routes })`.
2. **Static assets** (`/public/*`) — served from `src/public/` via `servePublicAsset()`.
3. **HTML pages** (everything else) — dispatched to `renderPage()` in `backend/site.ts`.

### SSR (server-side rendering)

`backend/site.ts` is the templating engine. It owns:
- **`PAGE_CONFIGS`** — maps URL paths to page metadata (title, active nav, footer variant, etc.).
- **`renderLayout()`** — assembles the full HTML document: shared `<head>` (Tailwind CDN, HTMX, fonts, custom CSS), header, page fragment, footer.
- **`resolveIncludes()`** — replaces `<!--#include filename.html-->` comments in page HTML with component partials from `src/components/`.
- **`servePublicAsset()`** — path-safe static file serving with MIME detection.

Page fragments live in `src/pages/`. Component partials (header, footer HTML) live in `src/components/` but are currently superseded by the TypeScript `renderHeader()`/`renderFooter()` functions in `site.ts`.

Frontend uses **HTMX** (no React/Vue). Styling uses **Tailwind CSS from CDN** with a Material Design 3 color palette extended in the inline `tailwind.config`. Fonts: Space Grotesk (headline/label), Inter (body), JetBrains Mono (mono).

### Dependency injection

`backend/src/DIContainer.ts` is a hand-rolled singleton DI container. Classes decorated with `@Injectable()` or registered via `container.registerFactory()` are resolved lazily and cached as singletons.

Wiring lives in `backend/src/app-container.ts`. When adding new services, register them there.

### ABAC authorization

Routes that require authorization wrap their handler with `enforce()` from `backend/src/abac/pep.ts`:

```ts
POST: enforce(handler, { actions: 'create', resource: 'project' })
```

The enforcement pipeline:
- **PEP** (`pep.ts`) — extracts `x-user-email` from the request header, fetches subject attributes and policies, calls the PDP.
- **PDP** (`pdp.ts`) — pure function that evaluates policies against `{ subject, action, resource, resourceAttributes, context }`. Deny-overrides-allow; defaults to deny if no policy matches.
- **PIP** (`pip.ts`) — fetches `users` and `policies` rows from Postgres.

Policies and user roles are stored in the database (`backend/src/db/schema.ts`). Seed the initial owner account and allow-all policy with `bun run db:seed`.

### Database

Drizzle ORM with PostgreSQL. Schema: `projects`, `users` (with `role` enum: owner/editor/viewer), `policies` (with `effect` enum: allow/deny).

Path alias `@/` resolves to `backend/src/` (configured in `tsconfig.json`).

### Infrastructure

`docker-compose.yml` runs four services: `nginx` (reverse proxy, SSL), `certbot` (auto-renew Let's Encrypt), `postgres` (port 5432), `backend` (port 8613). The backend's `DATABASE_URL` is injected by Compose; local dev reads it from `backend/.env`.
