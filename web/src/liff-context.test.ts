import { beforeEach, describe, expect, it } from 'vitest';
import {
  CONTEXT_MISSING_MESSAGE,
  contextFromLiffState,
  contextFromSearchParams,
  getJoyInContextToken,
  isJoyInContextTokenFormat,
  preserveJoyInContextBeforeInit,
  JOYIN_CONTEXT_STORAGE_KEY,
} from './liff-context';

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

const SAMPLE = `${'a'.repeat(40)}.${'b'.repeat(40)}`;

describe('getJoyInContextToken', () => {
  let storage: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    storage = memoryStorage();
  });

  it('reads context from location.search without double-decoding', () => {
    const result = getJoyInContextToken({
      search: `?context=${SAMPLE}`,
      storage,
    });
    expect(result).toEqual({ token: SAMPLE, source: 'search' });
    // Simulate what a mistaken second decodeURIComponent would do to a token with no %
    expect(decodeURIComponent(result.token)).toBe(SAMPLE);
  });

  it('reads context from liff.state path', () => {
    const result = getJoyInContextToken({
      search: `?liff.state=${encodeURIComponent(`/?context=${SAMPLE}`)}`,
      storage,
    });
    expect(result.token).toBe(SAMPLE);
    expect(result.source).toBe('liff.state');
  });

  it('reads context from URL-encoded liff.state once', () => {
    // URLSearchParams.get already decodes once; value may still contain %2F style path
    const onceEncodedPath = encodeURIComponent(`/?context=${SAMPLE}`);
    const result = getJoyInContextToken({
      search: `?liff.state=${encodeURIComponent(onceEncodedPath)}`,
      storage,
    });
    expect(result.token).toBe(SAMPLE);
    expect(result.source).toBe('liff.state');
  });

  it('restores context from sessionStorage after login redirect and clears it', () => {
    preserveJoyInContextBeforeInit({
      search: `?context=${SAMPLE}`,
      storage,
    });
    expect(storage.getItem(JOYIN_CONTEXT_STORAGE_KEY)).toBe(SAMPLE);

    const afterRedirect = getJoyInContextToken({
      search: '',
      storage,
      clearStorageOnRestore: true,
    });
    expect(afterRedirect).toEqual({ token: SAMPLE, source: 'sessionStorage' });
    expect(storage.getItem(JOYIN_CONTEXT_STORAGE_KEY)).toBeNull();
  });

  it('falls back to sessionStorage when oauth liff.state has no valid context token', () => {
    storage.setItem(JOYIN_CONTEXT_STORAGE_KEY, SAMPLE);
    const safe = getJoyInContextToken({
      search: `?liff.state=${encodeURIComponent('/callback?code=x')}`,
      storage,
      clearStorageOnRestore: true,
    });
    expect(safe.token).toBe(SAMPLE);
    expect(safe.source).toBe('sessionStorage');
  });

  it('returns empty token when context is missing', () => {
    const result = getJoyInContextToken({ search: '', storage });
    expect(result).toEqual({ token: '', source: '' });
    expect(CONTEXT_MISSING_MESSAGE).toContain('/list');
  });

  it('rejects treating whole liff.state as the token', () => {
    expect(contextFromLiffState(SAMPLE)).toBe('');
    expect(isJoyInContextTokenFormat(SAMPLE)).toBe(true);
  });
});

describe('contextFromSearchParams / liff.state decode', () => {
  it('URLSearchParams.get decodes once and we do not decode context again', () => {
    const search = `context=${encodeURIComponent(SAMPLE)}`;
    const once = contextFromSearchParams(search);
    expect(once).toBe(SAMPLE);
  });

  it('supports path and events query forms', () => {
    expect(contextFromLiffState(`/?context=${SAMPLE}`)).toBe(SAMPLE);
    expect(contextFromLiffState(`/events?context=${SAMPLE}`)).toBe(SAMPLE);
    expect(contextFromLiffState(encodeURIComponent(`/?context=${SAMPLE}`))).toBe(SAMPLE);
  });
});

describe('buildLiffLoginRedirectUri', () => {
  it('strips query and hash so LINE Login is not fed a long context URL', async () => {
    const { buildLiffLoginRedirectUri } = await import('./liff-context');
    expect(
      buildLiffLoginRedirectUri(
        `https://joyin-web.pages.dev/?context=${SAMPLE}&liff.state=${encodeURIComponent(`/?context=${SAMPLE}`)}`,
      ),
    ).toBe('https://joyin-web.pages.dev/');
    expect(buildLiffLoginRedirectUri('https://joyin-web.pages.dev/events/new')).toBe(
      'https://joyin-web.pages.dev/',
    );
  });
});
