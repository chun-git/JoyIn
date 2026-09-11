import { render, screen, waitFor } from '@testing-library/react';
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

vi.mock('./liff', async () => {
  const actual = await vi.importActual<typeof import('./liff')>('./liff');
  return {
    ...actual,
    closeLiff: vi.fn(),
  };
});

const session: LiffSession = {
  idToken: 'test:U-lee:Lee',
  lineUserId: 'U-lee',
  displayName: 'Lee',
  groupId: 'G-test-group',
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
    expect(screen.getByRole('link', { name: '使用手冊' })).toHaveAttribute('href', '/help');
    expect(screen.getByRole('link', { name: '開啟使用手冊' })).toHaveAttribute('href', '/help');
  });

  it('offers help from the empty state', async () => {
    listEvents.mockResolvedValue({ events: [] });
    render(
      <MemoryRouter>
        <EventListPage session={session} />
      </MemoryRouter>,
    );
    expect(await screen.findByText('目前沒有尚未結束的活動')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看操作說明' })).toBeInTheDocument();
  });
});
