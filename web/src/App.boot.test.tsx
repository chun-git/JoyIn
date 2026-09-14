import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const initSession = vi.fn();
const retryInitSession = vi.fn();
const startManualLineLogin = vi.fn();

vi.mock('./liff', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./liff')>();
  return {
    ...actual,
    initSession: (...args: unknown[]) => initSession(...args),
    retryInitSession: (...args: unknown[]) => retryInitSession(...args),
    startManualLineLogin: (...args: unknown[]) => startManualLineLogin(...args),
    getCachedLiff: () => null,
  };
});

import App from './App';
import {
  AUTH_EXPIRED_BODY,
  AUTH_EXPIRED_TITLE,
  AUTH_EXTERNAL_BROWSER_MESSAGE,
  AUTH_LOGIN_FAILED_BODY,
  AUTH_LOGIN_FAILED_TITLE,
  AUTH_REDIRECTING_LOGIN,
} from './auth-recovery-keys';

describe('App LIFF boot loading states', () => {
  beforeEach(() => {
    initSession.mockReset();
    retryInitSession.mockReset();
    startManualLineLogin.mockReset();
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
    expect(screen.queryByRole('button', { name: '重新登入' })).not.toBeInTheDocument();
    expect(screen.queryByText('正在連接 LINE…')).not.toBeInTheDocument();
  });

  it('external browser login failure shows 重新登入 instead of LINE-only block', async () => {
    initSession.mockResolvedValue({
      status: 'failed',
      phase: 'login_required',
      canRetryLogin: true,
      error: { message: AUTH_LOGIN_FAILED_BODY, code: 'login_required' },
    });

    render(
      <MemoryRouter initialEntries={['/events/550e8400-e29b-41d4-a716-446655440000']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText(AUTH_LOGIN_FAILED_TITLE)).toBeInTheDocument();
    expect(screen.getByText(AUTH_LOGIN_FAILED_BODY)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新登入' })).toBeInTheDocument();
    expect(screen.queryByText(AUTH_EXTERNAL_BROWSER_MESSAGE)).not.toBeInTheDocument();
  });

  it('重新登入 triggers startManualLineLogin and shows redirecting copy', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    initSession.mockResolvedValue({
      status: 'failed',
      phase: 'login_required',
      canRetryLogin: true,
      error: { message: AUTH_LOGIN_FAILED_BODY, code: 'login_required' },
    });
    startManualLineLogin.mockResolvedValue({
      status: 'redirecting',
      phase: 'redirecting_login',
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: '重新登入' }));
    await waitFor(() => {
      expect(startManualLineLogin).toHaveBeenCalled();
    });
    expect(await screen.findByText(AUTH_REDIRECTING_LOGIN)).toBeInTheDocument();
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
