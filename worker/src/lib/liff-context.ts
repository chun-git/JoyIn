import { timingSafeEqual } from './ids';

/** LIFF context token TTL: 24 hours */
export const LIFF_CONTEXT_TTL_MS = 24 * 60 * 60 * 1000;

export type LiffContextErrorCode =
  | 'context_missing'
  | 'context_malformed'
  | 'context_expired'
  | 'context_signature_mismatch'
  | 'context_payload_invalid'
  | 'context_secret_missing'
  /** Payload illegally binds a LINE user / signer — group context must not do this */
  | 'context_user_binding_error';

/** Only these keys are allowed in a group context payload. */
export const LIFF_CONTEXT_ALLOWED_KEYS = ['g', 'exp', 'n'] as const;

/**
 * Keys that would bind the token to a person. Presence → context_user_binding_error.
 * Group context represents the LINE group only; never the /list issuer.
 */
export const LIFF_CONTEXT_USER_BINDING_KEYS = [
  'u',
  'uid',
  'user',
  'userId',
  'user_id',
  'lineUserId',
  'line_user_id',
  'sub',
  'signer',
  'createdBy',
  'created_by',
  'owner',
  'issuer',
  'iss',
] as const;

export interface LiffContextPayload {
  /** LINE Messaging API groupId (C…) — group context, not a user */
  g: string;
  /** Expiry epoch milliseconds */
  exp: number;
  /**
   * Nonce for uniqueness / anti-tamper entropy.
   * NOT a one-time ticket — the same token may be reused by any group member until exp.
   */
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

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(base64UrlToBytes(body)));
  } catch {
    throw new LiffContextError('context_payload_invalid', 'invalid payload');
  }

  assertGroupOnlyContextPayload(raw);
  const payload = raw as LiffContextPayload;

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

  // Intentionally does NOT accept or compare any userId / signer.
  // Authorization (current user) is verified separately from X-JoyIn-Context (group).
  return {
    groupId: payload.g.trim(),
    expiresAt: payload.exp,
    nonce: payload.n,
  };
}

/**
 * Ensure the payload is group-scoped only.
 * Rejects any user-binding fields so a shared /list card works for every member.
 */
export function assertGroupOnlyContextPayload(raw: unknown): asserts raw is LiffContextPayload {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new LiffContextError('context_payload_invalid', 'invalid payload');
  }
  const record = raw as Record<string, unknown>;
  const keys = Object.keys(record);
  const allowed = new Set<string>(LIFF_CONTEXT_ALLOWED_KEYS);
  const userBinding = new Set<string>(LIFF_CONTEXT_USER_BINDING_KEYS);

  for (const key of keys) {
    const lower = key.toLowerCase();
    if (
      userBinding.has(key) ||
      lower.includes('userid') ||
      lower.includes('user_id') ||
      lower === 'signer' ||
      lower === 'sub'
    ) {
      throw new LiffContextError(
        'context_user_binding_error',
        'context token must not bind to a user',
      );
    }
    if (!allowed.has(key)) {
      throw new LiffContextError('context_payload_invalid', 'unexpected payload field');
    }
  }
}

/** Decode payload JSON without verifying signature — tests / diagnostics only. */
export function decodeLiffContextPayloadUnsafe(token: string): Record<string, unknown> {
  const trimmed = token.trim();
  if (!isLiffContextTokenFormat(trimmed)) {
    throw new LiffContextError('context_malformed', 'invalid token format');
  }
  const [body] = trimmed.split('.');
  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(body))) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new LiffContextError('context_payload_invalid', 'invalid payload');
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof LiffContextError) throw err;
    throw new LiffContextError('context_payload_invalid', 'invalid payload');
  }
}
