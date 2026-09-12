/** LINE LIFF ID Token must be a 3-part JWT (header.payload.signature). */
export const ID_TOKEN_JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export type AuthTokenErrorCode =
  | 'auth_token_missing'
  | 'auth_token_malformed'
  | 'auth_token_invalid'
  | 'auth_token_expired';

export function describeIdTokenSafe(token: string): {
  present: boolean;
  tokenLength: number;
  partCount: number;
  formatOk: boolean;
  looksUrlEncoded: boolean;
} {
  const trimmed = (token || '').trim();
  const parts = trimmed ? trimmed.split('.') : [];
  return {
    present: Boolean(trimmed),
    tokenLength: trimmed.length,
    partCount: parts.length,
    formatOk: isJwtIdTokenFormat(trimmed),
    looksUrlEncoded: trimmed.includes('%'),
  };
}

/** True only for a compact JWT with exactly three non-empty segments and no percent-encoding. */
export function isJwtIdTokenFormat(token: string): boolean {
  const trimmed = token.trim();
  if (!trimmed || trimmed.includes('%') || /\s/.test(trimmed)) {
    return false;
  }
  // Reject accidental "Bearer xxx" leftovers
  if (/^Bearer\s+/i.test(trimmed)) {
    return false;
  }
  const parts = trimmed.split('.');
  return parts.length === 3 && parts.every((part) => part.length > 0) && ID_TOKEN_JWT_RE.test(trimmed);
}

/**
 * Extract a single Bearer credential from Authorization header.
 * Does not URL-decode the token.
 */
export function extractBearerToken(authorizationHeader: string | null | undefined): {
  ok: true;
  token: string;
} | {
  ok: false;
  code: AuthTokenErrorCode;
} {
  if (authorizationHeader == null || authorizationHeader.trim() === '') {
    return { ok: false, code: 'auth_token_missing' };
  }
  const header = authorizationHeader.trim();
  const match = /^Bearer\s+(\S.*?)\s*$/i.exec(header);
  if (!match) {
    return { ok: false, code: 'auth_token_malformed' };
  }
  const token = match[1].trim();
  if (!token) {
    return { ok: false, code: 'auth_token_missing' };
  }
  // Double Bearer or nested Bearer
  if (/^Bearer\s+/i.test(token)) {
    return { ok: false, code: 'auth_token_malformed' };
  }
  return { ok: true, token };
}

export function buildAuthorizationHeader(idToken: string): string {
  const trimmed = idToken.trim();
  if (!trimmed) {
    throw new Error('idToken is empty');
  }
  if (/^Bearer\s+/i.test(trimmed)) {
    throw new Error('idToken must not include Bearer prefix');
  }
  return `Bearer ${trimmed}`;
}
