import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { authHeaders, createEvent, json } from './helpers';
import {
  applyPreorderCancelBatch,
  buildCancelOrderStatements,
  type CancelOrderBatchInput,
  type PreorderOrderRow,
} from '../src/db/preorder-repo';
import { newId } from '../src/lib/ids';

async function join(userId: string, name: string, eventId: string) {
  return json(`/api/events/${eventId}/join`, {
    method: 'POST',
    headers: await authHeaders(userId, name),
  });
}

function deadlineIso(hoursAhead = 24) {
  return new Date(Date.now() + hoursAhead * 60 * 60 * 1000).toISOString();
}

async function createOffer(userId: string, name: string, eventId: string) {
  return json<{ offer: { offerId: string; products: Array<{ productId: string }> } }>(
    `/api/events/${eventId}/preorders`,
    {
      method: 'POST',
      headers: await authHeaders(userId, name),
      body: JSON.stringify({
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
            quantityLimit: 10,
            sortOrder: 0,
            isActive: true,
          },
        ],
      }),
    },
  );
}

type SettlementHistory = {
  historyId: string;
  fromStatus: string | null;
  toStatus: string;
  actorLineUserId: string;
  actorDisplayName: string;
  note: string | null;
  createdAt: string;
};

type Settlement = {
  settlementId: string;
  orderId: string;
  offerId: string;
  status: string;
  sourceOrderStatus: string;
  latestNote: string | null;
  settledReportedAt: string | null;
  settledReportedByLineUserId: string | null;
  settledReportedByDisplayName: string | null;
  createdByLineUserId: string;
  createdByDisplayName: string;
  createdAt: string;
  updatedAt: string;
  history: SettlementHistory[];
};

type OrderBody = {
  orderId: string;
  status: string;
  totalAmount?: number;
  cancellationReason?: string | null;
  items?: Array<{ productId: string; quantity: number; subtotal: number }>;
  paymentSettlement: Settlement | null;
};

type MyOrderBody = {
  order: OrderBody | null;
  cancelledOrders: OrderBody[];
};

function actors(suffix: string) {
  return {
    org: { id: `U-set-org-${suffix}`, name: `主揪${suffix}` },
    prov: { id: `U-set-prov-${suffix}`, name: `代訂${suffix}` },
    buy: { id: `U-set-buy-${suffix}`, name: `買${suffix}` },
    other: { id: `U-set-other-${suffix}`, name: `其他${suffix}` },
  };
}

async function setupOffer(suffix: string) {
  const users = actors(suffix);
  const created = await createEvent(users.org.id, users.org.name, { capacity: 8 });
  const eventId = created.body.event.eventId;
  await join(users.org.id, users.org.name, eventId);
  await join(users.prov.id, users.prov.name, eventId);
  await join(users.buy.id, users.buy.name, eventId);
  await join(users.other.id, users.other.name, eventId);
  const offer = await createOffer(users.prov.id, users.prov.name, eventId);
  return {
    eventId,
    offerId: offer.body.offer.offerId,
    productId: offer.body.offer.products[0].productId,
    users,
  };
}

async function putOrder(offerId: string, productId: string, userId: string, name: string) {
  return json<{ order: OrderBody }>(`/api/preorders/${offerId}/my-order`, {
    method: 'PUT',
    headers: await authHeaders(userId, name),
    body: JSON.stringify({ items: [{ productId, quantity: 1 }] }),
  });
}

async function reportPayment(offerId: string, userId: string, name: string) {
  return json<{ order: OrderBody }>(`/api/preorders/${offerId}/my-order/report-payment`, {
    method: 'POST',
    headers: await authHeaders(userId, name),
  });
}

async function confirmPayment(
  offerId: string,
  orderId: string,
  userId: string,
  name: string,
) {
  return json<{ order: OrderBody }>(
    `/api/preorders/${offerId}/orders/${orderId}/confirm-payment`,
    { method: 'POST', headers: await authHeaders(userId, name) },
  );
}

async function providerCancel(
  offerId: string,
  orderId: string,
  reason: string,
  userId: string,
  name: string,
) {
  return json<{ order: OrderBody; error?: string; message?: string }>(
    `/api/preorders/${offerId}/orders/${orderId}/cancel`,
    {
      method: 'POST',
      headers: await authHeaders(userId, name),
      body: JSON.stringify({ reason }),
    },
  );
}

async function reportHandled(
  offerId: string,
  orderId: string,
  note: string,
  userId: string,
  name: string,
) {
  return json<{ order: OrderBody; error?: string; message?: string }>(
    `/api/preorders/${offerId}/orders/${orderId}/settlement/report-handled`,
    {
      method: 'POST',
      headers: await authHeaders(userId, name),
      body: JSON.stringify({ note }),
    },
  );
}

async function fulfillOrder(offerId: string, orderId: string, userId: string, name: string) {
  return json<{ order: OrderBody; message?: string }>(
    `/api/preorders/${offerId}/orders/${orderId}/fulfill`,
    { method: 'POST', headers: await authHeaders(userId, name) },
  );
}

async function productQuantity(productId: string): Promise<number> {
  const row = await env.DB
    .prepare('SELECT ordered_quantity AS qty FROM preorder_products WHERE product_id = ?')
    .bind(productId)
    .first<{ qty: number }>();
  return Number(row?.qty ?? 0);
}

async function orderRow(orderId: string): Promise<PreorderOrderRow> {
  const row = await env.DB
    .prepare('SELECT * FROM preorder_orders WHERE order_id = ?')
    .bind(orderId)
    .first<PreorderOrderRow>();
  if (!row) throw new Error(`missing order ${orderId}`);
  return row;
}

async function orderItemRows(orderId: string) {
  const { results } = await env.DB
    .prepare('SELECT product_id, quantity FROM preorder_order_items WHERE order_id = ?')
    .bind(orderId)
    .all<{ product_id: string; quantity: number }>();
  return results ?? [];
}

function cancelBatchInput(
  order: PreorderOrderRow,
  items: Array<{ product_id: string; quantity: number }>,
  reason: string,
): CancelOrderBatchInput {
  const updatedAt = new Date().toISOString();
  return {
    order,
    items,
    cancellationReason: reason,
    actorLineUserId: order.buyer_line_user_id,
    actorDisplayName: order.buyer_display_name,
    historyNote: reason,
    updatedAt,
    orderHistoryId: newId(),
    settlementId: newId(),
    settlementHistoryId: newId(),
  };
}

async function settlementCount(orderId: string): Promise<number> {
  const row = await env.DB
    .prepare('SELECT COUNT(*) AS count FROM preorder_payment_settlements WHERE order_id = ?')
    .bind(orderId)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

describe('preorder payment settlements', () => {
  it('duplicate provider cancel is 409 and keeps one settlement', async () => {
    const { offerId, productId, users } = await setupOffer('dup-cancel');
    const put = await putOrder(offerId, productId, users.buy.id, users.buy.name);
    await reportPayment(offerId, users.buy.id, users.buy.name);
    const first = await providerCancel(
      offerId,
      put.body.order.orderId,
      '貨源不足',
      users.prov.id,
      users.prov.name,
    );
    expect(first.status).toBe(200);
    expect(first.body.order.status).toBe('CANCELLED');
    expect(first.body.order.paymentSettlement?.status).toBe('AWAITING_RECEIPT_CHECK');
    expect(first.body.order.paymentSettlement?.sourceOrderStatus).toBe('PAYMENT_REPORTED');

    const second = await providerCancel(
      offerId,
      put.body.order.orderId,
      '再取消一次',
      users.prov.id,
      users.prov.name,
    );
    expect(second.status).toBe(409);
    expect(second.body.message).toBe('訂單已取消');
    expect(await settlementCount(put.body.order.orderId)).toBe(1);
  });

  it('duplicate report-handled is 409', async () => {
    const { offerId, productId, users } = await setupOffer('dup-report');
    const put = await putOrder(offerId, productId, users.buy.id, users.buy.name);
    await reportPayment(offerId, users.buy.id, users.buy.name);
    await confirmPayment(offerId, put.body.order.orderId, users.prov.id, users.prov.name);
    const cancelled = await providerCancel(
      offerId,
      put.body.order.orderId,
      '改由其他店處理',
      users.prov.id,
      users.prov.name,
    );
    expect(cancelled.body.order.paymentSettlement?.status).toBe('REFUND_PENDING');

    const first = await reportHandled(
      offerId,
      put.body.order.orderId,
      '已與買家退款完成',
      users.prov.id,
      users.prov.name,
    );
    expect(first.status).toBe(200);
    expect(first.body.order.paymentSettlement?.status).toBe('PROVIDER_REPORTED_SETTLED');
    expect(first.body.order.paymentSettlement?.latestNote).toBe('已與買家退款完成');
    expect(first.body.order.paymentSettlement?.settledReportedByLineUserId).toBe(users.prov.id);

    const second = await reportHandled(
      offerId,
      put.body.order.orderId,
      '再回報一次',
      users.prov.id,
      users.prov.name,
    );
    expect(second.status).toBe(409);
    expect(second.body.message).toBe('已回報處理，無需重複回報');
  });

  it('permissions isolate report-handled, provider cancel, and cancelledOrders', async () => {
    const { offerId, productId, users } = await setupOffer('perm');
    const put = await putOrder(offerId, productId, users.buy.id, users.buy.name);
    await reportPayment(offerId, users.buy.id, users.buy.name);
    await providerCancel(offerId, put.body.order.orderId, '無法出貨', users.prov.id, users.prov.name);

    const buyerReport = await reportHandled(
      offerId,
      put.body.order.orderId,
      '買家自己回報',
      users.buy.id,
      users.buy.name,
    );
    expect(buyerReport.status).toBe(403);
    expect(buyerReport.body.message).toBe('無權管理此代訂');

    const otherCancel = await json<{ message?: string }>(
      `/api/preorders/${offerId}/orders/${put.body.order.orderId}/cancel`,
      {
        method: 'POST',
        headers: await authHeaders(users.other.id, users.other.name),
        body: JSON.stringify({ reason: '不是代訂者' }),
      },
    );
    expect(otherCancel.status).toBe(403);
    expect(otherCancel.body.message).toBe('無權管理此代訂');

    const otherMine = await json<MyOrderBody>(`/api/preorders/${offerId}/my-order`, {
      headers: await authHeaders(users.other.id, users.other.name),
    });
    expect(otherMine.status).toBe(200);
    expect(otherMine.body.order).toBeNull();
    expect(otherMine.body.cancelledOrders).toEqual([]);

    const buyerMine = await json<MyOrderBody>(`/api/preorders/${offerId}/my-order`, {
      headers: await authHeaders(users.buy.id, users.buy.name),
    });
    expect(buyerMine.body.order).toBeNull();
    expect(buyerMine.body.cancelledOrders).toHaveLength(1);
    expect(buyerMine.body.cancelledOrders[0].orderId).toBe(put.body.order.orderId);
    expect(buyerMine.body.cancelledOrders[0].paymentSettlement?.status).toBe(
      'AWAITING_RECEIPT_CHECK',
    );
  });

  it('buyer can reorder after paid cancel; GET returns new order and previous cancelled settlement', async () => {
    const { offerId, productId, users } = await setupOffer('reorder');
    const first = await putOrder(offerId, productId, users.buy.id, users.buy.name);
    await reportPayment(offerId, users.buy.id, users.buy.name);
    const cancelled = await json<{ order: OrderBody }>(`/api/preorders/${offerId}/my-order/cancel`, {
      method: 'POST',
      headers: await authHeaders(users.buy.id, users.buy.name),
      body: JSON.stringify({ reason: '先改訂別的' }),
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.order.paymentSettlement?.status).toBe('AWAITING_RECEIPT_CHECK');

    const reorder = await putOrder(offerId, productId, users.buy.id, users.buy.name);
    expect(reorder.status).toBe(200);
    expect(reorder.body.order.orderId).not.toBe(first.body.order.orderId);
    expect(reorder.body.order.status).toBe('PENDING_PAYMENT');
    expect(reorder.body.order.paymentSettlement).toBeNull();

    const mine = await json<MyOrderBody>(`/api/preorders/${offerId}/my-order`, {
      headers: await authHeaders(users.buy.id, users.buy.name),
    });
    expect(mine.status).toBe(200);
    expect(mine.body.order?.orderId).toBe(reorder.body.order.orderId);
    expect(mine.body.cancelledOrders).toHaveLength(1);
    expect(mine.body.cancelledOrders[0].orderId).toBe(first.body.order.orderId);
    expect(mine.body.cancelledOrders[0].paymentSettlement?.status).toBe('AWAITING_RECEIPT_CHECK');
    expect(mine.body.cancelledOrders[0].paymentSettlement?.sourceOrderStatus).toBe(
      'PAYMENT_REPORTED',
    );
  });

  it('create + report-handled writes two history rows with actors, timestamps, and notes', async () => {
    const { offerId, productId, users } = await setupOffer('history');
    const put = await putOrder(offerId, productId, users.buy.id, users.buy.name);
    await reportPayment(offerId, users.buy.id, users.buy.name);
    await confirmPayment(offerId, put.body.order.orderId, users.prov.id, users.prov.name);

    const cancelled = await providerCancel(
      offerId,
      put.body.order.orderId,
      '店家缺貨需退款',
      users.prov.id,
      users.prov.name,
    );
    const created = cancelled.body.order.paymentSettlement;
    expect(created?.status).toBe('REFUND_PENDING');
    expect(created?.sourceOrderStatus).toBe('PAYMENT_CONFIRMED');
    expect(created?.history).toHaveLength(1);
    expect(created?.history[0]).toMatchObject({
      fromStatus: null,
      toStatus: 'REFUND_PENDING',
      actorLineUserId: users.prov.id,
      actorDisplayName: users.prov.name,
      note: '店家缺貨需退款',
    });
    expect(created?.history[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const handled = await reportHandled(
      offerId,
      put.body.order.orderId,
      '已私下退款給買家',
      users.prov.id,
      users.prov.name,
    );
    const settlement = handled.body.order.paymentSettlement;
    expect(settlement?.status).toBe('PROVIDER_REPORTED_SETTLED');
    expect(settlement?.latestNote).toBe('已私下退款給買家');
    expect(settlement?.settledReportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(settlement?.settledReportedByLineUserId).toBe(users.prov.id);
    expect(settlement?.settledReportedByDisplayName).toBe(users.prov.name);
    expect(settlement?.history).toHaveLength(2);
    expect(settlement?.history[1]).toMatchObject({
      fromStatus: 'REFUND_PENDING',
      toStatus: 'PROVIDER_REPORTED_SETTLED',
      actorLineUserId: users.prov.id,
      actorDisplayName: users.prov.name,
      note: '已私下退款給買家',
    });
    expect(settlement?.history[1].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('provider cancel PAYMENT_REPORTED vs PAYMENT_CONFIRMED sets different settlement statuses', async () => {
    const { eventId, offerId, productId, users } = await setupOffer('src-status');
    const buy2 = { id: 'U-set-buy2-src', name: '買S2' };
    await join(buy2.id, buy2.name, eventId);

    const reported = await putOrder(offerId, productId, users.buy.id, users.buy.name);
    await reportPayment(offerId, users.buy.id, users.buy.name);
    const reportedCancel = await providerCancel(
      offerId,
      reported.body.order.orderId,
      '先取消回報款',
      users.prov.id,
      users.prov.name,
    );
    expect(reportedCancel.body.order.paymentSettlement).toMatchObject({
      status: 'AWAITING_RECEIPT_CHECK',
      sourceOrderStatus: 'PAYMENT_REPORTED',
    });

    const confirmed = await putOrder(offerId, productId, buy2.id, buy2.name);
    await reportPayment(offerId, buy2.id, buy2.name);
    await confirmPayment(offerId, confirmed.body.order.orderId, users.prov.id, users.prov.name);
    const confirmedCancel = await providerCancel(
      offerId,
      confirmed.body.order.orderId,
      '確認收款後取消',
      users.prov.id,
      users.prov.name,
    );
    expect(confirmedCancel.body.order.paymentSettlement).toMatchObject({
      status: 'REFUND_PENDING',
      sourceOrderStatus: 'PAYMENT_CONFIRMED',
    });
  });

  it('buyer self-cancel PAYMENT_REPORTED creates AWAITING_RECEIPT_CHECK; confirmed self-cancel is 409 with no settlement', async () => {
    const { eventId, offerId, productId, users } = await setupOffer('self-cancel');
    const buy3 = { id: 'U-set-buy3-self', name: '買S3' };
    await join(buy3.id, buy3.name, eventId);

    const reported = await putOrder(offerId, productId, users.buy.id, users.buy.name);
    await reportPayment(offerId, users.buy.id, users.buy.name);
    const selfCancel = await json<{ order: OrderBody }>(`/api/preorders/${offerId}/my-order/cancel`, {
      method: 'POST',
      headers: await authHeaders(users.buy.id, users.buy.name),
      body: JSON.stringify({ reason: '我不買了' }),
    });
    expect(selfCancel.status).toBe(200);
    expect(selfCancel.body.order.paymentSettlement).toMatchObject({
      status: 'AWAITING_RECEIPT_CHECK',
      sourceOrderStatus: 'PAYMENT_REPORTED',
      createdByLineUserId: users.buy.id,
      createdByDisplayName: users.buy.name,
    });
    expect(selfCancel.body.order.paymentSettlement?.history[0]).toMatchObject({
      fromStatus: null,
      toStatus: 'AWAITING_RECEIPT_CHECK',
      actorLineUserId: users.buy.id,
      actorDisplayName: users.buy.name,
      note: '我不買了',
    });

    const confirmed = await putOrder(offerId, productId, buy3.id, buy3.name);
    await reportPayment(offerId, buy3.id, buy3.name);
    await confirmPayment(offerId, confirmed.body.order.orderId, users.prov.id, users.prov.name);
    const blocked = await json<{ message?: string }>(`/api/preorders/${offerId}/my-order/cancel`, {
      method: 'POST',
      headers: await authHeaders(buy3.id, buy3.name),
      body: JSON.stringify({ reason: '想取消已確認款' }),
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toContain('已確認付款不可自行取消');
    expect(await settlementCount(confirmed.body.order.orderId)).toBe(0);
  });

  it('registration cancel of PAYMENT_REPORTED creates settlement history; pending has none', async () => {
    const created = await createEvent('U-set-org-r', '主揪R', { capacity: 6 });
    const eventId = created.body.event.eventId;
    await join('U-set-org-r', '主揪R', eventId);
    await join('U-set-prov-r', '代訂R', eventId);
    await join('U-set-buy-r', '買R', eventId);
    await join('U-set-buy-p', '買P', eventId);

    const offer = await createOffer('U-set-prov-r', '代訂R', eventId);
    const offerId = offer.body.offer.offerId;
    const productId = offer.body.offer.products[0].productId;

    const reported = await json<{ order: OrderBody }>(`/api/preorders/${offerId}/my-order`, {
      method: 'PUT',
      headers: await authHeaders('U-set-buy-r', '買R'),
      body: JSON.stringify({ items: [{ productId, quantity: 1 }] }),
    });
    await json(`/api/preorders/${offerId}/my-order/report-payment`, {
      method: 'POST',
      headers: await authHeaders('U-set-buy-r', '買R'),
    });

    const pending = await json<{ order: OrderBody }>(`/api/preorders/${offerId}/my-order`, {
      method: 'PUT',
      headers: await authHeaders('U-set-buy-p', '買P'),
      body: JSON.stringify({ items: [{ productId, quantity: 1 }] }),
    });

    const detail = await json<{
      event: { viewer: { selfRegistration: { registrationId: string } } };
    }>(`/api/events/${eventId}`, { headers: await authHeaders('U-set-buy-r', '買R') });
    const cancelled = await json(
      `/api/registrations/${detail.body.event.viewer.selfRegistration.registrationId}`,
      { method: 'DELETE', headers: await authHeaders('U-set-buy-r', '買R') },
    );
    expect(cancelled.status).toBe(200);
    expect(await settlementCount(reported.body.order.orderId)).toBe(1);

    const mine = await json<MyOrderBody>(`/api/preorders/${offerId}/my-order`, {
      headers: await authHeaders('U-set-buy-r', '買R'),
    });
    expect(mine.body.order).toBeNull();
    expect(mine.body.cancelledOrders[0].paymentSettlement).toMatchObject({
      status: 'AWAITING_RECEIPT_CHECK',
      sourceOrderStatus: 'PAYMENT_REPORTED',
      createdByLineUserId: 'U-set-buy-r',
    });
    expect(mine.body.cancelledOrders[0].paymentSettlement?.history[0]).toMatchObject({
      fromStatus: null,
      toStatus: 'AWAITING_RECEIPT_CHECK',
      actorLineUserId: 'U-set-buy-r',
      note: '因取消活動報名而取消訂單',
    });

    const pendingDetail = await json<{
      event: { viewer: { selfRegistration: { registrationId: string } } };
    }>(`/api/events/${eventId}`, { headers: await authHeaders('U-set-buy-p', '買P') });
    const pendingCancel = await json(
      `/api/registrations/${pendingDetail.body.event.viewer.selfRegistration.registrationId}`,
      { method: 'DELETE', headers: await authHeaders('U-set-buy-p', '買P') },
    );
    expect(pendingCancel.status).toBe(200);
    expect(await settlementCount(pending.body.order.orderId)).toBe(0);
  });

  it('report-handled without settlement is 409; order/offer mismatch is 404', async () => {
    const { offerId, productId, users } = await setupOffer('no-settle');
    const put = await putOrder(offerId, productId, users.buy.id, users.buy.name);
    const missing = await reportHandled(
      offerId,
      put.body.order.orderId,
      '尚未取消沒有紀錄',
      users.prov.id,
      users.prov.name,
    );
    expect(missing.status).toBe(409);
    expect(missing.body.message).toBe('此訂單無需款項處理紀錄');

    const mismatch = await reportHandled(
      offerId,
      'order-does-not-exist',
      '隨便',
      users.prov.id,
      users.prov.name,
    );
    expect(mismatch.status).toBe(404);
  });

  it('reuses a consumed Idempotency-Key after paid cancel by creating a new order', async () => {
    const { offerId, productId, users } = await setupOffer('idem-reorder');
    const key = 'order-reuse-after-cancel';
    const first = await json<{ order: OrderBody }>(`/api/preorders/${offerId}/my-order`, {
      method: 'PUT',
      headers: { ...(await authHeaders(users.buy.id, users.buy.name)), 'Idempotency-Key': key },
      body: JSON.stringify({ items: [{ productId, quantity: 1 }] }),
    });
    expect(first.status).toBe(200);
    await reportPayment(offerId, users.buy.id, users.buy.name);
    const cancelled = await json(`/api/preorders/${offerId}/my-order/cancel`, {
      method: 'POST',
      headers: await authHeaders(users.buy.id, users.buy.name),
      body: JSON.stringify({ reason: '重用同一把 key' }),
    });
    expect(cancelled.status).toBe(200);

    const reorder = await json<{ order: OrderBody }>(`/api/preorders/${offerId}/my-order`, {
      method: 'PUT',
      headers: { ...(await authHeaders(users.buy.id, users.buy.name)), 'Idempotency-Key': key },
      body: JSON.stringify({ items: [{ productId, quantity: 1 }] }),
    });
    expect(reorder.status).toBe(200);
    expect(reorder.body.order.orderId).not.toBe(first.body.order.orderId);
    expect(reorder.body.order.status).toBe('PENDING_PAYMENT');

    const replay = await json<{ order: OrderBody }>(`/api/preorders/${offerId}/my-order`, {
      method: 'PUT',
      headers: { ...(await authHeaders(users.buy.id, users.buy.name)), 'Idempotency-Key': key },
      body: JSON.stringify({ items: [{ productId, quantity: 2 }] }),
    });
    expect(replay.status).toBe(200);
    expect(replay.body.order.orderId).toBe(reorder.body.order.orderId);
    const replayItems = await orderItemRows(replay.body.order.orderId);
    expect(replayItems.reduce((sum, item) => sum + Number(item.quantity), 0)).toBe(1);
  });

  it('report-handled with another group context is 404', async () => {
    const { offerId, productId, users } = await setupOffer('cross-group');
    const put = await putOrder(offerId, productId, users.buy.id, users.buy.name);
    await reportPayment(offerId, users.buy.id, users.buy.name);
    await providerCancel(
      offerId,
      put.body.order.orderId,
      '跨群測試',
      users.prov.id,
      users.prov.name,
    );
    const cross = await json<{ message?: string }>(
      `/api/preorders/${offerId}/orders/${put.body.order.orderId}/settlement/report-handled`,
      {
        method: 'POST',
        headers: await authHeaders(users.prov.id, users.prov.name, 'G-other-group'),
        body: JSON.stringify({ note: '不該成功' }),
      },
    );
    expect(cross.status).toBe(404);
  });

  it('cancels four statuses with matching settlement and inventory rules', async () => {
    const pending = await setupOffer('st-pending');
    const pendingPut = await putOrder(
      pending.offerId,
      pending.productId,
      pending.users.buy.id,
      pending.users.buy.name,
    );
    expect(await productQuantity(pending.productId)).toBe(1);
    const pendingCancel = await providerCancel(
      pending.offerId,
      pendingPut.body.order.orderId,
      '未付款取消',
      pending.users.prov.id,
      pending.users.prov.name,
    );
    expect(pendingCancel.status).toBe(200);
    expect(pendingCancel.body.order.status).toBe('CANCELLED');
    expect(pendingCancel.body.order.paymentSettlement).toBeNull();
    expect(await productQuantity(pending.productId)).toBe(0);
    expect(await settlementCount(pendingPut.body.order.orderId)).toBe(0);

    const reported = await setupOffer('st-reported');
    const reportedPut = await putOrder(
      reported.offerId,
      reported.productId,
      reported.users.buy.id,
      reported.users.buy.name,
    );
    await reportPayment(reported.offerId, reported.users.buy.id, reported.users.buy.name);
    const reportedCancel = await providerCancel(
      reported.offerId,
      reportedPut.body.order.orderId,
      '已回報取消',
      reported.users.prov.id,
      reported.users.prov.name,
    );
    expect(reportedCancel.status).toBe(200);
    expect(reportedCancel.body.order.paymentSettlement?.status).toBe('AWAITING_RECEIPT_CHECK');
    expect(reportedCancel.body.order.totalAmount).toBe(60);
    expect(reportedCancel.body.order.items).toHaveLength(1);

    const confirmed = await setupOffer('st-confirmed');
    const confirmedPut = await putOrder(
      confirmed.offerId,
      confirmed.productId,
      confirmed.users.buy.id,
      confirmed.users.buy.name,
    );
    await reportPayment(confirmed.offerId, confirmed.users.buy.id, confirmed.users.buy.name);
    await confirmPayment(
      confirmed.offerId,
      confirmedPut.body.order.orderId,
      confirmed.users.prov.id,
      confirmed.users.prov.name,
    );
    const confirmedCancel = await providerCancel(
      confirmed.offerId,
      confirmedPut.body.order.orderId,
      '已確認取消',
      confirmed.users.prov.id,
      confirmed.users.prov.name,
    );
    expect(confirmedCancel.status).toBe(200);
    expect(confirmedCancel.body.order.paymentSettlement?.status).toBe('REFUND_PENDING');

    const fulfilled = await setupOffer('st-fulfilled');
    const fulfilledPut = await putOrder(
      fulfilled.offerId,
      fulfilled.productId,
      fulfilled.users.buy.id,
      fulfilled.users.buy.name,
    );
    await reportPayment(fulfilled.offerId, fulfilled.users.buy.id, fulfilled.users.buy.name);
    await confirmPayment(
      fulfilled.offerId,
      fulfilledPut.body.order.orderId,
      fulfilled.users.prov.id,
      fulfilled.users.prov.name,
    );
    const fulfilledOk = await fulfillOrder(
      fulfilled.offerId,
      fulfilledPut.body.order.orderId,
      fulfilled.users.prov.id,
      fulfilled.users.prov.name,
    );
    expect(fulfilledOk.status).toBe(200);
    expect(await productQuantity(fulfilled.productId)).toBe(1);
    const fulfilledCancel = await providerCancel(
      fulfilled.offerId,
      fulfilledPut.body.order.orderId,
      '完成後不可取消',
      fulfilled.users.prov.id,
      fulfilled.users.prov.name,
    );
    expect(fulfilledCancel.status).toBe(409);
    expect(fulfilledCancel.body.message).toBe('已完成訂單不可取消');
    expect((await orderRow(fulfilledPut.body.order.orderId)).status).toBe('FULFILLED');
    expect(await productQuantity(fulfilled.productId)).toBe(1);
    expect(await settlementCount(fulfilledPut.body.order.orderId)).toBe(0);
  });

  it('restores inventory only once on duplicate cancel', async () => {
    const { offerId, productId, users } = await setupOffer('qty-once');
    const put = await putOrder(offerId, productId, users.buy.id, users.buy.name,);
    await reportPayment(offerId, users.buy.id, users.buy.name);
    expect(await productQuantity(productId)).toBe(1);
    const first = await providerCancel(
      offerId,
      put.body.order.orderId,
      '第一次取消',
      users.prov.id,
      users.prov.name,
    );
    expect(first.status).toBe(200);
    expect(await productQuantity(productId)).toBe(0);
    const second = await providerCancel(
      offerId,
      put.body.order.orderId,
      '第二次取消',
      users.prov.id,
      users.prov.name,
    );
    expect(second.status).toBe(409);
    expect(await productQuantity(productId)).toBe(0);
    expect(await settlementCount(put.body.order.orderId)).toBe(1);
  });

  it('rolls back the whole cancel batch when any statement fails', async () => {
    const { offerId, productId, users } = await setupOffer('batch-fail');
    const put = await putOrder(offerId, productId, users.buy.id, users.buy.name);
    await reportPayment(offerId, users.buy.id, users.buy.name);
    const order = await orderRow(put.body.order.orderId);
    const items = await orderItemRows(put.body.order.orderId);
    const input = cancelBatchInput(order, items, '強制失敗');
    const statements = buildCancelOrderStatements(env.DB, input);
    expect(statements.length).toBeGreaterThan(4);

    for (let failIndex = 0; failIndex < statements.length; failIndex += 1) {
      const beforeStatus = (await orderRow(put.body.order.orderId)).status;
      const beforeQty = await productQuantity(productId);
      const beforeSettlements = await settlementCount(put.body.order.orderId);
      const patched = statements.map((statement, index) =>
        index === failIndex
          ? env.DB.prepare(
              `INSERT INTO preorder_order_status_history (
                 history_id, order_id, from_status, to_status, changed_by_line_user_id, reason, created_at
               ) VALUES (NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
            )
          : statement,
      );
      await expect(applyPreorderCancelBatch(env.DB, patched)).rejects.toThrow();
      expect((await orderRow(put.body.order.orderId)).status).toBe(beforeStatus);
      expect(await productQuantity(productId)).toBe(beforeQty);
      expect(await settlementCount(put.body.order.orderId)).toBe(beforeSettlements);
    }

    const cancelled = await providerCancel(
      offerId,
      put.body.order.orderId,
      '失敗後仍可取消',
      users.prov.id,
      users.prov.name,
    );
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.order.status).toBe('CANCELLED');
    expect(cancelled.body.order.paymentSettlement?.status).toBe('AWAITING_RECEIPT_CHECK');
    expect(await productQuantity(productId)).toBe(0);
  });

  it('rolls back every registration-linked order when one cancel statement fails', async () => {
    const created = await createEvent('U-set-org-multi', '主揪M', { capacity: 8 });
    const eventId = created.body.event.eventId;
    await join('U-set-org-multi', '主揪M', eventId);
    await join('U-set-prov-multi', '代訂M', eventId);
    await join('U-set-buy-multi', '買M', eventId);
    const firstOffer = await createOffer('U-set-prov-multi', '代訂M', eventId);
    const secondOffer = await createOffer('U-set-prov-multi', '代訂M', eventId);
    const productA = firstOffer.body.offer.products[0].productId;
    const productB = secondOffer.body.offer.products[0].productId;
    const orderA = await putOrder(
      firstOffer.body.offer.offerId,
      productA,
      'U-set-buy-multi',
      '買M',
    );
    const orderB = await putOrder(
      secondOffer.body.offer.offerId,
      productB,
      'U-set-buy-multi',
      '買M',
    );
    await reportPayment(firstOffer.body.offer.offerId, 'U-set-buy-multi', '買M');
    await reportPayment(secondOffer.body.offer.offerId, 'U-set-buy-multi', '買M');

    const rowA = await orderRow(orderA.body.order.orderId);
    const rowB = await orderRow(orderB.body.order.orderId);
    const statements = [
      ...buildCancelOrderStatements(
        env.DB,
        cancelBatchInput(rowA, await orderItemRows(rowA.order_id), '一次取消兩張'),
      ),
      ...buildCancelOrderStatements(
        env.DB,
        cancelBatchInput(rowB, await orderItemRows(rowB.order_id), '一次取消兩張'),
      ),
    ];
    const failIndex = statements.length - 1;
    const patched = statements.map((statement, index) =>
      index === failIndex
        ? env.DB.prepare(
            `INSERT INTO preorder_order_status_history (
               history_id, order_id, from_status, to_status, changed_by_line_user_id, reason, created_at
             ) VALUES (NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
          )
        : statement,
    );
    await expect(applyPreorderCancelBatch(env.DB, patched)).rejects.toThrow();
    expect((await orderRow(orderA.body.order.orderId)).status).toBe('PAYMENT_REPORTED');
    expect((await orderRow(orderB.body.order.orderId)).status).toBe('PAYMENT_REPORTED');
    expect(await productQuantity(productA)).toBe(1);
    expect(await productQuantity(productB)).toBe(1);
    expect(await settlementCount(orderA.body.order.orderId)).toBe(0);
    expect(await settlementCount(orderB.body.order.orderId)).toBe(0);
  });

  it('registration cancel of two reported orders is all-or-nothing and maps abort to 409', async () => {
    const created = await createEvent('U-set-org-http2', '主揪H', { capacity: 8 });
    const eventId = created.body.event.eventId;
    await join('U-set-org-http2', '主揪H', eventId);
    await join('U-set-prov-http2', '代訂H', eventId);
    await join('U-set-buy-http2', '買H', eventId);
    const firstOffer = await createOffer('U-set-prov-http2', '代訂H', eventId);
    const secondOffer = await createOffer('U-set-prov-http2', '代訂H', eventId);
    const productA = firstOffer.body.offer.products[0].productId;
    const productB = secondOffer.body.offer.products[0].productId;
    const orderA = await putOrder(
      firstOffer.body.offer.offerId,
      productA,
      'U-set-buy-http2',
      '買H',
    );
    const orderB = await putOrder(
      secondOffer.body.offer.offerId,
      productB,
      'U-set-buy-http2',
      '買H',
    );
    await reportPayment(firstOffer.body.offer.offerId, 'U-set-buy-http2', '買H');
    await reportPayment(secondOffer.body.offer.offerId, 'U-set-buy-http2', '買H');

    await env.DB
      .prepare('UPDATE preorder_products SET ordered_quantity = 0 WHERE product_id = ?')
      .bind(productB)
      .run();

    const detail = await json<{
      event: { viewer: { selfRegistration: { registrationId: string } } };
    }>(`/api/events/${eventId}`, { headers: await authHeaders('U-set-buy-http2', '買H') });
    const registrationId = detail.body.event.viewer.selfRegistration.registrationId;
    const failed = await json<{ error?: string; message?: string }>(
      `/api/registrations/${registrationId}`,
      { method: 'DELETE', headers: await authHeaders('U-set-buy-http2', '買H') },
    );
    expect(failed.status).toBe(409);
    expect(failed.body.error).toBe('CONFLICT');
    expect(failed.body.message).not.toMatch(/D1|SQLITE|NOT NULL|FOREIGN KEY/i);
    expect((await orderRow(orderA.body.order.orderId)).status).toBe('PAYMENT_REPORTED');
    expect((await orderRow(orderB.body.order.orderId)).status).toBe('PAYMENT_REPORTED');
    expect(await settlementCount(orderA.body.order.orderId)).toBe(0);
    expect(await settlementCount(orderB.body.order.orderId)).toBe(0);

    const stillRegistered = await json<{
      event: { viewer: { selfRegistration: { registrationId: string } | null } };
    }>(`/api/events/${eventId}`, { headers: await authHeaders('U-set-buy-http2', '買H') });
    expect(stillRegistered.body.event.viewer.selfRegistration?.registrationId).toBe(registrationId);

    await env.DB
      .prepare('UPDATE preorder_products SET ordered_quantity = 1 WHERE product_id = ?')
      .bind(productB)
      .run();
    const cancelled = await json(
      `/api/registrations/${registrationId}`,
      { method: 'DELETE', headers: await authHeaders('U-set-buy-http2', '買H') },
    );
    expect(cancelled.status).toBe(200);
    expect((await orderRow(orderA.body.order.orderId)).status).toBe('CANCELLED');
    expect((await orderRow(orderB.body.order.orderId)).status).toBe('CANCELLED');
  });
});
