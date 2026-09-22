# Language switching (EN / RU)

Date: 2026-09-22
Status: approved, not yet implemented

## Goal

Serve the whole site in English or Russian, with a toggle in the header. English
stays the default. The Russian audience is recruiters, so the CV page matters
most, but all four static pages are in scope.

## Locked decisions

| Decision | Choice | Why |
|---|---|---|
| Scope | All four static pages + header/footer chrome | User choice |
| Language state | Cookie only; URL never changes | User choice |
| Toggle mechanism | `POST /lang` via `fetch`, then reload | User choice |
| Content storage | Parallel fragment files (`cv.ru.html`) | Prose resists key-based extraction; translated HTML stays readable and its markup may legitimately diverge |
| Translation author | Agent, final, no proofread pass | User accepted the voice risk |
| DB-backed project content | Stays English | Avoids a schema migration and admin-editor rework |
| `Accept-Language` sniffing | Not implemented | Not requested; predictability preferred |

Consequence of the cookie choice, accepted knowingly: a Russian version cannot be
linked directly, is not separately indexable, and a shared URL always opens in
the recipient's own cookie state (English for a first-time visitor).

## Architecture

### New module: `apps/site/i18n.ts`

```ts
export type Lang = 'en' | 'ru';
export const DEFAULT_LANG: Lang = 'en';
export function resolveLang(req: Request): Lang;
export function t(lang: Lang, key: StringKey): string;
```

`resolveLang` reads the `lang` cookie and returns `DEFAULT_LANG` for a missing,
malformed, or unrecognised value. It never throws.

The string table is typed so that a key present in `en` but missing in `ru` is a
compile error rather than a silent English fallback:

```ts
const STRINGS = {
  en: { navProjects: 'Projects', /* ... */ },
  ru: { navProjects: 'Проекты',  /* ... */ },
} satisfies Record<Lang, Record<string, string>>;
```

Covers: three nav labels, the footer `CV.pdf` label, `Hidden` / `Published`,
project-card and empty-state copy, and the `Intl.DateTimeFormat` locale.

Note the footer link: its **label** is translated but its **target** stays the
English PDF, because no Russian PDF exists. A Russian label pointing at an
English document is a visible wart. Resolve it by keeping the label language-
neutral — `CV.pdf` in both languages — until a Russian PDF exists.

### Fragment resolution: `apps/site/site.ts`

`renderPage(pathname, lang, userEmail)` derives the fragment filename by
inserting the language before the extension — `cv.html` → `cv.ru.html` — for any
language other than the default.

**Missing translation falls back to the English fragment, not 404.** A page added
before its translation must keep working.

`PageConfig.title` changes from `string` to `Record<Lang, string>`. This is an
interface change with one external consumer: `project.controller.ts`, which
builds a `PageConfig` inline for project detail pages.

Project detail titles are built as `${project.name} — BEGENCH_GELDYEV@ROOT:~$`.
Since project records stay English, the name stays English in both languages;
only the fixed suffix is resolved per language. The controller therefore builds
both `title.en` and `title.ru` from the same English project name.

`renderHeader` and `renderFooter` take `lang` and resolve their labels via `t()`.

### Toggle: `apps/site/components/site-header.html`

Two `<button>` elements in the existing right-hand block, before the terminal
icon, rendered as `EN │ RU`. Active language in `text-primary-container`,
inactive in `text-white/80`, monospace uppercase to match the nav links.

Buttons, not links, because the URL does not change. `aria-pressed` marks the
active one. The handler binds `onMouseDown` per the repository convention in
CLAUDE.md, calls `POST /lang`, then reloads.

### Route: `apps/site/server.ts`

`POST /lang` accepts a body of exactly `en` or `ru`. Anything else returns 400.

The submitted value is checked against the allowed set before use and is **never
interpolated into the `Set-Cookie` header directly** — doing so would allow
header injection via CRLF in the request body.

On success: `204` with
`Set-Cookie: lang=<value>; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`.

`HttpOnly` is safe here because the server sets the cookie in response to the
fetch; no client script needs to read it.

### Document language: `apps/site/components/document.html`

Line 2 becomes `<html class="dark" lang="{{lang}}">`, for screen readers and
hyphenation.

### Content: four new fragments

`index.ru.html`, `cv.ru.html`, `logs.ru.html`, `projects.ru.html`.

Translation rules:
- Translate prose and job titles.
- Do not translate stack names, `Feature-Sliced Design`, company names, or
  `SCPI/HiSLIP`.
- Keep every class attribute and `href` identical to the English fragment.

### Supporting refactor

The 45-line tag-scramble script at the bottom of `cv.html` moves to
`components/tag-scramble.html` and is pulled in through the existing
`<!--#include-->` mechanism from both language fragments. Without this it is
duplicated, and every future edit to it becomes two edits.

This is the only refactor in scope.

## Verification

The repository has no test framework, so verification is manual, via CDP and a
real browser:

1. No cookie → English.
2. `POST /lang` with `ru` → Russian, and it persists across navigation.
3. Missing `.ru.html` → English fragment, status 200.
4. Garbage cookie value → English, no error.
5. `POST /lang` with an invalid body → 400, no cookie set.
6. Cyrillic renders in Noto Sans Mono, not a fallback face — confirm by
   comparing rendered glyph metrics against the Latin text.
7. Russian text does not break the 72-character column or the two-column grid.
   Russian runs roughly 10–15% longer than English; this is the most likely
   visual regression.
8. Toggle works by mouse and by keyboard.

## Out of scope

- Translating DB-backed project content (`name`, `description`, `content`).
- A third language.
- `Accept-Language` detection.
- Localised PDF of the CV — the footer link keeps pointing at the English file.
