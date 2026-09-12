/** Safe ID Token expiry helpers — never log or store the raw token. */

export interface DecodedIdTokenClaims {
  exp?: number;
  iat?: number;
  [key: string]: unknown;
}

export interface IdTokenExpiryInfo {
  expired: boolean;
  hasExp: boolean;
  iat?: number;
  exp?: number;
  now: number;
  /** exp - now (negative when expired). Undefined when exp missing. */
  secondsUntilExpiry?: number;
}

export function nowUnixSeconds(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000);
}

/**
 * Classify ID Token lifetime from decoded claims (liff.getDecodedIDToken()).
 * Missing exp → not treated as expired here (API / format checks still apply).
 */
export function readIdTokenExpiry(
  decoded: DecodedIdTokenClaims | null | undefined,
  nowSec = nowUnixSeconds(),
): IdTokenExpiryInfo {
  const exp = typeof decoded?.exp === 'number' && Number.isFinite(decoded.exp) ? decoded.exp : undefined;
  const iat = typeof decoded?.iat === 'number' && Number.isFinite(decoded.iat) ? decoded.iat : undefined;
  if (exp == null) {
    return { expired: false, hasExp: false, iat, exp, now: nowSec };
  }
  return {
    expired: exp <= nowSec,
    hasExp: true,
    iat,
    exp,
    now: nowSec,
    secondsUntilExpiry: exp - nowSec,
  };
}
