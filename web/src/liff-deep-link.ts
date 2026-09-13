/** Safe in-app deep-link targets for LIFF boot / OAuth restore. */

export const JOYIN_PENDING_ROUTE_KEY = 'joyin_pending_route';

const EVENT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Transfer tokens are 64 hex chars (two UUIDs without dashes). */
const TRANSFER_TOKEN_RE = /^[a-f0-9]{64}$/i;

export function isAllowedEventId(eventId: string): boolean {
  return EVENT_ID_RE.test(eventId.trim());
}

export function isAllowedTransferToken(token: string): boolean {
  return TRANSFER_TOKEN_RE.test(token.trim());
}

/**
 * Allow only:
 * - /events
 * - /events/new
 * - /events/{uuid}
 * - /transfer/{token}
 * Reject external, protocol-relative, javascript:, traversal.
 */
export function sanitizeJoyInRoute(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  if (
    trimmed.includes('://') ||
    trimmed.startsWith('//') ||
    /javascript:/i.test(trimmed) ||
    trimmed.includes('..')
  ) {
    return '';
  }

  let pathname = trimmed;
  let search = '';
  try {
    const asUrl = new URL(trimmed, 'https://joyin.invalid');
    pathname = asUrl.pathname;
    // Drop oauth noise; never keep foreign query except we don't need any for routes
    search = '';
  } catch {
    const q = trimmed.indexOf('?');
    pathname = q >= 0 ? trimmed.slice(0, q) : trimmed;
  }

  pathname = pathname.replace(/\/+/g, '/');
  if (!pathname.startsWith('/')) pathname = `/${pathname}`;

  // Strip optional LIFF ID prefix: /{liffId}/events/...
  const stripped = stripLiffIdPrefix(pathname);

  if (stripped === '/events' || stripped === '/events/') return '/events';
  if (stripped === '/events/new') return '/events/new';

  const eventMatch = stripped.match(/^\/events\/([^/]+)\/?$/);
  if (eventMatch && isAllowedEventId(eventMatch[1])) {
    return `/events/${eventMatch[1]}`;
  }

  const transferMatch = stripped.match(/^\/transfer\/([^/]+)\/?$/);
  if (transferMatch && isAllowedTransferToken(transferMatch[1])) {
    return `/transfer/${transferMatch[1]}`;
  }

  // Root / list aliases
  if (stripped === '/' || stripped === '') return '';

  void search;
  return '';
}

function stripLiffIdPrefix(pathname: string): string {
  // LIFF IDs look like 2011545640-NBc7F1Gd
  const match = pathname.match(/^\/(\d{5,}-[A-Za-z0-9_-]+)(\/.*)?$/);
  if (!match) return pathname;
  return match[2] || '/';
}

export function routeFromLocation(
  pathname: string,
  search = '',
): string {
  const fromPath = sanitizeJoyInRoute(pathname);
  if (fromPath) return fromPath;

  // liff.state may carry the original path
  try {
    const state = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get(
      'liff.state',
    );
    if (!state) return '';
    const candidates = [state];
    if (/%[0-9A-Fa-f]{2}/.test(state)) {
      try {
        candidates.push(decodeURIComponent(state));
      } catch {
        // ignore
      }
    }
    for (const candidate of candidates) {
      const sanitized = sanitizeJoyInRoute(candidate);
      if (sanitized) return sanitized;
      try {
        const asUrl = new URL(candidate, 'https://joyin.invalid');
        const nested = sanitizeJoyInRoute(asUrl.pathname);
        if (nested) return nested;
      } catch {
        // continue
      }
    }
  } catch {
    // ignore
  }
  return '';
}

export function preservePendingRoute(storage?: Storage, pathname?: string, search?: string): string {
  const store = storage ?? (typeof window !== 'undefined' ? window.sessionStorage : undefined);
  const path =
    pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '');
  const query = search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const route = routeFromLocation(path, query);
  if (route && store) {
    try {
      store.setItem(JOYIN_PENDING_ROUTE_KEY, route);
    } catch {
      // ignore
    }
  }
  return route;
}

export function consumePendingRoute(storage?: Storage): string {
  const store = storage ?? (typeof window !== 'undefined' ? window.sessionStorage : undefined);
  if (!store) return '';
  try {
    const raw = (store.getItem(JOYIN_PENDING_ROUTE_KEY) || '').trim();
    store.removeItem(JOYIN_PENDING_ROUTE_KEY);
    return sanitizeJoyInRoute(raw);
  } catch {
    return '';
  }
}

/** Drop OAuth noise from the address bar while keeping the SPA path. */
export function cleanOauthParamsFromUrl(
  replaceState?: (data: unknown, unused: string, url?: string | null) => void,
  href?: string,
): void {
  try {
    const current = new URL(href ?? (typeof window !== 'undefined' ? window.location.href : ''));
    const drop = ['code', 'state', 'liffClientId', 'liffRedirectUri', 'friendship_status_changed'];
    let changed = false;
    for (const key of drop) {
      if (current.searchParams.has(key)) {
        current.searchParams.delete(key);
        changed = true;
      }
    }
    // Keep context if present; remove empty search
    if (!changed) return;
    const next = `${current.pathname}${current.searchParams.toString() ? `?${current.searchParams}` : ''}${current.hash}`;
    const replace =
      replaceState ??
      (typeof window !== 'undefined' ? window.history.replaceState.bind(window.history) : undefined);
    replace?.(null, '', next);
  } catch {
    // ignore
  }
}
