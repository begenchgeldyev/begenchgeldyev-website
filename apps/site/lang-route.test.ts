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
