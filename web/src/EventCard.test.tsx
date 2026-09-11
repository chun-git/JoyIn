import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EventCard } from './components/EventCard';
import type { EventSummary } from '../../shared/types';

const event: EventSummary = {
  eventId: 'e1',
  groupId: 'g1',
  name: '週五桌遊夜',
  eventDate: '2026-12-01',
  eventTime: '19:00',
  eventAt: '2026-12-01T11:00:00.000Z',
  address: '台北市中山區',
  capacity: 10,
  waitlistEnabled: true,
  status: 'OPEN',
  confirmedCount: 4,
  waitlistCount: 0,
  organizerLineUserId: 'U1',
  organizerDisplayName: 'Lee',
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z',
};

describe('EventCard', () => {
  it('renders event summary fields', () => {
    render(<EventCard event={event} />);
    expect(screen.getByText('週五桌遊夜')).toBeInTheDocument();
    expect(screen.getByText(/台北市中山區/)).toBeInTheDocument();
    expect(screen.getByText(/4／10/)).toBeInTheDocument();
    expect(screen.getByText('尚有名額')).toBeInTheDocument();
    expect(screen.getByText('報名中')).toBeInTheDocument();
  });
});
