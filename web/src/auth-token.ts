/** Shared ID Token format helpers (mirrors worker/src/lib/auth-token.ts). */

export const ID_TOKEN_JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

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

export function isJwtIdTokenFormat(token: string): boolean {
  const trimmed = token.trim();
  if (!trimmed || trimmed.includes('%') || /\s/.test(trimmed)) {
    return false;
  }
  if (/^Bearer\s+/i.test(trimmed)) {
    return false;
  }
  const parts = trimmed.split('.');
  return parts.length === 3 && parts.every((part) => part.length > 0) && ID_TOKEN_JWT_RE.test(trimmed);
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

export function requireLiffIdToken(idToken: string | null | undefined): string {
  if (idToken == null || typeof idToken !== 'string' || !idToken.trim()) {
    throw new Error('缺少 LIFF ID Token，請確認 LIFF 設定已開啟 openid');
  }
  const trimmed = idToken.trim();
  if (!isJwtIdTokenFormat(trimmed)) {
    throw new Error('LIFF ID Token 格式錯誤（需要三段式 JWT）。請確認 Scope 含 openid，且未使用 Access Token');
  }
  return trimmed;
}
