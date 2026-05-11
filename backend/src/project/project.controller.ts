import { Injectable } from '@/DIContainer';
import type { ProjectsRepository } from './project.repository';

@Injectable()
export class ProjectController {
  constructor(private readonly projectsRepository: ProjectsRepository) {}

  async get() {
    const items = await this.projectsRepository.list();
    return Response.json({ projects: items });
  }

  async post(req: Request) {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!body || typeof body !== 'object') {
      return Response.json({ error: 'Body must be a JSON object' }, { status: 400 });
    }

    const payload = body as Record<string, unknown>;
    if (typeof payload.name !== 'string' || payload.name.trim().length === 0) {
      return Response.json({ error: 'name is required' }, { status: 400 });
    }

    const [created] = await this.projectsRepository.create({
      name: payload.name.trim(),
      description: typeof payload.description === 'string' ? payload.description : null,
      content: typeof payload.content === 'string' ? payload.content : null,
      image: typeof payload.image === 'string' ? payload.image : null,
      isHidden: typeof payload.isHidden === 'boolean' ? payload.isHidden : false,
    });

    return Response.json({ project: created }, { status: 201 });
  }
}
