import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { Errors } from '../lib/errors';
import { handleRouteError, parseJson, requireGroupId, requireString, userOf } from '../lib/http';
import {
  errorCodeOf,
  logPreorderEvent,
  newRequestId,
  setPreorderMeta,
  type PreorderLogMeta,
} from '../lib/preorder-log';
import {
  addPreorderProduct,
  cancelMyPreorderOrder,
  cancelPreorderOffer,
  cancelPreorderOrderByProvider,
  closePreorderOffer,
  confirmPreorderPayment,
  createPreorderOffer,
  fulfillPreorderOrder,
  getMyPreorderOrder,
  getPreorderOfferDetail,
  getPreorderOfferSummary,
  listEventPreorders,
  listPreorderOrders,
  previewRegistrationCancelPreorderImpact,
  removePreorderProduct,
  reportMyPreorderPayment,
  updatePreorderOffer,
  updatePreorderProduct,
  upsertMyPreorderOrder,
} from '../services/preorders';
import type {
  CreatePreorderOfferInput,
  PreorderOrderItemInput,
  PreorderProductInput,
  UpdatePreorderOfferInput,
} from '../../../shared/types';

export const preorderRoutes = new Hono<AppEnv>();

type Handler = (c: Context<AppEnv>) => Promise<Response> | Response;

function withPreorderLog(operation: string, handler: Handler): Handler {
  return async (c) => {
    c.set('requestId', newRequestId());
    setPreorderMeta(c, { operation });
    try {
      const response = await handler(c);
      const meta: PreorderLogMeta = c.get('preorderMeta') || { operation };
      let errorCode: string | null = null;
      if (response.status >= 400) {
        try {
          const body = (await response.clone().json()) as { error?: string };
          errorCode = typeof body.error === 'string' ? body.error : null;
        } catch {
          errorCode = null;
        }
      }
      logPreorderEvent(c, response.status, meta, errorCode);
      return response;
    } catch (err) {
      const { status, body } = handleRouteError(err);
      const meta: PreorderLogMeta = c.get('preorderMeta') || { operation };
      logPreorderEvent(c, status, meta, errorCodeOf(err) || body.error);
      return c.json(body, status as 400 | 401 | 403 | 404 | 409 | 410 | 429 | 500 | 502);
    }
  };
}


function routeParam(c: Context<AppEnv>, name: string): string {
  return requireString(c.req.param(name), name, 1, 120);
}

function idempotencyKeyOf(c: { req: { header: (name: string) => string | undefined } }): string | null {
  const key = c.req.header('Idempotency-Key')?.trim();
  return key ? key.slice(0, 120) : null;
}

function parseProductInput(body: Record<string, unknown>): PreorderProductInput {
  return {
    productId: typeof body.productId === 'string' ? body.productId : undefined,
    name: requireString(body.name, '商品名稱', 1, 80),
    specification:
      body.specification == null || body.specification === ''
        ? null
        : requireString(body.specification, '規格', 1, 80),
    unitPrice: Number(body.unitPrice),
    quantityLimit:
      body.quantityLimit == null || body.quantityLimit === ''
        ? null
        : Number(body.quantityLimit),
    sortOrder: body.sortOrder == null ? undefined : Number(body.sortOrder),
    isActive: body.isActive === undefined ? true : Boolean(body.isActive),
  };
}

function parseProducts(value: unknown): PreorderProductInput[] {
  if (!Array.isArray(value)) throw Errors.validation('商品清單格式無效');
  return value.map((item) => parseProductInput(parseJson(item)));
}

function parseOrderItems(value: unknown): PreorderOrderItemInput[] {
  if (!Array.isArray(value)) throw Errors.validation('訂單商品格式無效');
  return value.map((raw) => {
    const item = parseJson<Record<string, unknown>>(raw);
    return {
      productId: requireString(item.productId, '商品', 1, 80),
      quantity: Number(item.quantity),
    };
  });
}

preorderRoutes.get(
  '/events/:eventId/preorders',
  withPreorderLog('list_event_preorders', async (c) => {
    const groupId = requireGroupId(c);
    const result = await listEventPreorders(c.env.DB, routeParam(c, 'eventId'), userOf(c), groupId);
    setPreorderMeta(c, {
      operation: 'list_event_preorders',
      offerPresent: result.offers.length > 0,
      orderPresent: result.offers.some((o) => o.myOrderStatus != null),
    });
    return c.json(result);
  }),
);

preorderRoutes.get(
  '/events/:eventId/preorder-cancel-check',
  withPreorderLog('preorder_cancel_check', async (c) => {
    const groupId = requireGroupId(c);
    await listEventPreorders(c.env.DB, routeParam(c, 'eventId'), userOf(c), groupId);
    const impact = await previewRegistrationCancelPreorderImpact(
      c.env.DB,
      routeParam(c, 'eventId'),
      userOf(c).lineUserId,
    );
    return c.json(impact);
  }),
);

preorderRoutes.post(
  '/events/:eventId/preorders',
  withPreorderLog('create_preorder_offer', async (c) => {
    const groupId = requireGroupId(c);
    const body = parseJson<Record<string, unknown>>(await c.req.json());
    const input: CreatePreorderOfferInput = {
      title: requireString(body.title, '服務名稱', 1, 50),
      merchantName: requireString(body.merchantName, '店家名稱', 1, 80),
      description: typeof body.description === 'string' ? body.description : '',
      orderDeadline: requireString(body.orderDeadline, '訂購截止時間', 10, 40),
      paymentInstructions:
        typeof body.paymentInstructions === 'string' ? body.paymentInstructions : '',
      paymentUrl: body.paymentUrl == null ? null : String(body.paymentUrl),
      products: parseProducts(body.products),
    };
    const offer = await createPreorderOffer(
      c.env.DB,
      routeParam(c, 'eventId'),
      userOf(c),
      groupId,
      input,
    );
    setPreorderMeta(c, { operation: 'create_preorder_offer', offerPresent: true, orderPresent: false });
    return c.json({ offer }, 201);
  }),
);

preorderRoutes.get(
  '/preorders/:offerId',
  withPreorderLog('get_preorder_offer', async (c) => {
    const groupId = requireGroupId(c);
    const offer = await getPreorderOfferDetail(c.env.DB, routeParam(c, 'offerId'), userOf(c), groupId);
    setPreorderMeta(c, {
      operation: 'get_preorder_offer',
      offerPresent: true,
      orderPresent: offer.myOrderStatus != null,
    });
    return c.json({ offer });
  }),
);

preorderRoutes.patch(
  '/preorders/:offerId',
  withPreorderLog('update_preorder_offer', async (c) => {
    const groupId = requireGroupId(c);
    const body = parseJson<Record<string, unknown>>(await c.req.json());
    const input: UpdatePreorderOfferInput = {};
    if (body.title !== undefined) input.title = requireString(body.title, '服務名稱', 1, 50);
    if (body.merchantName !== undefined) {
      input.merchantName = requireString(body.merchantName, '店家名稱', 1, 80);
    }
    if (body.description !== undefined) input.description = String(body.description);
    if (body.orderDeadline !== undefined) {
      input.orderDeadline = requireString(body.orderDeadline, '訂購截止時間', 10, 40);
    }
    if (body.paymentInstructions !== undefined) {
      input.paymentInstructions = String(body.paymentInstructions);
    }
    if (body.paymentUrl !== undefined) {
      input.paymentUrl = body.paymentUrl == null ? null : String(body.paymentUrl);
    }
    if (body.products !== undefined) input.products = parseProducts(body.products);
    const offer = await updatePreorderOffer(
      c.env.DB,
      routeParam(c, 'offerId'),
      userOf(c),
      groupId,
      input,
    );
    setPreorderMeta(c, { operation: 'update_preorder_offer', offerPresent: true });
    return c.json({ offer });
  }),
);

preorderRoutes.post(
  '/preorders/:offerId/close',
  withPreorderLog('close_preorder_offer', async (c) => {
    const groupId = requireGroupId(c);
    const offer = await closePreorderOffer(c.env.DB, routeParam(c, 'offerId'), userOf(c), groupId);
    setPreorderMeta(c, { operation: 'close_preorder_offer', offerPresent: true });
    return c.json({ offer });
  }),
);

preorderRoutes.post(
  '/preorders/:offerId/cancel',
  withPreorderLog('cancel_preorder_offer', async (c) => {
    const groupId = requireGroupId(c);
    const offer = await cancelPreorderOffer(c.env.DB, routeParam(c, 'offerId'), userOf(c), groupId);
    setPreorderMeta(c, { operation: 'cancel_preorder_offer', offerPresent: true });
    return c.json({ offer });
  }),
);

preorderRoutes.post(
  '/preorders/:offerId/products',
  withPreorderLog('add_preorder_product', async (c) => {
    const groupId = requireGroupId(c);
    const body = parseJson<Record<string, unknown>>(await c.req.json());
    const product = await addPreorderProduct(
      c.env.DB,
      routeParam(c, 'offerId'),
      userOf(c),
      groupId,
      parseProductInput(body),
    );
    setPreorderMeta(c, { operation: 'add_preorder_product', offerPresent: true });
    return c.json({ product }, 201);
  }),
);

preorderRoutes.patch(
  '/preorders/:offerId/products/:productId',
  withPreorderLog('update_preorder_product', async (c) => {
    const groupId = requireGroupId(c);
    const body = parseJson<Record<string, unknown>>(await c.req.json());
    const product = await updatePreorderProduct(
      c.env.DB,
      routeParam(c, 'offerId'),
      routeParam(c, 'productId'),
      userOf(c),
      groupId,
      parseProductInput(body),
    );
    setPreorderMeta(c, { operation: 'update_preorder_product', offerPresent: true });
    return c.json({ product });
  }),
);

preorderRoutes.delete(
  '/preorders/:offerId/products/:productId',
  withPreorderLog('remove_preorder_product', async (c) => {
    const groupId = requireGroupId(c);
    const result = await removePreorderProduct(
      c.env.DB,
      routeParam(c, 'offerId'),
      routeParam(c, 'productId'),
      userOf(c),
      groupId,
    );
    setPreorderMeta(c, { operation: 'remove_preorder_product', offerPresent: true });
    return c.json(result);
  }),
);

preorderRoutes.get(
  '/preorders/:offerId/orders',
  withPreorderLog('list_preorder_orders', async (c) => {
    const groupId = requireGroupId(c);
    const orders = await listPreorderOrders(c.env.DB, routeParam(c, 'offerId'), userOf(c), groupId);
    setPreorderMeta(c, {
      operation: 'list_preorder_orders',
      offerPresent: true,
      orderPresent: orders.length > 0,
    });
    return c.json({ orders });
  }),
);

preorderRoutes.get(
  '/preorders/:offerId/summary',
  withPreorderLog('get_preorder_summary', async (c) => {
    const groupId = requireGroupId(c);
    const summary = await getPreorderOfferSummary(
      c.env.DB,
      routeParam(c, 'offerId'),
      userOf(c),
      groupId,
    );
    setPreorderMeta(c, {
      operation: 'get_preorder_summary',
      offerPresent: true,
      orderPresent: summary.orderCount > 0,
    });
    return c.json({ summary });
  }),
);

preorderRoutes.put(
  '/preorders/:offerId/my-order',
  withPreorderLog('upsert_my_order', async (c) => {
    const groupId = requireGroupId(c);
    const body = parseJson<Record<string, unknown>>(await c.req.json());
    const result = await upsertMyPreorderOrder(
      c.env.DB,
      routeParam(c, 'offerId'),
      userOf(c),
      groupId,
      parseOrderItems(body.items),
      idempotencyKeyOf(c),
    );
    setPreorderMeta(c, {
      operation: 'upsert_my_order',
      offerPresent: true,
      orderPresent: true,
      idempotencyHit: result.idempotencyHit,
    });
    return c.json({ order: result.order });
  }),
);

preorderRoutes.get(
  '/preorders/:offerId/my-order',
  withPreorderLog('get_my_order', async (c) => {
    const groupId = requireGroupId(c);
    const order = await getMyPreorderOrder(c.env.DB, routeParam(c, 'offerId'), userOf(c), groupId);
    setPreorderMeta(c, {
      operation: 'get_my_order',
      offerPresent: true,
      orderPresent: order != null,
    });
    return c.json({ order });
  }),
);

preorderRoutes.post(
  '/preorders/:offerId/my-order/report-payment',
  withPreorderLog('report_my_payment', async (c) => {
    const groupId = requireGroupId(c);
    const order = await reportMyPreorderPayment(
      c.env.DB,
      routeParam(c, 'offerId'),
      userOf(c),
      groupId,
    );
    setPreorderMeta(c, { operation: 'report_my_payment', offerPresent: true, orderPresent: true });
    return c.json({ order });
  }),
);

preorderRoutes.post(
  '/preorders/:offerId/my-order/cancel',
  withPreorderLog('cancel_my_order', async (c) => {
    const groupId = requireGroupId(c);
    let reason = '';
    try {
      const body = parseJson<Record<string, unknown>>(await c.req.json());
      reason = typeof body.reason === 'string' ? body.reason : '';
    } catch {
      reason = '';
    }
    const order = await cancelMyPreorderOrder(
      c.env.DB,
      routeParam(c, 'offerId'),
      userOf(c),
      groupId,
      reason,
    );
    setPreorderMeta(c, { operation: 'cancel_my_order', offerPresent: true, orderPresent: true });
    return c.json({ order });
  }),
);

preorderRoutes.post(
  '/preorders/:offerId/orders/:orderId/confirm-payment',
  withPreorderLog('confirm_payment', async (c) => {
    const groupId = requireGroupId(c);
    const order = await confirmPreorderPayment(
      c.env.DB,
      routeParam(c, 'offerId'),
      routeParam(c, 'orderId'),
      userOf(c),
      groupId,
    );
    setPreorderMeta(c, { operation: 'confirm_payment', offerPresent: true, orderPresent: true });
    return c.json({ order });
  }),
);

preorderRoutes.post(
  '/preorders/:offerId/orders/:orderId/fulfill',
  withPreorderLog('fulfill_order', async (c) => {
    const groupId = requireGroupId(c);
    const order = await fulfillPreorderOrder(
      c.env.DB,
      routeParam(c, 'offerId'),
      routeParam(c, 'orderId'),
      userOf(c),
      groupId,
    );
    setPreorderMeta(c, { operation: 'fulfill_order', offerPresent: true, orderPresent: true });
    return c.json({ order });
  }),
);

preorderRoutes.post(
  '/preorders/:offerId/orders/:orderId/cancel',
  withPreorderLog('cancel_order_by_provider', async (c) => {
    const groupId = requireGroupId(c);
    const body = parseJson<Record<string, unknown>>(await c.req.json());
    const order = await cancelPreorderOrderByProvider(
      c.env.DB,
      routeParam(c, 'offerId'),
      routeParam(c, 'orderId'),
      userOf(c),
      groupId,
      requireString(body.reason, '取消原因', 1, 200),
    );
    setPreorderMeta(c, {
      operation: 'cancel_order_by_provider',
      offerPresent: true,
      orderPresent: true,
    });
    return c.json({ order });
  }),
);
