# Repo Restructure + Caddy Migration — Design

**Date:** 2026-07-25
**Status:** Approved

## Problem

Two pains with the current setup:

1. **Deployment friction.** Self-hosted docker-compose with nginx + certbot + `init-letsencrypt.sh` is heavier than the site warrants. Certificate provisioning and renewal are scripted by hand.
2. **Repo hygiene.** Root directory mixes app code (`backend/`, `src/`), infra (`docker-compose.yml`, `nginx.conf`, `init-letsencrypt.sh`), and stale config (`pnpm-lock.yaml`, `.eslintrc.yml`, `postcss.config.js`, `prettierrc.yml`). The `backend/` folder is the whole app, but the boundary between HTTP/rendering code and domain code (DB, ABAC) is not enforced.

Reuse across other projects is explicitly out of scope.

## Constraints

- Keep the stack: Bun, HTMX, Postgres, Drizzle, hand-rolled ABAC, SSR via `site.ts`.
- Stay self-hosted on the existing server.
- Zero incremental cost.
- One repository, one deployable.

## Design

### Repo layout

```
begenchgeldyev/
├── apps/
│   └── site/                 # was backend/
│       ├── server.ts
│       ├── site.ts           # SSR renderer
│       ├── pages/            # moved from root src/pages
│       ├── components/       # moved from root src/components
│       ├── public/           # moved from root src/public
│       ├── Dockerfile
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   └── core/
│       ├── db/               # drizzle schema, client, migrations
│       ├── abac/             # pep, pdp, pip
│       ├── DIContainer.ts
│       ├── app-container.ts
│       └── package.json
├── infra/
│   ├── compose.yml           # caddy + site + postgres
│   └── Caddyfile
├── docs/
├── .github/workflows/        # updated to reference infra/compose.yml
├── package.json              # bun workspaces root
├── biome.json
├── tsconfig.base.json
└── README.md
```

### Package boundary

- `packages/core` exports the domain layer: Drizzle schema and migrations, DB client, ABAC (PEP/PDP/PIP), DI container, and app-container wiring.
- `apps/site` owns everything HTTP and HTML: `Bun.serve()` routes, the SSR renderer in `site.ts`, page fragments, components, and public assets. It imports domain code from the core package via the workspace protocol (e.g. `"@bg/core": "workspace:*"`).
- Rendering stays server-side in the same process. There is no network hop between site and core.

Bun workspaces wire the two packages together. No publish step, no version drift.

### Deploy stack (`infra/compose.yml`)

Three services, all in Docker:

- **caddy** — official image. Mounts `infra/Caddyfile` and a named volume for certs/config. Exposes 80/443 to the host. Handles HTTPS automatically via Let's Encrypt.
- **site** — built from `apps/site/Dockerfile`. Listens on 8613 internally. No ports exposed to the host — traffic reaches it only through Caddy on the internal Docker network.
- **postgres** — same image and volume as today. `DATABASE_URL` injected into the `site` service.

### Caddyfile

```
begenchgeldyev.com {
    reverse_proxy site:8613
}
```

Caddy provisions and renews certificates automatically on first request. No `init-letsencrypt.sh`, no certbot container, no renewal cron.

### Kill list

Removed from the repo:

- `nginx.conf`
- `init-letsencrypt.sh`
- `docker-compose.yml` (replaced by `infra/compose.yml`)
- Root-level `src/` (contents moved into `apps/site/`)
- Root-level `node_modules/`
- `pnpm-lock.yaml` (project uses Bun)
- `.eslintrc.yml` and `.prettierrc.yml` / `prettierrc.yml` (project uses Biome)
- `postcss.config.js` (Tailwind is loaded from CDN per `CLAUDE.md`)
- `declarations.d.ts` — move into `apps/site/` if still required, otherwise delete

### Migration order

Steps are ordered so nothing breaks mid-move; each step should end with a working local dev loop before the next begins.

1. **Restructure locally.** Create `apps/site/` and `packages/core/`. Set up Bun workspaces in the root `package.json`. Move files, fix imports (`@/` alias updated in each package's `tsconfig.json`). Verify `bun run dev` from `apps/site/` still works and hits Postgres.
2. **Add new infra.** Write `infra/Caddyfile` and `infra/compose.yml`. Test locally: `docker compose -f infra/compose.yml up` should bring up Caddy → site → postgres end-to-end on localhost (with a local Caddyfile override for `http://localhost` during testing).
3. **Update GitHub Actions.** Point the existing deploy workflow at `infra/compose.yml`.
4. **Cut over on the server.** Stop the current stack. Pull the new tree. Run `docker compose -f infra/compose.yml up -d`. Caddy grabs certs on first HTTPS request. Verify the site loads over HTTPS with a valid cert.
5. **Delete the kill list.** Only after step 4 is confirmed healthy.

## Non-goals

- Splitting into multiple repositories.
- Moving off the self-hosted VPS.
- Introducing managed Postgres or any paid service.
- Reworking the ABAC model, the SSR approach, or swapping HTMX for a client framework.
- Preparing the backend for reuse by other projects.

## Open questions

None at design time. Naming of the core package (placeholder `@bg/core`) can be finalized during implementation.
