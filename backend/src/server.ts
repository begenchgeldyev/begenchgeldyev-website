import { renderPage, servePublicAsset } from '../site';
import { container } from './app-container';
import { ProjectController } from '@/project/project.controller';
import { enforce } from '@/abac/pep';

const PORT = Number(process.env.PORT) || 8613;

function withPrefix<T>(prefix: string, routes: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(routes).map(([path, handler]) => [`${prefix}${path}`, handler]));
}

Bun.serve({
  port: PORT,
  routes: withPrefix('/api', {
    '/title': () => {
      const title = ['Javascript Ninja', 'VIM enjoyer', 'Software Engineer', 'Fullstack Developer'];
      const randomTitleIndex = Math.floor(Math.random() * title.length);
      const randomTitle = title.at(randomTitleIndex);
      return Response.json({ title: randomTitle });
    },
    '/projects': {
      GET: () => container.resolve(ProjectController).get(),
      POST: enforce((req) => container.resolve(ProjectController).post(req), { actions: 'create', resource: 'project' }),
    },
  }),

  async fetch(req) {
    const { pathname } = new URL(req.url);

    if (pathname.startsWith('/public/')) {
      return servePublicAsset(pathname);
    }

    const page = await renderPage(pathname);
    if (page) {
      return page;
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log(`Server running at http://localhost:${PORT}`);
