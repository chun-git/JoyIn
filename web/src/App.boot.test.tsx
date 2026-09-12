import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  };
});

import App from './App';

describe('App LIFF boot loading states', () => {
  beforeEach(() => {
    initSession.mockReset();
    retryInitSession.mockReset();
    startManualLineLogin.mockReset();
  });

  it('does not stay on forever loading when boot redirects for login', async () => {
    initSession.mockResolvedValue({
      status: 'redirecting',
      phase: 'redirecting_login',
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('正在前往 LINE 登入…')).toBeInTheDocument();
    expect(screen.queryByText('正在連接 LINE…')).not.toBeInTheDocument();
  });

  it('leaves loading and shows 重新登入 LINE after login_required', async () => {
    initSession.mockResolvedValue({
      status: 'failed',
      phase: 'login_required',
      canRetryLogin: true,
      error: { message: '尚未登入 LINE。請點「重新登入 LINE」', code: 'login_required' },
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/尚未登入 LINE/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新登入 LINE' })).toBeInTheDocument();
    expect(screen.queryByText('正在連接 LINE…')).not.toBeInTheDocument();
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

  it('manual 重新登入 LINE triggers startManualLineLogin', async () => {
    const user = userEvent.setup();
    initSession.mockResolvedValue({
      status: 'failed',
      phase: 'login_required',
      canRetryLogin: true,
      error: { message: '請重新登入', code: 'login_required' },
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

    await screen.findByRole('button', { name: '重新登入 LINE' });
    await user.click(screen.getByRole('button', { name: '重新登入 LINE' }));
    await waitFor(() => {
      expect(startManualLineLogin).toHaveBeenCalled();
    });
    expect(await screen.findByText('正在前往 LINE 登入…')).toBeInTheDocument();
  });

  it('switches redirecting_login to failed with 重新登入 after 8s if page stays', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    initSession.mockResolvedValue({
      status: 'redirecting',
      phase: 'redirecting_login',
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('正在前往 LINE 登入…')).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await screen.findByText(/登入導向逾時/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新登入 LINE' })).toBeInTheDocument();
    expect(screen.queryByText('正在連接 LINE…')).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});
