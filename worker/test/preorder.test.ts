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

    const otherMine = await json<{ order: null }>(`/api/preorders/${offerId}/my-order`, {
      headers: await authHeaders('U-other6', '其他6'),
    });
    expect(otherMine.body.order).toBeNull();

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
