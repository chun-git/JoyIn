/** sessionStorage key for surviving LIFF OAuth redirect */
export const JOYIN_CONTEXT_STORAGE_KEY = 'joyin_liff_context';

export const CONTEXT_MISSING_MESSAGE =
  '請回到 LINE 群組輸入 /list，並從活動卡片開啟 JoyIn';

export const CONTEXT_INVALID_MESSAGE = '活動連結已失效，請重新輸入 /list';

/** Must match Worker signed token shape: base64url.payload */
export const LIFF_CONTEXT_TOKEN_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export type JoyInContextSource = 'search' | 'liff.state' | 'sessionStorage' | '';

export interface JoyInContextResult {
  token: string;
  source: JoyInContextSource;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function isJoyInContextTokenFormat(token: string): boolean {
  const trimmed = token.trim();
  if (!LIFF_CONTEXT_TOKEN_RE.test(trimmed)) return false;
  return trimmed.split('.').length === 2;
}

/**
 * Read `context` from a query string.
 * URLSearchParams.get() already performs a single URL decode — do not decode again.
 */
export function contextFromSearchParams(search: string): string {
  const normalized = search.startsWith('?') ? search.slice(1) : search;
  if (!normalized) return '';
  try {
    const value = (new URLSearchParams(normalized).get('context') || '').trim();
    return isJoyInContextTokenFormat(value) ? value : '';
  } catch {
    return '';
  }
}

/**
 * Parse LIFF `liff.state` for an embedded context token.
 * URLSearchParams.get('liff.state') already decodes once.
 * Only apply an extra decodeURIComponent when the value still looks percent-encoded.
 * Never treat the entire liff.state string as the token.
 */
export function contextFromLiffState(raw: string | null | undefined): string {
  if (!raw) return '';

  const candidates: string[] = [raw];
  // One extra decode only when still percent-encoded (e.g. %2F%3Fcontext%3D...)
  if (/%[0-9A-Fa-f]{2}/.test(raw)) {
    try {
      candidates.push(decodeURIComponent(raw));
    } catch {
      // ignore malformed escape sequences
    }
  }

  for (const candidate of candidates) {
    const value = candidate.trim();
    if (!value) continue;
    // Never accept the raw liff.state blob as a token
    if (isJoyInContextTokenFormat(value) && !value.includes('context=')) {
      continue;
    }

    try {
      const asUrl = new URL(value, 'https://joyin.invalid');
      const fromUrl = (asUrl.searchParams.get('context') || '').trim();
      // searchParams.get already decoded once within this URL parse
      if (isJoyInContextTokenFormat(fromUrl)) return fromUrl;
    } catch {
      // continue
    }

    if (value.includes('context=')) {
      const query = value.includes('?') ? value.slice(value.indexOf('?') + 1) : value;
      try {
        const fromQuery = (new URLSearchParams(query).get('context') || '').trim();
        if (isJoyInContextTokenFormat(fromQuery)) return fromQuery;
      } catch {
        // continue
      }
    }
  }
  return '';
}

function safeStorageGet(storage: StorageLike | undefined, key: string): string {
  if (!storage) return '';
  try {
    return (storage.getItem(key) || '').trim();
  } catch {
    return '';
  }
}

function safeStorageSet(storage: StorageLike | undefined, key: string, value: string): void {
  if (!storage || !value) return;
  try {
    storage.setItem(key, value);
  } catch {
    // ignore quota / private mode
  }
}

function safeStorageRemove(storage: StorageLike | undefined, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // ignore
  }
}

/**
 * Persist context from the current page URL before `liff.init()`.
 * Does not mutate location / LIFF query parameters.
 */
export function preserveJoyInContextBeforeInit(options?: {
  search?: string;
  storage?: StorageLike;
}): string {
  const search = options?.search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const storage =
    options?.storage ??
    (typeof window !== 'undefined' ? window.sessionStorage : undefined);

  const fromSearch = contextFromSearchParams(search);
  const liffState = (() => {
    try {
      return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('liff.state');
    } catch {
      return null;
    }
  })();
  const fromState = contextFromLiffState(liffState);
  const token = fromSearch || fromState;
  if (token) {
    safeStorageSet(storage, JOYIN_CONTEXT_STORAGE_KEY, token);
  }
  return token;
}

/**
 * Resolve signed JoyIn context token after LIFF is ready.
 * Order: location.search → liff.state → sessionStorage (cleared after restore).
 */
export function getJoyInContextToken(options?: {
  search?: string;
  storage?: StorageLike;
  clearStorageOnRestore?: boolean;
}): JoyInContextResult {
  const search = options?.search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const storage =
    options?.storage ??
    (typeof window !== 'undefined' ? window.sessionStorage : undefined);
  const clearStorageOnRestore = options?.clearStorageOnRestore !== false;

  const fromSearch = contextFromSearchParams(search);
  if (fromSearch) {
    safeStorageSet(storage, JOYIN_CONTEXT_STORAGE_KEY, fromSearch);
    return { token: fromSearch, source: 'search' };
  }

  const liffState = (() => {
    try {
      return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('liff.state');
    } catch {
      return null;
    }
  })();
  const fromState = contextFromLiffState(liffState);
  if (fromState) {
    safeStorageSet(storage, JOYIN_CONTEXT_STORAGE_KEY, fromState);
    return { token: fromState, source: 'liff.state' };
  }

  const stored = safeStorageGet(storage, JOYIN_CONTEXT_STORAGE_KEY);
  if (stored && isJoyInContextTokenFormat(stored)) {
    if (clearStorageOnRestore) {
      safeStorageRemove(storage, JOYIN_CONTEXT_STORAGE_KEY);
    }
    return { token: stored, source: 'sessionStorage' };
  }

  return { token: '', source: '' };
}

/** Safe diagnostics only — never includes the token value. */
export function buildContextDiag(
  token: string,
  source: JoyInContextSource = '',
): {
  hasContextToken: boolean;
  contextTokenLength: number;
  contextSource: JoyInContextSource;
  formatOk: boolean;
  loadedAt: string;
} {
  return {
    hasContextToken: Boolean(token),
    contextTokenLength: token.length,
    contextSource: source,
    formatOk: isJoyInContextTokenFormat(token),
    loadedAt: new Date().toISOString(),
  };
}

/**
 * Safe redirect URI for `liff.login()`.
 * Must start with the LIFF Endpoint URL (https://joyin-web.pages.dev).
 * Strip query/hash so LINE OAuth is not fed a long ?context= URL (400 Bad Request).
 */
export function buildLiffLoginRedirectUri(href: string): string {
  const url = new URL(href);
  return `${url.origin}/`;
}
