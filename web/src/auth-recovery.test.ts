import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JOYIN_CONTEXT_STORAGE_KEY } from './liff-context';
import {
  AUTH_EXPIRED_USER_MESSAGE,
  AUTH_RECOVERY_FAILED_MESSAGE,
  JOYIN_AUTH_RECOVERY_ATTEMPTED_KEY,
  clearAuthRecoveryState,
  hasAuthRecoveryAttempted,
  preserveContextForAuthRecovery,
  recoverFromExpiredIdToken,
} from './auth-recovery';
import { JOYIN_LOGIN_ATTEMPTED_KEY, resetLiffBootStateForTests } from './liff';

const CONTEXT = `${'g'.repeat(40)}.${'h'.repeat(40)}`;

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  } as Storage;
}

describe('auth recovery from expired ID Token', () => {
  beforeEach(() => {
    resetLiffBootStateForTests();
  });

  it('preserves context and never writes an ID Token into storage', () => {
    const storage = memoryStorage();
    preserveContextForAuthRecovery(CONTEXT, storage);
    expect(storage.getItem(JOYIN_CONTEXT_STORAGE_KEY)).toBe(CONTEXT);
    expect(storage.getItem('idToken')).toBeNull();
    expect(storage.getItem('Authorization')).toBeNull();
  });

  it('first expired recovery logs out, clears loginAttempted, and calls login once', async () => {
    const storage = memoryStorage({
      [JOYIN_LOGIN_ATTEMPTED_KEY]: '1',
    });
    const logout = vi.fn();
    const login = vi.fn();
    const status = await recoverFromExpiredIdToken({
      contextToken: CONTEXT,
      storage,
      liff: {
        init: vi.fn(),
        isLoggedIn: () => true,
        isInClient: () => false,
        login,
        logout,
        getIDToken: () => 'old.token.value',
        getProfile: async () => ({ userId: 'U-a', displayName: 'A' }),
      },
    });
    expect(status).toBe('redirecting');
    expect(logout).toHaveBeenCalledTimes(1);
    expect(login).toHaveBeenCalledTimes(1);
    expect(login.mock.calls[0][0].redirectUri).toBe('https://joyin-web.pages.dev/');
    expect(storage.getItem(JOYIN_CONTEXT_STORAGE_KEY)).toBe(CONTEXT);
    expect(storage.getItem(JOYIN_AUTH_RECOVERY_ATTEMPTED_KEY)).toBe('1');
    expect(storage.getItem(JOYIN_LOGIN_ATTEMPTED_KEY)).toBeNull();
    expect(storage.getItem('idToken')).toBeNull();
  });

  it('blocks a second automatic recovery to prevent login loops', async () => {
    const storage = memoryStorage({
      [JOYIN_AUTH_RECOVERY_ATTEMPTED_KEY]: '1',
      [JOYIN_CONTEXT_STORAGE_KEY]: CONTEXT,
    });
    const login = vi.fn();
    const status = await recoverFromExpiredIdToken({
      contextToken: CONTEXT,
      storage,
      liff: {
        init: vi.fn(),
        isLoggedIn: () => false,
        isInClient: () => false,
        login,
        logout: vi.fn(),
        getIDToken: () => null,
        getProfile: async () => ({ userId: 'U-a', displayName: 'A' }),
      },
    });
    expect(status).toBe('manual_required');
    expect(login).not.toHaveBeenCalled();
    expect(hasAuthRecoveryAttempted(storage)).toBe(true);
    expect(storage.getItem(JOYIN_CONTEXT_STORAGE_KEY)).toBe(CONTEXT);
  });

  it('force=true clears recovery state and allows another logout/login', async () => {
    const storage = memoryStorage({
      [JOYIN_AUTH_RECOVERY_ATTEMPTED_KEY]: '1',
    });
    const login = vi.fn();
    const logout = vi.fn();
    const status = await recoverFromExpiredIdToken({
      contextToken: CONTEXT,
      storage,
      force: true,
      liff: {
        init: vi.fn(),
        isLoggedIn: () => false,
        isInClient: () => false,
        login,
        logout,
        getIDToken: () => null,
        getProfile: async () => ({ userId: 'U-b', displayName: 'B' }),
      },
    });
    expect(status).toBe('redirecting');
    expect(logout).toHaveBeenCalledTimes(1);
    expect(login).toHaveBeenCalledTimes(1);
  });

  it('exposes user-facing copy without technical member-auth wording', () => {
    expect(AUTH_EXPIRED_USER_MESSAGE).toBe('LINE 登入已過期，系統將重新登入。');
    expect(AUTH_RECOVERY_FAILED_MESSAGE).toContain('從群組最新的 /list 卡片重新開啟');
    expect(AUTH_EXPIRED_USER_MESSAGE).not.toContain('每位成員');
    clearAuthRecoveryState(memoryStorage({ [JOYIN_AUTH_RECOVERY_ATTEMPTED_KEY]: '1' }));
  });
});
