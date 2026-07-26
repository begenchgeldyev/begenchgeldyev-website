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
├── bun.lock                  # single workspace lockfile
├── biome.json
├── tsconfig.base.json
└── README.md
```

### Package boundary

- `packages/core` exports the domain layer: Drizzle schema and migrations, DB client, ABAC (PEP/PDP/PIP), DI container, and app-container wiring.
- `apps/site` owns everything HTTP and HTML: `Bun.serve()` routes, the SSR renderer in `site.ts`, page fragments, components, and public assets. It imports domain code from the core package via the workspace protocol (e.g. `"@bg/core": "workspace:*"`).
- Rendering stays server-side in the same process. There is no network hop between site and core.
- Drizzle ownership moves with the schema: `packages/core/drizzle.config.ts`, `packages/core/drizzle/migrations/`, and core package scripts own `db:generate`, `db:migrate`, `db:push`, and `db:seed`. The root `package.json` may expose convenience scripts that delegate to `packages/core`, but there should be one source of truth for migration paths.

Bun workspaces wire the two packages together. No publish step, no version drift. The repository root owns the workspace install and commits the single root `bun.lock`; package-local lockfiles should not be retained after the migration.

### Deploy stack (`infra/compose.yml`)

Three services, all in Docker:

- **caddy** — official image. Mounts `infra/Caddyfile` and a named volume for certs/config. Exposes 80/443 to the host. Handles HTTPS automatically via Let's Encrypt.
- **site** — built with repo-root context and `apps/site/Dockerfile`, so the image can install the Bun workspace and copy both `apps/site` and `packages/core`. Listens on 8613 internally. No ports exposed to the host — traffic reaches it only through Caddy on the internal Docker network.
- **postgres** — same image and volume as today. No host port is exposed unless a temporary maintenance workflow explicitly needs it.

`site` receives all runtime configuration through Compose:

- `DATABASE_URL=postgres://...@postgres:5432/...`
- `ADMIN_SECRET` for the current admin login flow
- optional `PORT=8613` and `NODE_ENV=production`

The current `backend/.env` should become an untracked site environment file consumed by Compose, for example `apps/site/.env` or `infra/site.env`. Choose one path during implementation and document it in `README.md`; do not bake secrets into the image.

Because `infra/compose.yml` lives below the repo root, the site build stanza should use repo-root context:

```yaml
site:
  build:
    context: ..
    dockerfile: apps/site/Dockerfile
```

### Caddyfile

```
www.begenchgeldyev.com {
    redir https://begenchgeldyev.com{uri} permanent
}

begenchgeldyev.com {
    reverse_proxy site:8613
}
```

Caddy provisions and renews certificates automatically on first request. No `init-letsencrypt.sh`, no certbot container, no renewal cron. The `www` host remains supported and redirects permanently to the apex domain, matching the current nginx hostname coverage.

### Kill list

Removed from the repo:

- `nginx.conf`
- `init-letsencrypt.sh`
- `docker-compose.yml` (replaced by `infra/compose.yml`)
- Root-level `src/` (contents moved into `apps/site/`)
- Root-level `node_modules/`
- `pnpm-lock.yaml` (project uses Bun)
- `backend/bun.lock` (replaced by root `bun.lock`)
- `.eslintrc.yml` and `.prettierrc.yml` / `prettierrc.yml` (project uses Biome)
- `postcss.config.js` (Tailwind is loaded from CDN per `CLAUDE.md`)
- `declarations.d.ts` — move into `apps/site/` if still required, otherwise delete

### Migration order

Steps are ordered so nothing breaks mid-move; each step should end with a working local dev loop before the next begins.

1. **Restructure locally.** Create `apps/site/` and `packages/core/`. Set up Bun workspaces in the root `package.json`, regenerate a root `bun.lock`, and remove package-local/stale lockfiles. Move files, fix imports (`@/` alias updated in each package's `tsconfig.json`). Verify `bun run dev` from `apps/site/` still works and hits Postgres.
2. **Move DB tooling.** Move Drizzle config and migrations into `packages/core`, update migration/seed scripts, and verify `bun run db:migrate` and `bun run db:seed` through the chosen root/package commands.
3. **Add new infra.** Write `infra/Caddyfile` and `infra/compose.yml`. Include the root-context Docker build stanza, Caddy named volumes, `DATABASE_URL`, `ADMIN_SECRET`, and no public `site` port. Test locally: `docker compose -f infra/compose.yml up` should bring up Caddy → site → postgres end-to-end on localhost (with a local Caddyfile override for `http://localhost` during testing).
4. **Update GitHub Actions.** Point the existing deploy workflow at `infra/compose.yml`, including `docker compose -f infra/compose.yml up --build -d`.
5. **Cut over on the server.** Stop the current stack. Pull the new tree. Put the chosen untracked env file in place with `ADMIN_SECRET`. Run `docker compose -f infra/compose.yml up --build -d`. Caddy grabs certs on first HTTPS request. Verify the apex site loads over HTTPS with a valid cert, and verify `www.begenchgeldyev.com` redirects to the apex domain.
6. **Delete the kill list.** Only after step 5 is confirmed healthy.

## Non-goals

- Splitting into multiple repositories.
- Moving off the self-hosted VPS.
- Introducing managed Postgres or any paid service.
- Reworking the ABAC model, the SSR approach, or swapping HTMX for a client framework.
- Preparing the backend for reuse by other projects.

## Open questions

None at design time. Naming of the core package (placeholder `@bg/core`) can be finalized during implementation.
