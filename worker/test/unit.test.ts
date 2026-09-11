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
    expect(buildLiffUrlWithContext('https://liff.line.me/abc', 'tok.en')).toContain('context=tok.en');
    const withState = buildLiffUrlWithContext('https://liff.line.me/abc', 'tok.en');
    expect(withState).toContain('liff.state=');
    const parsed = new URL(withState);
    expect(parsed.searchParams.get('context')).toBe('tok.en');
    expect(parsed.searchParams.get('liff.state')).toContain('context=tok.en');
    expect(withState).not.toMatch(/groupId=/i);
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

  it('describeLiffUrlSafe omits token and full URI', async () => {
    const { buildLiffUrlWithContext, describeLiffUrlSafe } = await import('../src/lib/liff-context');
    const token = 'payload.signature';
    const url = buildLiffUrlWithContext('https://liff.line.me/test-liff-id', token);
    const safe = await describeLiffUrlSafe(url, token);
    expect(safe.hasContext).toBe(true);
    expect(safe.hasLiffState).toBe(true);
    expect(safe.tokenLength).toBe(token.length);
    expect(safe.urlLength).toBe(url.length);
    expect(safe.tokenHashPrefix).toMatch(/^[a-f0-9]{8}$/);
    expect(JSON.stringify(safe)).not.toContain(token);
    expect(JSON.stringify(safe)).not.toContain(url);
  });
});
