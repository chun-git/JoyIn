import { describe, expect, it } from 'vitest';
import { nowUnixSeconds, readIdTokenExpiry } from './id-token-expiry';

describe('readIdTokenExpiry', () => {
  it('marks token expired when exp <= now', () => {
    const now = 1_700_000_000;
    const info = readIdTokenExpiry({ iat: now - 3600, exp: now - 1 }, now);
    expect(info.expired).toBe(true);
    expect(info.hasExp).toBe(true);
    expect(info.secondsUntilExpiry).toBe(-1);
    expect(info.iat).toBe(now - 3600);
    expect(info.exp).toBe(now - 1);
    expect(info.now).toBe(now);
  });

  it('is not expired when exp is in the future', () => {
    const now = nowUnixSeconds();
    const info = readIdTokenExpiry({ iat: now - 10, exp: now + 600 }, now);
    expect(info.expired).toBe(false);
    expect(info.secondsUntilExpiry).toBe(600);
  });

  it('does not treat missing exp as expired', () => {
    const info = readIdTokenExpiry({ iat: 1 }, 100);
    expect(info.expired).toBe(false);
    expect(info.hasExp).toBe(false);
  });
});
