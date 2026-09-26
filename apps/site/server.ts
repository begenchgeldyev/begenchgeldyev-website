import { canAccess, enforce, resolveEmail } from '@bg/core/abac/pep';
import { container } from './app-container';
import { CONFIG } from './config';
import { resolveLang } from './i18n';
import { handleLangRequest } from './lang-route';
import { ProjectController } from './project/project.controller';
import { renderPage, servePublicAsset } from './site';

Bun.serve({
  port: CONFIG.PORT,
  routes: {
    '/api/version': () => Response.json({ sha: process.env.GIT_SHA ?? 'unknown' }),
    '/api/title': () => {
      const title = ['Javascript Ninja', 'VIM enjoyer', 'Software Engineer', 'Fullstack Developer'];
      const randomTitleIndex = Math.floor(Math.random() * title.length);
      const randomTitle = title.at(randomTitleIndex);
      return Response.json({ title: randomTitle });
    },
    '/api/projects': {
      GET: (req) => container.resolve(ProjectController).get(req),
      POST: enforce((req) => container.resolve(ProjectController).post(req), { actions: 'create', resource: 'project' }),
    },
    '/api/auth/login': {
      POST: async (req) => {
        let body: { secret?: string; email?: string } = {};
        try {
          body = (await req.json()) as typeof body;
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
    '/api/lang': {
      POST: (req: Request) => handleLangRequest(req),
    },
    '/api/auth/logout': {
      POST: () => {
        const cookie = `dev-user-email=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
        return Response.json({ ok: true }, { headers: { 'Set-Cookie': cookie } });
      },
    },
  },

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

    const page = await renderPage(pathname, resolveLang(req), resolveEmail(req));
    if (page) {
      return page;
    }

    return new Response('Not Found', { status: 404 });
  },
});
