export {
  APP_TIME_ZONE,
  DATE_RE,
  TIME_RE,
  addOneMinute,
  isExpired,
  isRangeInvalid,
  nowIso,
  taipeiParts,
  toEventAt,
  validateEventSchedule,
} from '../../../shared/datetime';

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function newTransferToken(): string {
  return `${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`;
}

export const TRANSFER_INVITE_TTL_MS = 24 * 60 * 60 * 1000;
