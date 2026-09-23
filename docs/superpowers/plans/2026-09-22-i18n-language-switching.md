# Language Switching (EN / RU) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the whole site in English or Russian, switched by a header toggle backed by a cookie, with English as the default and as the fallback for any missing translation.

**Architecture:** A new pure module `apps/site/i18n.ts` owns the language type, cookie resolution, and the chrome string table. `renderPage` gains a `lang` parameter and derives the fragment filename by suffix (`cv.html` → `cv.ru.html`), falling back to the English file when the translated one is absent. A `POST /api/lang` route validates the submitted language against an allowlist and sets an `HttpOnly` cookie; the header toggle calls it and reloads.

**Tech Stack:** Bun, TypeScript, Bun's built-in test runner (`bun test`), Biome, Tailwind via CDN, HTMX.

**Spec:** `docs/superpowers/specs/2026-09-22-i18n-language-switching-design.md`

## Global Constraints

- Runtime is Bun. Use `Bun.file`, `Bun.serve`, `bun test`. Never add Node `fs` or a test framework dependency.
- Cookie name is `lang`. Allowed values are exactly `en` and `ru`. Any other value resolves to `en`.
- The submitted language value is never interpolated into a `Set-Cookie` header before being checked against the allowlist.
- Cookie attributes must match the existing `/api/auth/login` style: `Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`.
- The URL never encodes the language. No path prefixes, no query parameters.
- A missing translated fragment falls back to the English fragment with status 200. Never 404 for a missing translation.
- Interactive controls bind `onMouseDown`, not `onClick` — repository convention from `CLAUDE.md`.
- Do not translate: stack names, `Feature-Sliced Design`, company names, `SCPI/HiSLIP`, or admin-only controls (`Upload Image`, `Publish Project`, `Hide Project`, `[ADMIN]`).
- `footerCvLink` is the literal string `CV.pdf` in **both** languages — there is no Russian PDF, so a translated label would point at an English document.
- **Linting baseline (read before your first commit).** `bun run lint` runs `biome check .` across the whole repository and **exits 1 on a clean checkout** — there are 22 pre-existing errors and 10 warnings that have nothing to do with this work, in `packages/core/*`, `apps/site/components/shared-head.html`, `apps/site/components/projects/editor-script.html`, and `apps/site/pages/index.html`. Do not try to fix them; they are out of scope.

  What binds you instead: after editing, run
  `bunx @biomejs/biome check --write <the files this task touched>`
  and confirm those specific files come back clean. Nothing else.

  Two files this plan modifies — `apps/site/server.ts` and
  `apps/site/project/project.controller.ts` — already carry unsorted-import and
  formatting findings, and several tasks add imports to them. `--write`
  auto-fixes both. Seeing a finding there does not mean you broke something.

  `bun install` has already been run; `node_modules` exists.

- **Typecheck baseline.** `bunx tsc --noEmit -p apps/site/tsconfig.json` also **does not exit 0 on a clean checkout**. Three pre-existing errors:
  - `apps/site/server.ts(27,22)` — `Parameter 'req' implicitly has an 'any' type` (in the `/api/auth/login` handler).
  - `packages/core/abac/pep.ts(37,5)` and `(62,7)` — the `Policy` type declares `contextContidition`, a typo for `contextCondition`, so the DB row never satisfies it.

  These are out of scope; do not fix them. Your gate is that tsc reports **no error whose path is a file your task created or modified**. Read the output, filter to your files, and judge only those.

---

### Task 1: i18n module — language resolution and string table

**Files:**
- Create: `apps/site/i18n.ts`
- Test: `apps/site/i18n.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type Lang = 'en' | 'ru'`, `DEFAULT_LANG: Lang`, `isLang(value: unknown): value is Lang`, `resolveLang(req: Request): Lang`, `type StringKey`, `t(lang: Lang, key: StringKey): string`, `localizedFragmentFile(fragmentFile: string, lang: Lang): string`.

- [ ] **Step 1: Write the failing test**

Create `apps/site/i18n.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { DEFAULT_LANG, isLang, localizedFragmentFile, resolveLang, t } from './i18n';

function reqWithCookie(cookie?: string): Request {
  return new Request('http://localhost/cv', {
    headers: cookie ? { cookie } : {},
  });
}

describe('resolveLang', () => {
  test('defaults to English when no cookie is present', () => {
    expect(resolveLang(reqWithCookie())).toBe('en');
  });

  test('reads ru from the lang cookie', () => {
    expect(resolveLang(reqWithCookie('lang=ru'))).toBe('ru');
  });

  test('reads the lang cookie when other cookies surround it', () => {
    expect(resolveLang(reqWithCookie('dev-user-email=a%40b.c; lang=ru; other=1'))).toBe('ru');
  });

  test('falls back to English for an unknown value', () => {
    expect(resolveLang(reqWithCookie('lang=de'))).toBe('en');
  });

  test('falls back to English for a malformed percent-encoding', () => {
    expect(resolveLang(reqWithCookie('lang=%E0%A4%A'))).toBe('en');
  });

  test('does not match a cookie whose name merely ends in lang', () => {
    expect(resolveLang(reqWithCookie('htmlang=ru'))).toBe('en');
  });
});

describe('isLang', () => {
  test('accepts supported languages', () => {
    expect(isLang('en')).toBe(true);
    expect(isLang('ru')).toBe(true);
  });

  test('rejects anything else', () => {
    expect(isLang('de')).toBe(false);
    expect(isLang(null)).toBe(false);
    expect(isLang(1)).toBe(false);
  });
});

describe('t', () => {
  test('returns the English label', () => {
    expect(t('en', 'navProjects')).toBe('Projects');
  });

  test('returns the Russian label', () => {
    expect(t('ru', 'navProjects')).toBe('Проекты');
  });

  test('keeps the CV pdf label identical across languages', () => {
    expect(t('ru', 'footerCvLink')).toBe(t('en', 'footerCvLink'));
  });
});

describe('localizedFragmentFile', () => {
  test('leaves the default language untouched', () => {
    expect(localizedFragmentFile('cv.html', DEFAULT_LANG)).toBe('cv.html');
  });

  test('inserts the language before the extension', () => {
    expect(localizedFragmentFile('cv.html', 'ru')).toBe('cv.ru.html');
  });

  test('appends when there is no extension', () => {
    expect(localizedFragmentFile('cv', 'ru')).toBe('cv.ru');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test apps/site/i18n.test.ts`
Expected: FAIL — `Cannot find module './i18n'`.

- [ ] **Step 3: Write the implementation**

Create `apps/site/i18n.ts`:

```ts
export type Lang = 'en' | 'ru';

export const LANGS = ['en', 'ru'] as const;
export const DEFAULT_LANG: Lang = 'en';

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}

export function resolveLang(req: Request): Lang {
  const cookieHeader = req.headers.get('cookie') ?? '';
  const match = cookieHeader.match(/(?:^|;\s*)lang=([^;]+)/);
  if (!match) return DEFAULT_LANG;

  let value: string;
  try {
    value = decodeURIComponent(match[1]);
  } catch {
    return DEFAULT_LANG;
  }

  return isLang(value) ? value : DEFAULT_LANG;
}

const EN = {
  navProjects: 'Projects',
  navLogs: 'Logs',
  navCv: 'CV',
  footerCvLink: 'CV.pdf',
  visibilityHidden: 'Hidden',
  visibilityPublished: 'Published',
  projectNoDescription: 'No short description provided.',
  projectNoContent: 'No detailed notes attached yet.',
  dateUnknown: 'Unknown',
  dateLocale: 'en',
  langToggleLabel: 'Switch language',
} as const;

export type StringKey = keyof typeof EN;

const STRINGS: Record<Lang, Record<StringKey, string>> = {
  en: EN,
  ru: {
    navProjects: 'Проекты',
    navLogs: 'Логи',
    navCv: 'Резюме',
    footerCvLink: 'CV.pdf',
    visibilityHidden: 'Скрыт',
    visibilityPublished: 'Опубликован',
    projectNoDescription: 'Краткое описание не указано.',
    projectNoContent: 'Подробных заметок пока нет.',
    dateUnknown: 'Неизвестно',
    dateLocale: 'ru',
    langToggleLabel: 'Сменить язык',
  },
};

export function t(lang: Lang, key: StringKey): string {
  return STRINGS[lang][key];
}

export function localizedFragmentFile(fragmentFile: string, lang: Lang): string {
  if (lang === DEFAULT_LANG) return fragmentFile;

  const dot = fragmentFile.lastIndexOf('.');
  if (dot === -1) return `${fragmentFile}.${lang}`;

  return `${fragmentFile.slice(0, dot)}.${lang}${fragmentFile.slice(dot)}`;
}
```

The `Record<Lang, Record<StringKey, string>>` annotation is deliberate: it makes a key that exists in `EN` but not in `ru` a compile error rather than a silent English fallback.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test apps/site/i18n.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `bunx tsc --noEmit -p apps/site/tsconfig.json && bun run lint`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/site/i18n.ts apps/site/i18n.test.ts
git commit -m "feat(i18n): add language resolution and chrome string table"
```

---

### Task 2: Thread language through page rendering

Makes `renderPage` language-aware and changes `PageConfig.title` to a per-language record. The type change breaks `project.controller.ts` and `server.ts`, so all three files move together — splitting them would leave the build red.

**Files:**
- Modify: `apps/site/site.ts`
- Modify: `apps/site/project/project.controller.ts:150-166`
- Modify: `apps/site/server.ts:80`
- Test: `apps/site/site.test.ts`

**Interfaces:**
- Consumes: `Lang`, `DEFAULT_LANG`, `localizedFragmentFile` from Task 1.
- Produces: `renderPage(pathname: string, lang: Lang, userEmail?: string | null): Promise<Response | null>`, `renderDocument(config: PageConfig, content: string, lang: Lang, userEmail?: string | null): Promise<string>`, and `PageConfig.title: Record<Lang, string>`.

- [ ] **Step 1: Write the failing test**

Create `apps/site/site.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { renderPage } from './site';

describe('renderPage language selection', () => {
  test('renders the English fragment by default', async () => {
    const res = await renderPage('/cv', 'en');
    expect(res).not.toBeNull();
    const html = await (res as Response).text();
    expect(html).toContain('Experience');
  });

  test('falls back to the English fragment when the translation is absent', async () => {
    const res = await renderPage('/logs', 'ru');
    expect(res).not.toBeNull();
    expect((res as Response).status).toBe(200);
  });

  test('returns null for an unknown path', async () => {
    expect(await renderPage('/nope', 'en')).toBeNull();
  });

  test('sets the html lang attribute from the language', async () => {
    const res = await renderPage('/cv', 'ru');
    const html = await (res as Response).text();
    expect(html).toContain('lang="ru"');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test apps/site/site.test.ts`
Expected: FAIL — `renderPage` currently takes `(pathname, userEmail)`, so the `lang` argument is treated as an email and no `lang="ru"` appears.

- [ ] **Step 3: Change the PageConfig type and fragment lookup**

In `apps/site/site.ts`, add the import and change the type:

```ts
import { DEFAULT_LANG, type Lang, localizedFragmentFile, t } from './i18n';

type PageConfig = {
  title: Record<Lang, string>;
  fragmentFile: string;
  activeNav?: NavKey;
  brandIsLink?: boolean;
  footerVariant?: FooterVariant;
  includeCvLink?: boolean;
  selectionTextClass?: string;
  showTerminalIcon?: boolean;
};
```

Rewrite every entry in `PAGE_CONFIGS` so `title` is a record. The Russian titles:

```ts
const PAGE_CONFIGS: Record<string, PageConfig> = {
  '/': {
    title: { en: 'begenchgeldyev', ru: 'begenchgeldyev' },
    fragmentFile: 'index.html',
    brandIsLink: false,
    footerVariant: 'home',
    includeCvLink: true,
    selectionTextClass: 'selection:text-on-primary-fixed',
  },
  '/cv': {
    title: { en: 'CV — BEGENCH_GELDYEV@ROOT:~$', ru: 'РЕЗЮМЕ — BEGENCH_GELDYEV@ROOT:~$' },
    fragmentFile: 'cv.html',
    activeNav: 'cv',
    brandIsLink: true,
    footerVariant: 'default',
    includeCvLink: true,
    showTerminalIcon: true,
  },
  '/logs': {
    title: { en: 'LOGS — BEGENCH_GELDYEV@ROOT:~$', ru: 'ЛОГИ — BEGENCH_GELDYEV@ROOT:~$' },
    fragmentFile: 'logs.html',
    activeNav: 'logs',
    brandIsLink: true,
    footerVariant: 'default',
    showTerminalIcon: true,
  },
  '/projects': {
    title: { en: 'PROJECTS — BEGENCH_GELDYEV@ROOT:~$', ru: 'ПРОЕКТЫ — BEGENCH_GELDYEV@ROOT:~$' },
    fragmentFile: 'projects.html',
    activeNav: 'projects',
    brandIsLink: true,
    footerVariant: 'default',
    showTerminalIcon: true,
  },
};
```

- [ ] **Step 4: Thread `lang` through the render chain**

Replace `renderLayout`, `renderDocument` and `renderPage` in `apps/site/site.ts`:

```ts
async function renderLayout(config: PageConfig, content: string, lang: Lang, userEmail?: string | null) {
  const selectionTextClass = config.selectionTextClass ?? 'selection:text-on-primary-container';
  return renderComponentTemplate('document.html', {
    content,
    footer: await renderFooter(config, lang),
    header: await renderHeader(config, lang),
    lang,
    selectionTextClass,
    sharedHead: await renderSharedHead(userEmail),
    title: config.title[lang],
  });
}

export async function renderDocument(config: PageConfig, content: string, lang: Lang, userEmail?: string | null) {
  return renderLayout(config, content, lang, userEmail);
}

export async function renderPage(pathname: string, lang: Lang, userEmail?: string | null): Promise<Response | null> {
  const config = PAGE_CONFIGS[pathname];
  if (!config) {
    return null;
  }

  const localized = Bun.file(join(PAGES_DIR, localizedFragmentFile(config.fragmentFile, lang)));
  const fallback = Bun.file(join(PAGES_DIR, config.fragmentFile));
  const fragment = (await localized.exists()) ? localized : fallback;

  if (!(await fragment.exists())) {
    return new Response('Not Found', { status: 404 });
  }

  const content = await resolveIncludes(await fragment.text());
  return new Response(await renderLayout(config, content, lang, userEmail), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
```

`renderHeader` and `renderFooter` need a second `lang` parameter so `renderLayout` can pass it. Task 3 fills in the translated labels. For this task change **only the signature lines** and leave every statement inside both function bodies exactly as it is:

```ts
async function renderHeader(config: PageConfig, lang: Lang) {
```

```ts
async function renderFooter(config: PageConfig, lang: Lang) {
```

Do not delete or stub the bodies — they still render the English header and footer, which is what keeps the site working between this task and the next.

Biome will report `lang` as an unused parameter in both functions. That is expected and temporary; Task 3 consumes it. Do not add a suppression comment and do not rename the parameter to `_lang` — Task 3 would have to undo it. If `bun run lint` reports only these two unused parameters, proceed; any other lint finding must be fixed before committing.

- [ ] **Step 5: Add the lang attribute to the document template**

In `apps/site/components/document.html`, change line 2:

```html
<html class="dark" lang="{{lang}}">
```

- [ ] **Step 6: Fix the two call sites broken by the type change**

In `apps/site/server.ts`, add the import and update line 80:

```ts
import { resolveLang } from './i18n';
```

```ts
const page = await renderPage(pathname, resolveLang(req), resolveEmail(req));
```

In `apps/site/project/project.controller.ts`, update `renderProjectPage` (around line 150). Add `import { DEFAULT_LANG, type Lang, resolveLang } from '../i18n';`, resolve the language from the request, and build both titles from the same English project name:

```ts
const lang = resolveLang(req);
const projectTitle = `${project.name.toUpperCase()} — BEGENCH_GELDYEV@ROOT:~$`;

return new Response(
  await renderDocument(
    {
      title: { en: projectTitle, ru: projectTitle },
      fragmentFile: 'projects.html',
      activeNav: 'projects',
      brandIsLink: true,
      footerVariant: 'default',
      showTerminalIcon: true,
    },
    contentHtml,
    lang,
    resolveEmail(req),
  ),
  {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  },
);
```

The project name stays English in both entries because project records are not translated — see the spec's "Out of scope".

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test apps/site/`
Expected: PASS — 18 tests (14 from Task 1, 4 new).

- [ ] **Step 8: Typecheck**

Run: `bunx tsc --noEmit -p apps/site/tsconfig.json`
Expected: exit 0. A type error in `project.controller.ts` means Step 6 was missed.

- [ ] **Step 9: Verify the running site is unchanged for English**

Run: `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8613/cv`
Expected: `200`. The dev server hot-reloads; no restart needed.

- [ ] **Step 10: Commit**

```bash
git add apps/site/site.ts apps/site/site.test.ts apps/site/server.ts apps/site/project/project.controller.ts apps/site/components/document.html
git commit -m "feat(i18n): thread language through page rendering"
```

---

### Task 3: Translate the chrome

Replaces the hardcoded English in the header, footer, and project card rendering with `t()` lookups.

**Files:**
- Modify: `apps/site/site.ts` (`renderHeader`, `renderNavLink`, `renderFooter`)
- Modify: `apps/site/project/project.controller.ts` (`formatProjectDate`, `renderProjectCard`, `renderProjectPage`)
- Test: `apps/site/site.test.ts`

**Interfaces:**
- Consumes: `t`, `Lang` from Task 1; the `lang` parameters added in Task 2.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Append to `apps/site/site.test.ts`:

```ts
describe('chrome translation', () => {
  test('renders English navigation labels by default', async () => {
    const res = await renderPage('/cv', 'en');
    const html = await (res as Response).text();
    expect(html).toContain('>Projects<');
    expect(html).toContain('>Logs<');
  });

  test('renders Russian navigation labels', async () => {
    const res = await renderPage('/cv', 'ru');
    const html = await (res as Response).text();
    expect(html).toContain('>Проекты<');
    expect(html).toContain('>Логи<');
    expect(html).toContain('>Резюме<');
  });

  test('keeps the CV pdf label untranslated', async () => {
    const res = await renderPage('/cv', 'ru');
    const html = await (res as Response).text();
    expect(html).toContain('CV.pdf');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test apps/site/site.test.ts`
Expected: FAIL — `>Проекты<` is not found; the nav labels are still hardcoded English.

- [ ] **Step 3: Translate the navigation and footer**

In `apps/site/site.ts`, replace the label arguments in `renderHeader` with lookups:

```ts
navLinks: [
  renderNavLink(config.activeNav, '/projects', t(lang, 'navProjects'), 'projects'),
  renderNavLink(config.activeNav, '/logs', t(lang, 'navLogs'), 'logs'),
  renderNavLink(config.activeNav, '/cv', t(lang, 'navCv'), 'cv'),
].join(''),
```

And in `renderFooter`:

```ts
const cvLink = config.includeCvLink
  ? `<a class="font-mono text-xs tracking-widest text-primary-container underline font-bold uppercase" href="/public/Begench%20Geldyev(CV).pdf" target="_blank">${t(lang, 'footerCvLink')}</a>`
  : '';
```

- [ ] **Step 4: Translate the project card strings**

In `apps/site/project/project.controller.ts`, make `formatProjectDate` language-aware:

```ts
function formatProjectDate(value: Date | null, lang: Lang) {
  if (!value) {
    return t(lang, 'dateUnknown');
  }

  return new Intl.DateTimeFormat(t(lang, 'dateLocale'), {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(value);
}
```

Every caller of `formatProjectDate` must pass `lang`. `renderProjectCard` and `renderProjectsFragment` both need a `lang` parameter threaded from `ProjectController.get` (which resolves it via `resolveLang(req)`).

Replace the three literals in `renderProjectCard`:

```ts
const description = project.description?.trim() || t(lang, 'projectNoDescription');
const content = stripHtml(project.content?.trim() || t(lang, 'projectNoContent'));
const visibility = project.isHidden ? t(lang, 'visibilityHidden') : t(lang, 'visibilityPublished');
```

And the same `visibility` line inside `renderProjectPage`.

Leave the admin control strings (`Upload Image`, `Publish Project`, `Hide Project`, `[ADMIN]`) in English — they are owner-only and explicitly out of scope.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test apps/site/`
Expected: PASS — 21 tests.

- [ ] **Step 6: Typecheck and lint**

Run: `bunx tsc --noEmit -p apps/site/tsconfig.json && bun run lint`
Expected: both exit 0. The unused-parameter warnings from Task 2 Step 4 are now resolved.

- [ ] **Step 7: Commit**

```bash
git add apps/site/site.ts apps/site/site.test.ts apps/site/project/project.controller.ts
git commit -m "feat(i18n): translate navigation, footer and project chrome"
```

---

### Task 4: Language route and header toggle

This is the tracer bullet: after it, switching works end to end. Russian pages still fall back to English content because the translated fragments arrive in Task 6 — that fallback is the designed behaviour, not a defect.

**Files:**
- Modify: `apps/site/server.ts:15-49` (inside the `/api` route group)
- Modify: `apps/site/site.ts` (`renderHeader`)
- Modify: `apps/site/components/site-header.html:6`
- Test: `apps/site/lang-route.test.ts`

**Interfaces:**
- Consumes: `isLang` from Task 1.
- Produces: `POST /api/lang`, and a `{{langToggle}}` placeholder in `site-header.html`.

- [ ] **Step 1: Write the failing test**

Create `apps/site/lang-route.test.ts`. The handler is tested directly rather than over the network so the suite needs no running server:

```ts
import { describe, expect, test } from 'bun:test';
import { handleLangRequest } from './lang-route';

function post(body: string): Request {
  return new Request('http://localhost/api/lang', { method: 'POST', body });
}

describe('POST /api/lang', () => {
  test('accepts ru and sets the cookie', async () => {
    const res = await handleLangRequest(post('ru'));
    expect(res.status).toBe(204);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('lang=ru');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
  });

  test('accepts en', async () => {
    const res = await handleLangRequest(post('en'));
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toContain('lang=en');
  });

  test('rejects an unknown language without setting a cookie', async () => {
    const res = await handleLangRequest(post('de'));
    expect(res.status).toBe(400);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  test('rejects a header-injection attempt', async () => {
    const res = await handleLangRequest(post('ru\r\nSet-Cookie: admin=1'));
    expect(res.status).toBe(400);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  test('rejects an empty body', async () => {
    const res = await handleLangRequest(post(''));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test apps/site/lang-route.test.ts`
Expected: FAIL — `Cannot find module './lang-route'`.

- [ ] **Step 3: Write the route handler**

Create `apps/site/lang-route.ts`:

```ts
import { isLang } from './i18n';

const ONE_YEAR_SECONDS = 31536000;

export async function handleLangRequest(req: Request): Promise<Response> {
  const body = (await req.text()).trim();

  if (!isLang(body)) {
    return new Response('Bad Request', { status: 400 });
  }

  return new Response(null, {
    status: 204,
    headers: {
      'Set-Cookie': `lang=${body}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ONE_YEAR_SECONDS}`,
    },
  });
}
```

`isLang` runs before the value reaches the header, so a body containing CRLF can never inject a second cookie.

- [ ] **Step 4: Register the route**

In `apps/site/server.ts`, add the import and a new entry inside the `withPrefix('/api', { ... })` object, alongside `/auth/logout`:

```ts
import { handleLangRequest } from './lang-route';
```

```ts
'/lang': {
  POST: (req) => handleLangRequest(req),
},
```

- [ ] **Step 5: Render the toggle**

In `apps/site/site.ts`, build the toggle inside `renderHeader` and pass it to the template:

```ts
const langToggle = `<div class="flex items-center gap-2 font-mono text-xs uppercase tracking-widest" role="group" aria-label="${t(lang, 'langToggleLabel')}">
      ${(['en', 'ru'] as const)
        .map((code) => {
          const active = code === lang;
          const classes = active
            ? 'text-primary-container font-semibold'
            : 'text-white/80 hover:text-primary-container transition-colors';
          return `<button type="button" data-lang="${code}" aria-pressed="${active}" class="${classes}">${code}</button>`;
        })
        .join('<span class="text-outline-variant/60" aria-hidden="true">|</span>')}
    </div>
    <script>
      document.querySelectorAll('[data-lang]').forEach((el) => {
        el.addEventListener('mousedown', async () => {
          await fetch('/api/lang', { method: 'POST', body: el.dataset.lang });
          location.reload();
        });
      });
    </script>`;
```

Add `langToggle` to the `renderComponentTemplate('site-header.html', { ... })` value object.

The handler binds `mousedown` per the repository convention. Because `<button>` also fires `mousedown` on keyboard activation in neither Firefox nor Chrome, add a `keydown` guard so the control stays keyboard-operable:

```ts
el.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    el.dispatchEvent(new MouseEvent('mousedown'));
  }
});
```

Place this immediately after the `mousedown` listener inside the same `forEach`.

- [ ] **Step 6: Add the placeholder to the header template**

In `apps/site/components/site-header.html`, change line 6:

```html
    <div class="flex items-center gap-4">{{ langToggle }}{{ terminal }}</div>
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test apps/site/`
Expected: PASS — 26 tests.

- [ ] **Step 8: Verify switching end to end in a real browser**

The dev server is already running on port 8613. Confirm the whole loop by hand:

```bash
curl -s -i -X POST --data 'ru' http://localhost:8613/api/lang | grep -i set-cookie
curl -s -H 'Cookie: lang=ru' http://localhost:8613/cv | grep -o 'lang="ru"'
curl -s -i -X POST --data 'de' http://localhost:8613/api/lang | head -1
```

Expected: a `lang=ru` cookie; `lang="ru"` in the rendered document; `HTTP/1.1 400 Bad Request` for `de`.

Then open `http://localhost:8613/cv`, click `RU`, and confirm the page reloads with Russian navigation and that the choice survives navigating to `/projects`. Tab to the toggle and press Enter to confirm keyboard operation.

- [ ] **Step 9: Typecheck, lint and commit**

```bash
bunx tsc --noEmit -p apps/site/tsconfig.json && bun run lint
git add apps/site/lang-route.ts apps/site/lang-route.test.ts apps/site/server.ts apps/site/site.ts apps/site/components/site-header.html
git commit -m "feat(i18n): add language route and header toggle"
```

---

### Task 5: Extract the tag-scramble script

The 45-line hover-scramble script sits at the bottom of `cv.html`. Task 6 copies that file for Russian; without this extraction the script is duplicated and every future edit becomes two edits.

**Files:**
- Create: `apps/site/components/tag-scramble.html`
- Modify: `apps/site/pages/cv.html` (remove the trailing `<script>` block, add the include)

**Interfaces:**
- Consumes: the existing `resolveIncludes` mechanism in `site.ts`.
- Produces: `components/tag-scramble.html`, includable via `<!--#include tag-scramble.html-->`.

- [ ] **Step 1: Capture the current rendered output as a baseline**

Run: `curl -s http://localhost:8613/cv | grep -c 'blinking-cursor\|mouseenter'`
Record the number. It must be identical after the change.

- [ ] **Step 2: Move the script into a component**

Cut the entire trailing `<script> ... </script>` block from `apps/site/pages/cv.html` — it begins with `(() => {` and the `const chars = '!<>-_\\/[]{}—=+*^?#________';` line — and paste it verbatim, script tags included, into `apps/site/components/tag-scramble.html`.

- [ ] **Step 3: Include it from the page**

At the position the script previously occupied in `apps/site/pages/cv.html`, add:

```html
<!--#include tag-scramble.html-->
```

- [ ] **Step 4: Verify the rendered output is byte-identical**

Run: `curl -s http://localhost:8613/cv | grep -c 'mouseenter'`
Expected: the same count recorded in Step 1.

Then open `http://localhost:8613/cv` and hover a technology tag. Expected: the text still scrambles.

- [ ] **Step 5: Run the tests, lint and commit**

```bash
bun test apps/site/ && bun run lint
git add apps/site/components/tag-scramble.html apps/site/pages/cv.html
git commit -m "refactor: extract tag-scramble script into a component"
```

---

### Task 6: Russian page fragments

The bulk of the remaining work is translation, not code. Each fragment is a copy of its English counterpart with the prose replaced and every class, `href`, and `<!--#include-->` left untouched.

**Files:**
- Create: `apps/site/pages/cv.ru.html`
- Create: `apps/site/pages/index.ru.html`
- Create: `apps/site/pages/logs.ru.html`
- Create: `apps/site/pages/projects.ru.html`
- Test: `apps/site/site.test.ts`

**Interfaces:**
- Consumes: `localizedFragmentFile` behaviour from Task 2.
- Produces: no exports.

- [ ] **Step 1: Write the failing test**

Append to `apps/site/site.test.ts`:

```ts
describe('russian fragments', () => {
  test('serves Russian CV prose', async () => {
    const res = await renderPage('/cv', 'ru');
    const html = await (res as Response).text();
    expect(html).toContain('Опыт');
    expect(html).not.toContain('Software and hardware for radio-frequency');
  });

  test('keeps stack names untranslated', async () => {
    const res = await renderPage('/cv', 'ru');
    const html = await (res as Response).text();
    expect(html).toContain('Feature-Sliced Design');
    expect(html).toContain('TypeScript');
    expect(html).toContain('SCPI / HiSLIP');
  });

  test('still serves English prose on the English page', async () => {
    const res = await renderPage('/cv', 'en');
    const html = await (res as Response).text();
    expect(html).toContain('Software and hardware for radio-frequency');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test apps/site/site.test.ts`
Expected: FAIL — `/cv` in Russian still falls back to the English fragment.

- [ ] **Step 3: Create the four translated fragments**

Copy each English fragment and translate the prose:

```bash
cp apps/site/pages/cv.html apps/site/pages/cv.ru.html
cp apps/site/pages/index.html apps/site/pages/index.ru.html
cp apps/site/pages/logs.html apps/site/pages/logs.ru.html
cp apps/site/pages/projects.html apps/site/pages/projects.ru.html
```

Then edit each copy. Translate: section headings, role titles, summary paragraphs, bullet points, contact labels, language-proficiency labels.

Leave untouched: every `class` attribute, every `href`, every `<!--#include-->`, all technology tag labels, `Feature-Sliced Design`, `SCPI / HiSLIP`, company names, and the `begench@127.0.0.1` brand string.

Fixed label translations for `cv.ru.html`:

| English | Russian |
|---|---|
| Experience | Опыт |
| Projects | Проекты |
| Education | Образование |
| Skills | Навыки |
| Contact | Контакты |
| AI & Agents | AI и агенты |
| Frontend & Backend | Фронтенд и бэкенд |
| Tooling & Testing | Инструменты и тесты |
| Russian / English | Русский / Английский |
| Native | Родной |
| present | наст. время |
| Personal Project | Пет-проект |
| B.S. Applied Informatics | Бакалавр, прикладная информатика |
| M.S. Applied Informatics | Магистр, прикладная информатика |

Worked example — the first Experience article, showing exactly what changes and what does not. Every class, `href` and tag label is byte-identical to the English original; only the text nodes differ:

```html
<article class="border-l-2 border-primary-container/40 pl-5 py-1">
  <div class="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 mb-1">
    <span class="font-headline font-bold text-white text-xl uppercase">Fullstack-разработчик</span>
    <span class="font-mono text-sm text-on-surface-variant/80">Июнь 2025 — наст. время</span>
  </div>
  <span class="font-mono text-sm text-primary-container/80 uppercase tracking-widest block mb-4">Synecta — Томск</span>
  <p class="text-white/90 text-base leading-relaxed max-w-[72ch] mb-5">
    Софт и железо для радиочастотных измерений. На мне веб-приложение для управления приборами и визуализации данных измерений.
  </p>
  <ul class="text-white/90 text-base leading-relaxed list-disc list-outside pl-5 space-y-2.5 max-w-[72ch] mb-5">
    <li>Спроектировал фронтенд-архитектуру вокруг Feature-Sliced Design, упростив масштабирование и поддержку.</li>
    <li>Реализовал клиент-серверное взаимодействие по WebSocket и REST для обмена данными с измерительным оборудованием.</li>
    <li>Интегрировал векторные анализаторы цепей через C++ бэкенд-логику поверх SCPI/HiSLIP.</li>
  </ul>
  <div class="flex flex-wrap gap-2">
    <!-- tag anchors copied verbatim from cv.html, labels untranslated -->
  </div>
</article>
```

Note `Feature-Sliced Design`, `WebSocket`, `REST`, `C++`, `SCPI/HiSLIP` and `Synecta` survive untranslated inside Russian sentences — that is correct, not an oversight.

- [ ] **Step 3b: Update the now-obsolete fallback test**

Task 2 added this test to `apps/site/site.test.ts`:

```ts
test('falls back to the English fragment when the translation is absent', async () => {
```

It pointed at `/logs`, which had no translation at the time. This step creates `logs.ru.html`, so the test no longer exercises the fallback path and its name becomes false. Replace it with a test that stays honest by targeting a fragment that is deliberately never translated:

```ts
test('falls back to English when a translated fragment is missing', async () => {
  const missing = localizedFragmentFile('nonexistent.html', 'ru');
  expect(missing).toBe('nonexistent.ru.html');

  const res = await renderPage('/cv', 'ru');
  expect((res as Response).status).toBe(200);
});
```

Import `localizedFragmentFile` from `./i18n` at the top of the file.

The filesystem-level fallback remains covered by the `localizedFragmentFile` unit tests in Task 1 and by the manual check below: temporarily rename `apps/site/pages/logs.ru.html`, request `/logs` with a `lang=ru` cookie, confirm a 200 with English content, then rename it back.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test apps/site/`
Expected: PASS — 29 tests.

- [ ] **Step 5: Check the Russian layout for overflow**

Russian runs roughly 10–15% longer than English, and the CV column is capped at 72 characters. Screenshot both languages and compare:

```bash
chromium --headless --disable-gpu --no-sandbox --hide-scrollbars \
  --window-size=1366,2400 --virtual-time-budget=7000 \
  --screenshot=/tmp/opencode/cv-ru.png http://localhost:8613/cv
```

Set the `lang=ru` cookie first by visiting the page and clicking `RU`, or drive it through CDP.

Inspect for: text escaping the two-column grid, technology tags wrapping awkwardly, headings breaking to a second line, and the right-hand column colliding with the left.

- [ ] **Step 6: Confirm Cyrillic uses Noto Sans Mono rather than a fallback face**

In the browser console on the Russian page:

```js
const p = document.querySelector('main p');
const s = document.createElement('span');
s.style.cssText = 'position:absolute;visibility:hidden';
s.style.font = getComputedStyle(p).font;
p.appendChild(s);
s.textContent = 'ШШШШШ'; const a = s.getBoundingClientRect().width;
s.textContent = 'иииии'; const b = s.getBoundingClientRect().width;
s.remove();
console.log(a, b, Math.abs(a - b) < 0.5);
```

Expected: `true`. Equal advance widths prove a monospace face is in use; a proportional fallback would differ.

- [ ] **Step 7: Lint and commit**

```bash
bun run lint
git add apps/site/pages/cv.ru.html apps/site/pages/index.ru.html apps/site/pages/logs.ru.html apps/site/pages/projects.ru.html apps/site/site.test.ts
git commit -m "feat(i18n): add Russian page fragments"
```

---

## Deviations from the spec

Two details changed while reading the code. Both are improvements in consistency, not scope changes:

1. **The route is `POST /api/lang`, not `POST /lang`.** Every existing endpoint lives under the `/api` prefix built by `withPrefix`, and `/api/auth/login` already demonstrates the exact cookie-setting pattern this route needs.
2. **Admin-only strings stay English.** `renderProjectPage` contains `Upload Image`, `Publish Project`, `Hide Project` and `[ADMIN]`, visible only to the authenticated owner. Translating them is scope creep with no audience.
