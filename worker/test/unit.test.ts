import { describe, expect, it } from 'vitest';
import { hmacSha256Base64, verifyLineSignature } from '../src/lib/line-signature';
import { isDateTimeInPast, toEventAt } from '../src/lib/datetime';
import { displayLabel, timingSafeEqual } from '../src/lib/ids';
import { buildEventCarousel } from '../src/lib/line-flex';
import type { EventSummary } from '../../shared/types';

describe('datetime', () => {
  it('converts Taipei date and time to UTC ISO', () => {
    expect(toEventAt('2026-12-01', '19:00')).toBe('2026-12-01T11:00:00.000Z');
  });

  it('detects past datetimes', () => {
    expect(isDateTimeInPast('2020-01-01', '10:00', new Date('2026-09-10T00:00:00Z'))).toBe(true);
    expect(isDateTimeInPast('2026-12-01', '19:00', new Date('2026-09-10T00:00:00Z'))).toBe(false);
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
      eventDate: '2026-12-01',
      eventTime: '19:00',
      eventAt: '2026-12-01T11:00:00.000Z',
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
    expect(JSON.stringify(filled)).toContain('https://liff.line.me/test');
  });
});
