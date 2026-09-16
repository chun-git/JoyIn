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
  createPreorderOfferFromMenu,
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
import { checkMenuIdempotency } from '../services/menus';
import type {
  CreatePreorderOfferInput,
  CreatePreorderFromMenuInput,
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
    sourceMenuProductId:
      typeof body.sourceMenuProductId === 'string' ? body.sourceMenuProductId : null,
    name: requireString(body.name, '商品名稱', 1, 80),
    description:
      body.description == null || body.description === ''
        ? ''
        : requireString(body.description, '商品說明', 1, 500),
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
    optionGroups: parseOptionGroups(body.optionGroups),
  };
}

function parseOptionGroups(value: unknown): NonNullable<PreorderProductInput['optionGroups']> {
  if (value == null) return [];
  if (!Array.isArray(value)) throw Errors.validation('商品選項格式無效');
  return value.map((raw) => {
    const group = parseJson<Record<string, unknown>>(raw);
    const values = group.values == null ? [] : group.values;
    if (!Array.isArray(values)) throw Errors.validation('選項值格式無效');
    return {
      optionGroupId:
        typeof group.optionGroupId === 'string' ? group.optionGroupId.trim() : undefined,
      name: requireString(group.name, '選項群組名稱', 1, 60),
      type: requireString(group.type, '選項類型', 1, 20) as 'SINGLE' | 'MULTIPLE' | 'TEXT',
      isRequired: Boolean(group.isRequired),
      minSelections: group.minSelections == null ? undefined : Number(group.minSelections),
      maxSelections: group.maxSelections == null ? null : Number(group.maxSelections),
      sortOrder: group.sortOrder == null ? undefined : Number(group.sortOrder),
      values: values.map((rawValue) => {
        const option = parseJson<Record<string, unknown>>(rawValue);
        return {
          optionValueId:
            typeof option.optionValueId === 'string' ? option.optionValueId.trim() : undefined,
          name: requireString(option.name, '選項名稱', 1, 60),
          priceAdjustment: Number(option.priceAdjustment ?? 0),
          isActive: option.isActive === undefined ? true : Boolean(option.isActive),
          sortOrder: option.sortOrder == null ? undefined : Number(option.sortOrder),
        };
      }),
    };
  });
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
      options:
        item.options == null
          ? []
          : (() => {
              if (!Array.isArray(item.options)) throw Errors.validation('訂單選項格式無效');
              return item.options.map((rawOption) => {
                const option = parseJson<Record<string, unknown>>(rawOption);
                if (option.optionValueIds != null && !Array.isArray(option.optionValueIds)) {
                  throw Errors.validation('選項值格式無效');
                }
                return {
                  optionGroupId: requireString(option.optionGroupId, '選項群組', 1, 80),
                  optionValueIds: (option.optionValueIds ?? []).map((value) =>
                    requireString(value, '選項值', 1, 80),
                  ),
                  textValue:
                    option.textValue == null || option.textValue === ''
                      ? undefined
                      : requireString(option.textValue, '自由文字選項', 1, 200),
                };
              });
            })(),
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
      canCreatePreorder: result.canCreatePreorder,
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
      sharedMenuVersionId:
        typeof body.sharedMenuVersionId === 'string' ? body.sharedMenuVersionId : null,
    };
    const eventId = routeParam(c, 'eventId');
    const user = userOf(c);
    const key = idempotencyKeyOf(c);
    const scope = `create_preorder:${eventId}`;
    if (key) {
      const existing = await checkMenuIdempotency(c.env.DB, scope, user.lineUserId, key);
      if (existing) {
        const offer = await getPreorderOfferDetail(c.env.DB, existing, user, groupId);
        setPreorderMeta(c, {
          operation: 'create_preorder_offer',
          offerPresent: true,
          orderPresent: false,
          idempotencyHit: true,
        });
        return c.json({ offer });
      }
    }
    const offer = await createPreorderOffer(
      c.env.DB,
      eventId,
      user,
      groupId,
      input,
      key ? { scope, key } : null,
    );
    setPreorderMeta(c, { operation: 'create_preorder_offer', offerPresent: true, orderPresent: false });
    return c.json({ offer }, 201);
  }),
);

preorderRoutes.post(
  '/events/:eventId/preorders/from-menu',
  withPreorderLog('create_preorder_from_menu', async (c) => {
    const groupId = requireGroupId(c);
    const body = parseJson<CreatePreorderFromMenuInput>(await c.req.json());
    const eventId = routeParam(c, 'eventId');
    const user = userOf(c);
    const key = idempotencyKeyOf(c);
    const scope = `create_preorder_from_menu:${eventId}`;
    if (key) {
      const existing = await checkMenuIdempotency(c.env.DB, scope, user.lineUserId, key);
      if (existing) {
        const offer = await getPreorderOfferDetail(c.env.DB, existing, user, groupId);
        setPreorderMeta(c, {
          operation: 'create_preorder_from_menu',
          offerPresent: true,
          orderPresent: false,
          idempotencyHit: true,
        });
        return c.json({ offer });
      }
    }
    const offer = await createPreorderOfferFromMenu(
      c.env.DB,
      eventId,
      user,
      groupId,
      body,
      key ? { scope, key } : null,
    );
    setPreorderMeta(c, {
      operation: 'create_preorder_from_menu',
      offerPresent: true,
      orderPresent: false,
    });
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
      canCreatePreorder: offer.viewer.canCreatePreorder,
      canOrder: offer.viewer.canOrder,
      canManagePreorder: offer.viewer.canManagePreorder,
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
