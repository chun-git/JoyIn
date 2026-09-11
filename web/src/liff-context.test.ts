import { beforeEach, describe, expect, it } from 'vitest';
import {
  CONTEXT_MISSING_MESSAGE,
  contextFromLiffState,
  getJoyInContextToken,
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
    raw: map,
  };
}

describe('getJoyInContextToken', () => {
  let storage: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    storage = memoryStorage();
  });

  it('reads context from location.search', () => {
    const result = getJoyInContextToken({
      search: '?context=tok.from.search',
      storage,
    });
    expect(result).toEqual({ token: 'tok.from.search', source: 'search' });
  });

  it('reads context from liff.state path', () => {
    const result = getJoyInContextToken({
      search: `?liff.state=${encodeURIComponent('/?context=tok.from.state')}`,
      storage,
    });
    expect(result.token).toBe('tok.from.state');
    expect(result.source).toBe('liff.state');
  });

  it('reads context from URL-encoded liff.state', () => {
    const encoded = encodeURIComponent(encodeURIComponent('/events?context=tok.encoded'));
    const result = getJoyInContextToken({
      search: `?liff.state=${encoded}`,
      storage,
    });
    expect(result.token).toBe('tok.encoded');
    expect(result.source).toBe('liff.state');
  });

  it('restores context from sessionStorage after login redirect and clears it', () => {
    preserveJoyInContextBeforeInit({
      search: '?context=tok.preserved',
      storage,
    });
    expect(storage.getItem(JOYIN_CONTEXT_STORAGE_KEY)).toBe('tok.preserved');

    const afterRedirect = getJoyInContextToken({
      search: '',
      storage,
      clearStorageOnRestore: true,
    });
    expect(afterRedirect).toEqual({ token: 'tok.preserved', source: 'sessionStorage' });
    expect(storage.getItem(JOYIN_CONTEXT_STORAGE_KEY)).toBeNull();
  });

  it('returns empty token when context is missing', () => {
    const result = getJoyInContextToken({ search: '', storage });
    expect(result).toEqual({ token: '', source: '' });
    expect(CONTEXT_MISSING_MESSAGE).toContain('/list');
  });
});

describe('contextFromLiffState', () => {
  it('supports path and events query forms', () => {
    expect(contextFromLiffState('/?context=abc')).toBe('abc');
    expect(contextFromLiffState('/events?context=xyz')).toBe('xyz');
    expect(contextFromLiffState(encodeURIComponent('/?context=enc'))).toBe('enc');
  });
});
