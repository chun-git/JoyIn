import type {
  CreatePreorderOfferInput,
  CreatePreorderFromMenuInput,
  EventPreorderListResponse,
  MyPreorderOrderResponse,
  PreorderOfferDetail,
  PreorderOfferOrderSummary,
  PreorderOfferSummary,
  PreorderOrder,
  PreorderOrderItem,
  PreorderOrderItemInput,
  PreorderOrderItemOption,
  PreorderOrderStatus,
  PreorderPaymentSettlement,
  PreorderPaymentSettlementHistoryEntry,
  PreorderPaymentSettlementStatus,
  PreorderProduct,
  PreorderProductInput,
  PreorderViewerCapabilities,
  UpdatePreorderOfferInput,
} from '../../../shared/types';
import { PREORDER_PAYMENT_DISCLAIMER } from '../../../shared/types';
import type { AuthUser } from '../env';
import {
  adjustProductOrderedQuantity,
  cancelEmptyOffersForProvider,
  cancelOpenOrdersForBuyerOnEvent,
  PreorderCancelBatchConflict,
  PreorderCancelBatchTooLarge,
  countActiveOrdersForEvent,
  countActiveOrdersForEventOffersByProvider,
  countActiveOrdersForOffer,
  countActiveProducts,
  countConfirmedPaymentOrdersForEventBuyer,
  countOrderItemsForProduct,
  deactivatePreorderProduct,
  deletePreorderOrderItems,
  deletePreorderProductIfUnused,
  getActiveOrderForBuyer,
  getOrderByIdempotencyKey,
  getPreorderOffer,
  getPreorderOrder,
  getPreorderPaymentSettlementByOrderId,
  getPreorderProduct,
  insertOrderStatusHistory,
  insertPreorderOrder,
  insertPreorderOrderItem,
  insertPreorderProduct,
  cancelSingleOrderAtomic,
  reportSettlementHandledAtomic,
  listCancelledOrdersForBuyerOnOffer,
  listPreorderOffersForEvent,
  listPreorderOrderItems,
  listPreorderOrderItemsForOrders,
  listPreorderOrdersForOffer,
  listPreorderPaymentSettlementHistory,
  listPreorderProducts,
  prepareInsertPreorderProduct,
  prepareInsertPreorderOffer,
  remainingQuantity,
  setPreorderOfferStatus,
  updatePreorderOfferRow,
  updatePreorderOrderRow,
  updatePreorderProductRow,
  insertPreorderOrderItemOption,
  listPreorderOptionGroups,
  listPreorderOptionValues,
  listPreorderOrderItemOptions,
  prepareInsertPreorderOptionGroup,
  prepareInsertPreorderOptionValue,
  replacePreorderProductOptions,
  type PreorderOfferRow,
  type PreorderOptionGroupRow,
  type PreorderOptionValueRow,
  type PreorderOrderItemRow,
  type PreorderOrderRow,
  type PreorderPaymentSettlementHistoryRow,
  type PreorderPaymentSettlementRow,
  type PreorderProductRow,
} from '../db/preorder-repo';
import { findSelfRegistration } from '../db/repo';
import { Errors } from '../lib/errors';
import { isExpired, nowIso } from '../lib/datetime';
import { newId } from '../lib/ids';
import { getReadableEvent, getVisibleEvent } from './events';
import { getMenuDetail, getMenuVersion } from './menus';

function endAtOf(row: { end_at: string | null; event_at: string }): string {
  return row.end_at || row.event_at;
}

function startAtOf(row: { start_at: string | null; event_at: string }): string {
  return row.start_at || row.event_at;
}

export async function requireConfirmedSelfRegistration(
  db: D1Database,
  eventId: string,
  lineUserId: string,
): Promise<void> {
  const reg = await findSelfRegistration(db, eventId, lineUserId);
  if (!reg) {
    throw Errors.forbidden('尚未報名此活動，無法使用代訂功能');
  }
  if (reg.status === 'WAITLIST') {
    throw Errors.forbidden('候補狀態不可建立或訂購代訂');
  }
  if (reg.status !== 'CONFIRMED') {
    throw Errors.forbidden('只有正式報名的 LINE 會員可以使用代訂功能');
  }
}

/** Capability flags for UI — never derived from organizer/provider alone. */
export function resolvePreorderCapabilities(input: {
  ended: boolean;
  selfStatus: string | null | undefined;
  offerStatus?: string | null;
  orderDeadline?: string | null;
  isProvider: boolean;
  now?: Date;
}): PreorderViewerCapabilities {
  const now = input.now ?? new Date();
  let preorderRestrictionReason: string | null = null;
  let canCreatePreorder = false;
  if (input.ended) {
    preorderRestrictionReason = '活動已結束，代訂改為唯讀';
  } else if (!input.selfStatus) {
    preorderRestrictionReason = '尚未報名此活動，無法使用代訂功能';
  } else if (input.selfStatus === 'WAITLIST') {
    preorderRestrictionReason = '候補狀態不可建立或訂購代訂';
  } else if (input.selfStatus !== 'CONFIRMED') {
    preorderRestrictionReason = '只有正式報名的 LINE 會員可以使用代訂功能';
  } else {
    canCreatePreorder = true;
  }

  const canManagePreorder = input.isProvider;
  let orderRestrictionReason: string | null = null;
  let canOrder = false;
  if (input.ended) {
    orderRestrictionReason = '活動已結束，無法下單';
  } else if (!input.selfStatus) {
    orderRestrictionReason = '尚未報名此活動，無法使用代訂功能';
  } else if (input.selfStatus === 'WAITLIST') {
    orderRestrictionReason = '候補狀態不可建立或訂購代訂';
  } else if (input.selfStatus !== 'CONFIRMED') {
    orderRestrictionReason = '只有正式報名的 LINE 會員可以使用代訂功能';
  } else if (input.offerStatus === 'CANCELLED') {
    orderRestrictionReason = '代訂已取消';
  } else if (input.offerStatus === 'CLOSED') {
    orderRestrictionReason = '代訂已關閉';
  } else if (input.orderDeadline && isExpired(input.orderDeadline, now)) {
    orderRestrictionReason = '已超過訂購截止時間';
  } else if (input.offerStatus && input.offerStatus !== 'OPEN') {
    orderRestrictionReason = '代訂目前不可訂購';
  } else {
    canOrder = true;
  }

  return {
    canCreatePreorder,
    canOrder,
    canManagePreorder,
    preorderRestrictionReason,
    orderRestrictionReason,
  };
}

function assertHttpsUrl(value: string | null | undefined, field: string): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw Errors.validation(`${field}無效`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw Errors.validation(`${field}必須是有效的 HTTPS 網址`);
  }
  if (url.protocol !== 'https:') {
    throw Errors.validation(`${field}只接受 HTTPS`);
  }
  return trimmed;
}

function parseDeadline(value: string, eventStartAt: string, now = new Date()): string {
  const trimmed = (value || '').trim();
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    throw Errors.validation('訂購截止時間格式無效');
  }
  const iso = new Date(ms).toISOString();
  if (ms <= now.getTime()) {
    throw Errors.validation('訂購截止時間必須晚於現在');
  }
  if (ms > Date.parse(eventStartAt)) {
    throw Errors.validation('訂購截止時間不可晚於活動開始時間');
  }
  return iso;
}

function normalizeProducts(inputs: PreorderProductInput[]): Array<{
  productId?: string;
  sourceMenuProductId: string | null;
  name: string;
  description: string;
  specification: string | null;
  unitPrice: number;
  quantityLimit: number | null;
  sortOrder: number;
  isActive: boolean;
  optionGroups: NonNullable<PreorderProductInput['optionGroups']>;
}> {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw Errors.validation('至少需要一個商品');
  }
  return inputs.map((raw, index) => {
    const name = (raw.name || '').trim();
    if (!name || name.length > 80) throw Errors.validation('商品名稱長度需為 1 到 80 字');
    const specification =
      raw.specification == null || String(raw.specification).trim() === ''
        ? null
        : String(raw.specification).trim().slice(0, 80);
    const unitPrice = Number(raw.unitPrice);
    if (!Number.isInteger(unitPrice) || unitPrice < 0) {
      throw Errors.validation('商品單價需為大於等於 0 的整數');
    }
    let quantityLimit: number | null = null;
    if (raw.quantityLimit != null && raw.quantityLimit !== ('' as unknown)) {
      const limit = Number(raw.quantityLimit);
      if (!Number.isInteger(limit) || limit < 1) {
        throw Errors.validation('商品數量上限需為大於等於 1 的整數');
      }
      quantityLimit = limit;
    }
    return {
      productId: raw.productId?.trim() || undefined,
      sourceMenuProductId: raw.sourceMenuProductId?.trim() || null,
      name,
      description: (raw.description || '').trim().slice(0, 500),
      specification,
      unitPrice,
      quantityLimit,
      sortOrder: Number.isInteger(raw.sortOrder) ? Number(raw.sortOrder) : index,
      isActive: raw.isActive !== false,
      optionGroups: normalizePreorderOptionGroups(raw.optionGroups ?? []),
    };
  });
}

function normalizePreorderOptionGroups(
  groups: NonNullable<PreorderProductInput['optionGroups']>,
): NonNullable<PreorderProductInput['optionGroups']> {
  return groups.map((group, index) => {
    const name = group.name?.trim();
    if (!name || name.length > 60) throw Errors.validation('選項群組名稱長度需為 1 到 60 字');
    if (!['SINGLE', 'MULTIPLE', 'TEXT'].includes(group.type)) {
      throw Errors.validation(`${name}的選項類型無效`);
    }
    const values = group.type === 'TEXT' ? [] : group.values ?? [];
    if (group.type !== 'TEXT' && values.length === 0) {
      throw Errors.validation(`${name}至少需要一個選項`);
    }
    const min = group.isRequired ? Math.max(1, Number(group.minSelections ?? 1)) : 0;
    const max =
      group.type === 'TEXT'
        ? null
        : group.maxSelections == null
          ? group.type === 'SINGLE'
            ? 1
            : null
          : Number(group.maxSelections);
    if (!Number.isInteger(min) || min < 0) throw Errors.validation(`${name}最少選擇數無效`);
    if (max != null && (!Number.isInteger(max) || max < min || max < 1)) {
      throw Errors.validation(`${name}最多選擇數無效`);
    }
    if (group.type === 'SINGLE' && max !== 1) {
      throw Errors.validation(`${name}是單選，最多只能選 1 項`);
    }
    return {
      ...group,
      name,
      minSelections: min,
      maxSelections: max,
      sortOrder: Number.isInteger(group.sortOrder) ? Number(group.sortOrder) : index,
      values: values.map((value, valueIndex) => {
        const valueName = value.name?.trim();
        if (!valueName || valueName.length > 60) throw Errors.validation(`${name}的選項名稱無效`);
        const adjustment = Number(value.priceAdjustment ?? 0);
        if (!Number.isInteger(adjustment) || adjustment < 0) {
          throw Errors.validation('選項加價必須為非負整數');
        }
        return {
          ...value,
          name: valueName,
          priceAdjustment: adjustment,
          isActive: value.isActive !== false,
          sortOrder: Number.isInteger(value.sortOrder) ? Number(value.sortOrder) : valueIndex,
        };
      }),
    };
  });
}

function toProduct(
  row: PreorderProductRow,
  groups: PreorderOptionGroupRow[] = [],
  values: PreorderOptionValueRow[] = [],
): PreorderProduct {
  return {
    productId: row.product_id,
    offerId: row.offer_id,
    name: row.name,
    description: row.description || '',
    sourceMenuProductId: row.source_menu_product_id || null,
    specification: row.specification,
    unitPrice: Number(row.unit_price),
    quantityLimit: row.quantity_limit == null ? null : Number(row.quantity_limit),
    orderedQuantity: Number(row.ordered_quantity),
    remainingQuantity: remainingQuantity(row),
    sortOrder: Number(row.sort_order),
    isActive: Boolean(row.is_active),
    optionGroups: groups
      .filter((group) => group.product_id === row.product_id)
      .map((group) => ({
        optionGroupId: group.option_group_id,
        name: group.name,
        type: group.type,
        isRequired: Boolean(group.is_required),
        minSelections: Number(group.min_selections),
        maxSelections: group.max_selections == null ? null : Number(group.max_selections),
        sortOrder: Number(group.sort_order),
        values: values
          .filter((value) => value.option_group_id === group.option_group_id)
          .map((value) => ({
            optionValueId: value.option_value_id,
            name: value.name,
            priceAdjustment: Number(value.price_adjustment),
            isActive: Boolean(value.is_active),
            sortOrder: Number(value.sort_order),
          })),
      })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function hydratePreorderProducts(
  db: D1Database,
  rows: PreorderProductRow[],
): Promise<PreorderProduct[]> {
  const groups = await listPreorderOptionGroups(
    db,
    rows.map((row) => row.product_id),
  );
  const values = await listPreorderOptionValues(
    db,
    groups.map((group) => group.option_group_id),
  );
  return rows.map((row) => toProduct(row, groups, values));
}

function preorderOptionStatements(
  db: D1Database,
  productId: string,
  groups: NonNullable<PreorderProductInput['optionGroups']>,
  createdAt: string,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  for (const [groupIndex, group] of groups.entries()) {
    const groupId = newId();
    statements.push(
      prepareInsertPreorderOptionGroup(db, {
        option_group_id: groupId,
        product_id: productId,
        source_option_group_id: group.optionGroupId || null,
        name: group.name,
        type: group.type,
        is_required: group.isRequired ? 1 : 0,
        min_selections: Number(group.minSelections ?? (group.isRequired ? 1 : 0)),
        max_selections: group.maxSelections ?? (group.type === 'SINGLE' ? 1 : null),
        sort_order: group.sortOrder ?? groupIndex,
        created_at: createdAt,
      }),
    );
    for (const [valueIndex, value] of (group.values ?? []).entries()) {
      statements.push(
        prepareInsertPreorderOptionValue(db, {
          option_value_id: newId(),
          option_group_id: groupId,
          source_option_value_id: value.optionValueId || null,
          name: value.name,
          price_adjustment: Number(value.priceAdjustment),
          is_active: value.isActive === false ? 0 : 1,
          sort_order: value.sortOrder ?? valueIndex,
          created_at: createdAt,
        }),
      );
    }
  }
  return statements;
}

function preorderOptionRows(
  productId: string,
  groups: NonNullable<PreorderProductInput['optionGroups']>,
  createdAt: string,
): { groups: PreorderOptionGroupRow[]; values: PreorderOptionValueRow[] } {
  const groupRows: PreorderOptionGroupRow[] = [];
  const valueRows: PreorderOptionValueRow[] = [];
  for (const [groupIndex, group] of groups.entries()) {
    const groupId = newId();
    groupRows.push({
      option_group_id: groupId,
      product_id: productId,
      source_option_group_id: group.optionGroupId || null,
      name: group.name,
      type: group.type,
      is_required: group.isRequired ? 1 : 0,
      min_selections: Number(group.minSelections ?? (group.isRequired ? 1 : 0)),
      max_selections: group.maxSelections ?? (group.type === 'SINGLE' ? 1 : null),
      sort_order: group.sortOrder ?? groupIndex,
      created_at: createdAt,
    });
    for (const [valueIndex, value] of (group.values ?? []).entries()) {
      valueRows.push({
        option_value_id: newId(),
        option_group_id: groupId,
        source_option_value_id: value.optionValueId || null,
        name: value.name,
        price_adjustment: Number(value.priceAdjustment),
        is_active: value.isActive === false ? 0 : 1,
        sort_order: value.sortOrder ?? valueIndex,
        created_at: createdAt,
      });
    }
  }
  return { groups: groupRows, values: valueRows };
}

function toOrderItem(
  row: PreorderOrderItemRow,
  options: Awaited<ReturnType<typeof listPreorderOrderItemOptions>>,
): PreorderOrderItem {
  return {
    orderItemId: row.order_item_id,
    productId: row.product_id,
    productNameSnapshot: row.product_name_snapshot,
    specificationSnapshot: row.specification_snapshot,
    unitPriceSnapshot: Number(row.unit_price_snapshot),
    optionPriceSnapshot: Number(row.option_price_snapshot || 0),
    quantity: Number(row.quantity),
    subtotal: Number(row.subtotal),
    options: options
      .filter((option) => option.order_item_id === row.order_item_id)
      .map(
        (option): PreorderOrderItemOption => ({
          orderItemOptionId: option.order_item_option_id,
          optionGroupId: option.option_group_id,
          optionValueId: option.option_value_id,
          groupNameSnapshot: option.group_name_snapshot,
          optionNameSnapshot: option.option_name_snapshot,
          priceAdjustmentSnapshot: Number(option.price_adjustment_snapshot),
          textValueSnapshot: option.text_value_snapshot,
        }),
      ),
  };
}

function toPaymentSettlement(
  row: PreorderPaymentSettlementRow,
  historyRows: PreorderPaymentSettlementHistoryRow[],
): PreorderPaymentSettlement {
  return {
    settlementId: row.settlement_id,
    orderId: row.order_id,
    offerId: row.offer_id,
    status: row.status,
    sourceOrderStatus: row.source_order_status,
    latestNote: row.latest_note,
    settledReportedAt: row.settled_reported_at,
    settledReportedByLineUserId: row.settled_reported_by_line_user_id,
    settledReportedByDisplayName: row.settled_reported_by_display_name,
    createdByLineUserId: row.created_by_line_user_id,
    createdByDisplayName: row.created_by_display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    history: historyRows.map(
      (entry): PreorderPaymentSettlementHistoryEntry => ({
        historyId: entry.history_id,
        fromStatus: entry.from_status,
        toStatus: entry.to_status,
        actorLineUserId: entry.actor_line_user_id,
        actorDisplayName: entry.actor_display_name,
        note: entry.note,
        createdAt: entry.created_at,
      }),
    ),
  };
}

async function loadPaymentSettlement(
  db: D1Database,
  orderId: string,
): Promise<PreorderPaymentSettlement | null> {
  const row = await getPreorderPaymentSettlementByOrderId(db, orderId);
  if (!row) return null;
  const history = await listPreorderPaymentSettlementHistory(db, row.settlement_id);
  return toPaymentSettlement(row, history);
}

async function applyCancelKeepingSnapshots(
  db: D1Database,
  order: PreorderOrderRow,
  actor: { lineUserId: string; displayName: string },
  cancellationReason: string,
  historyNote: string | null,
): Promise<PreorderOrder> {
  const updatedAt = nowIso();
  const items = await listPreorderOrderItems(db, order.order_id);
  try {
    await cancelSingleOrderAtomic(db, {
      order,
      items,
      cancellationReason,
      actorLineUserId: actor.lineUserId,
      actorDisplayName: actor.displayName,
      historyNote,
      updatedAt,
    });
  } catch (error) {
    if (error instanceof PreorderCancelBatchConflict) {
      const latest = await getPreorderOrder(db, order.order_id);
      if (latest?.status === 'CANCELLED') {
        throw Errors.conflict('訂單已取消');
      }
      throw Errors.conflict('訂單狀態已變更，請重新整理後再試');
    }
    throw error;
  }
  const cancelled = await getPreorderOrder(db, order.order_id);
  if (!cancelled || cancelled.status !== 'CANCELLED') {
    throw Errors.conflict('訂單狀態已變更，請重新整理後再試');
  }
  return toOrder(db, cancelled);
}

async function toOrder(db: D1Database, row: PreorderOrderRow): Promise<PreorderOrder> {
  const items = await listPreorderOrderItems(db, row.order_id);
  const options = await listPreorderOrderItemOptions(
    db,
    items.map((item) => item.order_item_id),
  );
  return {
    orderId: row.order_id,
    offerId: row.offer_id,
    eventId: row.event_id,
    buyerLineUserId: row.buyer_line_user_id,
    buyerDisplayName: row.buyer_display_name,
    status: row.status,
    totalAmount: Number(row.total_amount),
    cancellationReason: row.cancellation_reason,
    paymentReportedAt: row.payment_reported_at,
    paymentConfirmedAt: row.payment_confirmed_at,
    fulfilledAt: row.fulfilled_at,
    items: items.map((item) => toOrderItem(item, options)),
    paymentSettlement: await loadPaymentSettlement(db, row.order_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function toOfferSummary(
  db: D1Database,
  row: PreorderOfferRow,
  viewerLineUserId: string,
): Promise<PreorderOfferSummary> {
  const productCount = await countActiveProducts(db, row.offer_id);
  const myOrder = await getActiveOrderForBuyer(db, row.offer_id, viewerLineUserId);
  return {
    offerId: row.offer_id,
    eventId: row.event_id,
    providerLineUserId: row.provider_line_user_id,
    providerDisplayName: row.provider_display_name,
    title: row.title,
    merchantName: row.merchant_name,
    description: row.description,
    orderDeadline: row.order_deadline,
    paymentInstructions: row.payment_instructions || PREORDER_PAYMENT_DISCLAIMER,
    paymentUrl: row.payment_url,
    status: row.status,
    productCount,
    myOrderStatus: myOrder?.status ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function assertOfferInGroup(
  db: D1Database,
  offerId: string,
  groupId: string,
): Promise<PreorderOfferRow> {
  const offer = await getPreorderOffer(db, offerId);
  if (!offer || offer.group_id !== groupId) {
    throw Errors.notFound('找不到代訂服務');
  }
  return offer;
}

function assertOfferWritable(offer: PreorderOfferRow, now = new Date()): void {
  if (offer.status === 'CANCELLED') throw Errors.conflict('代訂已取消');
  if (offer.status === 'CLOSED') throw Errors.conflict('代訂已關閉');
  if (isExpired(offer.order_deadline, now)) {
    throw Errors.conflict('已超過訂購截止時間');
  }
}

export async function listEventPreorders(
  db: D1Database,
  eventId: string,
  user: AuthUser,
  groupId: string,
): Promise<EventPreorderListResponse> {
  const event = await getReadableEvent(db, eventId, groupId);
  const ended = isExpired(endAtOf(event));
  const self = await findSelfRegistration(db, eventId, user.lineUserId);
  const caps = resolvePreorderCapabilities({
    ended,
    selfStatus: self?.status,
    isProvider: false,
  });
  const rows = await listPreorderOffersForEvent(db, eventId, groupId);
  const offers = await Promise.all(rows.map((row) => toOfferSummary(db, row, user.lineUserId)));
  return {
    offers,
    canCreatePreorder: caps.canCreatePreorder,
    preorderRestrictionReason: caps.preorderRestrictionReason,
  };
}

export async function createPreorderOffer(
  db: D1Database,
  eventId: string,
  user: AuthUser,
  groupId: string,
  input: CreatePreorderOfferInput,
  idempotency?: { scope: string; key: string } | null,
): Promise<PreorderOfferDetail> {
  const event = await getVisibleEvent(db, eventId, groupId);
  await requireConfirmedSelfRegistration(db, eventId, user.lineUserId);

  const title = (input.title || '').trim();
  if (!title || title.length > 50) throw Errors.validation('服務名稱長度需為 1 到 50 字');
  const merchantName = (input.merchantName || '').trim();
  if (!merchantName || merchantName.length > 80) {
    throw Errors.validation('店家名稱長度需為 1 到 80 字');
  }
  const description = (input.description || '').trim().slice(0, 500);
  const paymentInstructions =
    (input.paymentInstructions || '').trim().slice(0, 500) || PREORDER_PAYMENT_DISCLAIMER;
  const paymentUrl = assertHttpsUrl(input.paymentUrl, '付款連結');
  const orderDeadline = parseDeadline(input.orderDeadline, startAtOf(event));
  const products = normalizeProducts(input.products);

  const createdAt = nowIso();
  const offerId = newId();
  const offerRow: PreorderOfferRow = {
    offer_id: offerId,
    event_id: eventId,
    group_id: groupId,
    provider_line_user_id: user.lineUserId,
    provider_display_name: user.displayName,
    title,
    merchant_name: merchantName,
    description,
    order_deadline: orderDeadline,
    payment_instructions: paymentInstructions,
    payment_url: paymentUrl,
    shared_menu_version_id: input.sharedMenuVersionId || null,
    status: 'OPEN',
    created_at: createdAt,
    updated_at: createdAt,
  };

  const statements: D1PreparedStatement[] = [
    ...(idempotency
      ? [
          db
            .prepare(
              `INSERT INTO menu_idempotency_keys
               (scope, line_user_id, idempotency_key, resource_id, created_at)
               VALUES (?, ?, ?, ?, ?)`,
            )
            .bind(
              idempotency.scope,
              user.lineUserId,
              idempotency.key,
              offerId,
              createdAt,
            ),
        ]
      : []),
    prepareInsertPreorderOffer(db, offerRow),
  ];
  for (const [index, product] of products.entries()) {
    const productId = newId();
    statements.push(
      prepareInsertPreorderProduct(db, {
      product_id: productId,
      offer_id: offerId,
      name: product.name,
      description: product.description,
      source_menu_product_id: product.sourceMenuProductId,
      specification: product.specification,
      unit_price: product.unitPrice,
      quantity_limit: product.quantityLimit,
      ordered_quantity: 0,
      sort_order: product.sortOrder ?? index,
      is_active: product.isActive ? 1 : 0,
      created_at: createdAt,
      updated_at: createdAt,
      }),
      ...preorderOptionStatements(db, productId, product.optionGroups, createdAt),
    );
  }
  await db.batch(statements);

  return getPreorderOfferDetail(db, offerId, user, groupId);
}

export async function createPreorderOfferFromMenu(
  db: D1Database,
  eventId: string,
  user: AuthUser,
  groupId: string,
  input: CreatePreorderFromMenuInput,
  idempotency?: { scope: string; key: string } | null,
): Promise<PreorderOfferDetail> {
  const detail = await getMenuDetail(db, input.menuId);
  if (
    detail.menu.status !== 'PUBLISHED' ||
    detail.menu.currentVersionId !== input.menuVersionId
  ) {
    throw Errors.conflict('共用菜單版本已更新或停用，請重新選擇');
  }
  const version = await getMenuVersion(db, input.menuId, input.menuVersionId);
  if (version.status !== 'PUBLISHED') throw Errors.conflict('只能使用已發布的共用菜單');
  const selectedIds = new Set(input.selectedMenuProductIds ?? []);
  const selected = version.products.filter(
    (product) => product.isActive && selectedIds.has(product.menuProductId),
  );
  if (selected.length === 0 || selected.length !== selectedIds.size) {
    throw Errors.validation('請選擇有效的共用菜單商品');
  }
  return createPreorderOffer(db, eventId, user, groupId, {
    title: input.title,
    merchantName: version.merchantName,
    description: input.description,
    orderDeadline: input.orderDeadline,
    paymentInstructions: input.paymentInstructions,
    paymentUrl: input.paymentUrl,
    sharedMenuVersionId: version.versionId,
    products: selected.map((product) => ({
      name: product.name,
      description: product.description,
      sourceMenuProductId: product.menuProductId,
      unitPrice: product.basePrice,
      quantityLimit: input.quantityLimits?.[product.menuProductId] ?? null,
      isActive: true,
      sortOrder: product.sortOrder,
      optionGroups: product.optionGroups.map((group) => ({
        optionGroupId: group.optionGroupId,
        name: group.name,
        type: group.type,
        isRequired: group.isRequired,
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
        sortOrder: group.sortOrder,
        values: group.values.map((value) => ({
          optionValueId: value.optionValueId,
          name: value.name,
          priceAdjustment: value.priceAdjustment,
          isActive: value.isActive,
          sortOrder: value.sortOrder,
        })),
      })),
    })),
  }, idempotency);
}

export async function getPreorderOfferDetail(
  db: D1Database,
  offerId: string,
  user: AuthUser,
  groupId: string,
): Promise<PreorderOfferDetail> {
  const offer = await assertOfferInGroup(db, offerId, groupId);
  const event = await getReadableEvent(db, offer.event_id, groupId);
  const ended = isExpired(endAtOf(event));
  const self = await findSelfRegistration(db, offer.event_id, user.lineUserId);
  const summary = await toOfferSummary(db, offer, user.lineUserId);
  const products = await hydratePreorderProducts(db, await listPreorderProducts(db, offerId));
  const viewer = resolvePreorderCapabilities({
    ended,
    selfStatus: self?.status,
    offerStatus: offer.status,
    orderDeadline: offer.order_deadline,
    isProvider: offer.provider_line_user_id === user.lineUserId,
  });
  return {
    ...summary,
    products: viewer.canManagePreorder ? products : products.filter((p) => p.isActive),
    viewer,
  };
}

export async function updatePreorderOffer(
  db: D1Database,
  offerId: string,
  user: AuthUser,
  groupId: string,
  input: UpdatePreorderOfferInput,
): Promise<PreorderOfferDetail> {
  const offer = await assertOfferInGroup(db, offerId, groupId);
  if (offer.provider_line_user_id !== user.lineUserId) {
    throw Errors.forbidden('無權管理此代訂');
  }
  if (offer.status === 'CANCELLED') throw Errors.conflict('代訂服務已取消');
  const event = await getReadableEvent(db, offer.event_id, groupId);
  if (isExpired(endAtOf(event))) throw Errors.eventEnded('活動已結束，代訂改為唯讀');

  const updatedAt = nowIso();
  const title = input.title != null ? input.title.trim() : offer.title;
  const merchantName = input.merchantName != null ? input.merchantName.trim() : offer.merchant_name;
  if (!title || title.length > 50) throw Errors.validation('服務名稱長度需為 1 到 50 字');
  if (!merchantName || merchantName.length > 80) {
    throw Errors.validation('店家名稱長度需為 1 到 80 字');
  }
  const description =
    input.description != null ? input.description.trim().slice(0, 500) : offer.description;
  const paymentInstructions =
    input.paymentInstructions != null
      ? input.paymentInstructions.trim().slice(0, 500) || PREORDER_PAYMENT_DISCLAIMER
      : offer.payment_instructions;
  const paymentUrl =
    input.paymentUrl !== undefined
      ? assertHttpsUrl(input.paymentUrl, '付款連結')
      : offer.payment_url;
  const orderDeadline =
    input.orderDeadline != null
      ? parseDeadline(input.orderDeadline, startAtOf(event))
      : offer.order_deadline;

  await updatePreorderOfferRow(db, offerId, {
    title,
    merchantName,
    description,
    orderDeadline,
    paymentInstructions,
    paymentUrl,
    updatedAt,
  });

  if (input.products) {
    const products = normalizeProducts(input.products);
    const existing = await listPreorderProducts(db, offerId);
    const existingById = new Map(existing.map((p) => [p.product_id, p]));
    const seen = new Set<string>();
    for (const [index, product] of products.entries()) {
      if (product.productId && existingById.has(product.productId)) {
        seen.add(product.productId);
        const current = existingById.get(product.productId)!;
        if (
          product.quantityLimit != null &&
          product.quantityLimit < Number(current.ordered_quantity)
        ) {
          throw Errors.validation('商品數量上限不可小於已訂數量');
        }
        await updatePreorderProductRow(db, product.productId, {
          name: product.name,
          description: product.description,
          specification: product.specification,
          unitPrice: product.unitPrice,
          quantityLimit: product.quantityLimit,
          sortOrder: product.sortOrder ?? index,
          isActive: product.isActive,
          updatedAt,
        });
        const optionRows = preorderOptionRows(product.productId, product.optionGroups, updatedAt);
        await replacePreorderProductOptions(
          db,
          product.productId,
          optionRows.groups,
          optionRows.values,
        );
      } else {
        const productId = newId();
        await insertPreorderProduct(db, {
          product_id: productId,
          offer_id: offerId,
          name: product.name,
          description: product.description,
          source_menu_product_id: product.sourceMenuProductId,
          specification: product.specification,
          unit_price: product.unitPrice,
          quantity_limit: product.quantityLimit,
          ordered_quantity: 0,
          sort_order: product.sortOrder ?? index,
          is_active: product.isActive ? 1 : 0,
          created_at: updatedAt,
          updated_at: updatedAt,
        });
        const optionRows = preorderOptionRows(productId, product.optionGroups, updatedAt);
        await replacePreorderProductOptions(db, productId, optionRows.groups, optionRows.values);
      }
    }
    for (const row of existing) {
      if (!seen.has(row.product_id)) {
        const used = await countOrderItemsForProduct(db, row.product_id);
        if (used > 0) {
          await deactivatePreorderProduct(db, row.product_id, updatedAt);
        } else {
          await deletePreorderProductIfUnused(db, row.product_id);
        }
      }
    }
  }

  return getPreorderOfferDetail(db, offerId, user, groupId);
}

export async function closePreorderOffer(
  db: D1Database,
  offerId: string,
  user: AuthUser,
  groupId: string,
): Promise<PreorderOfferDetail> {
  const offer = await assertOfferInGroup(db, offerId, groupId);
  if (offer.provider_line_user_id !== user.lineUserId) {
    throw Errors.forbidden('無權管理此代訂');
  }
  await setPreorderOfferStatus(db, offerId, 'CLOSED', nowIso());
  return getPreorderOfferDetail(db, offerId, user, groupId);
}

export async function cancelPreorderOffer(
  db: D1Database,
  offerId: string,
  user: AuthUser,
  groupId: string,
): Promise<PreorderOfferDetail> {
  const offer = await assertOfferInGroup(db, offerId, groupId);
  if (offer.provider_line_user_id !== user.lineUserId) {
    throw Errors.forbidden('無權管理此代訂');
  }
  const active = await countActiveOrdersForOffer(db, offerId);
  if (active > 0) {
    throw Errors.conflict('仍有有效訂單，請先處理訂單後再取消代訂');
  }
  await setPreorderOfferStatus(db, offerId, 'CANCELLED', nowIso());
  return getPreorderOfferDetail(db, offerId, user, groupId);
}

export async function addPreorderProduct(
  db: D1Database,
  offerId: string,
  user: AuthUser,
  groupId: string,
  input: PreorderProductInput,
): Promise<PreorderProduct> {
  const offer = await assertOfferInGroup(db, offerId, groupId);
  if (offer.provider_line_user_id !== user.lineUserId) {
    throw Errors.forbidden('無權管理此代訂');
  }
  const [product] = normalizeProducts([input]);
  const createdAt = nowIso();
  const productId = newId();
  await insertPreorderProduct(db, {
    product_id: productId,
    offer_id: offerId,
    name: product.name,
    description: product.description,
    source_menu_product_id: product.sourceMenuProductId,
    specification: product.specification,
    unit_price: product.unitPrice,
    quantity_limit: product.quantityLimit,
    ordered_quantity: 0,
    sort_order: product.sortOrder,
    is_active: product.isActive ? 1 : 0,
    created_at: createdAt,
    updated_at: createdAt,
  });
  const optionRows = preorderOptionRows(productId, product.optionGroups, createdAt);
  await replacePreorderProductOptions(db, productId, optionRows.groups, optionRows.values);
  const row = await getPreorderProduct(db, productId);
  if (!row) throw Errors.notFound('新增商品失敗');
  return (await hydratePreorderProducts(db, [row]))[0];
}

export async function updatePreorderProduct(
  db: D1Database,
  offerId: string,
  productId: string,
  user: AuthUser,
  groupId: string,
  input: PreorderProductInput,
): Promise<PreorderProduct> {
  const offer = await assertOfferInGroup(db, offerId, groupId);
  if (offer.provider_line_user_id !== user.lineUserId) {
    throw Errors.forbidden('無權管理此代訂');
  }
  const existing = await getPreorderProduct(db, productId);
  if (!existing || existing.offer_id !== offerId) throw Errors.notFound('找不到商品');
  const [product] = normalizeProducts([{ ...input, productId }]);
  if (product.quantityLimit != null && product.quantityLimit < Number(existing.ordered_quantity)) {
    throw Errors.validation('商品數量上限不可小於已訂數量');
  }
  const updatedAt = nowIso();
  await updatePreorderProductRow(db, productId, {
    name: product.name,
    description: product.description,
    specification: product.specification,
    unitPrice: product.unitPrice,
    quantityLimit: product.quantityLimit,
    sortOrder: product.sortOrder,
    isActive: product.isActive,
    updatedAt,
  });
  const optionRows = preorderOptionRows(productId, product.optionGroups, updatedAt);
  await replacePreorderProductOptions(db, productId, optionRows.groups, optionRows.values);
  const row = await getPreorderProduct(db, productId);
  if (!row) throw Errors.notFound('更新商品失敗');
  return (await hydratePreorderProducts(db, [row]))[0];
}

export async function removePreorderProduct(
  db: D1Database,
  offerId: string,
  productId: string,
  user: AuthUser,
  groupId: string,
): Promise<{ deactivated: boolean }> {
  const offer = await assertOfferInGroup(db, offerId, groupId);
  if (offer.provider_line_user_id !== user.lineUserId) {
    throw Errors.forbidden('無權管理此代訂');
  }
  const existing = await getPreorderProduct(db, productId);
  if (!existing || existing.offer_id !== offerId) throw Errors.notFound('找不到商品');
  const used = await countOrderItemsForProduct(db, productId);
  if (used > 0) {
    await deactivatePreorderProduct(db, productId, nowIso());
    return { deactivated: true };
  }
  await deletePreorderProductIfUnused(db, productId);
  return { deactivated: false };
}

function buildOrderLines(
  items: PreorderOrderItemInput[],
  products: PreorderProductRow[],
  previousItems: PreorderOrderItemRow[],
  optionGroups: PreorderOptionGroupRow[],
  optionValues: PreorderOptionValueRow[],
  previousOptions: Awaited<ReturnType<typeof listPreorderOrderItemOptions>>,
): Array<{
  productId: string;
  quantity: number;
  name: string;
  specification: string | null;
  unitPrice: number;
  optionPrice: number;
  subtotal: number;
  options: Array<{
    optionGroupId: string;
    optionValueId: string | null;
    groupName: string;
    optionName: string;
    priceAdjustment: number;
    textValue: string | null;
  }>;
}> {
  if (!Array.isArray(items) || items.length === 0) {
    throw Errors.validation('請至少選擇一項商品');
  }
  const productById = new Map(products.map((p) => [p.product_id, p]));
  const previousOptionsByItem = new Map<
    string,
    Awaited<ReturnType<typeof listPreorderOrderItemOptions>>
  >();
  for (const option of previousOptions) {
    const itemOptions = previousOptionsByItem.get(option.order_item_id) ?? [];
    itemOptions.push(option);
    previousOptionsByItem.set(option.order_item_id, itemOptions);
  }
  const combinationKey = (
    productId: string,
    options: Array<{
      optionGroupId: string;
      optionValueId: string | null;
      textValue: string | null;
    }>,
  ) =>
    `${productId}|${options
      .map((option) =>
        option.optionValueId
          ? `${option.optionGroupId}:v:${option.optionValueId}`
          : `${option.optionGroupId}:t:${option.textValue ?? ''}`,
      )
      .sort()
      .join('|')}`;
  const previousByCombination = new Map<string, PreorderOrderItemRow>();
  for (const item of previousItems) {
    previousByCombination.set(
      combinationKey(
        item.product_id,
        (previousOptionsByItem.get(item.order_item_id) ?? []).map((option) => ({
          optionGroupId: option.option_group_id,
          optionValueId: option.option_value_id,
          textValue: option.text_value_snapshot,
        })),
      ),
      item,
    );
  }
  const normalizedItems: PreorderOrderItemInput[] = [];
  for (const item of items) {
    const productId = (item.productId || '').trim();
    const quantity = Number(item.quantity);
    if (!productId) throw Errors.validation('商品無效');
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw Errors.validation('下單數量必須為正整數');
    }
    normalizedItems.push({ ...item, productId, quantity });
  }
  const lines: Array<{
    productId: string;
    quantity: number;
    name: string;
    specification: string | null;
    unitPrice: number;
    optionPrice: number;
    subtotal: number;
    options: Array<{
      optionGroupId: string;
      optionValueId: string | null;
      groupName: string;
      optionName: string;
      priceAdjustment: number;
      textValue: string | null;
    }>;
  }> = [];
  const lineByCombination = new Map<string, (typeof lines)[number]>();
  for (const item of normalizedItems) {
    const productId = item.productId;
    const quantity = Number(item.quantity);
    const product = productById.get(productId);
    if (!product || !product.is_active) {
      throw Errors.validation('部分商品已停用或不存在');
    }
    const groups = optionGroups.filter((group) => group.product_id === productId);
    const selectedByGroup = new Map<string, NonNullable<PreorderOrderItemInput['options']>[number]>();
    for (const selected of item.options ?? []) {
      if (selectedByGroup.has(selected.optionGroupId)) {
        throw Errors.validation('同一選項群組不可重複送出');
      }
      selectedByGroup.set(selected.optionGroupId, selected);
    }
    const snapshots: Array<{
      optionGroupId: string;
      optionValueId: string | null;
      groupName: string;
      optionName: string;
      priceAdjustment: number;
      textValue: string | null;
    }> = [];
    for (const group of groups) {
      const selected = selectedByGroup.get(group.option_group_id);
      if (group.type === 'TEXT') {
        const textValue = selected?.textValue?.trim().slice(0, 200) || '';
        if (group.is_required && !textValue) {
          throw Errors.validation(`${group.name}為必填`);
        }
        if (textValue) {
          snapshots.push({
            optionGroupId: group.option_group_id,
            optionValueId: null,
            groupName: group.name,
            optionName: '自由文字',
            priceAdjustment: 0,
            textValue,
          });
        }
        continue;
      }
      const valueIds = [...new Set(selected?.optionValueIds ?? [])];
      const min = Math.max(Number(group.min_selections), group.is_required ? 1 : 0);
      const max = group.type === 'SINGLE' ? 1 : group.max_selections;
      if (valueIds.length < min) throw Errors.validation(`${group.name}至少選擇 ${min} 項`);
      if (max != null && valueIds.length > Number(max)) {
        throw Errors.validation(`${group.name}最多選擇 ${max} 項`);
      }
      for (const valueId of valueIds) {
        const value = optionValues.find(
          (candidate) =>
            candidate.option_group_id === group.option_group_id &&
            candidate.option_value_id === valueId &&
            candidate.is_active,
        );
        if (!value) throw Errors.validation(`${group.name}包含無效或已停用的選項`);
        snapshots.push({
          optionGroupId: group.option_group_id,
          optionValueId: value.option_value_id,
          groupName: group.name,
          optionName: value.name,
          priceAdjustment: Number(value.price_adjustment),
          textValue: null,
        });
      }
    }
    for (const selectedGroupId of selectedByGroup.keys()) {
      if (!groups.some((group) => group.option_group_id === selectedGroupId)) {
        throw Errors.validation('包含不存在的商品選項');
      }
    }
    const key = combinationKey(productId, snapshots);
    const prev = previousByCombination.get(key);
    if (prev) {
      const oldOptions = previousOptionsByItem.get(prev.order_item_id) ?? [];
      for (const snapshot of snapshots) {
        const old = oldOptions.find(
          (candidate) =>
            candidate.option_group_id === snapshot.optionGroupId &&
            candidate.option_value_id === snapshot.optionValueId &&
            (candidate.text_value_snapshot ?? '') === (snapshot.textValue ?? ''),
        );
        if (old) {
          snapshot.groupName = old.group_name_snapshot;
          snapshot.optionName = old.option_name_snapshot;
          snapshot.priceAdjustment = Number(old.price_adjustment_snapshot);
        }
      }
    }
    const unitPrice = prev ? Number(prev.unit_price_snapshot) : Number(product.unit_price);
    const name = prev ? prev.product_name_snapshot : product.name;
    const specification = prev ? prev.specification_snapshot : product.specification;
    const optionPrice = snapshots.reduce((sum, option) => sum + option.priceAdjustment, 0);
    const duplicate = lineByCombination.get(key);
    if (duplicate) {
      duplicate.quantity += quantity;
      duplicate.subtotal = (duplicate.unitPrice + duplicate.optionPrice) * duplicate.quantity;
      continue;
    }
    const line = {
      productId,
      quantity,
      name,
      specification,
      unitPrice,
      optionPrice,
      subtotal: (unitPrice + optionPrice) * quantity,
      options: snapshots,
    };
    lines.push(line);
    lineByCombination.set(key, line);
  }
  return lines;
}

export async function upsertMyPreorderOrder(
  db: D1Database,
  offerId: string,
  user: AuthUser,
  groupId: string,
  items: PreorderOrderItemInput[],
  idempotencyKey?: string | null,
): Promise<{ order: PreorderOrder; idempotencyHit: boolean }> {
  const offer = await assertOfferInGroup(db, offerId, groupId);
  await getVisibleEvent(db, offer.event_id, groupId);
  await requireConfirmedSelfRegistration(db, offer.event_id, user.lineUserId);
  assertOfferWritable(offer);

  const products = await listPreorderProducts(db, offerId);
  const existing = await getActiveOrderForBuyer(db, offerId, user.lineUserId);
  if (existing && !['PENDING_PAYMENT', 'PAYMENT_REPORTED'].includes(existing.status)) {
    throw Errors.conflict('訂單狀態已變更，請重新整理後再試');
  }
  if (
    idempotencyKey &&
    existing?.idempotency_key &&
    existing.idempotency_key === idempotencyKey
  ) {
    return { order: await toOrder(db, existing), idempotencyHit: true };
  }

  let insertKey = idempotencyKey?.trim() || null;
  if (insertKey) {
    const priorByKey = await getOrderByIdempotencyKey(db, offerId, user.lineUserId, insertKey);
    if (existing) {
      if (priorByKey?.status === 'CANCELLED' && priorByKey.order_id !== existing.order_id) {
        return { order: await toOrder(db, existing), idempotencyHit: true };
      }
    } else {
      if (priorByKey && priorByKey.status !== 'CANCELLED') {
        return { order: await toOrder(db, priorByKey), idempotencyHit: true };
      }
      if (priorByKey?.status === 'CANCELLED') {
        insertKey = `${insertKey}:${newId()}`;
      }
    }
  }

  const previousItems = existing ? await listPreorderOrderItems(db, existing.order_id) : [];
  const optionGroups = await listPreorderOptionGroups(
    db,
    products.map((product) => product.product_id),
  );
  const optionValues = await listPreorderOptionValues(
    db,
    optionGroups.map((group) => group.option_group_id),
  );
  const previousOptions = await listPreorderOrderItemOptions(
    db,
    previousItems.map((item) => item.order_item_id),
  );
  const lines = buildOrderLines(
    items,
    products,
    previousItems,
    optionGroups,
    optionValues,
    previousOptions,
  );
  const totalAmount = lines.reduce((sum, line) => sum + line.subtotal, 0);
  const updatedAt = nowIso();

  const sumByProduct = <T>(
    rows: T[],
    productIdOf: (row: T) => string,
    quantityOf: (row: T) => number,
  ) => {
    const totals = new Map<string, number>();
    for (const row of rows) {
      const productId = productIdOf(row);
      totals.set(productId, (totals.get(productId) ?? 0) + quantityOf(row));
    }
    return totals;
  };
  const prevQty = sumByProduct(
    previousItems,
    (item) => item.product_id,
    (item) => Number(item.quantity),
  );
  const nextQty = sumByProduct(
    lines,
    (line) => line.productId,
    (line) => line.quantity,
  );
  const allProductIds = new Set([...prevQty.keys(), ...nextQty.keys()]);
  for (const productId of allProductIds) {
    const delta = (nextQty.get(productId) || 0) - (prevQty.get(productId) || 0);
    const ok = await adjustProductOrderedQuantity(db, productId, delta, updatedAt);
    if (!ok) {
      // rollback already applied deltas
      for (const rolled of allProductIds) {
        if (rolled === productId) break;
        const d = (nextQty.get(rolled) || 0) - (prevQty.get(rolled) || 0);
        if (d !== 0) await adjustProductOrderedQuantity(db, rolled, -d, updatedAt);
      }
      throw Errors.conflict('商品數量不足，請調整後再試');
    }
  }

  let orderId = existing?.order_id;
  if (!existing) {
    orderId = newId();
    try {
      await insertPreorderOrder(db, {
        order_id: orderId,
        offer_id: offerId,
        event_id: offer.event_id,
        group_id: groupId,
        buyer_line_user_id: user.lineUserId,
        buyer_display_name: user.displayName,
        status: 'PENDING_PAYMENT',
        total_amount: totalAmount,
        cancellation_reason: null,
        payment_reported_at: null,
        payment_confirmed_at: null,
        fulfilled_at: null,
        idempotency_key: insertKey,
        created_at: updatedAt,
        updated_at: updatedAt,
      });
      await insertOrderStatusHistory(db, {
        historyId: newId(),
        orderId,
        fromStatus: null,
        toStatus: 'PENDING_PAYMENT',
        changedByLineUserId: user.lineUserId,
        reason: null,
        createdAt: updatedAt,
      });
    } catch (error) {
      for (const productId of allProductIds) {
        const delta = (nextQty.get(productId) || 0) - (prevQty.get(productId) || 0);
        if (delta !== 0) await adjustProductOrderedQuantity(db, productId, -delta, updatedAt);
      }
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('UNIQUE') || message.includes('unique')) {
        throw Errors.conflict('你在此代訂已有訂單，請重新整理');
      }
      throw error;
    }
  } else {
    await updatePreorderOrderRow(db, existing.order_id, {
      status: existing.status,
      totalAmount,
      cancellationReason: null,
      paymentReportedAt: existing.payment_reported_at,
      paymentConfirmedAt: existing.payment_confirmed_at,
      fulfilledAt: existing.fulfilled_at,
      updatedAt,
    });
    await deletePreorderOrderItems(db, existing.order_id);
  }

  for (const line of lines) {
    const orderItemId = newId();
    await insertPreorderOrderItem(db, {
      order_item_id: orderItemId,
      order_id: orderId!,
      product_id: line.productId,
      product_name_snapshot: line.name,
      specification_snapshot: line.specification,
      unit_price_snapshot: line.unitPrice,
      option_price_snapshot: line.optionPrice,
      quantity: line.quantity,
      subtotal: line.subtotal,
      created_at: updatedAt,
    });
    for (const option of line.options) {
      await insertPreorderOrderItemOption(db, {
        order_item_option_id: newId(),
        order_item_id: orderItemId,
        option_group_id: option.optionGroupId,
        option_value_id: option.optionValueId,
        group_name_snapshot: option.groupName,
        option_name_snapshot: option.optionName,
        price_adjustment_snapshot: option.priceAdjustment,
        text_value_snapshot: option.textValue,
        created_at: updatedAt,
      });
    }
  }

  const row = await getPreorderOrder(db, orderId!);
  if (!row) throw Errors.notFound('建立訂單失敗');
  return { order: await toOrder(db, row), idempotencyHit: false };
}

export async function getMyPreorderOrder(
  db: D1Database,
  offerId: string,
  user: AuthUser,
  groupId: string,
): Promise<MyPreorderOrderResponse> {
  await assertOfferInGroup(db, offerId, groupId);
  const [active, cancelledRows] = await Promise.all([
    getActiveOrderForBuyer(db, offerId, user.lineUserId),
    listCancelledOrdersForBuyerOnOffer(db, offerId, user.lineUserId),
  ]);
  const [order, cancelledOrders] = await Promise.all([
    active ? toOrder(db, active) : Promise.resolve(null),
    Promise.all(cancelledRows.map((row) => toOrder(db, row))),
  ]);
  return { order, cancelledOrders };
}

export async function reportMyPreorderPayment(
  db: D1Database,
  offerId: string,
  user: AuthUser,
  groupId: string,
): Promise<PreorderOrder> {
  await assertOfferInGroup(db, offerId, groupId);
  const order = await getActiveOrderForBuyer(db, offerId, user.lineUserId);
  if (!order) throw Errors.notFound('找不到訂單');
  if (order.status !== 'PENDING_PAYMENT') {
    throw Errors.conflict('目前狀態無法回報付款');
  }
  const updatedAt = nowIso();
  await updatePreorderOrderRow(db, order.order_id, {
    status: 'PAYMENT_REPORTED',
    totalAmount: order.total_amount,
    cancellationReason: null,
    paymentReportedAt: updatedAt,
    paymentConfirmedAt: order.payment_confirmed_at,
    fulfilledAt: order.fulfilled_at,
    updatedAt,
  });
  await insertOrderStatusHistory(db, {
    historyId: newId(),
    orderId: order.order_id,
    fromStatus: order.status,
    toStatus: 'PAYMENT_REPORTED',
    changedByLineUserId: user.lineUserId,
    reason: null,
    createdAt: updatedAt,
  });
  return toOrder(db, (await getPreorderOrder(db, order.order_id))!);
}

export async function cancelMyPreorderOrder(
  db: D1Database,
  offerId: string,
  user: AuthUser,
  groupId: string,
  reason?: string,
): Promise<PreorderOrder> {
  await assertOfferInGroup(db, offerId, groupId);
  const order = await getActiveOrderForBuyer(db, offerId, user.lineUserId);
  if (!order) throw Errors.notFound('找不到訂單');
  if (order.status === 'PAYMENT_CONFIRMED' || order.status === 'FULFILLED') {
    throw Errors.conflict('已確認付款不可自行取消，請聯絡代訂者處理');
  }
  if (!['PENDING_PAYMENT', 'PAYMENT_REPORTED'].includes(order.status)) {
    throw Errors.conflict('目前狀態無法取消訂單');
  }
  const rawReason = (reason || '').trim().slice(0, 200);
  const cancellationReason = rawReason || '買家取消';
  return applyCancelKeepingSnapshots(
    db,
    order,
    { lineUserId: user.lineUserId, displayName: user.displayName },
    cancellationReason,
    rawReason || null,
  );
}

async function requireProviderOrder(
  db: D1Database,
  offerId: string,
  orderId: string,
  user: AuthUser,
  groupId: string,
): Promise<{ offer: PreorderOfferRow; order: PreorderOrderRow }> {
  const offer = await assertOfferInGroup(db, offerId, groupId);
  if (offer.provider_line_user_id !== user.lineUserId) {
    throw Errors.forbidden('無權管理此代訂');
  }
  const order = await getPreorderOrder(db, orderId);
  if (!order || order.offer_id !== offerId) throw Errors.notFound('找不到訂單');
  return { offer, order };
}

export async function confirmPreorderPayment(
  db: D1Database,
  offerId: string,
  orderId: string,
  user: AuthUser,
  groupId: string,
): Promise<PreorderOrder> {
  const { order } = await requireProviderOrder(db, offerId, orderId, user, groupId);
  if (order.status !== 'PAYMENT_REPORTED' && order.status !== 'PENDING_PAYMENT') {
    throw Errors.conflict('目前狀態無法確認收款');
  }
  const updatedAt = nowIso();
  await updatePreorderOrderRow(db, order.order_id, {
    status: 'PAYMENT_CONFIRMED',
    totalAmount: order.total_amount,
    cancellationReason: null,
    paymentReportedAt: order.payment_reported_at || updatedAt,
    paymentConfirmedAt: updatedAt,
    fulfilledAt: order.fulfilled_at,
    updatedAt,
  });
  await insertOrderStatusHistory(db, {
    historyId: newId(),
    orderId: order.order_id,
    fromStatus: order.status,
    toStatus: 'PAYMENT_CONFIRMED',
    changedByLineUserId: user.lineUserId,
    reason: null,
    createdAt: updatedAt,
  });
  return toOrder(db, (await getPreorderOrder(db, order.order_id))!);
}

export async function fulfillPreorderOrder(
  db: D1Database,
  offerId: string,
  orderId: string,
  user: AuthUser,
  groupId: string,
): Promise<PreorderOrder> {
  const { order } = await requireProviderOrder(db, offerId, orderId, user, groupId);
  if (order.status !== 'PAYMENT_CONFIRMED') {
    throw Errors.conflict('請先確認收款後再標記完成');
  }
  const updatedAt = nowIso();
  await updatePreorderOrderRow(db, order.order_id, {
    status: 'FULFILLED',
    totalAmount: order.total_amount,
    cancellationReason: null,
    paymentReportedAt: order.payment_reported_at,
    paymentConfirmedAt: order.payment_confirmed_at,
    fulfilledAt: updatedAt,
    updatedAt,
  });
  await insertOrderStatusHistory(db, {
    historyId: newId(),
    orderId: order.order_id,
    fromStatus: order.status,
    toStatus: 'FULFILLED',
    changedByLineUserId: user.lineUserId,
    reason: null,
    createdAt: updatedAt,
  });
  return toOrder(db, (await getPreorderOrder(db, order.order_id))!);
}

export async function cancelPreorderOrderByProvider(
  db: D1Database,
  offerId: string,
  orderId: string,
  user: AuthUser,
  groupId: string,
  reason: string,
): Promise<PreorderOrder> {
  const { order } = await requireProviderOrder(db, offerId, orderId, user, groupId);
  if (order.status === 'CANCELLED') throw Errors.conflict('訂單已取消');
  if (order.status === 'FULFILLED') throw Errors.conflict('已完成訂單不可取消');
  if (!['PENDING_PAYMENT', 'PAYMENT_REPORTED', 'PAYMENT_CONFIRMED'].includes(order.status)) {
    throw Errors.conflict('目前狀態無法取消訂單');
  }
  const trimmed = (reason || '').trim();
  if (!trimmed) throw Errors.validation('請填寫取消原因');
  return applyCancelKeepingSnapshots(
    db,
    order,
    { lineUserId: user.lineUserId, displayName: user.displayName },
    trimmed.slice(0, 200),
    trimmed.slice(0, 200),
  );
}

export async function reportPreorderSettlementHandled(
  db: D1Database,
  offerId: string,
  orderId: string,
  user: AuthUser,
  groupId: string,
  note: string,
): Promise<PreorderOrder> {
  const { order } = await requireProviderOrder(db, offerId, orderId, user, groupId);
  const settlement = await getPreorderPaymentSettlementByOrderId(db, order.order_id);
  if (!settlement) {
    throw Errors.conflict('此訂單無需款項處理紀錄');
  }
  if (settlement.status === 'PROVIDER_REPORTED_SETTLED') {
    throw Errors.conflict('已回報處理，無需重複回報');
  }
  if (
    settlement.status !== 'AWAITING_RECEIPT_CHECK' &&
    settlement.status !== 'REFUND_PENDING'
  ) {
    throw Errors.conflict('已回報處理，無需重複回報');
  }

  const updatedAt = nowIso();
  try {
    await reportSettlementHandledAtomic(db, {
      settlement,
      note,
      actorLineUserId: user.lineUserId,
      actorDisplayName: user.displayName,
      historyId: newId(),
      updatedAt,
    });
  } catch (error) {
    if (error instanceof PreorderCancelBatchConflict) {
      throw Errors.conflict('已回報處理，無需重複回報');
    }
    throw error;
  }
  return toOrder(db, (await getPreorderOrder(db, order.order_id))!);
}

export async function listPreorderOrders(
  db: D1Database,
  offerId: string,
  user: AuthUser,
  groupId: string,
): Promise<PreorderOrder[]> {
  const offer = await assertOfferInGroup(db, offerId, groupId);
  if (offer.provider_line_user_id !== user.lineUserId) {
    throw Errors.forbidden('無權管理此代訂');
  }
  const rows = await listPreorderOrdersForOffer(db, offerId);
  return Promise.all(rows.map((row) => toOrder(db, row)));
}

export async function getPreorderOfferSummary(
  db: D1Database,
  offerId: string,
  user: AuthUser,
  groupId: string,
): Promise<PreorderOfferOrderSummary> {
  const offer = await assertOfferInGroup(db, offerId, groupId);
  if (offer.provider_line_user_id !== user.lineUserId) {
    throw Errors.forbidden('無權管理此代訂');
  }
  const orders = await listPreorderOrdersForOffer(db, offerId);
  const active = orders.filter((o) => o.status !== 'CANCELLED');
  const items = await listPreorderOrderItemsForOrders(
    db,
    active.map((o) => o.order_id),
  );
  const countsByStatus: Record<PreorderOrderStatus, number> = {
    PENDING_PAYMENT: 0,
    PAYMENT_REPORTED: 0,
    PAYMENT_CONFIRMED: 0,
    CANCELLED: 0,
    FULFILLED: 0,
  };
  for (const order of orders) countsByStatus[order.status] += 1;

  const aggregateMap = new Map<
    string,
    {
      productId: string;
      name: string;
      specification: string | null;
      unitPrice: number;
      totalQuantity: number;
      subtotal: number;
    }
  >();
  for (const item of items) {
    const key = item.product_id;
    const current = aggregateMap.get(key) || {
      productId: item.product_id,
      name: item.product_name_snapshot,
      specification: item.specification_snapshot,
      unitPrice: Number(item.unit_price_snapshot),
      totalQuantity: 0,
      subtotal: 0,
    };
    current.totalQuantity += Number(item.quantity);
    current.subtotal += Number(item.subtotal);
    aggregateMap.set(key, current);
  }

  const receivableStatuses: PreorderOrderStatus[] = [
    'PENDING_PAYMENT',
    'PAYMENT_REPORTED',
    'PAYMENT_CONFIRMED',
    'FULFILLED',
  ];
  const totalReceivable = active
    .filter((o) => receivableStatuses.includes(o.status))
    .reduce((sum, o) => sum + Number(o.total_amount), 0);

  return {
    offerId,
    orderCount: active.length,
    totalReceivable,
    countsByStatus,
    productAggregates: [...aggregateMap.values()],
    orders: await Promise.all(orders.map((row) => toOrder(db, row))),
  };
}

/** Used by cancelRegistration — throws if blocked. */
export async function assertRegistrationCancelAllowedForPreorders(
  db: D1Database,
  eventId: string,
  lineUserId: string,
): Promise<{ cancelledOrderIds: string[] }> {
  const confirmedPaid = await countConfirmedPaymentOrdersForEventBuyer(db, eventId, lineUserId);
  if (confirmedPaid > 0) {
    throw Errors.conflict('你仍有已確認付款的代訂訂單，請先聯絡代訂者處理後再取消報名');
  }
  const providerBlock = await countActiveOrdersForEventOffersByProvider(db, eventId, lineUserId);
  if (providerBlock.orderCount > 0) {
    throw Errors.conflict(
      `你提供的代訂仍有有效訂單（${providerBlock.offerTitles.join('、')}），請先完成或取消相關訂單`,
    );
  }
  const updatedAt = nowIso();
  const reason = '因取消活動報名而取消訂單';
  let cancelledOrders;
  try {
    cancelledOrders = await cancelOpenOrdersForBuyerOnEvent(
      db,
      eventId,
      lineUserId,
      reason,
      updatedAt,
    );
  } catch (error) {
    if (error instanceof PreorderCancelBatchTooLarge) {
      throw Errors.conflict('代訂訂單過多，請先逐筆取消後再取消報名');
    }
    if (error instanceof PreorderCancelBatchConflict) {
      throw Errors.conflict('訂單狀態已變更，請重新整理後再試');
    }
    throw error;
  }
  await cancelEmptyOffersForProvider(db, eventId, lineUserId, updatedAt);
  return { cancelledOrderIds: cancelledOrders.map((order) => order.order_id) };
}

export async function assertEventDeleteAllowedForPreorders(
  db: D1Database,
  eventId: string,
): Promise<void> {
  const count = await countActiveOrdersForEvent(db, eventId);
  if (count > 0) {
    throw Errors.conflict(`此活動仍有 ${count} 筆有效代訂訂單，請先處理後再刪除活動`);
  }
}

export async function previewRegistrationCancelPreorderImpact(
  db: D1Database,
  eventId: string,
  lineUserId: string,
): Promise<{
  blocked: boolean;
  kind: 'buyer_confirmed' | 'provider_has_orders' | null;
  message: string | null;
  pendingCancelCount: number;
}> {
  const confirmedPaid = await countConfirmedPaymentOrdersForEventBuyer(db, eventId, lineUserId);
  if (confirmedPaid > 0) {
    return {
      blocked: true,
      kind: 'buyer_confirmed',
      message: '你仍有已確認付款的代訂訂單，請先聯絡代訂者處理後再取消報名',
      pendingCancelCount: 0,
    };
  }
  const providerBlock = await countActiveOrdersForEventOffersByProvider(db, eventId, lineUserId);
  if (providerBlock.orderCount > 0) {
    return {
      blocked: true,
      kind: 'provider_has_orders',
      message: `你提供的代訂仍有有效訂單（${providerBlock.offerTitles.join('、')}），請先完成或取消相關訂單`,
      pendingCancelCount: 0,
    };
  }
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM preorder_orders
       WHERE event_id = ? AND buyer_line_user_id = ?
         AND status IN ('PENDING_PAYMENT', 'PAYMENT_REPORTED')`,
    )
    .bind(eventId, lineUserId)
    .first<{ count: number }>();
  return {
    blocked: false,
    kind: null,
    message: null,
    pendingCancelCount: row?.count ?? 0,
  };
}
