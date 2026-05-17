import { canAccess, enforce, resolveEmail } from '@/abac/pep';
import { ProjectController } from '@/project/project.controller';
import { renderPage, servePublicAsset } from '../site';
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
