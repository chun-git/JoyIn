export function nowIso(date = new Date()): string {
  return date.toISOString();
}

export function toEventAt(eventDate: string, eventTime: string): string {
  const iso = `${eventDate}T${eventTime}:00+08:00`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('INVALID_DATETIME');
  }
  return parsed.toISOString();
}

export function isExpired(eventAt: string, now = new Date()): boolean {
  return new Date(eventAt).getTime() <= now.getTime();
}

export function isRangeInvalid(startAt: string, endAt: string): boolean {
  return new Date(endAt).getTime() <= new Date(startAt).getTime();
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function newTransferToken(): string {
  return `${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`;
}

export const TRANSFER_INVITE_TTL_MS = 24 * 60 * 60 * 1000;
