import { timingSafeEqual } from './ids';

/** LIFF context token TTL: 24 hours */
export const LIFF_CONTEXT_TTL_MS = 24 * 60 * 60 * 1000;

export interface LiffContextPayload {
  /** LINE Messaging API groupId (C…) */
  g: string;
  /** Expiry epoch milliseconds */
  exp: number;
  /** Nonce — must be present and non-empty */
  n: string;
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

export function buildLiffUrlWithContext(baseUrl: string, contextToken: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set('context', contextToken);
  return url.toString();
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
  constructor(message: string) {
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
    throw new LiffContextError('missing signing secret');
  }
  const trimmed = token.trim();
  if (!trimmed) {
    throw new LiffContextError('missing token');
  }
  const parts = trimmed.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new LiffContextError('invalid token format');
  }
  const [body, sig] = parts;
  const expected = await hmacSha256Base64Url(secret, body);
  if (!timingSafeEqual(expected, sig)) {
    throw new LiffContextError('invalid signature');
  }

  let payload: LiffContextPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(body))) as LiffContextPayload;
  } catch {
    throw new LiffContextError('invalid payload');
  }

  if (typeof payload.g !== 'string' || !payload.g.trim()) {
    throw new LiffContextError('missing groupId');
  }
  if (typeof payload.n !== 'string' || !payload.n.trim()) {
    throw new LiffContextError('missing nonce');
  }
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
    throw new LiffContextError('missing expiry');
  }
  if (payload.exp <= nowMs) {
    throw new LiffContextError('token expired');
  }

  return {
    groupId: payload.g.trim(),
    expiresAt: payload.exp,
    nonce: payload.n,
  };
}
