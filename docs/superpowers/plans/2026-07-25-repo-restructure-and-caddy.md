# Repo Restructure + Caddy Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the repo into a Bun workspace (`apps/site` + `packages/core`), and replace nginx + certbot with Caddy in a single `infra/compose.yml`, without changing any application behavior.

**Architecture:** One repository, one deployable. `packages/core` owns the domain layer (DB, schema, ABAC, DIContainer, repositories). `apps/site` owns HTTP/SSR (server.ts, site.ts, page fragments, static assets, controllers, and the composition root `app-container.ts`). Both are wired via Bun workspaces. Docker Compose runs three services from `infra/`: Caddy (automatic HTTPS reverse proxy), site, and Postgres.

**Tech Stack:** Bun (workspaces, `Bun.serve`, `Bun.file`, `bun:sql`), Drizzle ORM + drizzle-kit, PostgreSQL 17, Docker Compose, Caddy 2, Biome, HTMX (frontend, unchanged).

**Design note on `app-container.ts`:** The spec placed `app-container.ts` in `packages/core`, but it wires `ProjectController` which lives in `apps/site` (because the controller imports the SSR renderer). Making core depend on site would be a cycle. The plan therefore keeps `DIContainer.ts` in `packages/core` (it is generic infrastructure) and moves `app-container.ts` into `apps/site` (it is the composition root of the app). This is the only intentional deviation from the spec.

**No-tests note:** The current codebase has no unit tests. Following TDD literally for a pure file-move refactor would produce no useful tests. Each task therefore uses executable verification commands (dev server boot, HTTP requests, `docker compose up`) instead of unit-test steps. If a real behavior change ever gets tacked onto this refactor, that change gets a proper test.

---

## Preconditions

- Working tree is clean (or all pending work is committed).
- On branch `main` at commit `eaecb53` (the spec commit) or later.
- Docker + Docker Compose v2 installed locally.
- Bun installed locally, version >= 1.1.

---

## Task 1: Create feature branch and snapshot current dev loop

**Files:**
- None modified

- [ ] **Step 1: Create branch**

Run:
```bash
git checkout -b restructure-workspace-caddy
```

Expected: `Switched to a new branch 'restructure-workspace-caddy'`.

- [ ] **Step 2: Verify current dev loop works before touching anything**

Run:
```bash
cd backend && bun run dev &
BOOT_PID=$!
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8613/
curl -s http://localhost:8613/api/title
kill $BOOT_PID
cd ..
```

Expected: first curl prints `200`; second curl prints a JSON `{"title":"..."}`. This is the baseline the restructure must preserve.

- [ ] **Step 3: Commit the branch marker (empty commit)**

Run:
```bash
git commit --allow-empty -m "chore: start repo restructure + caddy branch"
```

---

## Task 2: Create workspace root `package.json` and `tsconfig.base.json`

**Files:**
- Modify: `package.json`
- Create: `tsconfig.base.json`

- [ ] **Step 1: Replace root `package.json` with workspace root**

Overwrite `/home/begench/projects/begenchgeldyev/package.json` with:

```json
{
  "name": "begenchgeldyev",
  "author": "Begench Geldyev <begenchgeldyev@gmail.com>",
  "version": "1.0.0",
  "description": "Personal portfolio & blog — Bun workspace (site + core)",
  "license": "MIT",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "dev": "bun --cwd apps/site run dev",
    "start": "bun --cwd apps/site run start",
    "lint": "biome check .",
    "format": "biome check --write .",
    "db:generate": "bun --cwd packages/core run db:generate",
    "db:migrate": "bun --cwd packages/core run db:migrate",
    "db:push": "bun --cwd packages/core run db:push",
    "db:seed": "bun --cwd packages/core run db:seed"
  },
  "devDependencies": {
    "@biomejs/biome": "2.4.11",
    "@types/bun": "latest",
    "typescript": "^5.8.3"
  }
}
```

Note: Bun workspaces support `bun --cwd <path> run <script>` for delegating; if a future Bun release changes the flag, the equivalent is `(cd <path> && bun run <script>)`.

- [ ] **Step 2: Create `tsconfig.base.json` at repo root**

Create `/home/begench/projects/begenchgeldyev/tsconfig.base.json` with:

```json
{
  "compilerOptions": {
    "types": ["bun-types"],
    "target": "esnext",
    "lib": ["ESNext"],
    "module": "preserve",
    "moduleResolution": "bundler",
    "strict": true,
    "experimentalDecorators": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 3: Delete stale root `tsconfig.json` (it will be replaced later by per-package configs; keep no root TS project for now)**

Run:
```bash
rm tsconfig.json
```

- [ ] **Step 4: Commit**

Run:
```bash
git add package.json tsconfig.base.json
git rm tsconfig.json
git commit -m "chore: convert root package.json to bun workspace root"
```

---

## Task 3: Scaffold `packages/core` skeleton

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`

- [ ] **Step 1: Create directory and package.json**

Run:
```bash
mkdir -p packages/core
```

Create `/home/begench/projects/begenchgeldyev/packages/core/package.json`:

```json
{
  "name": "@bg/core",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./index.ts",
    "./db": "./db/index.ts",
    "./db/schema": "./db/schema.ts",
    "./abac/pep": "./abac/pep.ts",
    "./abac/pdp": "./abac/pdp.ts",
    "./abac/pip": "./abac/pip.ts",
    "./DIContainer": "./DIContainer.ts",
    "./project/project.repository": "./project/project.repository.ts"
  },
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:push": "drizzle-kit push",
    "db:seed": "bun db/seed.ts"
  },
  "dependencies": {
    "drizzle-orm": "^0.45.2",
    "postgres": "^3.4.7"
  },
  "devDependencies": {
    "drizzle-kit": "^0.31.10"
  }
}
```

- [ ] **Step 2: Create `packages/core/tsconfig.json`**

Create `/home/begench/projects/begenchgeldyev/packages/core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "baseUrl": "."
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "drizzle/migrations"]
}
```

- [ ] **Step 3: Commit**

Run:
```bash
git add packages/core
git commit -m "chore: scaffold packages/core"
```

---

## Task 4: Move domain code into `packages/core`

**Files:**
- Move: `backend/src/db/*` → `packages/core/db/`
- Move: `backend/src/abac/*` → `packages/core/abac/`
- Move: `backend/src/DIContainer.ts` → `packages/core/DIContainer.ts`
- Move: `backend/src/project/project.repository.ts` → `packages/core/project/project.repository.ts`
- Move: `backend/drizzle/` → `packages/core/drizzle/`
- Move: `backend/drizzle.config.ts` → `packages/core/drizzle.config.ts`

- [ ] **Step 1: Move files with `git mv` (preserves history)**

Run:
```bash
mkdir -p packages/core/db packages/core/abac packages/core/project

git mv backend/src/db/db.ts        packages/core/db/db.ts
git mv backend/src/db/index.ts     packages/core/db/index.ts
git mv backend/src/db/schema.ts    packages/core/db/schema.ts
git mv backend/src/db/seed.ts      packages/core/db/seed.ts

git mv backend/src/abac/pdp.ts     packages/core/abac/pdp.ts
git mv backend/src/abac/pep.ts     packages/core/abac/pep.ts
git mv backend/src/abac/pip.ts     packages/core/abac/pip.ts

git mv backend/src/DIContainer.ts  packages/core/DIContainer.ts

git mv backend/src/project/project.repository.ts packages/core/project/project.repository.ts

git mv backend/drizzle             packages/core/drizzle
git mv backend/drizzle.config.ts   packages/core/drizzle.config.ts
```

- [ ] **Step 2: Fix `packages/core/abac/pip.ts` imports**

The file currently imports schema via the old `@/` alias (`import { users, policies } from '@/db/schema';`). Update it to a relative import.

Overwrite `/home/begench/projects/begenchgeldyev/packages/core/abac/pip.ts` with:

```ts
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { policies, users } from '../db/schema';

const db = drizzle(process.env.DATABASE_URL!);

export async function getSubjectAttributes(email: string | null) {
  if (!email) return { role: 'viewer' };

  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) return { role: 'viewer' };

  return { role: user.role, ...(user.attributes as Record<string, unknown>) };
}

export async function getPolicies() {
  return db.select().from(policies);
}
```

- [ ] **Step 3: Fix `packages/core/project/project.repository.ts` imports**

Overwrite `/home/begench/projects/begenchgeldyev/packages/core/project/project.repository.ts` with:

```ts
import { desc, eq } from 'drizzle-orm';
import { Injectable } from '../DIContainer';
import { type Db, projects } from '../db';

@Injectable()
export class ProjectsRepository {
  constructor(private readonly db: Db) {}

  list() {
    return this.db.select().from(projects).orderBy(desc(projects.createdAt));
  }

  async findById(id: number) {
    const [project] = await this.db.select().from(projects).where(eq(projects.id, id)).limit(1);
    return project ?? null;
  }

  updateById(
    id: number,
    input: { name: string; description: string | null; content: string | null; image: string | null; isHidden: boolean },
  ) {
    return this.db
      .update(projects)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id))
      .returning();
  }

  create(input: { name: string; description: string | null; content: string | null; image: string | null; isHidden: boolean }) {
    return this.db.insert(projects).values(input).returning();
  }
}
```

- [ ] **Step 4: Update `packages/core/drizzle.config.ts` (schema path is already relative — verify)**

Read `/home/begench/projects/begenchgeldyev/packages/core/drizzle.config.ts` and confirm it reads:

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema.ts',
  out: './drizzle/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

If the schema path is still `'./src/db/schema.ts'` from the old layout, overwrite the file with the block above.

- [ ] **Step 5: Create `packages/core/index.ts` barrel**

Create `/home/begench/projects/begenchgeldyev/packages/core/index.ts`:

```ts
export * from './db';
export * from './DIContainer';
export { canAccess, enforce, resolveEmail } from './abac/pep';
export { evaluate } from './abac/pdp';
export { getPolicies, getSubjectAttributes } from './abac/pip';
export { ProjectsRepository } from './project/project.repository';
```

- [ ] **Step 6: Commit**

Run:
```bash
git add packages/core
git commit -m "refactor: move domain code (db, abac, DIContainer, repository) into packages/core"
```

---

## Task 5: Scaffold `apps/site` skeleton

**Files:**
- Create: `apps/site/package.json`
- Create: `apps/site/tsconfig.json`

- [ ] **Step 1: Create directory and `package.json`**

Run:
```bash
mkdir -p apps/site
```

Create `/home/begench/projects/begenchgeldyev/apps/site/package.json`:

```json
{
  "name": "@bg/site",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun --hot server.ts",
    "start": "bun server.ts",
    "lint": "biome check .",
    "format": "biome check --write ."
  },
  "dependencies": {
    "@bg/core": "workspace:*",
    "drizzle-orm": "^0.45.2",
    "postgres": "^3.4.7"
  },
  "devDependencies": {
    "@types/bun": "^1.3.13",
    "bun-types": "^1.3.12",
    "typescript": "^5.8.3"
  }
}
```

- [ ] **Step 2: Create `apps/site/tsconfig.json`**

Create `/home/begench/projects/begenchgeldyev/apps/site/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@bg/core": ["../../packages/core/index.ts"],
      "@bg/core/*": ["../../packages/core/*"]
    }
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Commit**

Run:
```bash
git add apps/site
git commit -m "chore: scaffold apps/site package"
```

---

## Task 6: Move `site.ts`, `server.ts`, `project.controller.ts`, `app-container.ts` into `apps/site`

**Files:**
- Move: `backend/site.ts` → `apps/site/site.ts`
- Move: `backend/src/server.ts` → `apps/site/server.ts`
- Move: `backend/src/project/project.controller.ts` → `apps/site/project/project.controller.ts`
- Move: `backend/src/app-container.ts` → `apps/site/app-container.ts`

- [ ] **Step 1: Move files with `git mv`**

Run:
```bash
mkdir -p apps/site/project

git mv backend/site.ts                          apps/site/site.ts
git mv backend/src/server.ts                    apps/site/server.ts
git mv backend/src/project/project.controller.ts apps/site/project/project.controller.ts
git mv backend/src/app-container.ts             apps/site/app-container.ts
```

- [ ] **Step 2: Update `apps/site/site.ts` path resolution**

The old file resolved page/component/public dirs by going up one level from `backend/` to reach the root-level `src/`. Now `site.ts` lives at `apps/site/site.ts` and pages/components/public will move under `apps/site/` in Task 7.

Edit `/home/begench/projects/begenchgeldyev/apps/site/site.ts`, replacing the block:

```ts
const ROOT_DIR = join(import.meta.dir, '..');
const SRC_DIR = join(ROOT_DIR, 'src');
const PAGES_DIR = join(SRC_DIR, 'pages');
const COMPONENTS_DIR = join(SRC_DIR, 'components');
const PUBLIC_DIR = join(SRC_DIR, 'public');
```

with:

```ts
const APP_DIR = import.meta.dir;
const PAGES_DIR = join(APP_DIR, 'pages');
const COMPONENTS_DIR = join(APP_DIR, 'components');
const PUBLIC_DIR = join(APP_DIR, 'public');
```

- [ ] **Step 3: Rewrite `apps/site/server.ts` imports**

Overwrite `/home/begench/projects/begenchgeldyev/apps/site/server.ts` with:

```ts
import { canAccess, enforce, resolveEmail } from '@bg/core/abac/pep';
import { ProjectController } from './project/project.controller';
import { renderPage, servePublicAsset } from './site';
import { container } from './app-container';

const PORT = Number(process.env.PORT) || 8613;

function withPrefix<T>(prefix: string, routes: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(routes).map(([path, handler]) => [`${prefix}${path}`, handler]));
}

Bun.serve({
  port: PORT,
  routes: Object.assign(
    withPrefix('/api', {
      '/title': () => {
        const title = ['Javascript Ninja', 'VIM enjoyer', 'Software Engineer', 'Fullstack Developer'];
        const randomTitleIndex = Math.floor(Math.random() * title.length);
        const randomTitle = title.at(randomTitleIndex);
        return Response.json({ title: randomTitle });
      },
      '/projects': {
        GET: (req) => container.resolve(ProjectController).get(req),
        POST: enforce((req) => container.resolve(ProjectController).post(req), { actions: 'create', resource: 'project' }),
      },
      '/auth/login': {
        POST: async (req) => {
          let body: { secret?: string; email?: string } = {};
          try {
            body = await req.json();
          } catch {
            /* ignore */
          }
          const secret = process.env.ADMIN_SECRET;
          if (!secret || body.secret !== secret) {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
          }
          const email = body.email ?? 'begenchgeldyev@gmail.com';
          const cookie = `dev-user-email=${encodeURIComponent(email)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
          return Response.json({ ok: true }, { headers: { 'Set-Cookie': cookie } });
        },
      },
      '/auth/logout': {
        POST: () => {
          const cookie = `dev-user-email=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
          return Response.json({ ok: true }, { headers: { 'Set-Cookie': cookie } });
        },
      },
    }),
    {},
  ),

  async fetch(req) {
    const { pathname } = new URL(req.url);

    if (pathname.startsWith('/public/')) {
      return servePublicAsset(pathname);
    }

    const projectApiMatch = pathname.match(/^\/api\/projects\/(\d+)$/);
    if (projectApiMatch && req.method === 'PATCH') {
      const allowed = await canAccess(req, {
        actions: 'update',
        resource: 'project',
        resourceAttributes: { projectId: Number(projectApiMatch[1]) },
      });

      if (!allowed) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }

      return container.resolve(ProjectController).patch(req, Number(projectApiMatch[1]));
    }

    const projectDetailMatch = pathname.match(/^\/projects\/(\d+)$/);
    if (projectDetailMatch) {
      return container.resolve(ProjectController).getPageById(req, Number(projectDetailMatch[1]));
    }

    const page = await renderPage(pathname, resolveEmail(req));
    if (page) {
      return page;
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log(`Server running at http://localhost:${PORT}`);
```

- [ ] **Step 4: Rewrite `apps/site/app-container.ts` imports**

Overwrite `/home/begench/projects/begenchgeldyev/apps/site/app-container.ts` with:

```ts
import { Container, db, ProjectsRepository } from '@bg/core';
import { ProjectController } from './project/project.controller';

export const container = new Container();

container.registerFactory(ProjectsRepository, () => {
  return new ProjectsRepository(db);
});

container.registerFactory(ProjectController, (c) => {
  return new ProjectController(c.resolve(ProjectsRepository));
});
```

- [ ] **Step 5: Rewrite `apps/site/project/project.controller.ts` imports**

Read the existing file to preserve its full body (this plan showed only the top 80 lines during survey). Only the imports change; keep the entire rest of the file unchanged.

Edit `/home/begench/projects/begenchgeldyev/apps/site/project/project.controller.ts`. Replace the top import block:

```ts
import { canAccess, resolveEmail } from '@/abac/pep';
import { Injectable } from '@/DIContainer';
import { renderComponentTemplate, renderDocument } from '../../site';
import type { ProjectsRepository } from './project.repository';
```

with:

```ts
import { canAccess, resolveEmail, Injectable, type ProjectsRepository } from '@bg/core';
import { renderComponentTemplate, renderDocument } from '../site';
```

Do not modify any other lines in the file.

- [ ] **Step 6: Delete the now-empty `backend/` directory**

Run:
```bash
# Confirm nothing important remains
ls -la backend/
# Remove empty leftovers
rm -rf backend/node_modules
git rm backend/package.json backend/tsconfig.json backend/Dockerfile backend/README.md backend/CLAUDE.md backend/bun.lock backend/.env backend/.gitignore backend/docs/ 2>/dev/null || true
rm -rf backend
```

If `backend/.env` was tracked, remove from git tracking first with `git rm --cached backend/.env` (it should not be tracked because `.env` is in `.gitignore`; verify with `git status`). Keep a local copy of its contents — you will move them to the new env file in Task 8.

- [ ] **Step 7: Commit**

Run:
```bash
git add apps/site
git add -u  # capture backend deletions
git commit -m "refactor: move site.ts, server.ts, controller, and composition root into apps/site"
```

---

## Task 7: Move page fragments, components, and public assets into `apps/site`

**Files:**
- Move: `src/pages/` → `apps/site/pages/`
- Move: `src/components/` → `apps/site/components/`
- Move: `src/public/` → `apps/site/public/`

- [ ] **Step 1: Move directories with `git mv`**

Run:
```bash
git mv src/pages       apps/site/pages
git mv src/components  apps/site/components
git mv src/public      apps/site/public
rmdir src
```

- [ ] **Step 2: Commit**

Run:
```bash
git add -u
git commit -m "refactor: move pages/components/public into apps/site"
```

---

## Task 8: Site environment file

**Files:**
- Create: `apps/site/.env` (untracked — for local dev)
- Modify: `.gitignore` (ensure `apps/site/.env` is ignored)

- [ ] **Step 1: Verify `.gitignore` already ignores all `.env` files**

Read `/home/begench/projects/begenchgeldyev/.gitignore`. The first line should be `.env`. If it is not, add it. The plan requires:

```
.env
dist/
node_modules/
.todo.txt
.codex
```

- [ ] **Step 2: Create `apps/site/.env` locally with the contents from the old `backend/.env`**

Copy the values from the old `backend/.env` (backed up during Task 6, Step 6). At minimum:

```
DATABASE_URL=postgres://begench:begench@localhost:5432/begenchgeldyev
ADMIN_SECRET=<put the current admin secret here>
```

Do not commit this file — it should be gitignored.

- [ ] **Step 3: Verify it is not staged**

Run:
```bash
git status --porcelain apps/site/.env
```

Expected: empty output (file is ignored).

---

## Task 9: Install workspace deps and delete stale lockfiles

**Files:**
- Delete: root `pnpm-lock.yaml`, root `node_modules/`
- Delete: `postcss.config.js`, `.eslintrc.yml`, `.prettierrc.yml`, `prettierrc.yml`
- Delete: `declarations.d.ts` (or move it into `apps/site/` if imports still reference it)
- Create: root `bun.lock` (generated)

- [ ] **Step 1: Check whether `declarations.d.ts` is referenced**

Run:
```bash
grep -r "declarations" --include="*.ts" apps packages || echo "no references"
cat declarations.d.ts
```

If output is `no references` and the file contents are non-essential, delete it. If it declares module shims that are still needed, move it to `apps/site/declarations.d.ts` and add `"include": ["**/*.ts", "declarations.d.ts"]` to `apps/site/tsconfig.json`.

- [ ] **Step 2: Delete stale root files**

Run:
```bash
rm -rf node_modules
git rm pnpm-lock.yaml postcss.config.js .eslintrc.yml .prettierrc.yml prettierrc.yml 2>/dev/null || true
# declarations.d.ts: keep or delete based on Step 1
git rm declarations.d.ts 2>/dev/null || true
```

- [ ] **Step 3: Fresh install at repo root**

Run:
```bash
bun install
```

Expected: creates `bun.lock` and `node_modules/` at repo root, plus symlinked workspace packages under `node_modules/@bg/`.

- [ ] **Step 4: Confirm workspace symlinks**

Run:
```bash
ls -la node_modules/@bg/
```

Expected: `core -> ../../packages/core` and `site -> ../../apps/site` (or equivalent symlinks).

- [ ] **Step 5: Commit**

Run:
```bash
git add bun.lock package.json
git add -u
git commit -m "chore: install bun workspace, drop stale lockfile and legacy configs"
```

---

## Task 10: Verify local dev loop (no Docker yet)

**Files:**
- None modified

- [ ] **Step 1: Start Postgres locally via Docker (or use existing local pg)**

If you have no local Postgres, run temporarily:
```bash
docker run --rm -d --name bg-pg-tmp -e POSTGRES_USER=begench -e POSTGRES_PASSWORD=begench -e POSTGRES_DB=begenchgeldyev -p 5432:5432 postgres:17-alpine
sleep 3
```

- [ ] **Step 2: Apply migrations via new script path**

Run from repo root:
```bash
bun run db:migrate
```

Expected: drizzle-kit connects to Postgres and applies `packages/core/drizzle/migrations/0000_windy_talos.sql` without error.

- [ ] **Step 3: Seed the database**

Run:
```bash
bun run db:seed
```

Expected: prints `Seeded successfully` and exits 0.

- [ ] **Step 4: Boot the site dev server**

Run:
```bash
bun run dev &
BOOT_PID=$!
sleep 3
```

- [ ] **Step 5: Smoke-test HTTP endpoints**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8613/
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8613/cv
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8613/logs
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8613/projects
curl -s http://localhost:8613/api/title
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8613/api/projects
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8613/public/Begench%20Geldyev%28CV%29.pdf
```

Expected: all page endpoints return `200`; `/api/title` returns JSON; `/api/projects` returns `200`; `/public/...pdf` returns `200`.

- [ ] **Step 6: Stop dev server and (optionally) the temp Postgres**

Run:
```bash
kill $BOOT_PID
docker stop bg-pg-tmp 2>/dev/null || true
```

- [ ] **Step 7: If any endpoint failed**

Do NOT proceed. Common causes:
- Import paths still using `@/`: search `grep -r "'@/" apps packages`.
- `site.ts` still referencing the old `src/` layout: reopen `apps/site/site.ts` and confirm Task 6 Step 2 was applied.
- `pip.ts` still importing via `@/db/schema`: reapply Task 4 Step 2.
- `ProjectController` imports missing: reapply Task 6 Step 5.

Fix the root cause, re-run Step 5, and only then continue.

- [ ] **Step 8: Commit any fix-up changes with a descriptive message**

---

## Task 11: Write `apps/site/Dockerfile` for repo-root context

**Files:**
- Create: `apps/site/Dockerfile`

- [ ] **Step 1: Create the Dockerfile**

Create `/home/begench/projects/begenchgeldyev/apps/site/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1

FROM oven/bun:1
WORKDIR /usr/src/app

# Install workspace deps first for cache friendliness.
COPY package.json bun.lock ./
COPY apps/site/package.json ./apps/site/
COPY packages/core/package.json ./packages/core/
RUN bun install --frozen-lockfile

# Copy source last.
COPY apps/site ./apps/site
COPY packages/core ./packages/core

WORKDIR /usr/src/app/apps/site

ENV NODE_ENV=production
EXPOSE 8613

CMD ["bun", "server.ts"]
```

- [ ] **Step 2: Commit**

Run:
```bash
git add apps/site/Dockerfile
git commit -m "chore: add site Dockerfile with workspace-aware build"
```

---

## Task 12: Write `infra/Caddyfile` and `infra/compose.yml`

**Files:**
- Create: `infra/Caddyfile`
- Create: `infra/compose.yml`
- Create: `infra/site.env.example`
- Create: `infra/Caddyfile.local` (for local docker testing without ACME)

- [ ] **Step 1: Create `infra/Caddyfile` (production)**

Run:
```bash
mkdir -p infra
```

Create `/home/begench/projects/begenchgeldyev/infra/Caddyfile`:

```
www.begenchgeldyev.com {
    redir https://begenchgeldyev.com{uri} permanent
}

begenchgeldyev.com {
    reverse_proxy site:8613
    encode gzip
}
```

- [ ] **Step 2: Create `infra/Caddyfile.local` (for local docker testing)**

Create `/home/begench/projects/begenchgeldyev/infra/Caddyfile.local`:

```
:80 {
    reverse_proxy site:8613
    encode gzip
}
```

- [ ] **Step 3: Create `infra/site.env.example`**

Create `/home/begench/projects/begenchgeldyev/infra/site.env.example`:

```
DATABASE_URL=postgres://begench:begench@postgres:5432/begenchgeldyev
ADMIN_SECRET=change-me
PORT=8613
```

- [ ] **Step 4: Create `infra/compose.yml`**

Create `/home/begench/projects/begenchgeldyev/infra/compose.yml`:

```yaml
name: begenchgeldyev

services:
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on:
      - site
    networks:
      - begenchgeldyev-network

  site:
    build:
      context: ..
      dockerfile: apps/site/Dockerfile
    restart: unless-stopped
    env_file:
      - ./site.env
    environment:
      NODE_ENV: production
    depends_on:
      - postgres
    networks:
      - begenchgeldyev-network

  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: begench
      POSTGRES_PASSWORD: begench
      POSTGRES_DB: begenchgeldyev
    volumes:
      - pgdata:/var/lib/postgresql/data
    networks:
      - begenchgeldyev-network

volumes:
  pgdata:
  caddy-data:
  caddy-config:

networks:
  begenchgeldyev-network:
    driver: bridge
```

Notes on differences vs the old `docker-compose.yml`:
- No `nginx` service, no `certbot` service, no cert volumes.
- `site` no longer publishes port 8613 to the host — only Caddy is host-facing.
- `postgres` no longer publishes 5432 to the host in production. If you need psql access from the host, add `ports: ["5432:5432"]` locally (not in this file).
- `site` build context is `..` (repo root) so the workspace is available to Docker.
- `env_file` points at `infra/site.env` (untracked; create from `site.env.example`).

- [ ] **Step 5: Commit**

Run:
```bash
git add infra/Caddyfile infra/Caddyfile.local infra/site.env.example infra/compose.yml
git commit -m "feat(infra): add caddy + compose stack, replacing nginx + certbot"
```

---

## Task 13: Verify the compose stack locally with the local Caddyfile

**Files:**
- Uses: `infra/compose.yml`, `infra/Caddyfile.local`, temporary `infra/site.env`

- [ ] **Step 1: Copy example env**

Run from repo root:
```bash
cp infra/site.env.example infra/site.env
# edit infra/site.env to set ADMIN_SECRET to the same value used in Task 8
```

- [ ] **Step 2: Temporarily swap in the local Caddyfile**

Run:
```bash
cp infra/Caddyfile      infra/Caddyfile.prod.bak
cp infra/Caddyfile.local infra/Caddyfile
```

(A cleaner alternative is a `compose.local.yml` override file that mounts `Caddyfile.local`. For a one-time verification the swap is fine — Step 6 restores it.)

- [ ] **Step 3: Build and start the stack**

Run:
```bash
docker compose -f infra/compose.yml up --build -d
```

Wait for services to be healthy (about 10 seconds).

- [ ] **Step 4: Run migrations and seed against the containerized Postgres**

Run:
```bash
docker compose -f infra/compose.yml exec site bun --cwd /usr/src/app/packages/core run db:migrate
docker compose -f infra/compose.yml exec site bun --cwd /usr/src/app/packages/core run db:seed
```

Expected: migration applied, `Seeded successfully` printed. The seed will fail with a unique-constraint violation on the owner user if run twice — that is OK, seed is idempotent on `projects` via `onConflictDoNothing`; a second run will error on `users.email` unique. Ignore that error if you have already seeded.

- [ ] **Step 5: Smoke-test through Caddy on port 80**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost/
curl -s -o /dev/null -w "%{http_code}\n" http://localhost/projects
curl -s http://localhost/api/title
```

Expected: `200` from Caddy, JSON from `/api/title`.

- [ ] **Step 6: Tear down and restore prod Caddyfile**

Run:
```bash
docker compose -f infra/compose.yml down
mv infra/Caddyfile.prod.bak infra/Caddyfile
```

- [ ] **Step 7: Confirm no diff was introduced**

Run:
```bash
git status
```

Expected: `infra/Caddyfile` unchanged; `infra/site.env` untracked (correct).

---

## Task 14: Update GitHub Actions deploy workflow

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Overwrite the workflow**

Overwrite `/home/begench/projects/begenchgeldyev/.github/workflows/deploy.yml` with:

```yaml
name: Deploy

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /opt/apps/begenchgeldyev-frontend
            git pull origin main
            docker compose -f infra/compose.yml up --build -d
```

- [ ] **Step 2: Commit**

Run:
```bash
git add .github/workflows/deploy.yml
git commit -m "ci: point deploy workflow at infra/compose.yml"
```

---

## Task 15: Kill list — remove obsolete files

**Files:**
- Delete: `docker-compose.yml`, `nginx.conf`, `init-letsencrypt.sh`

- [ ] **Step 1: Delete replaced infra files**

Run:
```bash
git rm docker-compose.yml nginx.conf init-letsencrypt.sh
```

- [ ] **Step 2: Sanity-check no references remain**

Run:
```bash
grep -r "nginx" --include="*.yml" --include="*.md" --include="*.ts" . || echo "no residual references"
grep -r "certbot" --include="*.yml" --include="*.md" --include="*.ts" . || echo "no residual references"
grep -r "init-letsencrypt" . || echo "no residual references"
```

Expected: only matches in docs archived under `docs/` (if any) or nothing. Real references from live code or deploy scripts should be zero.

- [ ] **Step 3: Commit**

Run:
```bash
git commit -m "chore: remove nginx, certbot, and init-letsencrypt from the tree"
```

---

## Task 16: Update `CLAUDE.md` to reflect the new layout

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Rewrite the "Commands" and "Infrastructure" sections**

Edit `/home/begench/projects/begenchgeldyev/CLAUDE.md`.

Replace the block starting at `## Commands` and ending at `docker compose up -d  # start nginx, postgres, backend, certbot` (inclusive) with:

```markdown
## Commands

Run from the repo root (Bun workspace):

```bash
bun run dev          # hot-reload dev server (delegates to apps/site)
bun run start        # production server
bun run lint         # biome check (no writes)
bun run format       # biome check --write (formats + organizes imports)
bun run db:generate  # generate SQL migrations from schema changes
bun run db:migrate   # apply migrations to postgres
bun run db:seed      # seed owner user and default policies
```

Local Docker stack:
```bash
docker compose -f infra/compose.yml up -d  # caddy, site, postgres
```
```

Replace the `### Infrastructure` section at the bottom with:

```markdown
### Infrastructure

`infra/compose.yml` runs three services:
- **caddy** — Caddy 2, terminates HTTPS via automatic Let's Encrypt, reverse-proxies to `site:8613`. Config lives in `infra/Caddyfile`.
- **site** — the `apps/site` Bun app, built via `apps/site/Dockerfile` with the repo root as build context so it can install the workspace.
- **postgres** — PostgreSQL 17. `DATABASE_URL` and `ADMIN_SECRET` are injected via `infra/site.env` (untracked; create from `infra/site.env.example`).

Only Caddy exposes host ports (80/443). The site and Postgres talk on the internal `begenchgeldyev-network` bridge.
```

Also update any references to `backend/src/DIContainer.ts`, `backend/src/app-container.ts`, `backend/src/abac/pep.ts`, `backend/src/db/schema.ts`, and the path-alias line `Path alias @/ resolves to backend/src/` to their new locations:

- `backend/src/DIContainer.ts` → `packages/core/DIContainer.ts`
- `backend/src/app-container.ts` → `apps/site/app-container.ts`
- `backend/src/abac/pep.ts` → `packages/core/abac/pep.ts`
- `backend/src/db/schema.ts` → `packages/core/db/schema.ts`
- Delete the `Path alias @/ ...` sentence (the alias is gone; imports use `@bg/core` instead).
- Update the Request flow ASCII to `Client → Caddy (SSL termination) → Bun server (port 8613)`.
- Update `The single Bun server (backend/server.ts)` to `The single Bun server (apps/site/server.ts)`.
- Update `backend/site.ts` mentions to `apps/site/site.ts`.
- Update `src/components/` and `src/pages/` mentions to `apps/site/components/` and `apps/site/pages/`.

- [ ] **Step 2: Commit**

Run:
```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for workspace layout and caddy stack"
```

---

## Task 17: Full local end-to-end verification with production Caddyfile absent ACME

**Files:**
- None modified (verification only)

Because the production `Caddyfile` names `begenchgeldyev.com`, Caddy will try (and fail) to obtain a real cert when run locally on port 443. That is expected. This task confirms the container graph is correct and the site container responds internally.

- [ ] **Step 1: Bring the stack up with the local Caddyfile override (same trick as Task 13)**

Run:
```bash
cp infra/Caddyfile      infra/Caddyfile.prod.bak
cp infra/Caddyfile.local infra/Caddyfile
docker compose -f infra/compose.yml up --build -d
sleep 5
```

- [ ] **Step 2: Confirm all three services are Up**

Run:
```bash
docker compose -f infra/compose.yml ps
```

Expected: `caddy`, `site`, `postgres` all in state `Up` (or `running`).

- [ ] **Step 3: Confirm site responds through Caddy and directly (network-internal)**

Run:
```bash
curl -s -o /dev/null -w "via caddy: %{http_code}\n" http://localhost/
docker compose -f infra/compose.yml exec caddy wget -qO- http://site:8613/api/title
```

Expected: `via caddy: 200` and a JSON payload from the internal wget.

- [ ] **Step 4: Confirm certbot / nginx are absent**

Run:
```bash
docker compose -f infra/compose.yml ps --format json | grep -E "nginx|certbot" && echo "FAIL: legacy services present" || echo "OK: legacy services absent"
```

Expected: `OK: legacy services absent`.

- [ ] **Step 5: Tear down and restore prod Caddyfile**

Run:
```bash
docker compose -f infra/compose.yml down
mv infra/Caddyfile.prod.bak infra/Caddyfile
```

---

## Task 18: Push branch and open PR

**Files:**
- None modified

- [ ] **Step 1: Push branch**

Run:
```bash
git push -u origin restructure-workspace-caddy
```

- [ ] **Step 2: Open PR**

Ask the user whether to open a PR (per the assistant's default of confirming user-visible actions). If yes, run:

```bash
gh pr create --title "Restructure into bun workspace + swap nginx/certbot for caddy" --body "$(cat <<'EOF'
## Summary
- Restructure repo into a Bun workspace with `apps/site` (SSR + HTTP) and `packages/core` (DB, ABAC, DI, repositories).
- Replace nginx + certbot with Caddy in `infra/compose.yml`; Caddy handles HTTPS automatically.
- Deploy workflow now targets `infra/compose.yml`.
- Removed: `nginx.conf`, `init-letsencrypt.sh`, root-level `src/`, `pnpm-lock.yaml`, `.eslintrc.yml`, `.prettierrc.yml`, `postcss.config.js`.
- Design spec: `docs/superpowers/specs/2026-07-25-repo-restructure-and-caddy-design.md`.

## Test plan
- [ ] `bun run dev` boots and `curl http://localhost:8613/` returns 200.
- [ ] `bun run db:migrate` and `bun run db:seed` succeed.
- [ ] `docker compose -f infra/compose.yml up --build -d` starts caddy + site + postgres locally (with local Caddyfile).
- [ ] After deploy on server, `https://begenchgeldyev.com` returns 200 with a valid cert.
- [ ] `https://www.begenchgeldyev.com` 301-redirects to the apex.
EOF
)"
```

---

## Task 19: Server cut-over (manual — coordinate with user)

**Files:**
- None modified (operations on the VPS)

This task changes production. Do not run it without explicit user go-ahead.

- [ ] **Step 1: Ask the user to confirm the cut-over window**

Prompt (assistant):

> "Ready to cut over the server. This will stop the current nginx/backend/postgres stack, pull the new tree, and start the caddy/site/postgres stack. Caddy will obtain a fresh Let's Encrypt cert on the first HTTPS request (a few seconds of unavailability is possible). Give me the go-ahead when you are ready."

- [ ] **Step 2: On the server, back up Postgres data volume**

Ask the user to run on the VPS:
```bash
cd /opt/apps/begenchgeldyev-frontend
docker run --rm -v begenchgeldyev_pgdata:/var/lib/postgresql/data -v $(pwd):/backup alpine \
  tar czf /backup/pgdata-backup-$(date +%Y%m%d-%H%M%S).tar.gz -C /var/lib/postgresql/data .
```

- [ ] **Step 3: On the server, tear down the old stack**

```bash
cd /opt/apps/begenchgeldyev-frontend
docker compose down
```

- [ ] **Step 4: Pull the new tree and set up env**

```bash
git checkout main
git pull origin main
cp infra/site.env.example infra/site.env
# edit infra/site.env to set ADMIN_SECRET to the production value
```

- [ ] **Step 5: Bring up the new stack**

```bash
docker compose -f infra/compose.yml up --build -d
```

- [ ] **Step 6: Run migrations (safe: idempotent)**

```bash
docker compose -f infra/compose.yml exec site bun --cwd /usr/src/app/packages/core run db:migrate
```

- [ ] **Step 7: Verify HTTPS and cert issuance**

From a machine outside the server:
```bash
curl -sI https://begenchgeldyev.com/ | head -1
curl -sI https://www.begenchgeldyev.com/ | head -1
```

Expected: apex returns `HTTP/2 200`; `www` returns `HTTP/2 301` with `Location: https://begenchgeldyev.com/`.

Also verify cert is real (not self-signed):
```bash
echo | openssl s_client -servername begenchgeldyev.com -connect begenchgeldyev.com:443 2>/dev/null | openssl x509 -noout -issuer
```

Expected: issuer contains `Let's Encrypt`.

- [ ] **Step 8: If anything fails, roll back**

```bash
cd /opt/apps/begenchgeldyev-frontend
docker compose -f infra/compose.yml down
git checkout <previous main SHA>
docker compose up -d   # old compose file
```

The Postgres volume `begenchgeldyev_pgdata` is unchanged across the cut-over (same volume name, same schema), so no data restore is needed. The tarball from Step 2 is a safety net for schema-corruption scenarios.

---

## Post-implementation checklist

- [ ] Branch merged to `main`.
- [ ] Site is live at `https://begenchgeldyev.com` with a Let's Encrypt cert.
- [ ] `www.begenchgeldyev.com` redirects to apex.
- [ ] `docs/superpowers/specs/2026-07-25-repo-restructure-and-caddy-design.md` is unchanged (spec-of-record).
- [ ] `CLAUDE.md` reflects the new layout.
- [ ] No `nginx`, `certbot`, or `init-letsencrypt` references anywhere in the repo except the design/plan docs and archived history.
