import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { replaceGroupMembersCache } from '../src/db/repo';
import { lineCandidateKey, proxyCandidateKey } from '../../shared/preselect';
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
  it('lists LINE members from cache and does not expose secrets', async () => {
    await seedMembers([
      { lineUserId: 'U-amy', displayName: 'Amy', pictureUrl: 'https://example.com/a.png' },
      { lineUserId: 'U-bob', displayName: 'Bob' },
      { lineUserId: 'U-cara', displayName: 'Cara' },
      { lineUserId: 'U-dan', displayName: 'Dan' },
    ]);
    const listed = await json<{
      members: Array<{ key: string; lineUserId: string | null }>;
      emptyMessage: string | null;
    }>('/api/group/members', {
      headers: await authHeaders('U-lee', 'Lee'),
    });
    expect(listed.status).toBe(200);
    expect(listed.body.members).toHaveLength(4);
    expect(listed.body.emptyMessage).toBeNull();
    expect(JSON.stringify(listed.body)).not.toContain('G-test-group');
    expect(JSON.stringify(listed.body)).not.toContain('test-access-token');
  });

  it('keeps D1/history roster when LINE sync fails', async () => {
    await seedMembers([{ lineUserId: 'U-cached', displayName: 'Cached' }]);
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }));
    const { buildPreselectMemberRoster } = await import('../src/services/group-members');
    const roster = await buildPreselectMemberRoster(env.DB, 'G-test-group', 'token', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      forceRefresh: true,
    });
    expect(roster.members.map((m) => m.lineUserId)).toContain('U-cached');
    expect(roster.lineSyncStatus).toBe('failed');
    expect(roster.hint).toBe('目前顯示最近使用過的會員名單');
  });

  it('returns soft empty message when LINE fails and no D1/history exist', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }));
    const { buildPreselectMemberRoster } = await import('../src/services/group-members');
    const roster = await buildPreselectMemberRoster(env.DB, 'G-empty-group', 'token', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      forceRefresh: true,
    });
    expect(roster.members).toEqual([]);
    expect(roster.emptyMessage).toBe('目前還沒有可選擇的會員');
  });

  it('includes historical SELF, ORGANIZER_PRESELECT, and PROXY; excludes cancelled', async () => {
    await seedMembers([{ lineUserId: 'U-amy', displayName: 'Amy' }]);
    const older = await createEvent('U-lee', 'Lee', {
      name: '舊活動',
      capacity: 5,
      preselectedMemberIds: ['U-amy'],
    });
    const olderId = older.body.event.eventId as string;
    await json(`/api/events/${olderId}/proxy-join`, {
      method: 'POST',
      headers: await authHeaders('U-lee', 'Lee'),
      body: JSON.stringify({ participantName: '文字朋友' }),
    });
    await json(`/api/events/${olderId}/join`, {
      method: 'POST',
      headers: await authHeaders('U-bob', 'Bob'),
    });

    const latest = await createEvent('U-lee', 'Lee', {
      name: '新活動',
      capacity: 3,
      ...futureRange(20),
      preselectedMemberIds: ['U-amy'],
    });
    const latestId = latest.body.event.eventId as string;
    const detail = await json<{
      event: { registrations: { confirmed: Array<{ registrationId: string; participantLineUserId: string | null }> } };
    }>(`/api/events/${latestId}`, { headers: await authHeaders('U-lee', 'Lee') });
    const amyReg = detail.body.event.registrations.confirmed.find(
      (r) => r.participantLineUserId === 'U-amy',
    );
    await json(`/api/registrations/${amyReg!.registrationId}`, {
      method: 'DELETE',
      headers: await authHeaders('U-amy', 'Amy'),
    });

    const listed = await json<{
      members: Array<{ key: string; kind: string; section: string; displayName: string }>;
    }>('/api/group/members', {
      headers: await authHeaders('U-lee', 'Lee'),
    });
    expect(listed.status).toBe(200);
    const keys = listed.body.members.map((m) => m.key);
    expect(keys).toContain(lineCandidateKey('U-bob'));
    expect(keys).toContain(proxyCandidateKey('文字朋友'));
    // Cancelled amy from latest is gone from that event, but amy still in history from older / cache
    expect(keys).toContain(lineCandidateKey('U-amy'));
    expect(listed.body.members.some((m) => m.kind === 'proxy')).toBe(true);
  });

  it('orders copy roster with confirmed LINE+proxy selected and waitlist unselected', async () => {
    await seedMembers([
      { lineUserId: 'U-amy', displayName: 'Amy' },
      { lineUserId: 'U-bob', displayName: 'Bob' },
      { lineUserId: 'U-cara', displayName: 'Cara' },
    ]);
    const source = await createEvent('U-lee', 'Lee', {
      name: '來源活動',
      capacity: 2,
      waitlistEnabled: true,
      preselectedMemberIds: ['U-amy'],
      preselectedProxyNames: ['代報甲'],
    });
    const eventId = source.body.event.eventId as string;
    await json(`/api/events/${eventId}/join`, {
      method: 'POST',
      headers: await authHeaders('U-bob', 'Bob'),
    });

    const listed = await json<{
      members: Array<{
        key: string;
        section: string;
        defaultSelected: boolean;
        kind: string;
      }>;
      attendedTitle: string;
      proxyTitle: string;
      waitlistTitle: string;
      defaultSelectedKeys: string[];
    }>(`/api/group/members?copyEventId=${encodeURIComponent(eventId)}`, {
      headers: await authHeaders('U-lee', 'Lee'),
    });
    expect(listed.status).toBe(200);
    expect(listed.body.attendedTitle).toBe('原活動參加者');
    expect(listed.body.proxyTitle).toBe('原活動代報者');
    expect(listed.body.waitlistTitle).toBe('原活動候補');
    expect(listed.body.defaultSelectedKeys).toEqual([
      lineCandidateKey('U-amy'),
      proxyCandidateKey('代報甲'),
    ]);
    expect(listed.body.members.find((m) => m.key === lineCandidateKey('U-bob'))).toMatchObject({
      section: 'waitlist',
      defaultSelected: false,
    });
    expect(listed.body.members.find((m) => m.key === lineCandidateKey('U-cara'))?.section).toBe(
      'other',
    );
  });

  it('for new events, recent confirmed are first but not default-selected', async () => {
    await seedMembers([
      { lineUserId: 'U-amy', displayName: 'Amy' },
      { lineUserId: 'U-dan', displayName: 'Dan' },
    ]);
    await createEvent('U-lee', 'Lee', {
      name: '上次活動',
      capacity: 3,
      preselectedMemberIds: ['U-amy'],
      preselectedProxyNames: ['舊代報'],
    });

    const listed = await json<{
      members: Array<{ key: string; section: string; defaultSelected: boolean }>;
      attendedTitle: string;
      proxyTitle: string;
      defaultSelectedKeys: string[];
    }>('/api/group/members', {
      headers: await authHeaders('U-lee', 'Lee'),
    });
    expect(listed.body.attendedTitle).toBe('上次參加者');
    expect(listed.body.proxyTitle).toBe('歷史代報名單');
    expect(listed.body.defaultSelectedKeys).toEqual([]);
    expect(listed.body.members[0]).toMatchObject({
      key: lineCandidateKey('U-amy'),
      section: 'attended',
      defaultSelected: false,
    });
    expect(
      listed.body.members.some(
        (m) => m.key === proxyCandidateKey('舊代報') && m.section === 'proxy',
      ),
    ).toBe(true);
  });

  it('does not merge same-name LINE member and proxy', async () => {
    await seedMembers([{ lineUserId: 'U-amy', displayName: 'Amy' }]);
    await createEvent('U-lee', 'Lee', {
      name: '同名測試',
      capacity: 4,
      preselectedMemberIds: ['U-amy'],
      preselectedProxyNames: ['Amy'],
    });
    const listed = await json<{
      members: Array<{ key: string; kind: string; displayName: string }>;
    }>('/api/group/members', {
      headers: await authHeaders('U-lee', 'Lee'),
    });
    const amys = listed.body.members.filter((m) => m.displayName === 'Amy');
    expect(amys).toHaveLength(2);
    expect(amys.map((m) => m.kind).sort()).toEqual(['line', 'proxy']);
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
    const listed = await listGroupMemberIds('tok', 'G1', fetchImpl as unknown as typeof fetch);
    expect(listed.ids).toEqual(['U-a', 'U-b', 'U-c']);
    expect(listed.pageCount).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps other members when a single profile fetch fails', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('members/ids')) {
        return Response.json({ memberIds: ['U-ok', 'U-bad'] });
      }
      if (url.includes('/member/U-ok')) {
        return Response.json({
          userId: 'U-ok',
          displayName: 'Ok',
          pictureUrl: null,
        });
      }
      return new Response('missing', { status: 404 });
    });
    const { syncGroupMembersFromLine } = await import('../src/services/group-members');
    const rows = await syncGroupMembersFromLine(
      env.DB,
      'G-profile-partial',
      'token',
      fetchImpl as unknown as typeof fetch,
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.line_user_id === 'U-ok')?.display_name).toBe('Ok');
    expect(rows.find((r) => r.line_user_id === 'U-bad')?.display_name).toBe('LINE 使用者');
  });

  it('creates event with mixed LINE + proxy preselect in one batch', async () => {
    await seedMembers([
      { lineUserId: 'U-amy', displayName: 'Amy' },
      { lineUserId: 'U-bob', displayName: 'Bob' },
    ]);
    const created = await createEvent('U-lee', 'Lee', {
      name: '混合預選',
      capacity: 5,
      preselectedMemberIds: ['U-amy', 'U-bob'],
      preselectedProxyNames: ['代報乙'],
    });
    expect(created.status).toBe(201);
    expect(created.body.event.confirmedCount).toBe(3);

    const detail = await json<{
      event: {
        confirmedCount: number;
        registrations: {
          confirmed: Array<{
            type: string;
            registrationSource: string;
            participantName: string;
            participantLineUserId: string | null;
          }>;
        };
      };
    }>(`/api/events/${created.body.event.eventId}`, {
      headers: await authHeaders('U-lee', 'Lee'),
    });
    expect(detail.body.event.confirmedCount).toBe(3);
    const types = detail.body.event.registrations.confirmed.map((r) => r.type).sort();
    expect(types).toEqual(['PROXY', 'SELF', 'SELF']);
    const proxy = detail.body.event.registrations.confirmed.find((r) => r.type === 'PROXY');
    expect(proxy?.participantName).toBe('代報乙');
    expect(proxy?.participantLineUserId).toBeNull();
    expect(proxy?.registrationSource).toBe('PROXY');
  });

  it('rejects preselect over capacity including proxies', async () => {
    await seedMembers([
      { lineUserId: 'U-amy', displayName: 'Amy' },
      { lineUserId: 'U-bob', displayName: 'Bob' },
    ]);
    const created = await createEvent('U-lee', 'Lee', {
      name: '超過上限',
      capacity: 2,
      preselectedMemberIds: ['U-amy', 'U-bob'],
      preselectedProxyNames: ['多一人'],
    });
    expect(created.status).toBe(400);
    expect((created.body as { message?: string }).message).toContain('不可超過');
  });

  it('lets preselected member cancel self; organizer cancels proxy; unrelated blocked', async () => {
    await seedMembers([
      { lineUserId: 'U-amy', displayName: 'Amy' },
      { lineUserId: 'U-bob', displayName: 'Bob' },
    ]);
    const created = await createEvent('U-lee', 'Lee', {
      name: '取消權限',
      capacity: 4,
      preselectedMemberIds: ['U-amy', 'U-bob'],
      preselectedProxyNames: ['代報丙'],
    });
    const eventId = created.body.event.eventId as string;
    const detail = await json<{
      event: {
        registrations: {
          confirmed: Array<{
            registrationId: string;
            type: string;
            participantLineUserId: string | null;
          }>;
        };
      };
    }>(`/api/events/${eventId}`, { headers: await authHeaders('U-lee', 'Lee') });
    const amy = detail.body.event.registrations.confirmed.find(
      (r) => r.participantLineUserId === 'U-amy',
    );
    const proxy = detail.body.event.registrations.confirmed.find((r) => r.type === 'PROXY');
    expect(amy && proxy).toBeTruthy();

    const blocked = await json(`/api/registrations/${amy!.registrationId}`, {
      method: 'DELETE',
      headers: await authHeaders('U-cara', 'Cara'),
    });
    expect(blocked.status).toBe(403);

    const proxyBlocked = await json(`/api/registrations/${proxy!.registrationId}`, {
      method: 'DELETE',
      headers: await authHeaders('U-amy', 'Amy'),
    });
    expect(proxyBlocked.status).toBe(403);

    const cancelled = await json(`/api/registrations/${amy!.registrationId}`, {
      method: 'DELETE',
      headers: await authHeaders('U-amy', 'Amy'),
    });
    expect(cancelled.status).toBe(200);

    const orgCancelProxy = await json(`/api/registrations/${proxy!.registrationId}`, {
      method: 'DELETE',
      headers: await authHeaders('U-lee', 'Lee'),
    });
    expect(orgCancelProxy.status).toBe(200);
  });

  it('after organizer transfer, former organizer cannot manage others', async () => {
    await seedMembers([{ lineUserId: 'U-amy', displayName: 'Amy' }]);
    const created = await createEvent('U-lee', 'Lee', {
      name: '轉移後權限',
      capacity: 4,
      preselectedMemberIds: ['U-amy'],
      preselectedProxyNames: ['代報丁'],
    });
    const eventId = created.body.event.eventId as string;
    const invite = await json<{ invite: { token: string } }>(
      `/api/events/${eventId}/transfer-invites`,
      {
        method: 'POST',
        headers: await authHeaders('U-lee', 'Lee'),
      },
    );
    await json(`/api/transfer-invites/${invite.body.invite.token}/accept`, {
      method: 'POST',
      headers: await authHeaders('U-bob', 'Bob'),
    });
    const detail = await json<{
      event: {
        organizerLineUserId: string;
        registrations: {
          confirmed: Array<{ registrationId: string; type: string }>;
        };
      };
    }>(`/api/events/${eventId}`, { headers: await authHeaders('U-bob', 'Bob') });
    expect(detail.body.event.organizerLineUserId).toBe('U-bob');
    const proxy = detail.body.event.registrations.confirmed.find((r) => r.type === 'PROXY');
    const former = await json(`/api/registrations/${proxy!.registrationId}`, {
      method: 'DELETE',
      headers: await authHeaders('U-lee', 'Lee'),
    });
    expect(former.status).toBe(403);
    const current = await json(`/api/registrations/${proxy!.registrationId}`, {
      method: 'DELETE',
      headers: await authHeaders('U-bob', 'Bob'),
    });
    expect(current.status).toBe(200);
  });

  it('copy creates new registrations only after confirm with selected LINE+proxy', async () => {
    await seedMembers([{ lineUserId: 'U-amy', displayName: 'Amy' }]);
    const source = await createEvent('U-lee', 'Lee', {
      name: '來源活動',
      capacity: 3,
      preselectedMemberIds: ['U-amy'],
      preselectedProxyNames: ['代報戊'],
    });
    const eventId = source.body.event.eventId as string;
    const copied = await json<{
      event: { eventId: string; confirmedCount: number };
    }>(`/api/events/${eventId}/copy`, {
      method: 'POST',
      headers: await authHeaders('U-lee', 'Lee'),
      body: JSON.stringify({
        ...futureRange(25),
        preselectedMemberIds: ['U-amy'],
        preselectedProxyNames: ['代報戊'],
      }),
    });
    expect(copied.status).toBe(201);
    expect(copied.body.event.eventId).not.toBe(eventId);
    expect(copied.body.event.confirmedCount).toBe(2);
  });

  it('concurrent create with same preselected member does not double-book on one event', async () => {
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
      json<{ event?: { eventId: string } }>('/api/events', {
        method: 'POST',
        headers: await authHeaders('U-lee', 'Lee'),
        body: JSON.stringify(payload),
      }),
      json<{ event?: { eventId: string } }>('/api/events', {
        method: 'POST',
        headers: await authHeaders('U-org', 'Org'),
        body: JSON.stringify({ ...payload, name: '競態預選 B' }),
      }),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const dup = await json(`/api/events/${a.body.event!.eventId}/join`, {
      method: 'POST',
      headers: await authHeaders('U-amy', 'Amy'),
    });
    expect(dup.status).toBe(409);
  });
});
