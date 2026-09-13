import { describe, expect, it } from 'vitest';
import {
  JOYIN_PENDING_ROUTE_KEY,
  cleanOauthParamsFromUrl,
  consumePendingRoute,
  preservePendingRoute,
  routeFromLocation,
  sanitizeJoyInRoute,
} from './liff-deep-link';

describe('liff-deep-link', () => {
  it('allows only safe in-app routes', () => {
    expect(sanitizeJoyInRoute('/events')).toBe('/events');
    expect(sanitizeJoyInRoute('/events/new')).toBe('/events/new');
    expect(
      sanitizeJoyInRoute('/events/550e8400-e29b-41d4-a716-446655440000'),
    ).toBe('/events/550e8400-e29b-41d4-a716-446655440000');
    expect(sanitizeJoyInRoute(`/transfer/${'a'.repeat(64)}`)).toBe(`/transfer/${'a'.repeat(64)}`);

    expect(sanitizeJoyInRoute('https://evil.example/events')).toBe('');
    expect(sanitizeJoyInRoute('//evil.example/events')).toBe('');
    expect(sanitizeJoyInRoute('javascript:alert(1)')).toBe('');
    expect(sanitizeJoyInRoute('/events/../../etc/passwd')).toBe('');
    expect(sanitizeJoyInRoute('/events/not-a-uuid')).toBe('');
    expect(sanitizeJoyInRoute('/transfer/short')).toBe('');
  });

  it('strips LIFF id prefix and restores from liff.state', () => {
    expect(
      sanitizeJoyInRoute('/2011545640-NBc7F1Gd/events/550e8400-e29b-41d4-a716-446655440000'),
    ).toBe('/events/550e8400-e29b-41d4-a716-446655440000');

    expect(
      routeFromLocation(
        '/',
        `?liff.state=${encodeURIComponent('/events/550e8400-e29b-41d4-a716-446655440000')}`,
      ),
    ).toBe('/events/550e8400-e29b-41d4-a716-446655440000');
  });

  it('preserves and consumes pending route across redirect', () => {
    const storage = new Map<string, string>();
    const store = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
      removeItem: (k: string) => {
        storage.delete(k);
      },
    } as Storage;

    preservePendingRoute(
      store,
      '/events/550e8400-e29b-41d4-a716-446655440000',
      '?context=a.b',
    );
    expect(storage.get(JOYIN_PENDING_ROUTE_KEY)).toBe(
      '/events/550e8400-e29b-41d4-a716-446655440000',
    );

    // OAuth return lands on /
    preservePendingRoute(store, '/', '?code=xyz&state=1');
    expect(consumePendingRoute(store)).toBe(
      '/events/550e8400-e29b-41d4-a716-446655440000',
    );
    expect(storage.has(JOYIN_PENDING_ROUTE_KEY)).toBe(false);
  });

  it('cleans oauth query params while keeping SPA path and context', () => {
    let next = '';
    cleanOauthParamsFromUrl(
      (_d, _u, url) => {
        next = String(url);
      },
      'https://joyin-web.pages.dev/events/550e8400-e29b-41d4-a716-446655440000?code=abc&state=1&context=tok.en',
    );
    expect(next).toContain('/events/550e8400-e29b-41d4-a716-446655440000');
    expect(next).toContain('context=tok.en');
    expect(next).not.toContain('code=');
    expect(next).not.toContain('state=');
  });
});
