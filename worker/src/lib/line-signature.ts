import { timingSafeEqual } from './ids';

export async function hmacSha256Base64(secret: string, payload: BufferSource): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, payload);
  const bytes = new Uint8Array(signature);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export async function verifyLineSignature(
  channelSecret: string,
  rawBody: BufferSource,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader) {
    return false;
  }
  const expected = await hmacSha256Base64(channelSecret, rawBody);
  return timingSafeEqual(expected, signatureHeader);
}
