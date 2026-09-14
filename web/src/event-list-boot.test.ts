import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { bootEventListPage } from './event-list-boot';
import type { LiffSession } from './liff';
import { AUTH_EXPIRED_BODY, CONTEXT_EXPIRED_TITLE, CONTEXT_MISSING_TITLE } from './auth-recovery-keys';

const listEvents = vi.fn();
const refreshContext = vi.fn();

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return {
    ...actual,
    api: {
      listEvents: (...args: unknown[]) => listEvents(...args),
      refreshContext: (...args: unknown[]) => refreshContext(...args),
    },
  };
});

function freshContextToken(): string {
  const payload = btoa(JSON.stringify({ g: 'G1', exp: Date.now() + 60_000, n: 'n1' }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  const sig = btoa('sig').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `${payload}.${sig}`;
}

function expiredContextToken(): string {
  const payload = btoa(JSON.stringify({ g: 'G1', exp: Date.now() - 10_000, n: 'n1' }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  const sig = btoa('sig').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `${payload}.${sig}`;
}

function session(token = freshContextToken()): LiffSession {
  return {
    lineUserId: 'U-b',
    displayName: 'B',
    contextToken: token,
    inClient: true,
    getIdToken: () => 'a.b.c',
  };
}

describe('bootEventListPage', () => {
  beforeEach(() => {
    listEvents.mockReset();
    refreshContext.mockReset();
  });

  it('lists events with valid context', async () => {
    listEvents.mockResolvedValue({ events: [{ eventId: 'e1' }] });
    const result = await bootEventListPage(session());
    expect(result).toEqual({ kind: 'ready', events: [{ eventId: 'e1' }] });
  });

  it('refreshes expired context then lists', async () => {
    const next = freshContextToken();
    refreshContext.mockResolvedValue({ context: next });
    listEvents.mockResolvedValue({ events: [] });
    const s = session(expiredContextToken());
    const result = await bootEventListPage(s);
    expect(refreshContext).toHaveBeenCalled();
    expect(s.contextToken).toBe(next);
    expect(result.kind).toBe('ready');
  });

  it('maps auth_token_expired to auth — never /list', async () => {
    listEvents.mockRejectedValue(new ApiError(401, 'auth_token_expired', AUTH_EXPIRED_BODY));
    const result = await bootEventListPage(session());
    expect(result).toEqual({ kind: 'auth', code: 'auth_token_expired' });
  });

  it('maps context_signature_mismatch to context_invalid with /list body', async () => {
    listEvents.mockRejectedValue(
      new ApiError(401, 'context_signature_mismatch', '活動連結已失效，請重新輸入 /list'),
    );
    const result = await bootEventListPage(session());
    expect(result.kind).toBe('context_invalid');
    if (result.kind === 'context_invalid') {
      expect(result.title).toBe(CONTEXT_MISSING_TITLE);
      expect(result.body).toContain('/list');
    }
  });

  it('maps context_expired refresh failure to expired title', async () => {
    listEvents.mockRejectedValue(new ApiError(401, 'context_expired', '活動連結已失效'));
    refreshContext.mockRejectedValue(new ApiError(403, 'link_unrecoverable', 'fail'));
    const result = await bootEventListPage(session());
    expect(result.kind).toBe('context_invalid');
    if (result.kind === 'context_invalid') {
      expect(result.title).toBe(CONTEXT_EXPIRED_TITLE);
    }
  });

  it('context_missing when no token', async () => {
    const result = await bootEventListPage(session(''));
    expect(result).toEqual({ kind: 'context_missing' });
    expect(listEvents).not.toHaveBeenCalled();
  });
});
