import { timingSafeEqual } from './ids';

/** LIFF context token TTL: 24 hours */
export const LIFF_CONTEXT_TTL_MS = 24 * 60 * 60 * 1000;

export type LiffContextErrorCode =
  | 'context_missing'
  | 'context_malformed'
  | 'context_expired'
  | 'context_signature_mismatch'
  | 'context_payload_invalid'
  | 'context_secret_missing';

export interface LiffContextPayload {
  /** LINE Messaging API groupId (C…) */
  g: string;
  /** Expiry epoch milliseconds */
  exp: number;
  /** Nonce — must be present and non-empty */
  n: string;
}

/** Signed token shape: base64url(payload).base64url(hmac) — no extra decode needed after URLSearchParams.get */
export const LIFF_CONTEXT_TOKEN_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function isLiffContextTokenFormat(token: string): boolean {
  const trimmed = token.trim();
  if (!LIFF_CONTEXT_TOKEN_RE.test(trimmed)) return false;
  const parts = trimmed.split('.');
  return parts.length === 2 && Boolean(parts[0] && parts[1]);
}

export function describeTokenSafe(token: string): {
  present: boolean;
  tokenLength: number;
  partCount: number;
  formatOk: boolean;
} {
  const trimmed = (token || '').trim();
  return {
    present: Boolean(trimmed),
    tokenLength: trimmed.length,
    partCount: trimmed ? trimmed.split('.').length : 0,
    formatOk: isLiffContextTokenFormat(trimmed),
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function encodePayload(payload: LiffContextPayload): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

async function hmacSha256Base64Url(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return bytesToBase64Url(new Uint8Array(signature));
}

/**
 * Build the URL embedded in Flex cards.
 *
 * Prefer the LIFF Endpoint URL (Pages origin) with `?context=…`, not
 * `https://liff.line.me/{id}/?context=…`.
 *
 * Opening via liff.line.me puts first-time users in the LIFF browser, where
 * `liff.login()` is unsupported and commonly returns HTTP 400. Opening the
 * Endpoint URL uses LINE's in-app / external browser where login works.
 */
export function buildLiffUrlWithContext(baseUrl: string, contextToken: string): string {
  const url = new URL(baseUrl);
  url.search = '';
  url.hash = '';
  // Endpoint roots are typically `/`; keep existing path if present.
  if (!url.pathname || url.pathname === '') {
    url.pathname = '/';
  }
  url.searchParams.set('context', contextToken);
  return url.toString();
}

/** Safe flex URL diagnostics — never includes token or full URI. */
export async function describeLiffUrlSafe(
  liffUrl: string,
  contextToken: string,
): Promise<{
  hasContext: boolean;
  hasLiffState: boolean;
  tokenLength: number;
  urlLength: number;
  tokenHashPrefix: string;
  formatOk: boolean;
}> {
  let hasContext = false;
  let hasLiffState = false;
  try {
    const parsed = new URL(liffUrl);
    hasContext = Boolean(parsed.searchParams.get('context'));
    hasLiffState = Boolean(parsed.searchParams.get('liff.state'));
  } catch {
    hasContext = liffUrl.includes('context=');
    hasLiffState = liffUrl.includes('liff.state=');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(contextToken));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return {
    hasContext,
    hasLiffState,
    tokenLength: contextToken.length,
    urlLength: liffUrl.length,
    tokenHashPrefix: hex.slice(0, 8),
    formatOk: isLiffContextTokenFormat(contextToken),
  };
}

export async function signLiffContext(
  secret: string,
  groupId: string,
  nowMs = Date.now(),
  ttlMs = LIFF_CONTEXT_TTL_MS,
): Promise<string> {
  const trimmed = groupId.trim();
  if (!trimmed) {
    throw new Error('groupId is required to sign LIFF context');
  }
  if (!secret) {
    throw new Error('LIFF_CONTEXT_SIGNING_SECRET is required');
  }
  const payload: LiffContextPayload = {
    g: trimmed,
    exp: nowMs + ttlMs,
    n: crypto.randomUUID().replaceAll('-', ''),
  };
  const body = encodePayload(payload);
  const sig = await hmacSha256Base64Url(secret, body);
  return `${body}.${sig}`;
}

export class LiffContextError extends Error {
  constructor(
    public readonly code: LiffContextErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LiffContextError';
  }
}

export async function verifyLiffContext(
  secret: string,
  token: string,
  nowMs = Date.now(),
): Promise<{ groupId: string; expiresAt: number; nonce: string }> {
  if (!secret) {
    throw new LiffContextError('context_secret_missing', 'missing signing secret');
  }
  const trimmed = token.trim();
  if (!trimmed) {
    throw new LiffContextError('context_missing', 'missing token');
  }
  if (!isLiffContextTokenFormat(trimmed)) {
    throw new LiffContextError('context_malformed', 'invalid token format');
  }
  const parts = trimmed.split('.');
  const [body, sig] = parts;
  const expected = await hmacSha256Base64Url(secret, body);
  if (expected.length !== sig.length || !timingSafeEqual(expected, sig)) {
    throw new LiffContextError('context_signature_mismatch', 'invalid signature');
  }

  let payload: LiffContextPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(body))) as LiffContextPayload;
  } catch {
    throw new LiffContextError('context_payload_invalid', 'invalid payload');
  }

  if (typeof payload.g !== 'string' || !payload.g.trim()) {
    throw new LiffContextError('context_payload_invalid', 'missing groupId');
  }
  if (typeof payload.n !== 'string' || !payload.n.trim()) {
    throw new LiffContextError('context_payload_invalid', 'missing nonce');
  }
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
    throw new LiffContextError('context_payload_invalid', 'missing expiry');
  }
  if (payload.exp <= nowMs) {
    throw new LiffContextError('context_expired', 'token expired');
  }

  return {
    groupId: payload.g.trim(),
    expiresAt: payload.exp,
    nonce: payload.n,
  };
}
