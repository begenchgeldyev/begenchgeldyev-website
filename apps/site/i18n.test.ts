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
