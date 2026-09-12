import { describe, expect, it, vi } from 'vitest';
import { AUTH_EXPIRED_BODY, AUTH_EXTERNAL_BROWSER_MESSAGE } from './auth-recovery-keys';
import { closeLiffWindowIfInClient } from './auth-recovery';

describe('auth recovery (no auto logout/login)', () => {
  it('exposes LIFF Browser expired copy without auto-login wording', () => {
    expect(AUTH_EXPIRED_BODY).toContain('從群組最新的 /list 卡片重新開啟');
    expect(AUTH_EXPIRED_BODY).not.toContain('系統將重新登入');
    expect(AUTH_EXPIRED_BODY).not.toContain('每位成員');
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
