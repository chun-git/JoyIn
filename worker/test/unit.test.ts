import { describe, expect, it } from 'vitest';
import { hmacSha256Base64, verifyLineSignature } from '../src/lib/line-signature';
import { isExpired, isRangeInvalid, toEventAt } from '../src/lib/datetime';
import { displayLabel, timingSafeEqual } from '../src/lib/ids';
import { buildEventCarousel } from '../src/lib/line-flex';
import type { EventSummary } from '../../shared/types';

describe('datetime', () => {
  it('converts Taipei date and time to UTC ISO', () => {
    expect(toEventAt('2026-12-01', '19:00')).toBe('2026-12-01T11:00:00.000Z');
  });

  it('detects expired and invalid ranges', () => {
    expect(isExpired('2020-01-01T02:00:00.000Z', new Date('2026-09-10T00:00:00Z'))).toBe(true);
    expect(isExpired('2026-12-01T11:00:00.000Z', new Date('2026-09-10T00:00:00Z'))).toBe(false);
    expect(isRangeInvalid('2026-12-01T11:00:00.000Z', '2026-12-01T13:00:00.000Z')).toBe(false);
    expect(isRangeInvalid('2026-12-01T13:00:00.000Z', '2026-12-01T11:00:00.000Z')).toBe(true);
    expect(isRangeInvalid('2026-12-01T11:00:00.000Z', '2026-12-01T11:00:00.000Z')).toBe(true);
  });
});

describe('display labels', () => {
  it('keeps self registration names', () => {
    expect(displayLabel('SELF', 'Lee', 'Lee')).toBe('Lee');
  });

  it('formats proxy registrations', () => {
    expect(displayLabel('PROXY', 'Amy', 'Lee')).toBe('Amy（Lee 代報）');
  });
});

describe('LINE signature', () => {
  it('accepts a valid HMAC signature', async () => {
    const payload = new TextEncoder().encode('{"events":[]}');
    const signature = await hmacSha256Base64('test-secret', payload);
    await expect(verifyLineSignature('test-secret', payload, signature)).resolves.toBe(true);
  });

  it('rejects missing or invalid signatures', async () => {
    const payload = new TextEncoder().encode('{"events":[]}');
    await expect(verifyLineSignature('secret', payload, null)).resolves.toBe(false);
    await expect(verifyLineSignature('secret', payload, 'abc')).resolves.toBe(false);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
  });
});

describe('flex carousel', () => {
  it('renders empty state and event cards', () => {
    const empty = buildEventCarousel([], 'https://liff.line.me/test');
    expect(empty.type).toBe('flex');
    expect(JSON.stringify(empty)).toContain('目前沒有即將舉行的活動');

    const event: EventSummary = {
      eventId: 'e1',
      groupId: 'g1',
      name: '桌遊夜',
      startDate: '2026-12-01',
      startTime: '19:00',
      endDate: '2026-12-01',
      endTime: '21:00',
      startAt: '2026-12-01T11:00:00.000Z',
      endAt: '2026-12-01T13:00:00.000Z',
      address: '台北',
      capacity: 10,
      waitlistEnabled: true,
      status: 'OPEN',
      confirmedCount: 3,
      waitlistCount: 0,
      organizerLineUserId: 'U1',
      organizerDisplayName: 'Lee',
      createdAt: '2026-09-10T00:00:00.000Z',
      updatedAt: '2026-09-10T00:00:00.000Z',
    };
    const filled = buildEventCarousel([event], 'https://liff.line.me/test');
    expect(JSON.stringify(filled)).toContain('桌遊夜');
    expect(JSON.stringify(filled)).toContain('3／10');
    expect(JSON.stringify(filled)).toContain('2026-12-01 19:00 – 21:00');
    expect(JSON.stringify(filled)).toContain('https://liff.line.me/test');
  });
});
