import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { replaceGroupMembersCache } from '../src/db/repo';
import { authHeaders, createEvent, futureRange, json } from './helpers';

async function seedMembers(
  members: Array<{ lineUserId: string; displayName: string; pictureUrl?: string | null }>,
  groupId = 'G-test-group',
) {
  await replaceGroupMembersCache(
    env.DB,
    groupId,
    members.map((m) => ({
      lineUserId: m.lineUserId,
      displayName: m.displayName,
      pictureUrl: m.pictureUrl ?? null,
    })),
    new Date().toISOString(),
  );
}

describe('group members + organizer preselect', () => {
  it('lists prioritized roster without exposing groupId', async () => {
    await seedMembers([
      { lineUserId: 'U-amy', displayName: 'Amy', pictureUrl: 'https://example.com/a.png' },
      { lineUserId: 'U-bob', displayName: 'Bob' },
    ]);
    const listed = await json<{
      members: Array<{ lineUserId: string; displayName: string; pictureUrl: string | null }>;
      groupId?: string;
      emptyMessage: string | null;
    }>('/api/group/members', {
      headers: await authHeaders('U-lee', 'Lee'),
    });
    expect(listed.status).toBe(200);
    expect(listed.body.members).toHaveLength(2);
    expect(listed.body.members.map((m) => m.lineUserId).sort()).toEqual(['U-amy', 'U-bob']);
    expect(listed.body.emptyMessage).toBeNull();
    expect(JSON.stringify(listed.body)).not.toContain('G-test-group');
    expect(JSON.stringify(listed.body)).not.toContain('test-access-token');
  });

  it('falls back to D1 cache with soft hint when LINE fails', async () => {
    await seedMembers([{ lineUserId: 'U-cached', displayName: 'Cached' }]);
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }));
    const { buildPreselectMemberRoster } = await import('../src/services/group-members');
    const roster = await buildPreselectMemberRoster(env.DB, 'G-test-group', 'token', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      forceRefresh: true,
    });
    expect(roster.members.map((m) => m.lineUserId)).toEqual(['U-cached']);
    expect(roster.lineSyncStatus).toBe('failed');
    expect(roster.hint).toBe('目前顯示最近使用過的會員名單');
    expect(roster.emptyMessage).toBeNull();
  });

  it('returns soft empty message when LINE fails and no D1 members exist', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }));
    const { buildPreselectMemberRoster } = await import('../src/services/group-members');
    const roster = await buildPreselectMemberRoster(env.DB, 'G-empty-group', 'token', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      forceRefresh: true,
    });
    expect(roster.members).toEqual([]);
    expect(roster.lineSyncStatus).toBe('failed');
    expect(roster.emptyMessage).toBe('目前還沒有可選擇的會員');
    expect(roster.hint).toBeNull();
  });

  it('orders copy roster: confirmed selected, waitlist unselected, then other cache', async () => {
    await seedMembers([
      { lineUserId: 'U-amy', displayName: 'Amy' },
      { lineUserId: 'U-bob', displayName: 'Bob' },
      { lineUserId: 'U-cara', displayName: 'Cara' },
      { lineUserId: 'U-zoe', displayName: 'Zoe' },
    ]);
    const source = await createEvent('U-lee', 'Lee', {
      name: '來源活動',
      capacity: 1,
      waitlistEnabled: true,
      preselectedMemberIds: ['U-amy'],
    });
    const eventId = source.body.event.eventId as string;
    await json(`/api/events/${eventId}/join`, {
      method: 'POST',
      headers: await authHeaders('U-bob', 'Bob'),
    });

    const listed = await json<{
      members: Array<{
        lineUserId: string;
        section: string;
        defaultSelected: boolean;
      }>;
      attendedTitle: string;
      waitlistTitle: string;
      defaultSelectedIds: string[];
    }>(`/api/group/members?copyEventId=${encodeURIComponent(eventId)}`, {
      headers: await authHeaders('U-lee', 'Lee'),
    });
    expect(listed.status).toBe(200);
    expect(listed.body.attendedTitle).toBe('原活動參加者');
    expect(listed.body.waitlistTitle).toBe('原活動候補');
    expect(listed.body.defaultSelectedIds).toEqual(['U-amy']);
    expect(listed.body.members.map((m) => m.lineUserId)).toEqual([
      'U-amy',
      'U-bob',
      'U-cara',
      'U-zoe',
    ]);
    expect(listed.body.members[0]).toMatchObject({
      lineUserId: 'U-amy',
      section: 'attended',
      defaultSelected: true,
    });
    expect(listed.body.members[1]).toMatchObject({
      lineUserId: 'U-bob',
      section: 'waitlist',
      defaultSelected: false,
    });
    expect(listed.body.members.slice(2).every((m) => m.section === 'other')).toBe(true);
  });

  it('for new events, recent confirmed are listed first but not default-selected', async () => {
    await seedMembers([
      { lineUserId: 'U-amy', displayName: 'Amy' },
      { lineUserId: 'U-dan', displayName: 'Dan' },
    ]);
    await createEvent('U-lee', 'Lee', {
      name: '上次活動',
      capacity: 3,
      preselectedMemberIds: ['U-amy'],
    });

    const listed = await json<{
      members: Array<{ lineUserId: string; section: string; defaultSelected: boolean }>;
      attendedTitle: string;
      defaultSelectedIds: string[];
    }>('/api/group/members', {
      headers: await authHeaders('U-lee', 'Lee'),
    });
    expect(listed.status).toBe(200);
    expect(listed.body.attendedTitle).toBe('上次參加');
    expect(listed.body.defaultSelectedIds).toEqual([]);
    expect(listed.body.members[0]).toMatchObject({
      lineUserId: 'U-amy',
      section: 'attended',
      defaultSelected: false,
    });
    expect(listed.body.members.some((m) => m.lineUserId === 'U-dan' && m.section === 'other')).toBe(
      true,
    );
  });

  it('paginates LINE member ids via continuationToken', async () => {
    const { listGroupMemberIds } = await import('../src/lib/line-group');
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('members/ids') && !url.includes('start=')) {
        return Response.json({ memberIds: ['U-a', 'U-b'], next: 'token-2' });
      }
      if (url.includes('start=token-2')) {
        return Response.json({ memberIds: ['U-c'] });
      }
      return new Response('unexpected', { status: 500 });
    });
    const ids = await listGroupMemberIds('tok', 'G1', fetchImpl as unknown as typeof fetch);
    expect(ids).toEqual(['U-a', 'U-b', 'U-c']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('creates event with preselected members in one batch as ORGANIZER_PRESELECT', async () => {
    await seedMembers([
      { lineUserId: 'U-amy', displayName: 'Amy' },
      { lineUserId: 'U-bob', displayName: 'Bob' },
    ]);
    const created = await createEvent('U-lee', 'Lee', {
      name: '預選活動',
      capacity: 5,
      preselectedMemberIds: ['U-amy', 'U-bob'],
    });
    expect(created.status).toBe(201);
    expect(created.body.event.confirmedCount).toBe(2);

    const detail = await json<{
      event: {
        confirmedCount: number;
        registrations: {
          confirmed: Array<{
            participantName: string;
            participantLineUserId: string | null;
            registrationSource: string;
            createdByLineUserId: string;
            lineUserId: string | null;
            canCancel: boolean;
          }>;
        };
        viewer: { selfRegistration: null | { registrationId: string } };
      };
    }>(`/api/events/${created.body.event.eventId}`, {
      headers: await authHeaders('U-amy', 'Amy'),
    });
    expect(detail.status).toBe(200);
    expect(detail.body.event.confirmedCount).toBe(2);
    expect(detail.body.event.registrations.confirmed).toHaveLength(2);
    for (const row of detail.body.event.registrations.confirmed) {
      expect(row.registrationSource).toBe('ORGANIZER_PRESELECT');
      expect(row.createdByLineUserId).toBe('U-lee');
      expect(row.participantLineUserId).toBeTruthy();
      expect(row.lineUserId).toBe(row.participantLineUserId);
    }
    expect(detail.body.event.viewer.selfRegistration).toBeTruthy();
  });

  it('rejects preselect over capacity', async () => {
    await seedMembers([
      { lineUserId: 'U-amy', displayName: 'Amy' },
      { lineUserId: 'U-bob', displayName: 'Bob' },
      { lineUserId: 'U-cara', displayName: 'Cara' },
    ]);
    const created = await createEvent('U-lee', 'Lee', {
      name: '超過上限',
      capacity: 2,
      preselectedMemberIds: ['U-amy', 'U-bob', 'U-cara'],
    });
    expect(created.status).toBe(400);
    expect((created.body as { message?: string }).message).toContain('不可超過');
  });

  it('lets preselected member cancel self; blocks unrelated member', async () => {
    await seedMembers([
      { lineUserId: 'U-amy', displayName: 'Amy' },
      { lineUserId: 'U-bob', displayName: 'Bob' },
    ]);
    const created = await createEvent('U-lee', 'Lee', {
      name: '取消權限',
      capacity: 4,
      preselectedMemberIds: ['U-amy', 'U-bob'],
    });
    const eventId = created.body.event.eventId as string;
    const detail = await json<{
      event: {
        registrations: {
          confirmed: Array<{ registrationId: string; participantLineUserId: string | null }>;
        };
      };
    }>(`/api/events/${eventId}`, { headers: await authHeaders('U-lee', 'Lee') });
    const amy = detail.body.event.registrations.confirmed.find(
      (r) => r.participantLineUserId === 'U-amy',
    );
    expect(amy).toBeTruthy();

    const blocked = await json(`/api/registrations/${amy!.registrationId}`, {
      method: 'DELETE',
      headers: await authHeaders('U-cara', 'Cara'),
    });
    expect(blocked.status).toBe(403);

    const cancelled = await json(`/api/registrations/${amy!.registrationId}`, {
      method: 'DELETE',
      headers: await authHeaders('U-amy', 'Amy'),
    });
    expect(cancelled.status).toBe(200);

    const after = await json<{ event: { confirmedCount: number } }>(`/api/events/${eventId}`, {
      headers: await authHeaders('U-lee', 'Lee'),
    });
    expect(after.body.event.confirmedCount).toBe(1);
  });

  it('copy preselects confirmed LINE members only (not proxy/waitlist)', async () => {
    await seedMembers([
      { lineUserId: 'U-amy', displayName: 'Amy' },
      { lineUserId: 'U-bob', displayName: 'Bob' },
    ]);
    const source = await createEvent('U-lee', 'Lee', {
      name: '來源活動',
      capacity: 2,
      waitlistEnabled: true,
      preselectedMemberIds: ['U-amy'],
    });
    const eventId = source.body.event.eventId as string;
    await json(`/api/events/${eventId}/proxy-join`, {
      method: 'POST',
      headers: await authHeaders('U-lee', 'Lee'),
      body: JSON.stringify({ participantName: '代報朋友' }),
    });
    const wait = await json(`/api/events/${eventId}/join`, {
      method: 'POST',
      headers: await authHeaders('U-bob', 'Bob'),
    });
    expect(wait.status).toBe(201);
    expect((wait.body as { registration: { status: string } }).registration.status).toBe('WAITLIST');

    const copied = await json<{
      event: {
        eventId: string;
        confirmedCount: number;
        waitlistCount: number;
        registrations?: unknown;
      };
    }>(`/api/events/${eventId}/copy`, {
      method: 'POST',
      headers: await authHeaders('U-lee', 'Lee'),
      body: JSON.stringify({
        ...futureRange(25),
        preselectedMemberIds: ['U-amy'],
      }),
    });
    expect(copied.status).toBe(201);
    expect(copied.body.event.eventId).not.toBe(eventId);
    expect(copied.body.event.confirmedCount).toBe(1);
    expect(copied.body.event.waitlistCount).toBe(0);

    const copiedDetail = await json<{
      event: {
        registrations: {
          confirmed: Array<{ participantLineUserId: string | null; participantName: string }>;
          waitlist: unknown[];
        };
      };
    }>(`/api/events/${copied.body.event.eventId}`, {
      headers: await authHeaders('U-lee', 'Lee'),
    });
    expect(copiedDetail.body.event.registrations.confirmed).toHaveLength(1);
    expect(copiedDetail.body.event.registrations.confirmed[0].participantLineUserId).toBe('U-amy');
    expect(copiedDetail.body.event.registrations.waitlist).toHaveLength(0);
    expect(
      copiedDetail.body.event.registrations.confirmed.some((r) => r.participantName === '代報朋友'),
    ).toBe(false);
  });

  it('still creates event when LINE resolve fails but cache has names', async () => {
    await seedMembers([{ lineUserId: 'U-amy', displayName: 'Amy' }]);
    const created = await createEvent('U-lee', 'Lee', {
      name: '離線預選',
      capacity: 2,
      preselectedMemberIds: ['U-amy'],
    });
    expect(created.status).toBe(201);
    expect(created.body.event.confirmedCount).toBe(1);
  });

  it('concurrent create with same preselected member does not double-book', async () => {
    await seedMembers([{ lineUserId: 'U-amy', displayName: 'Amy' }]);
    const payload = {
      name: '競態預選',
      ...futureRange(30),
      address: '台北',
      capacity: 3,
      waitlistEnabled: true,
      googleMapsUrl: null,
      feeAmount: 0,
      preselectedMemberIds: ['U-amy'],
    };
    const [a, b] = await Promise.all([
      json<{ event?: { eventId: string }; error?: string }>('/api/events', {
        method: 'POST',
        headers: await authHeaders('U-lee', 'Lee'),
        body: JSON.stringify(payload),
      }),
      json<{ event?: { eventId: string }; error?: string }>('/api/events', {
        method: 'POST',
        headers: await authHeaders('U-org', 'Org'),
        body: JSON.stringify({ ...payload, name: '競態預選 B' }),
      }),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const eventId = a.body.event!.eventId;
    const dup = await json(`/api/events/${eventId}/join`, {
      method: 'POST',
      headers: await authHeaders('U-amy', 'Amy'),
    });
    expect(dup.status).toBe(409);
  });
});
