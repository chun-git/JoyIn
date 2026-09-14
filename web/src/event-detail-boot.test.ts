import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { bootEventDetailPage } from './event-detail-boot';
import type { LiffSession } from './liff';

const getEvent = vi.fn();
const refreshContext = vi.fn();
const recoverContextFromEvent = vi.fn();

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return {
    ...actual,
    api: {
      getEvent: (...args: unknown[]) => getEvent(...args),
      refreshContext: (...args: unknown[]) => refreshContext(...args),
      recoverContextFromEvent: (...args: unknown[]) => recoverContextFromEvent(...args),
    },
  };
});

function session(overrides: Partial<LiffSession> = {}): LiffSession {
  return {
    lineUserId: 'U-a',
    displayName: 'A',
    contextToken: '',
    inClient: true,
    getIdToken: () => 't',
    ...overrides,
  };
}

/** Valid-looking context payload.exp in the past (client soft-expiry). */
function expiredContextToken(): string {
  const payload = btoa(JSON.stringify({ g: 'G1', exp: Date.now() - 10_000, n: 'n1' }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  const sig = btoa('sig').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `${payload}.${sig}`;
}

function freshContextToken(): string {
  const payload = btoa(JSON.stringify({ g: 'G1', exp: Date.now() + 60_000, n: 'n1' }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  const sig = btoa('sig').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `${payload}.${sig}`;
}

describe('bootEventDetailPage', () => {
  beforeEach(() => {
    getEvent.mockReset();
    refreshContext.mockReset();
    recoverContextFromEvent.mockReset();
  });

  it('redirects ended events to list with toast', async () => {
    getEvent.mockRejectedValue(new ApiError(410, 'event_ended', '此活動已結束'));
    const result = await bootEventDetailPage(session({ contextToken: freshContextToken() }), 'e1');
    expect(result).toEqual({ kind: 'redirect_list', toast: '此活動已結束' });
  });

  it('redirects deleted events to list with toast', async () => {
    getEvent.mockRejectedValue(new ApiError(410, 'event_deleted', '此活動已刪除'));
    const result = await bootEventDetailPage(session({ contextToken: freshContextToken() }), 'e1');
    expect(result).toEqual({ kind: 'redirect_list', toast: '此活動已刪除' });
  });

  it('refreshes expired context then redirects to list', async () => {
    const next = freshContextToken();
    refreshContext.mockResolvedValue({ context: next });
    const s = session({ contextToken: expiredContextToken() });
    const result = await bootEventDetailPage(s, 'e1');
    expect(refreshContext).toHaveBeenCalled();
    expect(getEvent).not.toHaveBeenCalled();
    expect(result.kind).toBe('redirect_list');
    expect(s.contextToken).toBe(next);
  });

  it('recovers from eventId when context is missing', async () => {
    const next = freshContextToken();
    recoverContextFromEvent.mockResolvedValue({ context: next });
    const s = session({ contextToken: '' });
    const result = await bootEventDetailPage(s, '550e8400-e29b-41d4-a716-446655440000');
    expect(recoverContextFromEvent).toHaveBeenCalled();
    expect(result.kind).toBe('redirect_list');
    expect(s.contextToken).toBe(next);
  });

  it('shows unrecoverable message when recovery fails', async () => {
    recoverContextFromEvent.mockRejectedValue(
      new ApiError(403, 'link_unrecoverable', '此活動連結已失效，請回群組重新輸入 /list'),
    );
    const result = await bootEventDetailPage(session({ contextToken: '' }), 'e1');
    expect(result.kind).toBe('unrecoverable');
  });
});
