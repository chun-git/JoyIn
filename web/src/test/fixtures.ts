import type { EventSummary } from '../../../shared/types';

export const sampleEvent: EventSummary = {
  eventId: 'e1',
  groupId: 'g1',
  name: '週五桌遊夜',
  startDate: '2026-12-01',
  startTime: '19:00',
  endDate: '2026-12-01',
  endTime: '21:00',
  startAt: '2026-12-01T11:00:00.000Z',
  endAt: '2026-12-01T13:00:00.000Z',
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
