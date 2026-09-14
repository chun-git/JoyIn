import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/lib/errors';
import { signLiffContext } from '../src/lib/liff-context';
import { resetRateLimitForTests } from '../src/lib/rate-limit';
import {
  recoverContextFromEventId,
  refreshExpiredContext,
} from '../src/services/context-recovery';

const SECRET = 'unit-context-secret';
const USER = { lineUserId: 'U-member', displayName: 'Member' };

describe('context recovery services', () => {
  beforeEach(() => {
    resetRateLimitForTests();
  });

  it('refreshes expired signed context when LINE membership is 200', async () => {
    const expired = await signLiffContext(SECRET, 'Cgroup1', Date.now(), -1_000);
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const result = await refreshExpiredContext({
      secret: SECRET,
      channelAccessToken: 'token',
      contextToken: expired,
      user: USER,
      allowTestAuth: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.context).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(fetchImpl).toHaveBeenCalled();
    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toContain('/v2/bot/group/');
    expect(url).toContain('/member/');
  });

  it('does not refresh when signature mismatches', async () => {
    const expired = await signLiffContext(SECRET, 'Cgroup1', Date.now(), -1_000);
    await expect(
      refreshExpiredContext({
        secret: SECRET,
        channelAccessToken: 'token',
        contextToken: `${expired}x`,
        user: USER,
        allowTestAuth: false,
        fetchImpl: vi.fn() as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'context_signature_mismatch' });
  });

  it('does not refresh when user is not a group member', async () => {
    const expired = await signLiffContext(SECRET, 'Cgroup1', Date.now(), -1_000);
    await expect(
      refreshExpiredContext({
        secret: SECRET,
        channelAccessToken: 'token',
        contextToken: expired,
        user: USER,
        allowTestAuth: false,
        fetchImpl: vi.fn(async () => new Response('{}', { status: 404 })) as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'link_unrecoverable' });
  });

  it('does not refresh when bot is not in the group', async () => {
    const expired = await signLiffContext(SECRET, 'Cgroup1', Date.now(), -1_000);
    await expect(
      refreshExpiredContext({
        secret: SECRET,
        channelAccessToken: 'token',
        contextToken: expired,
        user: USER,
        allowTestAuth: false,
        fetchImpl: vi.fn(async () => new Response('{}', { status: 403 })) as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'link_unrecoverable' });
  });

  it('rate-limits refresh attempts', async () => {
    const expired = await signLiffContext(SECRET, 'Cgroup1', Date.now(), -1_000);
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    for (let i = 0; i < 8; i += 1) {
      await refreshExpiredContext({
        secret: SECRET,
        channelAccessToken: 'token',
        contextToken: expired,
        user: USER,
        allowTestAuth: false,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
    }
    await expect(
      refreshExpiredContext({
        secret: SECRET,
        channelAccessToken: 'token',
        contextToken: expired,
        user: USER,
        allowTestAuth: false,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      refreshExpiredContext({
        secret: SECRET,
        channelAccessToken: 'token',
        contextToken: expired,
        user: USER,
        allowTestAuth: false,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('recover refuses without leaking when membership fails', async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          first: async () => ({ event_id: 'e1', group_id: 'CgroupHidden', status: 'OPEN' }),
        }),
      }),
    } as unknown as D1Database;

    await expect(
      recoverContextFromEventId({
        db,
        secret: SECRET,
        channelAccessToken: 'token',
        eventId: 'e1',
        user: USER,
        allowTestAuth: false,
        fetchImpl: vi.fn(async () => new Response('{}', { status: 404 })) as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'link_unrecoverable', message: expect.stringContaining('/list') });
  });
});
