import { describe, expect, it } from 'vitest';
import {
  buildAuthorizationHeader,
  describeIdTokenSafe,
  extractBearerToken,
  isJwtIdTokenFormat,
} from '../src/lib/auth-token';

const VALID_JWT = `${'a'.repeat(20)}.${'b'.repeat(20)}.${'c'.repeat(20)}`;

describe('ID Token format', () => {
  it('accepts a three-part JWT', () => {
    expect(isJwtIdTokenFormat(VALID_JWT)).toBe(true);
    expect(describeIdTokenSafe(VALID_JWT)).toMatchObject({
      present: true,
      partCount: 3,
      formatOk: true,
      looksUrlEncoded: false,
    });
  });

  it('rejects access-token-like opaque strings', () => {
    expect(isJwtIdTokenFormat('v2abcdefghijklmnopqrstuvwxyz0123456789')).toBe(false);
    expect(isJwtIdTokenFormat('test:U-lee:Lee')).toBe(false);
  });

  it('rejects URL-encoded tokens instead of silently accepting them', () => {
    // encodeURIComponent does not encode '.' — use an explicitly percent-encoded form
    const encoded = VALID_JWT.replaceAll('.', '%2E');
    expect(isJwtIdTokenFormat(encoded)).toBe(false);
    expect(describeIdTokenSafe(encoded).looksUrlEncoded).toBe(true);
  });

  it('rejects tokens that already include Bearer', () => {
    expect(isJwtIdTokenFormat(`Bearer ${VALID_JWT}`)).toBe(false);
  });
});

describe('extractBearerToken', () => {
  it('extracts a single Bearer credential and trims whitespace', () => {
    const result = extractBearerToken(`  Bearer   ${VALID_JWT}  `);
    expect(result).toEqual({ ok: true, token: VALID_JWT });
  });

  it('does not allow nested Bearer prefixes', () => {
    const result = extractBearerToken(`Bearer Bearer ${VALID_JWT}`);
    expect(result).toEqual({ ok: false, code: 'auth_token_malformed' });
  });

  it('returns auth_token_missing when header is absent', () => {
    expect(extractBearerToken(null)).toEqual({ ok: false, code: 'auth_token_missing' });
    expect(extractBearerToken('')).toEqual({ ok: false, code: 'auth_token_missing' });
  });

  it('returns auth_token_malformed for non-Bearer schemes', () => {
    expect(extractBearerToken(`Token ${VALID_JWT}`)).toEqual({
      ok: false,
      code: 'auth_token_malformed',
    });
  });
});

describe('buildAuthorizationHeader', () => {
  it('adds Bearer exactly once', () => {
    expect(buildAuthorizationHeader(VALID_JWT)).toBe(`Bearer ${VALID_JWT}`);
    expect(() => buildAuthorizationHeader(`Bearer ${VALID_JWT}`)).toThrow(/Bearer/);
  });
});
