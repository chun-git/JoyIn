import { describe, expect, it } from 'vitest';
import {
  buildLiffUrlWithContext,
  signLiffContext,
  verifyLiffContext,
} from '../src/lib/liff-context';
import {
  buildEventCarousel,
  FLEX_COLORS,
  flexStatusPresentation,
} from '../src/lib/line-flex';
import type { EventSummary } from '../../shared/types';

const LIFF_BASE = 'https://liff.line.me/2011545640-NBc7F1Gd';

function baseEvent(overrides: Partial<EventSummary> = {}): EventSummary {
  return {
    eventId: 'e1',
    groupId: 'g1',
    name: '桌遊夜',
    startDate: '2026-12-01',
    startTime: '19:00',
    endDate: '2026-12-01',
    endTime: '21:00',
    startAt: '2026-12-01T11:00:00.000Z',
    endAt: '2026-12-01T13:00:00.000Z',
    address: '台北車站',
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
    ...overrides,
  };
}

function collectUris(payload: unknown): string[] {
  return [...JSON.stringify(payload).matchAll(/"uri"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
}

describe('Flex brand palette', () => {
  it('applies JoyIn brand colors on free event without maps', () => {
    const event = baseEvent({ feeAmount: 0, googleMapsUrl: null });
    const flex = buildEventCarousel([event], {
      listUrl: 'https://liff.line.me/test/events?context=tok.en',
      eventUrls: { e1: 'https://liff.line.me/test/events/e1?context=tok.en' },
    });
    const json = JSON.stringify(flex);

    expect(json).toContain(FLEX_COLORS.paper);
    expect(json).toContain(FLEX_COLORS.bgSoft);
    expect(json).toContain(FLEX_COLORS.ink);
    expect(json).toContain(FLEX_COLORS.navy);
    expect(json).toContain(FLEX_COLORS.brand);
    expect(json).toContain(FLEX_COLORS.mint);
    expect(json).toContain('免費');
    expect(json).toContain('報名中・尚有名額');
    expect(json).toContain(`"color":"${FLEX_COLORS.navy}"`);
    expect(json).toContain(`"color":"${FLEX_COLORS.brand}"`);
    expect(json).not.toContain('"label":"導航"');
    expect(json).not.toContain('#0F6E6C');
    expect(json).not.toContain('#14302E');
  });

  it('renders paid event with mint 導航 box and ink text', () => {
    const event = baseEvent({
      eventId: 'e2',
      name: '付費活動',
      feeAmount: 150,
      googleMapsUrl: 'https://maps.app.goo.gl/navDemo',
    });
    const flex = buildEventCarousel([event], 'https://liff.line.me/test?context=a.b');
    const json = JSON.stringify(flex);

    expect(json).toContain('150 元／人');
    expect(json).toContain('"text":"導航"');
    expect(json).toContain(`"backgroundColor":"${FLEX_COLORS.mint}"`);
    expect(json).toContain(`"color":"${FLEX_COLORS.ink}"`);
    expect(json).toContain('openExternalBrowser=1');
    expect(json).toContain('maps.app.goo.gl/navDemo');
  });

  it('uses distinct status text and colors for open / waitlist / closed', () => {
    expect(flexStatusPresentation(baseEvent({ confirmedCount: 2 }))).toEqual({
      label: '報名中・尚有名額',
      color: FLEX_COLORS.mint,
    });
    expect(
      flexStatusPresentation(
        baseEvent({ confirmedCount: 10, waitlistEnabled: true, waitlistCount: 2 }),
      ),
    ).toEqual({
      label: '候補中・2 人',
      color: FLEX_COLORS.warn,
    });
    expect(
      flexStatusPresentation(baseEvent({ confirmedCount: 10, waitlistEnabled: false })),
    ).toEqual({
      label: '已額滿',
      color: FLEX_COLORS.danger,
    });
    expect(flexStatusPresentation(baseEvent({ status: 'CLOSED' }))).toEqual({
      label: '已關閉報名',
      color: FLEX_COLORS.closed,
    });

    const waitlistCard = buildEventCarousel(
      [baseEvent({ confirmedCount: 10, waitlistEnabled: true, waitlistCount: 1 })],
      'https://liff.line.me/test?context=x.y',
    );
    const closedCard = buildEventCarousel(
      [baseEvent({ status: 'CLOSED', confirmedCount: 5 })],
      'https://liff.line.me/test?context=x.y',
    );
    expect(JSON.stringify(waitlistCard)).toContain('候補中・1 人');
    expect(JSON.stringify(waitlistCard)).toContain(FLEX_COLORS.warn);
    expect(JSON.stringify(waitlistCard)).toContain('查看並候補');
    expect(JSON.stringify(closedCard)).toContain('已關閉報名');
    expect(JSON.stringify(closedCard)).toContain(FLEX_COLORS.closed);
    expect(JSON.stringify(closedCard)).toContain('查看活動');
  });

  it('keeps context on every LIFF URI for maps and no-maps cards', async () => {
    const token = await signLiffContext('flex-brand-secret', 'CgroupBrand');
    const open = baseEvent({ eventId: 'open-1', googleMapsUrl: null, feeAmount: 0 });
    const paid = baseEvent({
      eventId: 'paid-1',
      feeAmount: 80,
      googleMapsUrl: 'https://www.google.com/maps?q=台北',
    });
    const flex = buildEventCarousel([open, paid], {
      listUrl: buildLiffUrlWithContext(LIFF_BASE, token, '/events'),
      eventUrls: {
        'open-1': buildLiffUrlWithContext(LIFF_BASE, token, '/events/open-1'),
        'paid-1': buildLiffUrlWithContext(LIFF_BASE, token, '/events/paid-1'),
      },
    });

    const uris = collectUris(flex);
    const liffUris = uris.filter((uri) => uri.startsWith('https://liff.line.me/'));
    expect(liffUris.length).toBeGreaterThanOrEqual(3);
    for (const uri of liffUris) {
      expect(uri).toContain('context=');
      const context = new URL(uri).searchParams.get('context');
      expect(context).toBeTruthy();
      await expect(verifyLiffContext('flex-brand-secret', context!)).resolves.toMatchObject({
        groupId: 'CgroupBrand',
      });
    }
    expect(JSON.stringify(flex)).toContain('/events/open-1');
    expect(JSON.stringify(flex)).toContain('/events/paid-1');
    expect(JSON.stringify(flex)).toContain('/events?');
  });
});
