import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  api,
  resetApiAuthRecoveryForTests,
  tryRefreshIdTokenOnce,
} from './api';
import { AUTH_EXPIRED_BODY } from './auth-recovery-keys';
import { resetLiffBootStateForTests, type LiffLike } from './liff';

const VALID_JWT = `${'a'.repeat(12)}.${'b'.repeat(12)}.${'c'.repeat(12)}`;

describe('API auth recovery once', () => {
  beforeEach(() => {
    resetLiffBootStateForTests();
    resetApiAuthRecoveryForTests();
  });

  afterEach(() => {
    resetLiffBootStateForTests();
    resetApiAuthRecoveryForTests();
    vi.unstubAllGlobals();
  });

  it('retries listEvents once after silent getIDToken refresh — never login/logout', async () => {
    let token = VALID_JWT;
    let decodedExp = Math.floor(Date.now() / 1000) - 10;
    const login = vi.fn();
    const logout = vi.fn();
    const getIDToken = vi.fn(() => token);
    const liff = {
      init: vi.fn(async () => undefined),
      isLoggedIn: () => true,
      isInClient: () => true,
      login,
      logout,
      getIDToken,
      getDecodedIDToken: () => ({
        iat: Math.floor(Date.now() / 1000) - 100,
        exp: decodedExp,
      }),
      getProfile: async () => ({ userId: 'U-a', displayName: 'A' }),
    } satisfies LiffLike;

    const { initLiffSingleton } = await import('./liff');
    await initLiffSingleton(liff, 'liff-id', { timeoutMs: 500 });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'auth_token_expired', message: 'LINE 登入已過期' }), {
          status: 401,
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ events: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    // First resolveFreshIdToken would fail on expired decoded — fix before request by
    // making first client check pass: use non-expired decoded, then server returns expired,
    // then recovery re-reads token.
    decodedExp = Math.floor(Date.now() / 1000) + 3600;

    const session = {
      lineUserId: 'U-a',
      displayName: 'A',
      contextToken: `${'g'.repeat(40)}.${'h'.repeat(40)}`,
      inClient: true,
      getIdToken: () => token,
      getDecodedIdToken: () => ({
        iat: Math.floor(Date.now() / 1000) - 100,
        exp: decodedExp,
      }),
    };

    // Simulate server auth failure then client recovery finds fresh token.
    const resultPromise = api.listEvents(session);
    // After first failure, recovery runs — ensure token still valid for retry.
    token = VALID_JWT;
    const result = await resultPromise;
    expect(result).toEqual({ events: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(login).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
  });

  it('tryRefreshIdTokenOnce only succeeds once per lifetime', () => {
    const session = {
      lineUserId: 'U-a',
      displayName: 'A',
      contextToken: 'a.b',
      inClient: true,
      getIdToken: () => VALID_JWT,
      getDecodedIdToken: () => ({
        iat: 1,
        exp: Math.floor(Date.now() / 1000) + 1000,
      }),
    };
    expect(tryRefreshIdTokenOnce(session)).toBe(true);
    expect(tryRefreshIdTokenOnce(session)).toBe(false);
  });

  it('auth expiry message never mentions /list', () => {
    expect(AUTH_EXPIRED_BODY).not.toContain('/list');
    expect(() => {
      throw new ApiError(401, 'auth_token_expired', AUTH_EXPIRED_BODY);
    }).toThrow(ApiError);
  });
});
