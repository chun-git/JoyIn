import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventListPage } from './pages/EventListPage';
import { sampleEvent } from './test/fixtures';
import type { LiffSession } from './liff';
import { ApiError } from './api';
import { AUTH_EXPIRED_BODY, AUTH_EXPIRED_TITLE, AUTH_RELOGIN_BUTTON } from './auth-recovery-keys';

const listEvents = vi.fn();
const refreshContext = vi.fn();

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return {
    ...actual,
    api: {
      listEvents: (...args: unknown[]) => listEvents(...args),
      refreshContext: (...args: unknown[]) => refreshContext(...args),
    },
  };
});

function freshContextToken(): string {
  const payload = btoa(JSON.stringify({ g: 'G1', exp: Date.now() + 60_000, n: 'n1' }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  const sig = btoa('sig').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `${payload}.${sig}`;
}

const session: LiffSession = {
  lineUserId: 'U-lee',
  displayName: 'Lee',
  contextToken: freshContextToken(),
  inClient: false,
  getIdToken: () => 'test:U-lee:Lee',
};

describe('EventListPage', () => {
  beforeEach(() => {
    listEvents.mockReset();
    refreshContext.mockReset();
    listEvents.mockResolvedValue({ events: [sampleEvent] });
  });

  it('loads events from GET /api/events on mount', async () => {
    render(
      <MemoryRouter>
        <EventListPage session={session} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(listEvents).toHaveBeenCalledWith(session);
    });
    expect(await screen.findByText('週五桌遊夜')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: '主要' });
    expect(within(nav).getByRole('link', { name: '活動' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: '使用手冊' })).toHaveAttribute('href', '/help');
    expect(screen.getByRole('button', { name: '新增活動' })).toBeInTheDocument();
  });

  it('renders events in start_at ascending order', async () => {
    listEvents.mockResolvedValue({
      events: [
        { ...sampleEvent, eventId: 'later', name: '較晚活動', startAt: '2026-12-20T11:00:00.000Z' },
        { ...sampleEvent, eventId: 'sooner', name: '較早活動', startAt: '2026-12-01T11:00:00.000Z' },
      ],
    });
    render(
      <MemoryRouter>
        <EventListPage session={session} />
      </MemoryRouter>,
    );
    const names = await screen.findAllByRole('heading', { level: 3 });
    expect(names.map((node) => node.textContent)).toEqual(['較早活動', '較晚活動']);
  });

  it('offers create and help from the empty state', async () => {
    listEvents.mockResolvedValue({ events: [] });
    render(
      <MemoryRouter>
        <EventListPage session={session} />
      </MemoryRouter>,
    );
    expect(await screen.findByText('目前沒有尚未結束的活動')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看操作說明' })).toBeInTheDocument();
  });

  it('shows 重新登入 LINE on auth expiry — never /list', async () => {
    listEvents.mockRejectedValue(new ApiError(401, 'auth_token_expired', AUTH_EXPIRED_BODY));
    const onRelogin = vi.fn();
    render(
      <MemoryRouter>
        <EventListPage session={session} onRelogin={onRelogin} />
      </MemoryRouter>,
    );
    expect(await screen.findByText(AUTH_EXPIRED_TITLE)).toBeInTheDocument();
    expect(screen.getByText(AUTH_EXPIRED_BODY)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: AUTH_RELOGIN_BUTTON })).toBeInTheDocument();
    expect(screen.queryByText(/重新輸入 \/list/)).not.toBeInTheDocument();
    expect(AUTH_EXPIRED_BODY).not.toContain('/list');
  });
});
