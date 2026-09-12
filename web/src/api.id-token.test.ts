import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, resolveFreshIdToken } from './api';
import { AUTH_EXPIRED_BODY } from './auth-recovery-keys';
import {
  getCachedLiff,
  resetLiffBootStateForTests,
  type LiffLike,
  type LiffSession,
} from './liff';

const VALID_JWT = `${'a'.repeat(12)}.${'b'.repeat(12)}.${'c'.repeat(12)}`;

function memorySession(overrides: Partial<LiffSession> = {}): LiffSession {
  return {
    lineUserId: 'U-a',
    displayName: 'A',
    contextToken: `${'g'.repeat(40)}.${'h'.repeat(40)}`,
    inClient: true,
    getIdToken: () => 'stale.token.value',
    ...overrides,
  };
}

describe('resolveFreshIdToken', () => {
  beforeEach(() => {
    resetLiffBootStateForTests();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ events: [] }), { status: 200 })),
    );
  });

  afterEach(() => {
    resetLiffBootStateForTests();
    vi.unstubAllGlobals();
  });

  it('reads getIDToken from LIFF on every call and ignores stale session closure values', async () => {
    let current = 'first.token.value';
    const getIDToken = vi.fn(() => current);
    const liff = {
      init: vi.fn(async () => undefined),
      isLoggedIn: () => true,
      isInClient: () => true,
      login: vi.fn(),
      logout: vi.fn(),
      getIDToken,
      getDecodedIDToken: () => ({ iat: 1, exp: Math.floor(Date.now() / 1000) + 3600 }),
      getProfile: async () => ({ userId: 'U-a', displayName: 'A' }),
    } satisfies LiffLike;

    // Seed cache as a successful init would.
    const { initLiffSingleton } = await import('./liff');
    await initLiffSingleton(liff, 'liff-id', { timeoutMs: 500, withLoginOnExternalBrowser: true });
    expect(getCachedLiff()).toBe(liff);

    const session = memorySession({ getIdToken: () => 'should-not-use-this' });
    expect(resolveFreshIdToken(session)).toBe('first.token.value');

    current = 'second.token.value';
    expect(resolveFreshIdToken(session)).toBe('second.token.value');
    expect(getIDToken).toHaveBeenCalledTimes(2);
    expect(liff.logout).not.toHaveBeenCalled();
    expect(liff.login).not.toHaveBeenCalled();
  });

  it('does not call fetch when exp is already past', async () => {
    const now = Math.floor(Date.now() / 1000);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const liff = {
      init: vi.fn(async () => undefined),
      isLoggedIn: () => true,
      isInClient: () => true,
      login: vi.fn(),
      logout: vi.fn(),
      getIDToken: () => VALID_JWT,
      getDecodedIDToken: () => ({ iat: now - 10_000, exp: now - 10 }),
      getProfile: async () => ({ userId: 'U-a', displayName: 'A' }),
    } satisfies LiffLike;

    const { initLiffSingleton } = await import('./liff');
    await initLiffSingleton(liff, 'liff-id', { timeoutMs: 500 });

    const session = memorySession();
    expect(() => resolveFreshIdToken(session)).toThrow(ApiError);
    try {
      resolveFreshIdToken(session);
    } catch (err) {
      expect(err).toMatchObject({ code: 'auth_token_expired', message: AUTH_EXPIRED_BODY });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(liff.logout).not.toHaveBeenCalled();
    expect(liff.login).not.toHaveBeenCalled();
  });
});
