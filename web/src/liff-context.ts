/** sessionStorage key for surviving LIFF OAuth redirect */
export const JOYIN_CONTEXT_STORAGE_KEY = 'joyin_liff_context';

export const CONTEXT_MISSING_MESSAGE =
  '請回到 LINE 群組輸入 /list，並從最新活動卡片開啟 JoyIn';

export const CONTEXT_INVALID_MESSAGE = '活動連結已失效，請重新輸入 /list';

export const LINK_UNRECOVERABLE_MESSAGE =
  '此活動連結已失效，請回群組重新輸入 /list';

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
 * Read expiry (ms) from an unsigned context payload for client-side freshness checks.
 * Never logs or returns groupId.
 */
export function readContextExpiryMs(token: string): number | null {
  const trimmed = token.trim();
  if (!isJoyInContextTokenFormat(trimmed)) return null;
  try {
    const [body] = trimmed.split('.');
    const padded = body.replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    const json = JSON.parse(atob(padded + pad)) as { exp?: unknown };
    return typeof json.exp === 'number' && Number.isFinite(json.exp) ? json.exp : null;
  } catch {
    return null;
  }
}

export function isContextTokenExpired(token: string, nowMs = Date.now()): boolean {
  const exp = readContextExpiryMs(token);
  // Only drop when expiry is known and past. Undecodable payloads are left for the API.
  if (exp == null) return false;
  return exp <= nowMs;
}

function acceptContextToken(
  token: string,
  storage: StorageLike | undefined,
  nowMs: number,
): string {
  if (!token || !isJoyInContextTokenFormat(token)) return '';
  // Keep expired-but-well-formed tokens so the app can call context refresh.
  // Do NOT clear sessionStorage here — that misclassified ended cards as「context 缺失」.
  void nowMs;
  void storage;
  return token;
}

/**
 * Persist context from the current page URL before `liff.init()`.
 * A new /list context always overwrites any previous stored context.
 * Expired tokens are kept for refresh (signature still verified server-side).
 */
export function preserveJoyInContextBeforeInit(options?: {
  search?: string;
  storage?: StorageLike;
  nowMs?: number;
}): string {
  const search = options?.search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const storage =
    options?.storage ??
    (typeof window !== 'undefined' ? window.sessionStorage : undefined);
  const nowMs = options?.nowMs ?? Date.now();

  const fromSearch = contextFromSearchParams(search);
  const liffState = (() => {
    try {
      return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('liff.state');
    } catch {
      return null;
    }
  })();
  const fromState = contextFromLiffState(liffState);
  const token = acceptContextToken(fromSearch || fromState, storage, nowMs);
  if (token) {
    // New card context overwrites any previous group context in this browser session.
    safeStorageSet(storage, JOYIN_CONTEXT_STORAGE_KEY, token);
  }
  return token;
}

/**
 * Resolve signed JoyIn context token after LIFF is ready.
 * Order: location.search → liff.state → sessionStorage.
 *
 * Expired tokens are retained for refresh — never treated as missing here.
 * Never use localStorage for context or Authorization.
 */
export function getJoyInContextToken(options?: {
  search?: string;
  storage?: StorageLike;
  /** When true, remove sessionStorage after reading from it. Default false. */
  clearStorageOnRestore?: boolean;
  nowMs?: number;
}): JoyInContextResult {
  const search = options?.search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const storage =
    options?.storage ??
    (typeof window !== 'undefined' ? window.sessionStorage : undefined);
  const clearStorageOnRestore = options?.clearStorageOnRestore === true;
  const nowMs = options?.nowMs ?? Date.now();

  const fromSearch = acceptContextToken(contextFromSearchParams(search), storage, nowMs);
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
  const fromState = acceptContextToken(contextFromLiffState(liffState), storage, nowMs);
  if (fromState) {
    safeStorageSet(storage, JOYIN_CONTEXT_STORAGE_KEY, fromState);
    return { token: fromState, source: 'liff.state' };
  }

  const storedRaw = safeStorageGet(storage, JOYIN_CONTEXT_STORAGE_KEY);
  const stored = acceptContextToken(storedRaw, storage, nowMs);
  if (stored) {
    if (clearStorageOnRestore) {
      safeStorageRemove(storage, JOYIN_CONTEXT_STORAGE_KEY);
    }
    return { token: stored, source: 'sessionStorage' };
  }

  return { token: '', source: '' };
}

/** Persist a freshly minted context onto the live session + sessionStorage. */
export function applyContextTokenToSession(session: { contextToken: string }, token: string): void {
  const trimmed = token.trim();
  if (!isJoyInContextTokenFormat(trimmed)) return;
  session.contextToken = trimmed;
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.setItem(JOYIN_CONTEXT_STORAGE_KEY, trimmed);
    } catch {
      // ignore
    }
  }
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
