import { describe, expect, it } from 'vitest';
import {
  buildLiffUrlWithContext,
  isFlexLiffUri,
  signLiffContext,
  verifyLiffContext,
} from '../src/lib/liff-context';
import { buildEventCarousel } from '../src/lib/line-flex';
import type { EventSummary } from '../../shared/types';

const LIFF_BASE = 'https://liff.line.me/2011545640-NBc7F1Gd';

const sampleEvent: EventSummary = {
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
  googleMapsUrl: null,
  feeAmount: 0,
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

describe('/list Flex LIFF URIs', () => {
  it('all carousel URIs start with liff.line.me and never Pages', async () => {
    const token = await signLiffContext('flex-secret', 'Cgroup123');
    const liffUrl = buildLiffUrlWithContext(LIFF_BASE, token);
    expect(liffUrl.startsWith('https://liff.line.me/')).toBe(true);
    expect(liffUrl).not.toContain('joyin-web.pages.dev');
    expect(liffUrl).not.toContain('external=true');
    expect(isFlexLiffUri(liffUrl)).toBe(true);

    const filled = buildEventCarousel([sampleEvent], {
      listUrl: buildLiffUrlWithContext(LIFF_BASE, token, '/events'),
      eventUrls: {
        [sampleEvent.eventId]: buildLiffUrlWithContext(
          LIFF_BASE,
          token,
          `/events/${sampleEvent.eventId}`,
        ),
      },
    });
    const empty = buildEventCarousel([], buildLiffUrlWithContext(LIFF_BASE, token, '/events'));
    const serialized = `${JSON.stringify(filled)}\n${JSON.stringify(empty)}`;

    const uris = [...serialized.matchAll(/"uri"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(uris.length).toBeGreaterThanOrEqual(2);
    for (const uri of uris) {
      expect(uri.startsWith('https://liff.line.me/')).toBe(true);
      expect(uri).not.toContain('joyin-web.pages.dev');
      expect(uri).not.toContain('external=true');
      expect(uri).toContain('context=');
      const parsed = new URL(uri);
      const context = parsed.searchParams.get('context');
      expect(context).toBeTruthy();
      await expect(verifyLiffContext('flex-secret', context!)).resolves.toMatchObject({
        groupId: 'Cgroup123',
      });
    }
    expect(serialized).toContain(`/events/${sampleEvent.eventId}`);
    expect(serialized).toContain('/events?');
    expect(serialized).toContain('查看並報名');
    expect(serialized).toContain('查看全部活動');
  });

  it('URLSearchParams round-trip does not corrupt context', async () => {
    const token = await signLiffContext('flex-secret', 'CgroupRoundTrip');
    const url = buildLiffUrlWithContext(LIFF_BASE, token, `/events/${sampleEvent.eventId}`);
    expect(url).toContain(`/events/${sampleEvent.eventId}`);
    const again = new URL(url).searchParams.get('context');
    expect(again).toBe(token);
    await expect(verifyLiffContext('flex-secret', again!)).resolves.toMatchObject({
      groupId: 'CgroupRoundTrip',
    });
  });

  it('rejects Pages Endpoint as Flex base', () => {
    expect(() => buildLiffUrlWithContext('https://joyin-web.pages.dev', 'a.b')).toThrow(
      /liff\.line\.me/,
    );
    expect(isFlexLiffUri('https://joyin-web.pages.dev/?context=a.b')).toBe(false);
  });
});
