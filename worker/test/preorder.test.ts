import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { authHeaders, createEvent, futureRange, json, request } from './helpers';
import { signLiffContext } from '../src/lib/liff-context';

async function join(userId: string, name: string, eventId: string) {
  return json(`/api/events/${eventId}/join`, {
    method: 'POST',
    headers: await authHeaders(userId, name),
  });
}

function deadlineIso(hoursAhead = 24) {
  return new Date(Date.now() + hoursAhead * 60 * 60 * 1000).toISOString();
}

async function createOffer(
  userId: string,
  name: string,
  eventId: string,
  overrides: Record<string, unknown> = {},
) {
  const payload = {
    title: '飲料代訂',
    merchantName: '五十嵐',
    description: '活動當天外送',
    orderDeadline: deadlineIso(48),
    paymentInstructions: '',
    paymentUrl: null,
    products: [
      {
        name: '珍奶',
        specification: '微糖',
        unitPrice: 60,
        quantityLimit: 5,
        sortOrder: 0,
        isActive: true,
      },
    ],
    ...overrides,
  };
  return json<{ offer: { offerId: string; products: Array<{ productId: string; unitPrice: number }> } }>(
    `/api/events/${eventId}/preorders`,
    {
      method: 'POST',
      headers: await authHeaders(userId, name),
      body: JSON.stringify(payload),
    },
  );
}

describe('preorder role capabilities (organizer A vs participant B)', () => {
  it('non-organizer confirmed SELF can create offer and order organizer offer', async () => {
    const created = await createEvent('U-cap-org', '主揪A', { capacity: 5 });
    const eventId = created.body.event.eventId;
    await join('U-cap-org', '主揪A', eventId);
    const joinedB = await join('U-cap-b', '參加者B', eventId);
    expect(joinedB.status).toBe(201);
    expect(joinedB.body).toMatchObject({
      registration: {
        eventId,
        type: 'SELF',
        status: 'CONFIRMED',
        participantLineUserId: 'U-cap-b',
      },
    });
    const storedB = await env.DB
      .prepare(
        `SELECT event_id, type, status, participant_line_user_id
         FROM registrations
         WHERE event_id = ? AND participant_line_user_id = ?`,
      )
      .bind(eventId, 'U-cap-b')
      .first<{
        event_id: string;
        type: string;
        status: string;
        participant_line_user_id: string;
      }>();
    expect(storedB).toEqual({
      event_id: eventId,
      type: 'SELF',
      status: 'CONFIRMED',
      participant_line_user_id: 'U-cap-b',
    });

    const reopenedB = await json<{
      event: {
        eventId: string;
        groupId: string;
        viewer: {
          isOrganizer: boolean;
          selfRegistration: {
            eventId: string;
            type: string;
            status: string;
            participantLineUserId: string;
          } | null;
        };
      };
    }>(`/api/events/${eventId}`, {
      headers: await authHeaders('U-cap-b', '參加者B'),
    });
    expect(reopenedB.status).toBe(200);
    expect(reopenedB.body.event.eventId).toBe(eventId);
    expect(reopenedB.body.event.groupId).toBe('G-test-group');
    expect(reopenedB.body.event.viewer.isOrganizer).toBe(false);
    expect(reopenedB.body.event.viewer.selfRegistration).toMatchObject({
      eventId,
      type: 'SELF',
      status: 'CONFIRMED',
      participantLineUserId: 'U-cap-b',
    });

    const listB = await json<{
      canCreatePreorder: boolean;
      preorderRestrictionReason: string | null;
    }>(`/api/events/${eventId}/preorders`, {
      headers: await authHeaders('U-cap-b', '參加者B'),
    });
    expect(listB.status).toBe(200);
    expect(listB.body.canCreatePreorder).toBe(true);
    expect(listB.body.preorderRestrictionReason).toBeNull();

    const offerA = await createOffer('U-cap-org', '主揪A', eventId, { title: '主揪代訂' });
    expect(offerA.status).toBe(201);
    const offerId = offerA.body.offer.offerId;
    const productId = offerA.body.offer.products[0].productId;

    const detailB = await json<{
      offer: {
        viewer: {
          canCreatePreorder: boolean;
          canOrder: boolean;
          canManagePreorder: boolean;
          orderRestrictionReason: string | null;
        };
      };
    }>(`/api/preorders/${offerId}`, {
      headers: await authHeaders('U-cap-b', '參加者B'),
    });
    expect(detailB.status).toBe(200);
    expect(detailB.body.offer.viewer.canOrder).toBe(true);
    expect(detailB.body.offer.viewer.canManagePreorder).toBe(false);
    expect(detailB.body.offer.viewer.canCreatePreorder).toBe(true);
    expect(detailB.body.offer.viewer.orderRestrictionReason).toBeNull();

    const orderB = await json(`/api/preorders/${offerId}/my-order`, {
      method: 'PUT',
      headers: await authHeaders('U-cap-b', '參加者B'),
      body: JSON.stringify({ items: [{ productId, quantity: 2 }] }),
    });
    expect(orderB.status).toBe(200);

    const offerB = await createOffer('U-cap-b', '參加者B', eventId, { title: 'B的代訂' });
    expect(offerB.status).toBe(201);

    const detailA = await json<{
      offer: {
        viewer: { canOrder: boolean; canManagePreorder: boolean };
      };
    }>(`/api/preorders/${offerId}`, {
      headers: await authHeaders('U-cap-org', '主揪A'),
    });
    expect(detailA.body.offer.viewer.canManagePreorder).toBe(true);
    expect(detailA.body.offer.viewer.canOrder).toBe(true);

    const orderA = await json(`/api/preorders/${offerId}/my-order`, {
      method: 'PUT',
      headers: await authHeaders('U-cap-org', '主揪A'),
      body: JSON.stringify({ items: [{ productId, quantity: 1 }] }),
    });
    expect(orderA.status).toBe(200);

    const unreg = await json<{
      canCreatePreorder: boolean;
      preorderRestrictionReason: string | null;
    }>(`/api/events/${eventId}/preorders`, {
      headers: await authHeaders('U-cap-stranger', '未報名'),
    });
    expect(unreg.body.canCreatePreorder).toBe(false);
    expect(unreg.body.preorderRestrictionReason).toContain('尚未報名');

    await env.DB
      .prepare(
        `UPDATE registrations
         SET status = 'WAITLIST'
         WHERE event_id = ? AND participant_line_user_id = ?`,
      )
      .bind(eventId, 'U-cap-b')
      .run();
    const waitlistOrder = await json<{ error: string }>(
      `/api/preorders/${offerId}/my-order`,
      {
        method: 'PUT',
        headers: await authHeaders('U-cap-b', '參加者B'),
        body: JSON.stringify({ items: [{ productId, quantity: 1 }] }),
      },
    );
    expect(waitlistOrder.status).toBe(403);
    expect(waitlistOrder.body.error).toBe('FORBIDDEN');

    const unregisteredOrder = await json<{ error: string }>(
      `/api/preorders/${offerId}/my-order`,
      {
        method: 'PUT',
        headers: await authHeaders('U-cap-stranger', '未報名'),
        body: JSON.stringify({ items: [{ productId, quantity: 1 }] }),
      },
    );
    expect(unregisteredOrder.status).toBe(403);
    expect(unregisteredOrder.body.error).toBe('FORBIDDEN');
  });

  it('matches SELF by participant_line_user_id when line_user_id differs', async () => {
    const created = await createEvent('U-match-org', '主揪', { capacity: 3 });
    const eventId = created.body.event.eventId;
    await join('U-match-org', '主揪', eventId);
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO registrations (
        registration_id, event_id, type, status, waitlist_position,
        participant_name, line_user_id, created_by_line_user_id,
        created_by_display_name, created_at, updated_at,
        registration_source, participant_line_user_id
      ) VALUES (?, ?, 'SELF', 'CONFIRMED', NULL, ?, ?, ?, ?, ?, ?, 'ORGANIZER_PRESELECT', ?)`,
    )
      .bind(
        'reg-participant-only',
        eventId,
        '參加者',
        'U-legacy-line',
        'U-match-org',
        '主揪',
        now,
        now,
        'U-real-participant',
      )
      .run();

    const list = await json<{ canCreatePreorder: boolean }>(`/api/events/${eventId}/preorders`, {
      headers: await authHeaders('U-real-participant', '參加者'),
    });
    expect(list.status).toBe(200);
    expect(list.body.canCreatePreorder).toBe(true);

    const createdOffer = await createOffer('U-real-participant', '參加者', eventId, {
      title: 'participant-id 代訂',
    });
    expect(createdOffer.status).toBe(201);
  });

  it('uses the same canonical participant identity for event and preorder eligibility', async () => {
    const created = await createEvent('U-canonical-org', '主揪', { capacity: 3 });
    const eventId = created.body.event.eventId;
    const now = new Date().toISOString();
    await env.DB
      .prepare(
        `INSERT INTO registrations (
          registration_id, event_id, type, status, waitlist_position,
          participant_name, line_user_id, created_by_line_user_id,
          created_by_display_name, created_at, updated_at,
          registration_source, participant_line_user_id
        ) VALUES (?, ?, 'SELF', 'CONFIRMED', NULL, ?, ?, ?, ?, ?, ?, 'ORGANIZER_PRESELECT', ?)`,
      )
      .bind(
        'reg-canonical-mismatch',
        eventId,
        '真正參加者',
        'U-legacy-viewer',
        'U-canonical-org',
        '主揪',
        now,
        now,
        'U-actual-participant',
      )
      .run();

    const eventForLegacy = await json<{
      event: { viewer: { selfRegistration: unknown | null } };
    }>(`/api/events/${eventId}`, {
      headers: await authHeaders('U-legacy-viewer', '舊欄位帳號'),
    });
    expect(eventForLegacy.status).toBe(200);
    expect(eventForLegacy.body.event.viewer.selfRegistration).toBeNull();
    const preorderForLegacy = await json<{
      canCreatePreorder: boolean;
      preorderRestrictionReason: string | null;
    }>(`/api/events/${eventId}/preorders`, {
      headers: await authHeaders('U-legacy-viewer', '舊欄位帳號'),
    });
    expect(preorderForLegacy.body.canCreatePreorder).toBe(false);
    expect(preorderForLegacy.body.preorderRestrictionReason).toContain('尚未報名');
  });

  it('does not persist or report success when joining through the wrong group context', async () => {
    const created = await createEvent('U-join-fail-org', '主揪', { capacity: 3 });
    const eventId = created.body.event.eventId;
    const failed = await json<{ error: string }>(`/api/events/${eventId}/join`, {
      method: 'POST',
      headers: await authHeaders('U-join-fail-b', '參加者B', 'G-other'),
    });
    expect(failed.status).toBe(404);
    expect(failed.body.error).toBe('event_not_found');
    const stored = await env.DB
      .prepare(
        `SELECT COUNT(*) AS count
         FROM registrations
         WHERE event_id = ? AND participant_line_user_id = ?`,
      )
      .bind(eventId, 'U-join-fail-b')
      .first<{ count: number }>();
    expect(stored?.count).toBe(0);
  });
});

describe('preorder MVP', () => {
  it('confirmed registrant can create offer; waitlist/proxy/unregistered cannot', async () => {
    const created = await createEvent('U-org', '主揪', { capacity: 3 });
    const eventId = created.body.event.eventId;
    await join('U-org', '主揪', eventId);
    await join('U-a', '正式A', eventId);

    // Fill remaining then waitlist
    await join('U-b', '正式B', eventId);
    await join('U-wait', '候補', eventId);

    const ok = await createOffer('U-a', '正式A', eventId);
    expect(ok.status).toBe(201);
    expect(ok.body.offer.offerId).toBeTruthy();

    const noReg = await createOffer('U-stranger', '路人', eventId);
    expect(noReg.status).toBe(403);

    const wait = await createOffer('U-wait', '候補', eventId);
    expect(wait.status).toBe(403);

    await json(`/api/events/${eventId}/proxy-join`, {
      method: 'POST',
      headers: await authHeaders('U-a', '正式A'),
      body: JSON.stringify({ participantName: '代報小明' }),
    });
    // Proxy registrant has no LINE id — creator already confirmed; stranger still blocked.
    const proxyCreatorAlreadyHas = await createOffer('U-a', '正式A', eventId, {
      title: '第二個代訂',
    });
    expect(proxyCreatorAlreadyHas.status).toBe(201);
  });

  it('multiple providers can create offers on the same event', async () => {
    const created = await createEvent('U-org2', '主揪2', { capacity: 5 });
    const eventId = created.body.event.eventId;
    await join('U-org2', '主揪2', eventId);
    await join('U-p1', '代訂一', eventId);
    await join('U-p2', '代訂二', eventId);

    const a = await createOffer('U-p1', '代訂一', eventId, { title: '飲料' });
    const b = await createOffer('U-p2', '代訂二', eventId, { title: '便當' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const list = await json<{ offers: Array<{ title: string }> }>(`/api/events/${eventId}/preorders`, {
      headers: await authHeaders('U-p1', '代訂一'),
    });
    expect(list.body.offers).toHaveLength(2);
  });

  it('only confirmed registrants can order; cross-group denied; non-provider cannot manage', async () => {
    const created = await createEvent('U-org3', '主揪3', { capacity: 4 });
    const eventId = created.body.event.eventId;
    await join('U-org3', '主揪3', eventId);
    await join('U-provider', '代訂者', eventId);
    await join('U-buyer', '買家', eventId);

    const offer = await createOffer('U-provider', '代訂者', eventId);
    const offerId = offer.body.offer.offerId;
    const productId = offer.body.offer.products[0].productId;

    const orderOk = await json(`/api/preorders/${offerId}/my-order`, {
      method: 'PUT',
      headers: {
        ...(await authHeaders('U-buyer', '買家')),
        'Idempotency-Key': 'key-1',
      },
      body: JSON.stringify({ items: [{ productId, quantity: 1 }] }),
    });
    expect(orderOk.status).toBe(200);

    const stranger = await json(`/api/preorders/${offerId}/my-order`, {
      method: 'PUT',
      headers: await authHeaders('U-stranger2', '路人'),
      body: JSON.stringify({ items: [{ productId, quantity: 1 }] }),
    });
    expect(stranger.status).toBe(403);

    const otherGroup = await signLiffContext(env.LIFF_CONTEXT_SIGNING_SECRET, 'G-other');
    const cross = await json(`/api/preorders/${offerId}`, {
      headers: {
        Authorization: 'Bearer test:U-buyer:買家',
        'Content-Type': 'application/json',
        'X-JoyIn-Context': otherGroup,
      },
    });
    expect(cross.status).toBe(404);

    const manageDenied = await json(`/api/preorders/${offerId}/summary`, {
      headers: await authHeaders('U-buyer', '買家'),
    });
    expect(manageDenied.status).toBe(403);
  });

  it('rejects order after deadline and after event end; recalculates total with price snapshot', async () => {
    const created = await createEvent('U-org4', '主揪4', { capacity: 4 });
    const eventId = created.body.event.eventId;
    await join('U-org4', '主揪4', eventId);
    await join('U-prov4', '代訂4', eventId);
    await join('U-buy4', '買4', eventId);

    const offer = await createOffer('U-prov4', '代訂4', eventId, {
      products: [{ name: '咖啡', unitPrice: 80, quantityLimit: 10, isActive: true }],
    });
    const offerId = offer.body.offer.offerId;
    const productId = offer.body.offer.products[0].productId;

    const ordered = await json<{ order: { totalAmount: number; items: Array<{ unitPriceSnapshot: number }> } }>(
      `/api/preorders/${offerId}/my-order`,
      {
        method: 'PUT',
        headers: await authHeaders('U-buy4', '買4'),
        body: JSON.stringify({ items: [{ productId, quantity: 2 }] }),
      },
    );
    expect(ordered.status).toBe(200);
    expect(ordered.body.order.totalAmount).toBe(160);
    expect(ordered.body.order.items[0].unitPriceSnapshot).toBe(80);

    // Change price — existing order amount must stay
    await json(`/api/preorders/${offerId}/products/${productId}`, {
      method: 'PATCH',
      headers: await authHeaders('U-prov4', '代訂4'),
      body: JSON.stringify({ name: '咖啡', unitPrice: 100, isActive: true }),
    });
    const mine = await json<{ order: { totalAmount: number; items: Array<{ unitPriceSnapshot: number }> } }>(
      `/api/preorders/${offerId}/my-order`,
      { headers: await authHeaders('U-buy4', '買4') },
    );
    expect(mine.body.order.totalAmount).toBe(160);
    expect(mine.body.order.items[0].unitPriceSnapshot).toBe(80);

    // Force deadline passed
    await env.DB.prepare(`UPDATE preorder_offers SET order_deadline = ? WHERE offer_id = ?`)
      .bind('2020-01-01T00:00:00.000Z', offerId)
      .run();
    const afterDeadline = await json(`/api/preorders/${offerId}/my-order`, {
      method: 'PUT',
      headers: await authHeaders('U-buy4', '買4'),
      body: JSON.stringify({ items: [{ productId, quantity: 1 }] }),
    });
    expect(afterDeadline.status).toBe(409);

    // Event ended
    await env.DB.prepare(`UPDATE events SET end_at = ?, event_at = ?, start_at = ? WHERE event_id = ?`)
      .bind(
        '2020-01-02T00:00:00.000Z',
        '2020-01-02T00:00:00.000Z',
        '2020-01-01T00:00:00.000Z',
        eventId,
      )
      .run();
    await env.DB.prepare(`UPDATE preorder_offers SET order_deadline = ? WHERE offer_id = ?`)
      .bind(deadlineIso(1), offerId)
      .run();
    const afterEnd = await json(`/api/preorders/${offerId}/my-order`, {
      method: 'PUT',
      headers: await authHeaders('U-buy4', '買4'),
      body: JSON.stringify({ items: [{ productId, quantity: 1 }] }),
    });
    expect([409, 410]).toContain(afterEnd.status);
  });

  it('prevents oversell under concurrent orders and duplicate idempotent creates', async () => {
    const created = await createEvent('U-org5', '主揪5', { capacity: 6 });
    const eventId = created.body.event.eventId;
    await join('U-org5', '主揪5', eventId);
    await join('U-prov5', '代訂5', eventId);
    await join('U-b1', '買一', eventId);
    await join('U-b2', '買二', eventId);

    const offer = await createOffer('U-prov5', '代訂5', eventId, {
      products: [{ name: '限量杯', unitPrice: 50, quantityLimit: 3, isActive: true }],
    });
    const offerId = offer.body.offer.offerId;
    const productId = offer.body.offer.products[0].productId;

    const [r1, r2] = await Promise.all([
      json(`/api/preorders/${offerId}/my-order`, {
        method: 'PUT',
        headers: await authHeaders('U-b1', '買一'),
        body: JSON.stringify({ items: [{ productId, quantity: 2 }] }),
      }),
      json(`/api/preorders/${offerId}/my-order`, {
        method: 'PUT',
        headers: await authHeaders('U-b2', '買二'),
        body: JSON.stringify({ items: [{ productId, quantity: 2 }] }),
      }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const first = await json<{ order: { orderId: string } }>(`/api/preorders/${offerId}/my-order`, {
      method: 'PUT',
      headers: {
        ...(await authHeaders('U-b1', '買一')),
        'Idempotency-Key': 'same-key',
      },
      body: JSON.stringify({ items: [{ productId, quantity: 1 }] }),
    });
    // May be update of existing — clear by using buyer without order: U-org5
    const idem1 = await json<{ order: { orderId: string } }>(`/api/preorders/${offerId}/my-order`, {
      method: 'PUT',
      headers: {
        ...(await authHeaders('U-org5', '主揪5')),
        'Idempotency-Key': 'dup-key',
      },
      body: JSON.stringify({ items: [{ productId, quantity: 1 }] }),
    });
    const idem2 = await json<{ order: { orderId: string } }>(`/api/preorders/${offerId}/my-order`, {
      method: 'PUT',
      headers: {
        ...(await authHeaders('U-org5', '主揪5')),
        'Idempotency-Key': 'dup-key',
      },
      body: JSON.stringify({ items: [{ productId, quantity: 1 }] }),
    });
    expect(idem1.status).toBe(200);
    expect(idem2.status).toBe(200);
    expect(idem1.body.order.orderId).toBe(idem2.body.order.orderId);
    void first;
  });

  it('checks concurrent stock using the total across option combinations', async () => {
    const created = await createEvent('U-cart-org', '購物車主揪', { capacity: 6 });
    const eventId = created.body.event.eventId;
    for (const [userId, name] of [
      ['U-cart-org', '購物車主揪'],
      ['U-cart-provider', '購物車代訂'],
      ['U-cart-a', '購物車買家A'],
      ['U-cart-b', '購物車買家B'],
    ]) {
      await join(userId, name, eventId);
    }
    const offer = await createOffer('U-cart-provider', '購物車代訂', eventId, {
      products: [
        {
          name: '紅茶',
          unitPrice: 30,
          quantityLimit: 3,
          isActive: true,
          optionGroups: [
            {
              name: '糖度',
              type: 'SINGLE',
              isRequired: true,
              minSelections: 1,
              maxSelections: 1,
              values: [
                { name: '無糖', priceAdjustment: 0 },
                { name: '微糖', priceAdjustment: 0 },
              ],
            },
          ],
        },
      ],
    });
    const offerId = offer.body.offer.offerId;
    const detail = await json<{
      offer: {
        products: Array<{
          productId: string;
          optionGroups: Array<{
            optionGroupId: string;
            values: Array<{ optionValueId: string }>;
          }>;
        }>;
      };
    }>(`/api/preorders/${offerId}`, {
      headers: await authHeaders('U-cart-a', '購物車買家A'),
    });
    const product = detail.body.offer.products[0];
    const sugar = product.optionGroups[0];
    const cartPayload = {
      items: sugar.values.map((value) => ({
        productId: product.productId,
        quantity: 1,
        options: [
          {
            optionGroupId: sugar.optionGroupId,
            optionValueIds: [value.optionValueId],
          },
        ],
      })),
    };
    const [a, b] = await Promise.all([
      json(`/api/preorders/${offerId}/my-order`, {
        method: 'PUT',
        headers: await authHeaders('U-cart-a', '購物車買家A'),
        body: JSON.stringify(cartPayload),
      }),
      json(`/api/preorders/${offerId}/my-order`, {
        method: 'PUT',
        headers: await authHeaders('U-cart-b', '購物車買家B'),
        body: JSON.stringify(cartPayload),
      }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const stored = await env.DB
      .prepare('SELECT ordered_quantity FROM preorder_products WHERE product_id = ?')
      .bind(product.productId)
      .first<{ ordered_quantity: number }>();
    expect(stored?.ordered_quantity).toBe(2);
  });

  it('buyer sees only own order; provider sees all + summary; payment transitions; confirmed cannot self-cancel', async () => {
    const created = await createEvent('U-org6', '主揪6', { capacity: 5 });
    const eventId = created.body.event.eventId;
    await join('U-org6', '主揪6', eventId);
    await join('U-prov6', '代訂6', eventId);
    await join('U-buy6', '買6', eventId);
    await join('U-other6', '其他6', eventId);

    const offer = await createOffer('U-prov6', '代訂6', eventId);
    const offerId = offer.body.offer.offerId;
    const productId = offer.body.offer.products[0].productId;

    const put = await json<{ order: { orderId: string; status: string } }>(
      `/api/preorders/${offerId}/my-order`,
      {
        method: 'PUT',
        headers: await authHeaders('U-buy6', '買6'),
        body: JSON.stringify({ items: [{ productId, quantity: 1 }] }),
      },
    );
    expect(put.body.order.status).toBe('PENDING_PAYMENT');

    const otherMine = await json<{ order: null; cancelledOrders: unknown[] }>(
      `/api/preorders/${offerId}/my-order`,
      {
        headers: await authHeaders('U-other6', '其他6'),
      },
    );
    expect(otherMine.body.order).toBeNull();
    expect(otherMine.body.cancelledOrders).toEqual([]);

    const allDenied = await json(`/api/preorders/${offerId}/orders`, {
      headers: await authHeaders('U-other6', '其他6'),
    });
    expect(allDenied.status).toBe(403);

    const summary = await json<{ summary: { orderCount: number; totalReceivable: number } }>(
      `/api/preorders/${offerId}/summary`,
      { headers: await authHeaders('U-prov6', '代訂6') },
    );
    expect(summary.status).toBe(200);
    expect(summary.body.summary.orderCount).toBe(1);
    expect(summary.body.summary.totalReceivable).toBe(60);

    const reported = await json<{ order: { status: string } }>(
      `/api/preorders/${offerId}/my-order/report-payment`,
      { method: 'POST', headers: await authHeaders('U-buy6', '買6') },
    );
    expect(reported.body.order.status).toBe('PAYMENT_REPORTED');

    const confirmed = await json<{ order: { status: string } }>(
      `/api/preorders/${offerId}/orders/${put.body.order.orderId}/confirm-payment`,
      { method: 'POST', headers: await authHeaders('U-prov6', '代訂6') },
    );
    expect(confirmed.body.order.status).toBe('PAYMENT_CONFIRMED');

    const selfCancel = await json(`/api/preorders/${offerId}/my-order/cancel`, {
      method: 'POST',
      headers: await authHeaders('U-buy6', '買6'),
      body: JSON.stringify({ reason: '不想要了' }),
    });
    expect(selfCancel.status).toBe(409);

    const fulfilled = await json<{ order: { status: string } }>(
      `/api/preorders/${offerId}/orders/${put.body.order.orderId}/fulfill`,
      { method: 'POST', headers: await authHeaders('U-prov6', '代訂6') },
    );
    expect(fulfilled.body.order.status).toBe('FULFILLED');
  });

  it('blocks registration cancel when payment confirmed; cancels pending orders otherwise', async () => {
    const created = await createEvent('U-org7', '主揪7', { capacity: 5 });
    const eventId = created.body.event.eventId;
    await join('U-org7', '主揪7', eventId);
    await join('U-prov7', '代訂7', eventId);
    await join('U-buy7', '買7', eventId);

    const offer = await createOffer('U-prov7', '代訂7', eventId);
    const offerId = offer.body.offer.offerId;
    const productId = offer.body.offer.products[0].productId;

    const put = await json<{ order: { orderId: string } }>(`/api/preorders/${offerId}/my-order`, {
      method: 'PUT',
      headers: await authHeaders('U-buy7', '買7'),
      body: JSON.stringify({ items: [{ productId, quantity: 1 }] }),
    });
    await json(`/api/preorders/${offerId}/orders/${put.body.order.orderId}/confirm-payment`, {
      method: 'POST',
      headers: await authHeaders('U-prov7', '代訂7'),
    });

    const detail = await json<{
      event: { viewer: { selfRegistration: { registrationId: string } } };
    }>(`/api/events/${eventId}`, { headers: await authHeaders('U-buy7', '買7') });
    const cancelBlocked = await json(
      `/api/registrations/${detail.body.event.viewer.selfRegistration.registrationId}`,
      { method: 'DELETE', headers: await authHeaders('U-buy7', '買7') },
    );
    expect(cancelBlocked.status).toBe(409);

    // Provider with open orders cannot cancel registration
    const provDetail = await json<{
      event: { viewer: { selfRegistration: { registrationId: string } } };
    }>(`/api/events/${eventId}`, { headers: await authHeaders('U-prov7', '代訂7') });
    const provCancel = await json(
      `/api/registrations/${provDetail.body.event.viewer.selfRegistration.registrationId}`,
      { method: 'DELETE', headers: await authHeaders('U-prov7', '代訂7') },
    );
    expect(provCancel.status).toBe(409);
  });

  it('copy event does not copy preorders; transfer organizer does not transfer provider', async () => {
    const created = await createEvent('U-org8', '主揪8', { capacity: 5 });
    const eventId = created.body.event.eventId;
    await join('U-org8', '主揪8', eventId);
    await join('U-prov8', '代訂8', eventId);
    await join('U-recv8', '接手8', eventId);

    const offer = await createOffer('U-prov8', '代訂8', eventId, { title: '不該被複製' });
    expect(offer.status).toBe(201);

    const copied = await json<{ event: { eventId: string } }>(`/api/events/${eventId}/copy`, {
      method: 'POST',
      headers: await authHeaders('U-org8', '主揪8'),
      body: JSON.stringify({
        name: '複製活動',
        ...futureRange(20),
        address: '台北',
        capacity: 5,
        waitlistEnabled: true,
      }),
    });
    expect(copied.status).toBe(201);
    await join('U-org8', '主揪8', copied.body.event.eventId);
    const listCopied = await json<{ offers: unknown[] }>(
      `/api/events/${copied.body.event.eventId}/preorders`,
      { headers: await authHeaders('U-org8', '主揪8') },
    );
    expect(listCopied.body.offers).toHaveLength(0);

    const invite = await json<{ invite: { token: string } }>(
      `/api/events/${eventId}/transfer-invites`,
      { method: 'POST', headers: await authHeaders('U-org8', '主揪8') },
    );
    await json(`/api/transfer-invites/${invite.body.invite.token}/accept`, {
      method: 'POST',
      headers: await authHeaders('U-recv8', '接手8'),
    });

    const detail = await json<{ offer: { providerLineUserId: string; providerDisplayName: string } }>(
      `/api/preorders/${offer.body.offer.offerId}`,
      { headers: await authHeaders('U-prov8', '代訂8') },
    );
    expect(detail.body.offer.providerLineUserId).toBe('U-prov8');
  });

  it('rejects non-https payment url and past/late deadlines', async () => {
    const created = await createEvent('U-org9', '主揪9', { capacity: 3 });
    const eventId = created.body.event.eventId;
    await join('U-org9', '主揪9', eventId);

    const httpUrl = await createOffer('U-org9', '主揪9', eventId, {
      paymentUrl: 'http://example.com/pay',
    });
    expect(httpUrl.status).toBe(400);

    const past = await createOffer('U-org9', '主揪9', eventId, {
      orderDeadline: '2020-01-01T00:00:00.000Z',
    });
    expect(past.status).toBe(400);

    const late = await createOffer('U-org9', '主揪9', eventId, {
      orderDeadline: new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(late.status).toBe(400);
  });
});

describe('preorder smoke against existing flows', () => {
  it('event create/join/list still works with preorder migration present', async () => {
    const created = await createEvent('U-smoke', '煙霧', { capacity: 2 });
    expect(created.status).toBe(201);
    const joined = await join('U-smoke', '煙霧', created.body.event.eventId);
    expect(joined.status).toBe(201);
    const list = await json<{ events: unknown[] }>('/api/events', {
      headers: await authHeaders('U-smoke', '煙霧'),
    });
    expect(list.status).toBe(200);
    expect(list.body.events.length).toBeGreaterThan(0);
    void request;
  });
});
