/**
 * Shared validation for event Google Maps URL and per-person fee (TWD).
 * Used by both Worker API and web form — do not rely on HTML alone.
 */

export const FEE_AMOUNT_MIN = 0;
export const FEE_AMOUNT_MAX = 1_000_000;
export const GOOGLE_MAPS_URL_MAX_LENGTH = 500;

const ALLOWED_GOOGLE_MAPS_HOSTS = new Set([
  'maps.app.goo.gl',
  'goo.gl',
  'google.com',
  'www.google.com',
  'maps.google.com',
  'maps.google.com.tw',
  'www.maps.google.com',
  'www.maps.google.com.tw',
]);

export type GoogleMapsUrlResult =
  | { ok: true; value: string | null }
  | { ok: false; message: string };

export type FeeAmountResult =
  | { ok: true; value: number }
  | { ok: false; message: string };

function isAllowedGoogleMapsUrl(url: URL): boolean {
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (!ALLOWED_GOOGLE_MAPS_HOSTS.has(host)) return false;

  const path = url.pathname.toLowerCase();
  if (host === 'goo.gl') {
    return path.startsWith('/maps');
  }
  if (host === 'google.com' || host === 'www.google.com') {
    return path.startsWith('/maps');
  }
  // maps.app.goo.gl, maps.google.com*, etc.
  return true;
}

/**
 * Empty / null / undefined → null (選填).
 * Otherwise must be https Google Maps URL.
 */
export function parseGoogleMapsUrl(value: unknown): GoogleMapsUrlResult {
  if (value == null) return { ok: true, value: null };
  if (typeof value !== 'string') {
    return { ok: false, message: 'Google Maps 網址格式無效' };
  }
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > GOOGLE_MAPS_URL_MAX_LENGTH) {
    return { ok: false, message: `Google Maps 網址長度不可超過 ${GOOGLE_MAPS_URL_MAX_LENGTH} 字` };
  }
  if (!/^https:\/\//i.test(trimmed)) {
    return { ok: false, message: 'Google Maps 網址需為 https 開頭' };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, message: 'Google Maps 網址格式無效' };
  }
  if (!isAllowedGoogleMapsUrl(parsed)) {
    return {
      ok: false,
      message: '僅接受 Google Maps 相關網址（例如 maps.app.goo.gl、google.com/maps）',
    };
  }
  return { ok: true, value: trimmed };
}

/**
 * Integer TWD per person; 0 = free.
 * Rejects negatives, decimals, NaN, and non-numeric strings.
 */
export function parseFeeAmount(value: unknown): FeeAmountResult {
  if (value == null || value === '') {
    return { ok: false, message: '請填寫每人費用（0 代表免費）' };
  }
  if (typeof value === 'boolean') {
    return { ok: false, message: '每人費用需為整數' };
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^-?\d+$/.test(trimmed)) {
      return { ok: false, message: '每人費用需為整數，不可含小數' };
    }
    const num = Number(trimmed);
    if (!Number.isInteger(num) || num < FEE_AMOUNT_MIN || num > FEE_AMOUNT_MAX) {
      return {
        ok: false,
        message: `每人費用需為 ${FEE_AMOUNT_MIN} 到 ${FEE_AMOUNT_MAX} 的整數`,
      };
    }
    return { ok: true, value: num };
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      return { ok: false, message: '每人費用需為整數，不可含小數' };
    }
    if (value < FEE_AMOUNT_MIN || value > FEE_AMOUNT_MAX) {
      return {
        ok: false,
        message: `每人費用需為 ${FEE_AMOUNT_MIN} 到 ${FEE_AMOUNT_MAX} 的整數`,
      };
    }
    return { ok: true, value: value };
  }
  return { ok: false, message: '每人費用需為整數' };
}

export function formatFeeLabel(feeAmount: number): string {
  if (!Number.isFinite(feeAmount) || feeAmount <= 0) return '免費';
  return `${Math.trunc(feeAmount)} 元／人`;
}

/** Append LINE openExternalBrowser so Flex URI opens maps outside in-app browser. */
export function withOpenExternalBrowser(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('openExternalBrowser', '1');
    return parsed.toString();
  } catch {
    return url;
  }
}
