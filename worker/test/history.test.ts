import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { listCachedGroupMembers, listGroupProxyCandidates } from '../src/db/repo';
import { runDailyCleanup } from '../src/services/cleanup';
import { authHeaders, createEvent, futureRange, json } from './helpers';

async function insertEndedEvent(opts: {
  eventId: string;
  groupId?: string;
  endAt: string;
  organizerId?: string;
  name?: string;
}) {
  const now = '2026-01-01T00:00:00.000Z';
  const groupId = opts.groupId ?? 'G-test-group';
  await env.DB.prepare(
    `INSERT INTO events (
      event_id, group_id, name, event_date, event_time, event_at, start_at, end_at, address,
      capacity, waitlist_enabled, status, organizer_line_user_id,
      organizer_display_name, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?)`,
  )
    .bind(
      opts.eventId,
      groupId,
      opts.name ?? '已結束活動',
      '2026-01-01',
      '19:00',
      opts.endAt,
      opts.endAt,
      opts.endAt,
      '台北',
      4,
      1,
      opts.organizerId ?? 'U-org',
      '主揪',
      now,
      now,
    )
    .run();
}

async function insertSelfReg(opts: {
  registrationId: string;
  eventId: string;
  lineUserId: string;
  name: string;
  status?: 'CONFIRMED' | 'WAITLIST';
  waitlistPosition?: number | null;
}) {
  const now = '2026-01-01T00:00:00.000Z';
  await env.DB.prepare(
    `INSERT INTO registrations (
      registration_id, event_id, type, status, waitlist_position,
      participant_name, line_user_id, created_by_line_user_id,
      created_by_display_name, created_at, updated_at,
      registration_source, participant_line_user_id
    ) VALUES (?, ?, 'SELF', ?, ?, ?, ?, ?, ?, ?, ?, 'SELF_JOIN', ?)`,
  )
    .bind(
      opts.registrationId,
      opts.eventId,
      opts.status ?? 'CONFIRMED',
      opts.waitlistPosition ?? null,
      opts.name,
      opts.lineUserId,
      opts.lineUserId,
      opts.name,
      now,
      now,
      opts.lineUserId,
    )
    .run();
}

describe('history retention + cleanup', () => {
  it('keeps ended events for 29 days and deletes after 30+', async () => {
    const now = new Date('2026-09-10T16:00:00.000Z');
    await insertEndedEvent({
      eventId: 'ended-29d',
      endAt: '2026-08-12T16:00:00.000Z', // 29 days before now
    });
    await insertEndedEvent({
      eventId: 'ended-31d',
      endAt: '2026-08-10T15:00:00.000Z', // >30 days
    });
    await insertEndedEvent({
      eventId: 'paid-31d',
      endAt: '2026-08-10T14:00:00.000Z',
      name: '保留付款紀錄活動',
    });
    await insertEndedEvent({
      eventId: 'still-future',
      endAt: '2026-12-01T13:00:00.000Z',
      name: '未來活動',
    });

    await insertSelfReg({
      registrationId: 'reg-31d',
      eventId: 'ended-31d',
      lineUserId: 'U-lee',
      name: 'Lee',
    });
    await env.DB.prepare(
      `INSERT INTO registrations (
        registration_id, event_id, type, status, waitlist_position,
        participant_name, line_user_id, created_by_line_user_id,
        created_by_display_name, created_at, updated_at,
        registration_source, participant_line_user_id
      ) VALUES (?, ?, 'PROXY', 'CONFIRMED', NULL, ?, NULL, ?, ?, ?, ?, 'PROXY', NULL)`,
    )
      .bind(
        'proxy-31d',
        'ended-31d',
        '代報友人',
        'U-lee',
        'Lee',
        '2026-08-10T10:00:00.000Z',
        '2026-08-10T10:00:00.000Z',
      )
      .run();

    const preorderAt = '2026-08-10T10:00:00.000Z';
    await env.DB.batch([
      env.DB
        .prepare(
          `INSERT INTO preorder_offers (
            offer_id, event_id, group_id, provider_line_user_id, provider_display_name,
            title, merchant_name, order_deadline, status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CLOSED', ?, ?)`,
        )
        .bind(
          'offer-31d',
          'paid-31d',
          'G-test-group',
          'U-lee',
          'Lee',
          '歷史代訂',
          '歷史店家',
          preorderAt,
          preorderAt,
          preorderAt,
        ),
      env.DB
        .prepare(
          `INSERT INTO preorder_products (
            product_id, offer_id, name, unit_price, ordered_quantity,
            sort_order, is_active, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 1, 0, 1, ?, ?)`,
        )
        .bind('product-31d', 'offer-31d', '歷史商品', 50, preorderAt, preorderAt),
      env.DB
        .prepare(
          `INSERT INTO preorder_product_option_groups (
            option_group_id, product_id, name, type, is_required,
            min_selections, max_selections, sort_order, created_at
           ) VALUES (?, ?, ?, 'SINGLE', 1, 1, 1, 0, ?)`,
        )
        .bind('group-31d', 'product-31d', '甜度', preorderAt),
      env.DB
        .prepare(
          `INSERT INTO preorder_product_option_values (
            option_value_id, option_group_id, name, price_adjustment,
            is_active, sort_order, created_at
           ) VALUES (?, ?, ?, 0, 1, 0, ?)`,
        )
        .bind('value-31d', 'group-31d', '無糖', preorderAt),
      env.DB
        .prepare(
          `INSERT INTO preorder_orders (
            order_id, offer_id, event_id, group_id, buyer_line_user_id,
            buyer_display_name, status, total_amount, payment_reported_at,
            payment_confirmed_at, fulfilled_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'FULFILLED', 50, ?, ?, ?, ?, ?)`,
        )
        .bind(
          'order-31d',
          'offer-31d',
          'paid-31d',
          'G-test-group',
          'U-lee',
          'Lee',
          preorderAt,
          preorderAt,
          preorderAt,
          preorderAt,
          preorderAt,
        ),
      env.DB
        .prepare(
          `INSERT INTO preorder_order_items (
            order_item_id, order_id, product_id, product_name_snapshot,
            unit_price_snapshot, quantity, subtotal, created_at
           ) VALUES (?, ?, ?, ?, 50, 1, 50, ?)`,
        )
        .bind('item-31d', 'order-31d', 'product-31d', '歷史商品', preorderAt),
      env.DB
        .prepare(
          `INSERT INTO preorder_order_item_options (
            order_item_option_id, order_item_id, option_group_id, option_value_id,
            group_name_snapshot, option_name_snapshot, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          'item-option-31d',
          'item-31d',
          'group-31d',
          'value-31d',
          '甜度',
          '無糖',
          preorderAt,
        ),
      env.DB
        .prepare(
          `INSERT INTO preorder_order_status_history (
            history_id, order_id, from_status, to_status,
            changed_by_line_user_id, created_at
           ) VALUES (?, ?, 'PAYMENT_CONFIRMED', 'FULFILLED', ?, ?)`,
        )
        .bind('history-31d', 'order-31d', 'U-lee', preorderAt),
    ]);

    const result = await runDailyCleanup(env.DB, now);
    expect(result.events).toBeGreaterThanOrEqual(1);

    const kept29 = await env.DB.prepare('SELECT event_id FROM events WHERE event_id = ?')
      .bind('ended-29d')
      .first();
    const gone31 = await env.DB.prepare('SELECT event_id FROM events WHERE event_id = ?')
      .bind('ended-31d')
      .first();
    const future = await env.DB.prepare('SELECT event_id FROM events WHERE event_id = ?')
      .bind('still-future')
      .first();
    const paid31 = await env.DB.prepare('SELECT event_id FROM events WHERE event_id = ?')
      .bind('paid-31d')
      .first();

    expect(kept29).not.toBeNull();
    expect(gone31).toBeNull();
    expect(future).not.toBeNull();
    expect(paid31).not.toBeNull();
    const preorderRows = await env.DB
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM preorder_offers WHERE event_id = 'paid-31d') AS offers,
          (SELECT COUNT(*) FROM preorder_orders
             WHERE event_id = 'paid-31d'
               AND payment_reported_at IS NOT NULL
               AND payment_confirmed_at IS NOT NULL) AS orders,
          (SELECT COUNT(*) FROM preorder_order_item_options
             WHERE order_item_id = 'item-31d') AS item_options,
          (SELECT COUNT(*) FROM preorder_order_status_history
             WHERE order_id = 'order-31d') AS payment_history`,
      )
      .first<{ offers: number; orders: number; item_options: number; payment_history: number }>();
    expect(preorderRows).toEqual({ offers: 1, orders: 1, item_options: 1, payment_history: 1 });

    const members = await listCachedGroupMembers(env.DB, 'G-test-group');
    expect(members.some((m) => m.line_user_id === 'U-lee')).toBe(true);
    const proxies = await listGroupProxyCandidates(env.DB, 'G-test-group');
    expect(proxies.some((p) => p.display_name === '代報友人')).toBe(true);
  });

  it('lists history for participants/organizer and hides unrelated members', async () => {
    await insertEndedEvent({
      eventId: 'hist-a',
      endAt: '2026-09-01T12:00:00.000Z',
      organizerId: 'U-org',
      name: '歷史 A',
    });
    await insertSelfReg({
      registrationId: 'hist-a-amy',
      eventId: 'hist-a',
      lineUserId: 'U-amy',
      name: 'Amy',
    });
    await insertSelfReg({
      registrationId: 'hist-a-bob-wait',
      eventId: 'hist-a',
      lineUserId: 'U-bob',
      name: 'Bob',
      status: 'WAITLIST',
      waitlistPosition: 1,
    });
    await env.DB.prepare(
      `INSERT INTO registrations (
        registration_id, event_id, type, status, waitlist_position,
        participant_name, line_user_id, created_by_line_user_id,
        created_by_display_name, created_at, updated_at,
        registration_source, participant_line_user_id
      ) VALUES (?, ?, 'PROXY', 'CONFIRMED', NULL, ?, NULL, ?, ?, ?, ?, 'PROXY', NULL)`,
    )
      .bind(
        'hist-a-proxy',
        'hist-a',
        'Cara',
        'U-lee',
        'Lee',
        '2026-09-01T10:00:00.000Z',
        '2026-09-01T10:00:00.000Z',
      )
      .run();

    const amy = await json<{
      events: Array<{ eventId: string; viewerRoles: string[]; isEnded: boolean }>;
    }>('/api/events/history', {
      headers: await authHeaders('U-amy', 'Amy'),
    });
    expect(amy.status).toBe(200);
    expect(amy.body.events.some((e) => e.eventId === 'hist-a')).toBe(true);
    expect(amy.body.events.find((e) => e.eventId === 'hist-a')?.viewerRoles).toContain('attended');

    const bob = await json<{ events: Array<{ eventId: string; viewerRoles: string[] }> }>(
      '/api/events/history',
      { headers: await authHeaders('U-bob', 'Bob') },
    );
    expect(bob.body.events.find((e) => e.eventId === 'hist-a')?.viewerRoles).toContain('waitlist');

    const lee = await json<{ events: Array<{ eventId: string; viewerRoles: string[] }> }>(
      '/api/events/history',
      { headers: await authHeaders('U-lee', 'Lee') },
    );
    expect(lee.body.events.find((e) => e.eventId === 'hist-a')?.viewerRoles).toContain('proxy');

    const org = await json<{ events: Array<{ eventId: string; viewerRoles: string[] }> }>(
      '/api/events/history',
      { headers: await authHeaders('U-org', '主揪') },
    );
    expect(org.body.events.find((e) => e.eventId === 'hist-a')?.viewerRoles).toContain('organizer');

    const stranger = await json<{ events: Array<{ eventId: string }> }>('/api/events/history', {
      headers: await authHeaders('U-stranger', 'Stranger'),
    });
    expect(stranger.body.events.some((e) => e.eventId === 'hist-a')).toBe(false);
  });

  it('allows reading ended event detail within retention and blocks mutations', async () => {
    await insertEndedEvent({
      eventId: 'hist-detail',
      endAt: '2026-09-01T12:00:00.000Z',
      organizerId: 'U-lee',
    });
    await insertSelfReg({
      registrationId: 'hist-detail-amy',
      eventId: 'hist-detail',
      lineUserId: 'U-amy',
      name: 'Amy',
    });

    const detail = await json<{
      event: { isEnded: boolean; registrations: { confirmed: Array<{ canCancel: boolean }> } };
    }>('/api/events/hist-detail', {
      headers: await authHeaders('U-amy', 'Amy'),
    });
    expect(detail.status).toBe(200);
    expect(detail.body.event.isEnded).toBe(true);
    expect(detail.body.event.registrations.confirmed.every((r) => r.canCancel === false)).toBe(true);

    const join = await json('/api/events/hist-detail/join', {
      method: 'POST',
      headers: await authHeaders('U-bob', 'Bob'),
    });
    expect(join.status).toBe(410);

    const copied = await json('/api/events/hist-detail/copy', {
      method: 'POST',
      headers: await authHeaders('U-lee', 'Lee'),
      body: JSON.stringify({
        ...futureRange(40),
        preselectedMemberIds: [],
      }),
    });
    expect(copied.status).toBe(201);
  });

  it('rejects cross-group history detail access', async () => {
    await insertEndedEvent({
      eventId: 'hist-other-group',
      groupId: 'G-other-group',
      endAt: '2026-09-01T12:00:00.000Z',
      organizerId: 'U-lee',
    });
    const detail = await json('/api/events/hist-other-group', {
      headers: await authHeaders('U-lee', 'Lee', 'G-test-group'),
    });
    expect(detail.status).toBe(404);
  });

  it('still lists upcoming create flow events', async () => {
    const created = await createEvent('U-lee', 'Lee', { name: '即將活動', capacity: 3 });
    expect(created.status).toBe(201);
    const listed = await json<{ events: Array<{ eventId: string }> }>('/api/events', {
      headers: await authHeaders('U-lee', 'Lee'),
    });
    expect(listed.body.events.some((e) => e.eventId === created.body.event.eventId)).toBe(true);
  });
});
