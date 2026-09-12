import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const initSession = vi.fn();
const retryInitSession = vi.fn();

vi.mock('./liff', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./liff')>();
  return {
    ...actual,
    initSession: (...args: unknown[]) => initSession(...args),
    retryInitSession: (...args: unknown[]) => retryInitSession(...args),
    getCachedLiff: () => null,
  };
});

import App from './App';
import { AUTH_EXPIRED_BODY, AUTH_EXPIRED_TITLE, AUTH_EXTERNAL_BROWSER_MESSAGE } from './auth-recovery-keys';

describe('App LIFF boot loading states', () => {
  beforeEach(() => {
    initSession.mockReset();
    retryInitSession.mockReset();
  });

  it('leaves loading when init times out', async () => {
    initSession.mockResolvedValue({
      status: 'failed',
      phase: 'failed',
      canRetryLogin: true,
      error: { message: 'LIFF 初始化逾時，請重新整理或稍後再試', code: 'init_timeout' },
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/LIFF 初始化逾時/)).toBeInTheDocument();
    expect(screen.queryByText('正在連接 LINE…')).not.toBeInTheDocument();
  });

  it('shows expired panel without 重新登入 when auth_token_expired in LIFF Browser', async () => {
    initSession.mockResolvedValue({
      status: 'failed',
      phase: 'failed',
      canRetryLogin: false,
      canCloseWindow: true,
      error: { message: AUTH_EXPIRED_BODY, code: 'auth_token_expired' },
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText(AUTH_EXPIRED_TITLE)).toBeInTheDocument();
    expect(screen.getByText(AUTH_EXPIRED_BODY)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '關閉頁面' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新登入 LINE' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重試登入' })).not.toBeInTheDocument();
    expect(screen.queryByText('正在連接 LINE…')).not.toBeInTheDocument();
  });

  it('shows external browser message without login buttons', async () => {
    initSession.mockResolvedValue({
      status: 'failed',
      phase: 'login_required',
      canRetryLogin: false,
      error: { message: AUTH_EXTERNAL_BROWSER_MESSAGE, code: 'external_browser_required' },
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText(AUTH_EXTERNAL_BROWSER_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新登入 LINE' })).not.toBeInTheDocument();
  });

  it('retry button calls retryInitSession for init failures', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    initSession.mockResolvedValue({
      status: 'failed',
      phase: 'failed',
      canRetryLogin: true,
      error: { message: 'LIFF 初始化逾時', code: 'init_timeout' },
    });
    retryInitSession.mockResolvedValue({
      status: 'failed',
      phase: 'failed',
      canRetryLogin: true,
      error: { message: '仍失敗', code: 'init_error' },
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    await screen.findByRole('button', { name: '重試' });
    await user.click(screen.getByRole('button', { name: '重試' }));
    await waitFor(() => {
      expect(retryInitSession).toHaveBeenCalled();
    });
  });
});
