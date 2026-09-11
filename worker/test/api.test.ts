import { describe, expect, it } from 'vitest';
import { authHeaders, authOnlyHeaders, createEvent, futureRange, json, request } from './helpers';

describe('events API', () => {
  it('serves a public health check', async () => {
    const { status, body } = await json<{ ok: boolean }>('/api/health');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('rejects unauthenticated access', async () => {
    const { status, body } = await json<{ error: string }>('/api/events');
    expect(status).toBe(401);
    expect(body.error).toBe('auth_token_missing');
  });

  it('rejects malformed ID tokens before context checks', async () => {
    const { status, body } = await json<{ error: string; message: string }>('/api/events', {
      headers: {
        Authorization: 'Bearer not-a-jwt-access-token',
        'Content-Type': 'application/json',
        'X-JoyIn-Context': 'a.b',
      },
    });
    expect(status).toBe(401);
    expect(body.error).toBe('auth_token_malformed');
  });

  it('rejects URL-encoded ID tokens', async () => {
    const fakeJwt = `${'a'.repeat(12)}.${'b'.repeat(12)}.${'c'.repeat(12)}`;
    const encoded = fakeJwt.replaceAll('.', '%2E');
    const { status, body } = await json<{ error: string }>('/api/events', {
      headers: {
        Authorization: `Bearer ${encoded}`,
        'Content-Type': 'application/json',
      },
    });
    expect(status).toBe(401);
    expect(body.error).toBe('auth_token_malformed');
  });

  it('requires a signed LIFF context token', async () => {
    const { status, body } = await json<{ message: string }>('/api/events', {
      headers: {
        Authorization: 'Bearer test:U-lee:Lee',
        'Content-Type': 'application/json',
      },
    });
    expect(status).toBe(401);
    expect(body.message).toContain('/list');
  });

  it('rejects forged X-Line-Group-Id without a context token', async () => {
    const { status } = await json('/api/events', {
      headers: {
        Authorization: 'Bearer test:U-lee:Lee',
        'Content-Type': 'application/json',
        'X-Line-Group-Id': 'G-forged',
      },
    });
    expect(status).toBe(401);
  });

  it('rejects tampered and expired context tokens', async () => {
    const { signLiffContext, verifyLiffContext } = await import('../src/lib/liff-context');
    const { env } = await import('cloudflare:test');
    const valid = await signLiffContext(env.LIFF_CONTEXT_SIGNING_SECRET, 'G-test-group');
    const [bodyPart, sig] = valid.split('.');
    const tampered = `${bodyPart}.${sig.slice(0, -2)}aa`;

    const tamperedRes = await json<{ error: string; message: string }>('/api/events', {
      headers: {
        Authorization: 'Bearer test:U-lee:Lee',
        'Content-Type': 'application/json',
        'X-JoyIn-Context': tampered,
      },
    });
    expect(tamperedRes.status).toBe(401);
    expect(tamperedRes.body.error).toBe('context_signature_mismatch');

    const expired = await signLiffContext(
      env.LIFF_CONTEXT_SIGNING_SECRET,
      'G-test-group',
      Date.now() - 60_000,
      1,
    );
    await expect(
      verifyLiffContext(env.LIFF_CONTEXT_SIGNING_SECRET, expired, Date.now()),
    ).rejects.toMatchObject({ code: 'context_expired' });
    const expiredRes = await json<{ error: string }>('/api/events', {
      headers: {
        Authorization: 'Bearer test:U-lee:Lee',
        'Content-Type': 'application/json',
        'X-JoyIn-Context': expired,
      },
    });
    expect(expiredRes.status).toBe(401);
    expect(expiredRes.body.error).toBe('context_expired');
  });

  it('accepts tokens after Flex URL / liff.state / sessionStorage round-trips', async () => {
    const { signLiffContext, verifyLiffContext, buildLiffUrlWithContext } = await import(
      '../src/lib/liff-context'
    );
    const { env } = await import('cloudflare:test');
    const original = await signLiffContext(env.LIFF_CONTEXT_SIGNING_SECRET, 'G-test-group');
    const flexUrl = buildLiffUrlWithContext('https://liff.line.me/test-liff-id', original);
    const parsed = new URL(flexUrl);
    const fromQuery = parsed.searchParams.get('context') || '';
    expect(fromQuery).toBe(original);
    await expect(verifyLiffContext(env.LIFF_CONTEXT_SIGNING_SECRET, fromQuery)).resolves.toMatchObject({
      groupId: 'G-test-group',
    });

    const fromStateRaw = parsed.searchParams.get('liff.state') || '';
    const fromStateUrl = new URL(fromStateRaw, 'https://joyin.invalid');
    const fromState = fromStateUrl.searchParams.get('context') || '';
    expect(fromState).toBe(original);
    await expect(verifyLiffContext(env.LIFF_CONTEXT_SIGNING_SECRET, fromState)).resolves.toMatchObject({
      groupId: 'G-test-group',
    });

    const list = await json<{ events: unknown[] }>('/api/events', {
      headers: {
        Authorization: 'Bearer test:U-lee:Lee',
        'Content-Type': 'application/json',
        'X-JoyIn-Context': fromState,
      },
    });
    expect(list.status).toBe(200);
  });

  it('isolates events by verified context groupId', async () => {
    const a = await createEvent('U-lee', 'Lee', { name: '群組 A 活動' });
    expect(a.status).toBe(201);

    const otherList = await json<{ events: Array<{ name: string }> }>('/api/events', {
      headers: await authHeaders('U-lee', 'Lee', 'G-other-group'),
    });
    expect(otherList.status).toBe(200);
    expect(otherList.body.events.some((e) => e.name === '群組 A 活動')).toBe(false);

    const sameList = await json<{ events: Array<{ name: string }> }>('/api/events', {
      headers: await authHeaders('U-lee', 'Lee', 'G-test-group'),
    });
    expect(sameList.body.events.some((e) => e.name === '群組 A 活動')).toBe(true);
  });

  it('creates and lists upcoming events sorted by time', async () => {
    const first = await createEvent('U-lee', 'Lee', {
      name: '較晚的活動',
      startDate: '2026-12-20',
      startTime: '19:00',
      endDate: '2026-12-20',
      endTime: '21:00',
    });
    const second = await createEvent('U-lee', 'Lee', {
      name: '較近的活動',
      startDate: '2026-12-10',
      startTime: '18:30',
      endDate: '2026-12-10',
      endTime: '20:30',
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.event.eventId).toBeTruthy();
    expect(first.body.event.groupId).toBe('G-test-group');
    expect(first.body.event.startAt).toBeTruthy();
    expect(first.body.event.endAt).toBeTruthy();

    const list = await json<{ events: Array<{ name: string }> }>('/api/events', {
      headers: await authHeaders('U-amy', 'Amy'),
    });
    expect(list.status).toBe(200);
    const names = list.body.events.map((event) => event.name);
    expect(names.indexOf('較近的活動')).toBeLessThan(names.indexOf('較晚的活動'));
  });

  it('sets the creator as organizer', async () => {
    const created = await createEvent('U-lee', 'Lee', { name: '主揪測試' });
    const detail = await json<{
      event: { organizerLineUserId: string; viewer: { isOrganizer: boolean } };
    }>(`/api/events/${created.body.event.eventId}`, {
      headers: await authHeaders('U-lee', 'Lee'),
    });
    expect(detail.body.event.organizerLineUserId).toBe('U-lee');
    expect(detail.body.event.viewer.isOrganizer).toBe(true);
  });

  it('rejects past event times', async () => {
    const result = await createEvent('U-lee', 'Lee', {
      name: '過去活動',
      startDate: '2020-01-01',
      startTime: '10:00',
      endDate: '2020-01-01',
      endTime: '12:00',
    });
    expect(result.status).toBe(400);
    expect((result.body as { message?: string }).message).toBe('開始時間必須晚於現在');
  });

  it('accepts Taipei evening and overnight ranges', async () => {
    const evening = await createEvent('U-lee', 'Lee', {
      name: '今晚桌遊',
      startDate: '2026-12-01',
      startTime: '19:00',
      endDate: '2026-12-01',
      endTime: '21:00',
    });
    expect(evening.status).toBe(201);
    expect(evening.body.event.startAt).toBe('2026-12-01T11:00:00.000Z');
    expect(evening.body.event.endAt).toBe('2026-12-01T13:00:00.000Z');

    const overnight = await createEvent('U-lee', 'Lee', {
      name: '跨日活動',
      startDate: '2026-12-01',
      startTime: '23:00',
      endDate: '2026-12-02',
      endTime: '01:00',
    });
    expect(overnight.status).toBe(201);
    expect(overnight.body.event.startAt).toBe('2026-12-01T15:00:00.000Z');
    expect(overnight.body.event.endAt).toBe('2026-12-01T17:00:00.000Z');
  });

  it('rejects when end_at is not after start_at', async () => {
    const equal = await createEvent('U-lee', 'Lee', {
      name: '同時段',
      startDate: '2026-12-10',
      startTime: '19:00',
      endDate: '2026-12-10',
      endTime: '19:00',
    });
    expect(equal.status).toBe(400);
    expect((equal.body as { message?: string }).message).toContain('結束時間');

    const reversed = await createEvent('U-lee', 'Lee', {
      name: '時間顛倒',
      startDate: '2026-12-10',
      startTime: '21:00',
      endDate: '2026-12-10',
      endTime: '19:00',
    });
    expect(reversed.status).toBe(400);
  });

  it('persists created events in D1 and still returns them after a new query', async () => {
    const { env } = await import('cloudflare:test');
    const created = await createEvent('U-lee', 'Lee', { name: '持久化活動' });
    expect(created.status).toBe(201);
    const eventId = created.body.event.eventId as string;
    expect(eventId).toMatch(/\S/);
    expect(created.body.event.groupId).toBe('G-test-group');

    const row = await env.DB.prepare(
      'SELECT event_id, group_id, start_at, end_at, name FROM events WHERE event_id = ?',
    )
      .bind(eventId)
      .first<{ event_id: string; group_id: string; start_at: string; end_at: string; name: string }>();

    expect(row).not.toBeNull();
    expect(row?.event_id).toBe(eventId);
    expect(row?.group_id).toBe('G-test-group');
    expect(row?.name).toBe('持久化活動');
    expect(row?.start_at).toBeTruthy();
    expect(row?.end_at).toBeTruthy();
    expect(new Date(row!.end_at).getTime()).toBeGreaterThan(new Date(row!.start_at).getTime());

    const list = await json<{ events: Array<{ eventId: string; groupId: string; name: string }> }>(
      '/api/events',
      { headers: await authHeaders('U-lee', 'Lee') },
    );
    const found = list.body.events.find((event) => event.eventId === eventId);
    expect(found).toBeTruthy();
    expect(found?.groupId).toBe('G-test-group');
    expect(found?.name).toBe('持久化活動');
  });

  it('keeps already-started events in the list until they end', async () => {
    const { env } = await import('cloudflare:test');
    const now = '2026-09-11T07:00:00.000Z';
    await env.DB.prepare(
      `INSERT INTO events (
        event_id, group_id, name, event_date, event_time, event_at, start_at, end_at, address,
        capacity, waitlist_enabled, status, organizer_line_user_id,
        organizer_display_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?)`,
    )
      .bind(
        'in-progress-event',
        'G-test-group',
        '進行中活動',
        '2026-09-11',
        '10:00',
        '2026-09-11T02:00:00.000Z',
        '2026-09-11T02:00:00.000Z',
        '2026-12-31T15:00:00.000Z',
        '台北',
        2,
        1,
        'U-lee',
        'Lee',
        now,
        now,
      )
      .run();

    const list = await json<{ events: Array<{ name: string }> }>('/api/events', {
      headers: await authHeaders('U-amy', 'Amy'),
    });
    expect(list.body.events.some((event) => event.name === '進行中活動')).toBe(true);

    const renamed = await json<{ event: { name: string } }>('/api/events/in-progress-event', {
      method: 'PATCH',
      headers: await authHeaders('U-lee', 'Lee'),
      body: JSON.stringify({ name: '進行中活動（改名）' }),
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.event.name).toBe('進行中活動（改名）');
  });

  it('lets the organizer update the time range', async () => {
    const created = await createEvent('U-lee', 'Lee', { name: '改時間' });
    const patched = await json<{
      event: { startDate: string; startTime: string; endDate: string; endTime: string };
    }>(`/api/events/${created.body.event.eventId}`, {
      method: 'PATCH',
      headers: await authHeaders('U-lee', 'Lee'),
      body: JSON.stringify({
        startDate: '2026-12-15',
        startTime: '18:00',
        endDate: '2026-12-15',
        endTime: '22:00',
        confirmTimeLocationChange: true,
      }),
    });
    expect(patched.status).toBe(200);
    expect(patched.body.event.startDate).toBe('2026-12-15');
    expect(patched.body.event.startTime).toBe('18:00');
    expect(patched.body.event.endTime).toBe('22:00');
  });
});

describe('organizer permissions', () => {
  it('hides management from regular members', async () => {
    const created = await createEvent('U-lee', 'Lee', { name: '權限活動' });
    const eventId = created.body.event.eventId;

    const memberPatch = await json(`/api/events/${eventId}`, {
      method: 'PATCH',
      headers: await authHeaders('U-amy', 'Amy'),
      body: JSON.stringify({ name: '被改名', confirmTimeLocationChange: true }),
    });
    expect(memberPatch.status).toBe(403);

    const memberClose = await json(`/api/events/${eventId}/close`, {
      method: 'POST',
      headers: await authHeaders('U-amy', 'Amy'),
    });
    expect(memberClose.status).toBe(403);

    const memberDelete = await json(`/api/events/${eventId}`, {
      method: 'DELETE',
      headers: await authHeaders('U-amy', 'Amy'),
    });
    expect(memberDelete.status).toBe(403);

    const memberTransfer = await json(`/api/events/${eventId}/transfer-invites`, {
      method: 'POST',
      headers: await authHeaders('U-amy', 'Amy'),
    });
    expect(memberTransfer.status).toBe(403);
  });

  it('lets the organizer close, edit, transfer and soft-delete', async () => {
    const created = await createEvent('U-lee', 'Lee', { name: '主揪管理', capacity: 3 });
    const eventId = created.body.event.eventId;

    const patched = await json<{ event: { name: string; address: string } }>(`/api/events/${eventId}`, {
      method: 'PATCH',
      headers: await authHeaders('U-lee', 'Lee'),
      body: JSON.stringify({
        name: '主揪管理（更新）',
        address: '台中市西區',
        confirmTimeLocationChange: true,
      }),
    });
    expect(patched.status).toBe(200);
    expect(patched.body.event.name).toBe('主揪管理（更新）');

    const invite = await json<{ invite: { token: string } }>(`/api/events/${eventId}/transfer-invites`, {
      method: 'POST',
      headers: await authHeaders('U-lee', 'Lee'),
    });
    expect(invite.status).toBe(201);

    const transferred = await json<{ event: { organizerLineUserId: string } }>(
      `/api/transfer-invites/${invite.body.invite.token}/accept`,
      {
        method: 'POST',
        headers: await authHeaders('U-amy', 'Amy'),
      },
    );
    expect(transferred.status).toBe(200);
    expect(transferred.body.event.organizerLineUserId).toBe('U-amy');

    const closed = await json<{ event: { status: string } }>(`/api/events/${eventId}/close`, {
      method: 'POST',
      headers: await authHeaders('U-amy', 'Amy'),
    });
    expect(closed.status).toBe(200);
    expect(closed.body.event.status).toBe('CLOSED');

    const deleted = await json(`/api/events/${eventId}`, {
      method: 'DELETE',
      headers: await authHeaders('U-amy', 'Amy'),
    });
    expect(deleted.status).toBe(200);

    const missing = await json(`/api/events/${eventId}`, {
      headers: await authHeaders('U-amy', 'Amy'),
    });
    expect(missing.status).toBe(404);
  });

  it('requires confirmation before time or location changes', async () => {
    const created = await createEvent('U-lee', 'Lee', { name: '確認提示' });
    const result = await json(`/api/events/${created.body.event.eventId}`, {
      method: 'PATCH',
      headers: await authHeaders('U-lee', 'Lee'),
      body: JSON.stringify({ address: '新地址' }),
    });
    expect(result.status).toBe(400);
  });

  it('does not allow capacity below current confirmed count', async () => {
    const created = await createEvent('U-lee', 'Lee', { name: '名額下限', capacity: 2 });
    const eventId = created.body.event.eventId;
    await json(`/api/events/${eventId}/join`, {
      method: 'POST',
      headers: await authHeaders('U-lee', 'Lee'),
    });
    await json(`/api/events/${eventId}/join`, {
      method: 'POST',
      headers: await authHeaders('U-amy', 'Amy'),
    });

    const lowered = await json(`/api/events/${eventId}`, {
      method: 'PATCH',
      headers: await authHeaders('U-lee', 'Lee'),
      body: JSON.stringify({ capacity: 1 }),
    });
    expect(lowered.status).toBe(400);
  });
});

describe('registrations and waitlist', () => {
  it('joins as self, proxies another person, and blocks duplicates', async () => {
    const created = await createEvent('U-lee', 'Lee', { name: '報名流程', capacity: 5 });
    const eventId = created.body.event.eventId;

    const selfJoin = await json<{ registration: { type: string; displayLabel: string } }>(
      `/api/events/${eventId}/join`,
      { method: 'POST', headers: await authHeaders('U-lee', 'Lee') },
    );
    expect(selfJoin.status).toBe(201);
    expect(selfJoin.body.registration.type).toBe('SELF');
    expect(selfJoin.body.registration.displayLabel).toBe('Lee');

    const duplicateSelf = await json(`/api/events/${eventId}/join`, {
      method: 'POST',
      headers: await authHeaders('U-lee', 'Lee'),
    });
    expect(duplicateSelf.status).toBe(409);

    const proxy = await json<{ registration: { displayLabel: string; type: string } }>(
      `/api/events/${eventId}/proxy-join`,
      {
        method: 'POST',
        headers: await authHeaders('U-lee', 'Lee'),
        body: JSON.stringify({ participantName: 'Amy' }),
      },
    );
    expect(proxy.status).toBe(201);
    expect(proxy.body.registration.type).toBe('PROXY');
    expect(proxy.body.registration.displayLabel).toBe('Amy（Lee 代報）');

    const duplicateProxy = await json(`/api/events/${eventId}/proxy-join`, {
      method: 'POST',
      headers: await authHeaders('U-lee', 'Lee'),
      body: JSON.stringify({ participantName: 'Amy' }),
    });
    expect(duplicateProxy.status).toBe(409);
  });

  it('uses waitlist when full and promotes the first waitlist after a cancel', async () => {
    const created = await createEvent('U-org', '主揪', {
      name: '候補遞補',
      capacity: 1,
      waitlistEnabled: true,
    });
    const eventId = created.body.event.eventId;

    const first = await json<{ registration: { registrationId: string; status: string } }>(
      `/api/events/${eventId}/join`,
      { method: 'POST', headers: await authHeaders('U-lee', 'Lee') },
    );
    expect(first.body.registration.status).toBe('CONFIRMED');

    const waitSelf = await json<{ registration: { status: string; waitlistPosition: number } }>(
      `/api/events/${eventId}/join`,
      { method: 'POST', headers: await authHeaders('U-amy', 'Amy') },
    );
    expect(waitSelf.body.registration.status).toBe('WAITLIST');
    expect(waitSelf.body.registration.waitlistPosition).toBe(1);

    const waitProxy = await json<{
      registration: { status: string; waitlistPosition: number; type: string };
    }>(`/api/events/${eventId}/proxy-join`, {
      method: 'POST',
      headers: await authHeaders('U-bob', 'Bob'),
      body: JSON.stringify({ participantName: 'Cara' }),
    });
    expect(waitProxy.body.registration.status).toBe('WAITLIST');
    expect(waitProxy.body.registration.waitlistPosition).toBe(2);

    const cancelled = await json<{ promoted: boolean }>(
      `/api/registrations/${first.body.registration.registrationId}`,
      { method: 'DELETE', headers: await authHeaders('U-lee', 'Lee') },
    );
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.promoted).toBe(true);

    const detail = await json<{
      event: {
        confirmedCount: number;
        registrations: {
          confirmed: Array<{ displayLabel: string; type: string; status: string }>;
          waitlist: Array<{ displayLabel: string; waitlistPosition: number }>;
        };
      };
    }>(`/api/events/${eventId}`, { headers: await authHeaders('U-org', '主揪') });

    expect(detail.body.event.confirmedCount).toBe(1);
    expect(detail.body.event.registrations.confirmed[0].displayLabel).toBe('Amy');
    expect(detail.body.event.registrations.confirmed[0].type).toBe('SELF');
    expect(detail.body.event.registrations.waitlist).toHaveLength(1);
    expect(detail.body.event.registrations.waitlist[0].displayLabel).toBe('Cara（Bob 代報）');
    expect(detail.body.event.registrations.waitlist[0].waitlistPosition).toBe(1);
  });

  it('keeps proxy metadata after waitlist promotion', async () => {
    const created = await createEvent('U-org', '主揪', { name: '代報轉正', capacity: 1 });
    const eventId = created.body.event.eventId;
    const confirmed = await json<{ registration: { registrationId: string } }>(
      `/api/events/${eventId}/join`,
      { method: 'POST', headers: await authHeaders('U-lee', 'Lee') },
    );
    await json(`/api/events/${eventId}/proxy-join`, {
      method: 'POST',
      headers: await authHeaders('U-lee', 'Lee'),
      body: JSON.stringify({ participantName: 'Amy' }),
    });
    await json(`/api/registrations/${confirmed.body.registration.registrationId}`, {
      method: 'DELETE',
      headers: await authHeaders('U-lee', 'Lee'),
    });

    const detail = await json<{
      event: { registrations: { confirmed: Array<{ displayLabel: string; type: string }> } };
    }>(`/api/events/${eventId}`, { headers: await authHeaders('U-org', '主揪') });
    expect(detail.body.event.registrations.confirmed[0].type).toBe('PROXY');
    expect(detail.body.event.registrations.confirmed[0].displayLabel).toBe('Amy（Lee 代報）');
  });

  it('lets a user cancel own self and proxy registrations but not others', async () => {
    const created = await createEvent('U-org', '主揪', { name: '取消權限', capacity: 5 });
    const eventId = created.body.event.eventId;
    const amy = await json<{ registration: { registrationId: string } }>(`/api/events/${eventId}/join`, {
      method: 'POST',
      headers: await authHeaders('U-amy', 'Amy'),
    });
    const leeProxy = await json<{ registration: { registrationId: string } }>(
      `/api/events/${eventId}/proxy-join`,
      {
        method: 'POST',
        headers: await authHeaders('U-lee', 'Lee'),
        body: JSON.stringify({ participantName: 'Amy' }),
      },
    );

    const blocked = await json(`/api/registrations/${amy.body.registration.registrationId}`, {
      method: 'DELETE',
      headers: await authHeaders('U-lee', 'Lee'),
    });
    expect(blocked.status).toBe(403);

    const proxyCancel = await json(`/api/registrations/${leeProxy.body.registration.registrationId}`, {
      method: 'DELETE',
      headers: await authHeaders('U-lee', 'Lee'),
    });
    expect(proxyCancel.status).toBe(200);

    const organizerCancel = await json(`/api/registrations/${amy.body.registration.registrationId}`, {
      method: 'DELETE',
      headers: await authHeaders('U-org', '主揪'),
    });
    expect(organizerCancel.status).toBe(200);
  });

  it('rejects new joins when the event is full without waitlist', async () => {
    const created = await createEvent('U-org', '主揪', {
      name: '不開放候補',
      capacity: 1,
      waitlistEnabled: false,
    });
    const eventId = created.body.event.eventId;
    await json(`/api/events/${eventId}/join`, {
      method: 'POST',
      headers: await authHeaders('U-lee', 'Lee'),
    });
    const full = await json(`/api/events/${eventId}/join`, {
      method: 'POST',
      headers: await authHeaders('U-amy', 'Amy'),
    });
    expect(full.status).toBe(409);
  });

  it('rejects joins after registration is closed', async () => {
    const created = await createEvent('U-org', '主揪', { name: '關閉後報名' });
    const eventId = created.body.event.eventId;
    await json(`/api/events/${eventId}/close`, {
      method: 'POST',
      headers: await authHeaders('U-org', '主揪'),
    });
    const join = await json(`/api/events/${eventId}/join`, {
      method: 'POST',
      headers: await authHeaders('U-amy', 'Amy'),
    });
    expect(join.status).toBe(409);
  });
});

describe('organizer transfer invites', () => {
  it('rejects unauthenticated preview and accept', async () => {
    const preview = await json('/api/transfer-invites/not-a-real-token');
    expect(preview.status).toBe(401);
    const accept = await json('/api/transfer-invites/not-a-real-token/accept', { method: 'POST' });
    expect(accept.status).toBe(401);
  });

  it('lets the organizer create a one-time invite that the recipient must confirm', async () => {
    const created = await createEvent('U-lee', 'Lee', { name: '轉移邀請' });
    const eventId = created.body.event.eventId;

    const invite = await json<{ invite: { token: string; sharePath: string; expiresAt: string } }>(
      `/api/events/${eventId}/transfer-invites`,
      { method: 'POST', headers: await authHeaders('U-lee', 'Lee') },
    );
    expect(invite.status).toBe(201);
    expect(invite.body.invite.token).toBeTruthy();
    expect(invite.body.invite.sharePath).toBe(`/transfer/${invite.body.invite.token}`);

    const preview = await json<{
      invite: { eventName: string; status: string; isOrganizer: boolean };
    }>(`/api/transfer-invites/${invite.body.invite.token}`, {
      headers: authOnlyHeaders('U-amy', 'Amy'),
    });
    expect(preview.status).toBe(200);
    expect(preview.body.invite.eventName).toBe('轉移邀請');
    expect(preview.body.invite.status).toBe('PENDING');
    expect(preview.body.invite.isOrganizer).toBe(false);

    const selfAccept = await json(`/api/transfer-invites/${invite.body.invite.token}/accept`, {
      method: 'POST',
      headers: authOnlyHeaders('U-lee', 'Lee'),
    });
    expect(selfAccept.status).toBe(400);

    const accepted = await json<{ event: { organizerLineUserId: string } }>(
      `/api/transfer-invites/${invite.body.invite.token}/accept`,
      { method: 'POST', headers: authOnlyHeaders('U-amy', 'Amy') },
    );
    expect(accepted.status).toBe(200);
    expect(accepted.body.event.organizerLineUserId).toBe('U-amy');

    const reused = await json(`/api/transfer-invites/${invite.body.invite.token}/accept`, {
      method: 'POST',
      headers: authOnlyHeaders('U-bob', 'Bob'),
    });
    expect(reused.status).toBe(409);
  });

  it('invalidates old links when cancelled or regenerated', async () => {
    const created = await createEvent('U-lee', 'Lee', { name: '重新產生連結' });
    const eventId = created.body.event.eventId;
    const first = await json<{ invite: { token: string } }>(`/api/events/${eventId}/transfer-invites`, {
      method: 'POST',
      headers: await authHeaders('U-lee', 'Lee'),
    });
    const second = await json<{ invite: { token: string } }>(`/api/events/${eventId}/transfer-invites`, {
      method: 'POST',
      headers: await authHeaders('U-lee', 'Lee'),
    });
    expect(first.body.invite.token).not.toBe(second.body.invite.token);

    const oldLink = await json(`/api/transfer-invites/${first.body.invite.token}/accept`, {
      method: 'POST',
      headers: authOnlyHeaders('U-amy', 'Amy'),
    });
    expect(oldLink.status).toBe(410);

    await json(`/api/events/${eventId}/transfer-invites`, {
      method: 'DELETE',
      headers: await authHeaders('U-lee', 'Lee'),
    });
    const cancelled = await json(`/api/transfer-invites/${second.body.invite.token}/accept`, {
      method: 'POST',
      headers: authOnlyHeaders('U-amy', 'Amy'),
    });
    expect(cancelled.status).toBe(410);
  });

  it('rejects expired transfer invites', async () => {
    const { env } = await import('cloudflare:test');
    const { sha256Hex } = await import('../src/lib/datetime');
    const created = await createEvent('U-lee', 'Lee', { name: '過期轉移' });
    const eventId = created.body.event.eventId;
    const invite = await json<{ invite: { token: string } }>(`/api/events/${eventId}/transfer-invites`, {
      method: 'POST',
      headers: await authHeaders('U-lee', 'Lee'),
    });
    const tokenHash = await sha256Hex(invite.body.invite.token);
    await env.DB.prepare(
      `UPDATE organizer_transfer_invites SET expires_at = ? WHERE token_hash = ?`,
    )
      .bind('2020-01-01T00:00:00.000Z', tokenHash)
      .run();

    const expired = await json(`/api/transfer-invites/${invite.body.invite.token}/accept`, {
      method: 'POST',
      headers: authOnlyHeaders('U-amy', 'Amy'),
    });
    expect(expired.status).toBe(410);
  });
});

describe('copy event', () => {
  it('copies event metadata without registrations or the old id', async () => {
    const created = await createEvent('U-lee', 'Lee', {
      name: '原活動',
      address: '台北車站',
      capacity: 4,
      waitlistEnabled: false,
    });
    const eventId = created.body.event.eventId;
    await json(`/api/events/${eventId}/join`, {
      method: 'POST',
      headers: await authHeaders('U-amy', 'Amy'),
    });

    const copied = await json<{
      event: {
        eventId: string;
        groupId: string;
        name: string;
        address: string;
        capacity: number;
        waitlistEnabled: boolean;
        organizerLineUserId: string;
        confirmedCount: number;
        startDate: string;
        endTime: string;
      };
    }>(`/api/events/${eventId}/copy`, {
      method: 'POST',
      headers: await authHeaders('U-amy', 'Amy'),
      body: JSON.stringify({
        ...futureRange(20),
        name: '原活動',
      }),
    });
    expect(copied.status).toBe(201);
    expect(copied.body.event.eventId).not.toBe(eventId);
    expect(copied.body.event.groupId).toBe('G-test-group');
    expect(copied.body.event.name).toBe('原活動');
    expect(copied.body.event.address).toBe('台北車站');
    expect(copied.body.event.capacity).toBe(4);
    expect(copied.body.event.waitlistEnabled).toBe(false);
    expect(copied.body.event.organizerLineUserId).toBe('U-amy');
    expect(copied.body.event.confirmedCount).toBe(0);

    const original = await json<{
      event: { confirmedCount: number; organizerLineUserId: string };
    }>(`/api/events/${eventId}`, { headers: await authHeaders('U-lee', 'Lee') });
    expect(original.body.event.confirmedCount).toBe(1);
    expect(original.body.event.organizerLineUserId).toBe('U-lee');
  });

  it('rejects copy from another group', async () => {
    const created = await createEvent('U-lee', 'Lee', { name: '別群活動' });
    const copied = await json(`/api/events/${created.body.event.eventId}/copy`, {
      method: 'POST',
      headers: await authHeaders('U-amy', 'Amy', 'G-other'),
      body: JSON.stringify(futureRange()),
    });
    expect(copied.status).toBe(403);
  });
});

describe('LINE webhook', () => {
  it('rejects invalid signatures', async () => {
    const response = await request('/webhook/line', {
      method: 'POST',
      headers: { 'X-Line-Signature': 'invalid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: [] }),
    });
    expect(response.status).toBe(401);
  });

  it('accepts a valid signature and ignores non-list messages', async () => {
    const { hmacSha256Base64 } = await import('../src/lib/line-signature');
    const payload = JSON.stringify({
      events: [
        {
          type: 'message',
          webhookEventId: 'wh-1',
          replyToken: 'reply-token',
          message: { type: 'text', text: 'hello' },
          source: { type: 'group', groupId: 'G-test-group' },
        },
      ],
    });
    const signature = await hmacSha256Base64('test-channel-secret', new TextEncoder().encode(payload));
    const response = await request('/webhook/line', {
      method: 'POST',
      headers: { 'X-Line-Signature': signature, 'Content-Type': 'application/json' },
      body: payload,
    });
    expect(response.status).toBe(200);
  });

  it('embeds a signed context token in /list flex links from webhook groupId', async () => {
    const { hmacSha256Base64 } = await import('../src/lib/line-signature');
    const { verifyLiffContext } = await import('../src/lib/liff-context');
    const { env } = await import('cloudflare:test');

    await createEvent('U-lee', 'Lee', { name: 'Webhook 列表活動' });

    const replies: Array<{ messages: Array<{ contents?: unknown }> }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('api.line.me/v2/bot/message/reply')) {
        replies.push(JSON.parse(String(init?.body)) as { messages: Array<{ contents?: unknown }> });
        return new Response('{}', { status: 200 });
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      const payload = JSON.stringify({
        events: [
          {
            type: 'message',
            webhookEventId: `wh-list-${crypto.randomUUID()}`,
            replyToken: 'reply-list-token',
            message: { type: 'text', text: '/list' },
            source: { type: 'group', groupId: 'G-test-group' },
          },
        ],
      });
      const signature = await hmacSha256Base64(
        'test-channel-secret',
        new TextEncoder().encode(payload),
      );
      const response = await request('/webhook/line', {
        method: 'POST',
        headers: { 'X-Line-Signature': signature, 'Content-Type': 'application/json' },
        body: payload,
      });
      expect(response.status).toBe(200);
      expect(replies.length).toBe(1);
      const serialized = JSON.stringify(replies[0]);
      expect(serialized).toContain('context=');
      expect(serialized).toContain('liff.line.me/test-liff-id');

      const match = serialized.match(/context=([^"&\\]+)/);
      expect(match?.[1]).toBeTruthy();
      const token = decodeURIComponent(match![1]);
      const verified = await verifyLiffContext(env.LIFF_CONTEXT_SIGNING_SECRET, token);
      expect(verified.groupId).toBe('G-test-group');
      expect(verified.nonce.length).toBeGreaterThan(0);

      const list = await json<{ events: Array<{ name: string }> }>('/api/events', {
        headers: {
          Authorization: 'Bearer test:U-lee:Lee',
          'Content-Type': 'application/json',
          'X-JoyIn-Context': token,
        },
      });
      expect(list.status).toBe(200);
      expect(list.body.events.some((e) => e.name === 'Webhook 列表活動')).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('limits /list results to five upcoming events sorted by start_at ASC', async () => {
    const { hmacSha256Base64 } = await import('../src/lib/line-signature');
    const names = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];
    for (let i = 0; i < names.length; i += 1) {
      await createEvent('U-lee', 'Lee', {
        name: names[i],
        startDate: `2026-12-${String(10 + i).padStart(2, '0')}`,
        startTime: '19:00',
        endDate: `2026-12-${String(10 + i).padStart(2, '0')}`,
        endTime: '21:00',
      });
    }

    const replies: Array<{ messages: unknown[] }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('api.line.me/v2/bot/message/reply')) {
        replies.push(JSON.parse(String(init?.body)) as { messages: unknown[] });
        return new Response('{}', { status: 200 });
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      const payload = JSON.stringify({
        events: [
          {
            type: 'message',
            webhookEventId: `wh-limit-${crypto.randomUUID()}`,
            replyToken: 'reply-limit-token',
            message: { type: 'text', text: '/list' },
            source: { type: 'group', groupId: 'G-test-group' },
          },
        ],
      });
      const signature = await hmacSha256Base64(
        'test-channel-secret',
        new TextEncoder().encode(payload),
      );
      const response = await request('/webhook/line', {
        method: 'POST',
        headers: { 'X-Line-Signature': signature, 'Content-Type': 'application/json' },
        body: payload,
      });
      expect(response.status).toBe(200);
      const serialized = JSON.stringify(replies[0]);
      expect(serialized).toContain('L1');
      expect(serialized).toContain('L5');
      expect(serialized).not.toContain('"L6"');
      const idx1 = serialized.indexOf('L1');
      const idx5 = serialized.indexOf('L5');
      expect(idx1).toBeGreaterThan(-1);
      expect(idx5).toBeGreaterThan(idx1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});