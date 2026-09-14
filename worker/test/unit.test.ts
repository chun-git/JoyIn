import { describe, expect, it } from 'vitest';
import { hmacSha256Base64, verifyLineSignature } from '../src/lib/line-signature';
import { isExpired, isRangeInvalid, toEventAt, validateEventSchedule } from '../src/lib/datetime';
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

  it('validates Taipei evening and overnight events against full datetimes', () => {
    const now = new Date('2026-09-11T07:00:00.000Z');
    expect(toEventAt('2026-09-11', '19:00')).toBe('2026-09-11T11:00:00.000Z');
    expect(
      validateEventSchedule(
        { startDate: '2026-09-11', startTime: '19:00', endDate: '2026-09-11', endTime: '21:00' },
        { now },
      ).ok,
    ).toBe(true);
    expect(
      validateEventSchedule(
        { startDate: '2026-09-11', startTime: '23:00', endDate: '2026-09-12', endTime: '01:00' },
        { now },
      ).ok,
    ).toBe(true);
    expect(
      validateEventSchedule(
        { startDate: '2026-09-12', startTime: '09:00', endDate: '2026-09-12', endTime: '11:00' },
        { now },
      ).ok,
    ).toBe(true);

    const startedButNotEnded = validateEventSchedule(
      { startDate: '2026-09-11', startTime: '19:00', endDate: '2026-09-11', endTime: '21:00' },
      { now: new Date('2026-09-11T12:30:00.000Z') },
    );
    expect(startedButNotEnded).toEqual({ ok: false, message: '開始時間必須晚於現在' });
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
    const filled = buildEventCarousel([event], {
      listUrl: 'https://liff.line.me/test/events?context=a.b',
      eventUrls: { e1: 'https://liff.line.me/test/events/e1?context=a.b' },
    });
    const serialized = JSON.stringify(filled);
    expect(serialized).toContain('桌遊夜');
    expect(serialized).toContain('3／10');
    expect(serialized).toContain('2026-12-01 19:00 – 21:00');
    expect(serialized).toContain('https://liff.line.me/test/events/e1');
    expect(serialized).toContain('查看全部活動');
    expect(serialized).toContain('查看並報名');
    expect(serialized).toContain('免費');
    expect(serialized).not.toContain('"label":"導航"');
    expect(serialized).toContain('報名中・尚有名額');
    expect(serialized).toContain('#0756A5');
    expect(serialized).toContain('#149BE8');
    expect(serialized).toContain('#F5FBFF');
    expect(serialized).toContain('#12324A');
  });

  it('adds 導航 uri action with openExternalBrowser when maps URL exists', () => {
    const event: EventSummary = {
      eventId: 'e2',
      groupId: 'g1',
      name: '付費活動',
      startDate: '2026-12-01',
      startTime: '19:00',
      endDate: '2026-12-01',
      endTime: '21:00',
      startAt: '2026-12-01T11:00:00.000Z',
      endAt: '2026-12-01T13:00:00.000Z',
      address: '台北車站',
      googleMapsUrl: 'https://maps.app.goo.gl/navDemo',
      feeAmount: 150,
      capacity: 10,
      waitlistEnabled: true,
      status: 'OPEN',
      confirmedCount: 1,
      waitlistCount: 0,
      organizerLineUserId: 'U1',
      organizerDisplayName: 'Lee',
      createdAt: '2026-09-10T00:00:00.000Z',
      updatedAt: '2026-09-10T00:00:00.000Z',
    };
    const filled = buildEventCarousel([event], 'https://liff.line.me/test');
    const serialized = JSON.stringify(filled);
    expect(serialized).toContain('150 元／人');
    expect(serialized).toContain('"label":"導航"');
    expect(serialized).toContain('"text":"導航"');
    expect(serialized).toContain('maps.app.goo.gl/navDemo');
    expect(serialized).toContain('openExternalBrowser=1');
    expect(serialized).toContain('"type":"uri"');
    expect(serialized).toContain('#35C7B5');
  });
});

describe('LIFF context token', () => {
  it('signs and verifies groupId, expiry, and nonce', async () => {
    const { signLiffContext, verifyLiffContext } = await import('../src/lib/liff-context');
    const token = await signLiffContext('unit-secret', 'Cgroup123');
    const verified = await verifyLiffContext('unit-secret', token);
    expect(verified.groupId).toBe('Cgroup123');
    expect(verified.nonce.length).toBeGreaterThan(8);
    expect(verified.expiresAt).toBeGreaterThan(Date.now());
  });

  it('rejects tampered tokens and wrong secrets with classified codes', async () => {
    const { signLiffContext, verifyLiffContext, buildLiffUrlWithContext } = await import(
      '../src/lib/liff-context'
    );
    const token = await signLiffContext('unit-secret', 'Cgroup123');
    await expect(verifyLiffContext('other-secret', token)).rejects.toMatchObject({
      code: 'context_signature_mismatch',
    });
    const [body, sig] = token.split('.');
    await expect(verifyLiffContext('unit-secret', `${body}.${sig}x`)).rejects.toMatchObject({
      code: 'context_signature_mismatch',
    });
    await expect(verifyLiffContext('unit-secret', 'not-a-token')).rejects.toMatchObject({
      code: 'context_malformed',
    });
    expect(buildLiffUrlWithContext('https://liff.line.me/test-liff-id', 'tok.en')).toContain(
      'context=tok.en',
    );
    const flexUrl = buildLiffUrlWithContext('https://liff.line.me/test-liff-id', 'tok.en');
    // Flex cards must open via liff.line.me so LIFF Browser sets isInClient()
    expect(flexUrl.startsWith('https://liff.line.me/')).toBe(true);
    expect(flexUrl).not.toContain('joyin-web.pages.dev');
    expect(flexUrl).not.toContain('liff.state=');
    expect(flexUrl).not.toContain('external=true');
    const parsed = new URL(flexUrl);
    expect(parsed.searchParams.get('context')).toBe('tok.en');
    expect(parsed.searchParams.get('liff.state')).toBeNull();
    expect(flexUrl).not.toMatch(/groupId=/i);
    expect(() => buildLiffUrlWithContext('https://joyin-web.pages.dev', 'tok.en')).toThrow(
      /liff\.line\.me/,
    );
  });

  it('same secret signs and verifies; expired returns context_expired', async () => {
    const { signLiffContext, verifyLiffContext } = await import('../src/lib/liff-context');
    const token = await signLiffContext('same-secret', 'G1');
    await expect(verifyLiffContext('same-secret', token)).resolves.toMatchObject({ groupId: 'G1' });
    const expired = await signLiffContext('same-secret', 'G1', Date.now() - 10_000, 1);
    await expect(verifyLiffContext('same-secret', expired)).rejects.toMatchObject({
      code: 'context_expired',
    });
  });

  it('payload contains only groupId, expiry, nonce — no user binding', async () => {
    const { signLiffContext, decodeLiffContextPayloadUnsafe, verifyLiffContext } = await import(
      '../src/lib/liff-context'
    );
    const token = await signLiffContext('unit-secret', 'CgroupShared');
    const payload = decodeLiffContextPayloadUnsafe(token);
    expect(Object.keys(payload).sort()).toEqual(['exp', 'g', 'n']);
    expect(payload).not.toHaveProperty('u');
    expect(payload).not.toHaveProperty('userId');
    expect(payload).not.toHaveProperty('sub');
    expect(payload).not.toHaveProperty('signer');
    // Same token verifies repeatedly (not one-time)
    await expect(verifyLiffContext('unit-secret', token)).resolves.toMatchObject({
      groupId: 'CgroupShared',
    });
    await expect(verifyLiffContext('unit-secret', token)).resolves.toMatchObject({
      groupId: 'CgroupShared',
    });
  });

  it('rejects user-bound payloads with context_user_binding_error', async () => {
    const { verifyLiffContext, LiffContextError } = await import('../src/lib/liff-context');
    const secret = 'unit-secret';
    const badPayload = {
      g: 'Cgroup123',
      exp: Date.now() + 60_000,
      n: 'nonceabc',
      userId: 'U-should-not-bind',
    };
    const body = btoa(JSON.stringify(badPayload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
    const sigBytes = new Uint8Array(signature);
    let binary = '';
    for (const byte of sigBytes) binary += String.fromCharCode(byte);
    const sig = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    const token = `${body}.${sig}`;

    await expect(verifyLiffContext(secret, token)).rejects.toMatchObject({
      code: 'context_user_binding_error',
    });
    await expect(verifyLiffContext(secret, token)).rejects.toBeInstanceOf(LiffContextError);
  });

  it('describeLiffUrlSafe omits token and full URI', async () => {
    const { buildLiffUrlWithContext, describeLiffUrlSafe } = await import('../src/lib/liff-context');
    const token = 'payload.signature';
    const url = buildLiffUrlWithContext('https://liff.line.me/test-liff-id', token);
    const safe = await describeLiffUrlSafe(url, token);
    expect(safe.hasContext).toBe(true);
    expect(safe.hasLiffState).toBe(false);
    expect(safe.tokenLength).toBe(token.length);
    expect(safe.urlLength).toBe(url.length);
    expect(safe.tokenHashPrefix).toMatch(/^[a-f0-9]{8}$/);
    expect(JSON.stringify(safe)).not.toContain(token);
    expect(JSON.stringify(safe)).not.toContain(url);
  });
});
