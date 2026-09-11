import { describe, expect, it } from 'vitest';
import {
  buildAuthorizationHeader,
  describeIdTokenSafe,
  isJwtIdTokenFormat,
  requireLiffIdToken,
} from './auth-token';

const VALID_JWT = `${'h'.repeat(16)}.${'p'.repeat(16)}.${'s'.repeat(16)}`;

describe('web auth-token helpers', () => {
  it('requires a three-part ID Token from liff.getIDToken()', () => {
    expect(requireLiffIdToken(VALID_JWT)).toBe(VALID_JWT);
    expect(() => requireLiffIdToken(null)).toThrow(/openid/);
    expect(() => requireLiffIdToken('access-token-not-jwt')).toThrow(/三段式 JWT/);
    expect(() => requireLiffIdToken(VALID_JWT.replaceAll('.', '%2E'))).toThrow(/三段式 JWT/);
  });

  it('never treats Access Token style values as ID Tokens', () => {
    expect(isJwtIdTokenFormat('v2.' + 'x'.repeat(40))).toBe(false);
    expect(describeIdTokenSafe('opaque-access-token').formatOk).toBe(false);
  });

  it('builds Authorization with a single Bearer prefix', () => {
    expect(buildAuthorizationHeader(VALID_JWT)).toBe(`Bearer ${VALID_JWT}`);
    expect(buildAuthorizationHeader(VALID_JWT).match(/Bearer/gi)?.length).toBe(1);
  });
});
