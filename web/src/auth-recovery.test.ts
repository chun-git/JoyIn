import { describe, expect, it, vi } from 'vitest';
import { AUTH_EXPIRED_BODY, AUTH_EXTERNAL_BROWSER_MESSAGE, AUTH_LOGIN_FAILED_BODY, AUTH_LOGIN_FAILED_TITLE } from './auth-recovery-keys';
import { closeLiffWindowIfInClient } from './auth-recovery';

describe('auth recovery (auth vs context copy)', () => {
  it('auth expired copy never asks for /list', () => {
    expect(AUTH_EXPIRED_BODY).toBe('請重新登入 LINE 後繼續查看活動。');
    expect(AUTH_EXPIRED_BODY).not.toContain('/list');
    expect(AUTH_LOGIN_FAILED_TITLE).toBe('無法登入 LINE');
    expect(AUTH_LOGIN_FAILED_BODY).toContain('請重新登入');
    expect(AUTH_EXTERNAL_BROWSER_MESSAGE).toBe('請使用 LINE 開啟 JoyIn');
  });

  it('closeLiffWindowIfInClient only calls closeWindow inside LIFF Browser', () => {
    const closeWindow = vi.fn();
    const logout = vi.fn();
    const login = vi.fn();

    expect(
      closeLiffWindowIfInClient({
        init: vi.fn(),
        isLoggedIn: () => true,
        isInClient: () => true,
        login,
        logout,
        closeWindow,
        getIDToken: () => null,
        getProfile: async () => ({ userId: 'U', displayName: 'A' }),
      }),
    ).toBe(true);
    expect(closeWindow).toHaveBeenCalledTimes(1);
    expect(logout).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();

    expect(
      closeLiffWindowIfInClient({
        init: vi.fn(),
        isLoggedIn: () => false,
        isInClient: () => false,
        login,
        logout,
        closeWindow,
        getIDToken: () => null,
        getProfile: async () => ({ userId: 'U', displayName: 'A' }),
      }),
    ).toBe(false);
    expect(closeWindow).toHaveBeenCalledTimes(1);
  });
});
