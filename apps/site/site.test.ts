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

describe('include resolution', () => {
  test('resolves an include whose filename contains a hyphen', async () => {
    const res = await renderPage('/cv', 'en');
    const html = await (res as Response).text();
    expect(html).toContain('mouseenter');
    expect(html).not.toContain('#include');
  });
});

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
