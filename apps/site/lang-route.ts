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
