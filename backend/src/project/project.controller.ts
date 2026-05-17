import { canAccess, resolveEmail } from '@/abac/pep';
import { Injectable } from '@/DIContainer';
import { renderComponentTemplate, renderDocument } from '../../site';
import type { ProjectsRepository } from './project.repository';

type ProjectRecord = Awaited<ReturnType<ProjectsRepository['list']>>[number];

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function formatProjectDate(value: Date | null) {
  if (!value) {
    return 'Unknown';
  }

  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(value);
}

function stripHtml(value: string) {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function serializeForScript(value: unknown) {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

async function renderContentHtml(value: string | null) {
  const content = value?.trim();
  if (!content) {
    return renderComponentTemplate('projects/content-empty.html');
  }

  return content;
}

async function renderProjectCard(project: ProjectRecord, index: number) {
  const accent = String(index + 1).padStart(2, '0');
  const description = project.description?.trim() || 'No short description provided.';
  const content = stripHtml(project.content?.trim() || 'No detailed notes attached yet.');
  const image = project.image?.trim();
  const imageBlock = image
    ? `<div class="border-b border-outline-variant/20 bg-surface overflow-hidden">
      <img class="h-56 w-full object-cover" src="${escapeHtml(image)}" alt="${escapeHtml(project.name)} preview"/>
    </div>`
    : '';
  const name = escapeHtml(project.name);
  const projectPath = escapeHtml(project.name.toLowerCase().replaceAll(/\s+/g, '-'));
  const visibility = project.isHidden ? 'Hidden' : 'Published';
  return renderComponentTemplate('project-card.html', {
    accent,
    content: escapeHtml(content),
    createdAt: escapeHtml(formatProjectDate(project.createdAt)),
    description: escapeHtml(description),
    imageBlock,
    projectHref: `/projects/${project.id}`,
    projectName: name,
    projectPath,
    visibility: escapeHtml(visibility),
  });
}

async function renderProjectsFragment(projects: ProjectRecord[]) {
  if (projects.length === 0) {
    return renderComponentTemplate('projects/empty-state.html');
  }

  return (await Promise.all(projects.map(renderProjectCard))).join('');
}

async function renderProjectEditor() {
  return renderComponentTemplate('projects/editor.html');
}

async function renderProjectEditorScript(project: ProjectRecord) {
  const state = serializeForScript({
    id: project.id,
    name: project.name,
    description: project.description ?? '',
    content: project.content ?? '',
    image: project.image ?? '',
    isHidden: project.isHidden,
  });

  return renderComponentTemplate('projects/editor-script.html', {
    editorStateAttr: escapeHtml(state),
    emptyContentHtmlAttr: escapeHtml(await renderComponentTemplate('projects/content-empty.html')),
  });
}

async function renderProjectPage(req: Request, project: ProjectRecord, canEdit: boolean) {
  const description = project.description?.trim() || 'No short description provided.';
  const image = project.image?.trim();
  const createdAt = formatProjectDate(project.createdAt);
  const updatedAt = formatProjectDate(project.updatedAt);
  const visibility = project.isHidden ? 'Hidden' : 'Published';
  const editorHint = canEdit ? await renderComponentTemplate('projects/editor-hint.html') : '';
  const imageBlock = image
    ? `<div class="overflow-hidden border border-outline-variant/30 bg-surface" ${canEdit ? 'data-admin-editable="image" ondblclick="window.__openProjectEditor && window.__openProjectEditor(event)"' : ''}>
        <img data-project-preview class="max-h-[520px] w-full object-cover" src="${escapeHtml(image)}" alt="${escapeHtml(project.name)} preview"/>
      </div>`
    : `<div class="overflow-hidden border border-outline-variant/30 bg-surface" hidden>
        <img data-project-preview class="max-h-[520px] w-full object-cover" src="" alt="${escapeHtml(project.name)} preview"/>
      </div>`;
  const contentHtml = await renderComponentTemplate('projects/page.html', {
    content: await renderContentHtml(project.content),
    createdAt: escapeHtml(createdAt),
    description: escapeHtml(description),
    editor: canEdit ? `${await renderProjectEditor()}${await renderProjectEditorScript(project)}` : '',
    editorHint,
    headerEditableAttrs: canEdit
      ? 'data-admin-editable="header" ondblclick="window.__openProjectEditor && window.__openProjectEditor(event)"'
      : '',
    contentEditableAttrs: canEdit
      ? 'data-admin-editable="content" ondblclick="window.__openProjectEditor && window.__openProjectEditor(event)"'
      : '',
    imageBlock,
    projectId: String(project.id),
    projectName: escapeHtml(project.name),
    route: `/projects/${project.id}`,
    updatedAt: escapeHtml(updatedAt),
    visibility: escapeHtml(visibility),
  });

  return new Response(
    await renderDocument(
      {
        title: `${project.name.toUpperCase()} — BEGENCH_GELDYEV@ROOT:~$`,
        fragmentFile: 'projects.html',
        activeNav: 'projects',
        brandIsLink: true,
        footerVariant: 'default',
        showTerminalIcon: true,
      },
      contentHtml,
      resolveEmail(req),
    ),
    {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    },
  );
}

async function parseProjectPayload(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { error: Response.json({ error: 'Invalid JSON body' }, { status: 400 }) };
  }

  if (!body || typeof body !== 'object') {
    return { error: Response.json({ error: 'Body must be a JSON object' }, { status: 400 }) };
  }

  const payload = body as Record<string, unknown>;
  if (typeof payload.name !== 'string' || payload.name.trim().length === 0) {
    return { error: Response.json({ error: 'name is required' }, { status: 400 }) };
  }

  return {
    value: {
      name: payload.name.trim(),
      description: typeof payload.description === 'string' ? payload.description : null,
      content: typeof payload.content === 'string' ? payload.content : null,
      image: typeof payload.image === 'string' ? payload.image : null,
      isHidden: typeof payload.isHidden === 'boolean' ? payload.isHidden : false,
    },
  };
}

@Injectable()
export class ProjectController {
  constructor(private readonly projectsRepository: ProjectsRepository) {}

  async get(req: Request) {
    const items = await this.projectsRepository.list();
    if (req.headers.get('HX-Request') === 'true') {
      return new Response(await renderProjectsFragment(items), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    return Response.json({ projects: items });
  }

  async post(req: Request) {
    const parsed = await parseProjectPayload(req);
    if ('error' in parsed) {
      return parsed.error;
    }

    const [created] = await this.projectsRepository.create({
      ...parsed.value,
    });

    return Response.json({ project: created }, { status: 201 });
  }

  async patch(req: Request, id: number) {
    const parsed = await parseProjectPayload(req);
    if ('error' in parsed) {
      return parsed.error;
    }

    const [updated] = await this.projectsRepository.updateById(id, parsed.value);
    if (!updated) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }

    return Response.json({ project: updated });
  }

  async getPageById(req: Request, id: number) {
    const project = await this.projectsRepository.findById(id);
    if (!project) {
      return new Response('Not Found', { status: 404 });
    }

    const allowEdit = await canAccess(req, {
      actions: 'update',
      resource: 'project',
      resourceAttributes: { projectId: project.id },
    });

    return await renderProjectPage(req, project, allowEdit);
  }
}
