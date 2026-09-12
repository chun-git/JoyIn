import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventCreatePage } from './pages/EventCreatePage';
import { sampleEvent } from './test/fixtures';
import type { LiffSession } from './liff';

const getEvent = vi.fn();
const copyEvent = vi.fn();
const createEvent = vi.fn();

vi.mock('./api', () => ({
  api: {
    getEvent: (...args: unknown[]) => getEvent(...args),
    copyEvent: (...args: unknown[]) => copyEvent(...args),
    createEvent: (...args: unknown[]) => createEvent(...args),
  },
}));

const session: LiffSession = {
  lineUserId: 'U-lee',
  displayName: 'Lee',
  contextToken: 'test-context-token',
  inClient: false,
  getIdToken: () => 'test:U-lee:Lee',
};

describe('EventCreatePage copy flow', () => {
  beforeEach(() => {
    getEvent.mockReset();
    copyEvent.mockReset();
    createEvent.mockReset();
    getEvent.mockResolvedValue({
      event: {
        ...sampleEvent,
        registrations: { confirmed: [], waitlist: [] },
        viewer: { isOrganizer: false, selfRegistration: null, proxyRegistrations: [] },
      },
    });
    copyEvent.mockResolvedValue({ event: { ...sampleEvent, eventId: 'copied-1' } });
  });

  it('opens the create form with copied fields and saves a new event', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/events/new?copy=e1']}>
        <Routes>
          <Route path="/events/new" element={<EventCreatePage session={session} />} />
          <Route path="/events/:eventId" element={<div>copied-detail</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByDisplayValue('週五桌遊夜')).toBeInTheDocument();
    expect(screen.getByDisplayValue('台北市中山區')).toBeInTheDocument();
    expect(screen.getByLabelText('開始日期')).toHaveValue('');
    expect(getEvent).toHaveBeenCalledWith(session, 'e1');

    await user.type(screen.getByLabelText('開始日期'), '2026-12-20');
    expect(screen.getByLabelText('結束日期')).toHaveValue('2026-12-20');
    await user.click(screen.getByRole('button', { name: '建立複製活動' }));

    await waitFor(() => {
      expect(copyEvent).toHaveBeenCalledWith(
        session,
        'e1',
        expect.objectContaining({
          name: '週五桌遊夜',
          address: '台北市中山區',
          startDate: '2026-12-20',
          endDate: '2026-12-20',
        }),
      );
    });
    expect(createEvent).not.toHaveBeenCalled();
  });
});
