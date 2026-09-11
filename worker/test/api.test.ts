import { describe, expect, it } from 'vitest';
import { authHeaders, createEvent, json, request } from './helpers';

describe('events API', () => {
  it('serves a public health check', async () => {
    const { status, body } = await json<{ ok: boolean }>('/api/health');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('rejects unauthenticated access', async () => {
    const { status } = await json('/api/events');
    expect(status).toBe(401);
  });

  it('requires a LINE group id', async () => {
    const { status, body } = await json<{ message: string }>('/api/events', {
      headers: {
        Authorization: 'Bearer test:U-lee:Lee',
        'Content-Type': 'application/json',
      },
    });
    expect(status).toBe(400);
    expect(body.message).toContain('群組');
  });

  it('creates and lists upcoming events sorted by time', async () => {
    const first = await createEvent('U-lee', 'Lee', {
      name: '較晚的活動',
      eventDate: '2026-12-20',
      eventTime: '19:00',
    });
    const second = await createEvent('U-lee', 'Lee', {
      name: '較近的活動',
      eventDate: '2026-12-10',
      eventTime: '18:30',
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const list = await json<{ events: Array<{ name: string }> }>('/api/events', {
      headers: authHeaders('U-amy', 'Amy'),
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
      headers: authHeaders('U-lee', 'Lee'),
    });
    expect(detail.body.event.organizerLineUserId).toBe('U-lee');
    expect(detail.body.event.viewer.isOrganizer).toBe(true);
  });

  it('rejects past event times', async () => {
    const result = await createEvent('U-lee', 'Lee', {
      name: '過去活動',
      eventDate: '2020-01-01',
      eventTime: '10:00',
    });
    expect(result.status).toBe(400);
  });
});

describe('organizer permissions', () => {
  it('hides management from regular members', async () => {
    const created = await createEvent('U-lee', 'Lee', { name: '權限活動' });
    const eventId = created.body.event.eventId;

    const memberPatch = await json(`/api/events/${eventId}`, {
      method: 'PATCH',
      headers: authHeaders('U-amy', 'Amy'),
      body: JSON.stringify({ name: '被改名', confirmTimeLocationChange: true }),
    });
    expect(memberPatch.status).toBe(403);

    const memberClose = await json(`/api/events/${eventId}/close`, {
      method: 'POST',
      headers: authHeaders('U-amy', 'Amy'),
    });
    expect(memberClose.status).toBe(403);

    const memberDelete = await json(`/api/events/${eventId}`, {
      method: 'DELETE',
      headers: authHeaders('U-amy', 'Amy'),
    });
    expect(memberDelete.status).toBe(403);

    const memberTransfer = await json(`/api/events/${eventId}/transfer-organizer`, {
      method: 'POST',
      headers: authHeaders('U-amy', 'Amy'),
      body: JSON.stringify({ toLineUserId: 'U-amy', toDisplayName: 'Amy' }),
    });
    expect(memberTransfer.status).toBe(403);
  });

  it('lets the organizer close, edit, transfer and soft-delete', async () => {
    const created = await createEvent('U-lee', 'Lee', { name: '主揪管理', capacity: 3 });
    const eventId = created.body.event.eventId;

    const patched = await json<{ event: { name: string; address: string } }>(`/api/events/${eventId}`, {
      method: 'PATCH',
      headers: authHeaders('U-lee', 'Lee'),
      body: JSON.stringify({
        name: '主揪管理（更新）',
        address: '台中市西區',
        confirmTimeLocationChange: true,
      }),
    });
    expect(patched.status).toBe(200);
    expect(patched.body.event.name).toBe('主揪管理（更新）');

    const transferred = await json<{ event: { organizerLineUserId: string } }>(
      `/api/events/${eventId}/transfer-organizer`,
      {
        method: 'POST',
        headers: authHeaders('U-lee', 'Lee'),
        body: JSON.stringify({ toLineUserId: 'U-amy', toDisplayName: 'Amy' }),
      },
    );
    expect(transferred.status).toBe(200);
    expect(transferred.body.event.organizerLineUserId).toBe('U-amy');

    const closed = await json<{ event: { status: string } }>(`/api/events/${eventId}/close`, {
      method: 'POST',
      headers: authHeaders('U-amy', 'Amy'),
    });
    expect(closed.status).toBe(200);
    expect(closed.body.event.status).toBe('CLOSED');

    const deleted = await json(`/api/events/${eventId}`, {
      method: 'DELETE',
      headers: authHeaders('U-amy', 'Amy'),
    });
    expect(deleted.status).toBe(200);

    const missing = await json(`/api/events/${eventId}`, {
      headers: authHeaders('U-amy', 'Amy'),
    });
    expect(missing.status).toBe(404);
  });

  it('requires confirmation before time or location changes', async () => {
    const created = await createEvent('U-lee', 'Lee', { name: '確認提示' });
    const result = await json(`/api/events/${created.body.event.eventId}`, {
      method: 'PATCH',
      headers: authHeaders('U-lee', 'Lee'),
      body: JSON.stringify({ address: '新地址' }),
    });
    expect(result.status).toBe(400);
  });

  it('does not allow capacity below current confirmed count', async () => {
    const created = await createEvent('U-lee', 'Lee', { name: '名額下限', capacity: 2 });
    const eventId = created.body.event.eventId;
    await json(`/api/events/${eventId}/join`, {
      method: 'POST',
      headers: authHeaders('U-lee', 'Lee'),
    });
    await json(`/api/events/${eventId}/join`, {
      method: 'POST',
      headers: authHeaders('U-amy', 'Amy'),
    });

    const lowered = await json(`/api/events/${eventId}`, {
      method: 'PATCH',
      headers: authHeaders('U-lee', 'Lee'),
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
      { method: 'POST', headers: authHeaders('U-lee', 'Lee') },
    );
    expect(selfJoin.status).toBe(201);
    expect(selfJoin.body.registration.type).toBe('SELF');
    expect(selfJoin.body.registration.displayLabel).toBe('Lee');

    const duplicateSelf = await json(`/api/events/${eventId}/join`, {
      method: 'POST',
      headers: authHeaders('U-lee', 'Lee'),
    });
    expect(duplicateSelf.status).toBe(409);

    const proxy = await json<{ registration: { displayLabel: string; type: string } }>(
      `/api/events/${eventId}/proxy-join`,
      {
        method: 'POST',
        headers: authHeaders('U-lee', 'Lee'),
        body: JSON.stringify({ participantName: 'Amy' }),
      },
    );
    expect(proxy.status).toBe(201);
    expect(proxy.body.registration.type).toBe('PROXY');
    expect(proxy.body.registration.displayLabel).toBe('Amy（Lee 代報）');

    const duplicateProxy = await json(`/api/events/${eventId}/proxy-join`, {
      method: 'POST',
      headers: authHeaders('U-lee', 'Lee'),
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
      { method: 'POST', headers: authHeaders('U-lee', 'Lee') },
    );
    expect(first.body.registration.status).toBe('CONFIRMED');

    const waitSelf = await json<{ registration: { status: string; waitlistPosition: number } }>(
      `/api/events/${eventId}/join`,
      { method: 'POST', headers: authHeaders('U-amy', 'Amy') },
    );
    expect(waitSelf.body.registration.status).toBe('WAITLIST');
    expect(waitSelf.body.registration.waitlistPosition).toBe(1);

    const waitProxy = await json<{
      registration: { status: string; waitlistPosition: number; type: string };
    }>(`/api/events/${eventId}/proxy-join`, {
      method: 'POST',
      headers: authHeaders('U-bob', 'Bob'),
      body: JSON.stringify({ participantName: 'Cara' }),
    });
    expect(waitProxy.body.registration.status).toBe('WAITLIST');
    expect(waitProxy.body.registration.waitlistPosition).toBe(2);

    const cancelled = await json<{ promoted: boolean }>(
      `/api/registrations/${first.body.registration.registrationId}`,
      { method: 'DELETE', headers: authHeaders('U-lee', 'Lee') },
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
    }>(`/api/events/${eventId}`, { headers: authHeaders('U-org', '主揪') });

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
      { method: 'POST', headers: authHeaders('U-lee', 'Lee') },
    );
    await json(`/api/events/${eventId}/proxy-join`, {
      method: 'POST',
      headers: authHeaders('U-lee', 'Lee'),
      body: JSON.stringify({ participantName: 'Amy' }),
    });
    await json(`/api/registrations/${confirmed.body.registration.registrationId}`, {
      method: 'DELETE',
      headers: authHeaders('U-lee', 'Lee'),
    });

    const detail = await json<{
      event: { registrations: { confirmed: Array<{ displayLabel: string; type: string }> } };
    }>(`/api/events/${eventId}`, { headers: authHeaders('U-org', '主揪') });
    expect(detail.body.event.registrations.confirmed[0].type).toBe('PROXY');
    expect(detail.body.event.registrations.confirmed[0].displayLabel).toBe('Amy（Lee 代報）');
  });

  it('lets a user cancel own self and proxy registrations but not others', async () => {
    const created = await createEvent('U-org', '主揪', { name: '取消權限', capacity: 5 });
    const eventId = created.body.event.eventId;
    const amy = await json<{ registration: { registrationId: string } }>(`/api/events/${eventId}/join`, {
      method: 'POST',
      headers: authHeaders('U-amy', 'Amy'),
    });
    const leeProxy = await json<{ registration: { registrationId: string } }>(
      `/api/events/${eventId}/proxy-join`,
      {
        method: 'POST',
        headers: authHeaders('U-lee', 'Lee'),
        body: JSON.stringify({ participantName: 'Amy' }),
      },
    );

    const blocked = await json(`/api/registrations/${amy.body.registration.registrationId}`, {
      method: 'DELETE',
      headers: authHeaders('U-lee', 'Lee'),
    });
    expect(blocked.status).toBe(403);

    const proxyCancel = await json(`/api/registrations/${leeProxy.body.registration.registrationId}`, {
      method: 'DELETE',
      headers: authHeaders('U-lee', 'Lee'),
    });
    expect(proxyCancel.status).toBe(200);

    const organizerCancel = await json(`/api/registrations/${amy.body.registration.registrationId}`, {
      method: 'DELETE',
      headers: authHeaders('U-org', '主揪'),
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
      headers: authHeaders('U-lee', 'Lee'),
    });
    const full = await json(`/api/events/${eventId}/join`, {
      method: 'POST',
      headers: authHeaders('U-amy', 'Amy'),
    });
    expect(full.status).toBe(409);
  });

  it('rejects joins after registration is closed', async () => {
    const created = await createEvent('U-org', '主揪', { name: '關閉後報名' });
    const eventId = created.body.event.eventId;
    await json(`/api/events/${eventId}/close`, {
      method: 'POST',
      headers: authHeaders('U-org', '主揪'),
    });
    const join = await json(`/api/events/${eventId}/join`, {
      method: 'POST',
      headers: authHeaders('U-amy', 'Amy'),
    });
    expect(join.status).toBe(409);
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
});
