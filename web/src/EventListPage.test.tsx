import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventListPage } from './pages/EventListPage';
import { sampleEvent } from './test/fixtures';
import type { LiffSession } from './liff';

const listEvents = vi.fn();

vi.mock('./api', () => ({
  api: {
    listEvents: (...args: unknown[]) => listEvents(...args),
  },
}));

const session: LiffSession = {
  idToken: 'test:U-lee:Lee',
  lineUserId: 'U-lee',
  displayName: 'Lee',
  contextToken: 'test-context-token',
  inClient: false,
};

describe('EventListPage', () => {
  beforeEach(() => {
    listEvents.mockReset();
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
    expect(within(nav).queryByRole('link', { name: '開啟使用手冊' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '返回 LINE' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /時間：/ })).not.toBeInTheDocument();
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
    const emptyActions = screen.getByText('目前沒有尚未結束的活動').parentElement;
    expect(emptyActions).toBeTruthy();
    const createButtons = screen.getAllByRole('button', { name: '新增活動' });
    expect(createButtons.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: '查看操作說明' })).toBeInTheDocument();
    const actionRow = screen.getByRole('button', { name: '查看操作說明' }).closest('.row');
    expect(actionRow?.textContent).toMatch(/新增活動.*查看操作說明/);
  });
});
