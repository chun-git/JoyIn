import { asBoolean, newId } from '../lib/ids';

export type PreorderOfferStatus = 'OPEN' | 'CLOSED' | 'CANCELLED';
export type PreorderOrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAYMENT_REPORTED'
  | 'PAYMENT_CONFIRMED'
  | 'CANCELLED'
  | 'FULFILLED';

export interface PreorderOfferRow {
  offer_id: string;
  event_id: string;
  group_id: string;
  provider_line_user_id: string;
  provider_display_name: string;
  title: string;
  merchant_name: string;
  description: string;
  order_deadline: string;
  payment_instructions: string;
  payment_url: string | null;
  shared_menu_version_id: string | null;
  status: PreorderOfferStatus;
  created_at: string;
  updated_at: string;
}

export interface PreorderProductRow {
  product_id: string;
  offer_id: string;
  name: string;
  description: string;
  source_menu_product_id: string | null;
  specification: string | null;
  unit_price: number;
  quantity_limit: number | null;
  ordered_quantity: number;
  sort_order: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface PreorderOrderRow {
  order_id: string;
  offer_id: string;
  event_id: string;
  group_id: string;
  buyer_line_user_id: string;
  buyer_display_name: string;
  status: PreorderOrderStatus;
  total_amount: number;
  cancellation_reason: string | null;
  payment_reported_at: string | null;
  payment_confirmed_at: string | null;
  fulfilled_at: string | null;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface PreorderOrderItemRow {
  order_item_id: string;
  order_id: string;
  product_id: string;
  product_name_snapshot: string;
  specification_snapshot: string | null;
  unit_price_snapshot: number;
  option_price_snapshot: number;
  quantity: number;
  subtotal: number;
  created_at: string;
}

export interface PreorderOptionGroupRow {
  option_group_id: string;
  product_id: string;
  source_option_group_id: string | null;
  name: string;
  type: 'SINGLE' | 'MULTIPLE' | 'TEXT';
  is_required: number;
  min_selections: number;
  max_selections: number | null;
  sort_order: number;
  created_at: string;
}

export interface PreorderOptionValueRow {
  option_value_id: string;
  option_group_id: string;
  source_option_value_id: string | null;
  name: string;
  price_adjustment: number;
  is_active: number;
  sort_order: number;
  created_at: string;
}

export interface PreorderOrderItemOptionRow {
  order_item_option_id: string;
  order_item_id: string;
  option_group_id: string;
  option_value_id: string | null;
  group_name_snapshot: string;
  option_name_snapshot: string;
  price_adjustment_snapshot: number;
  text_value_snapshot: string | null;
  created_at: string;
}

export type PreorderPaymentSettlementStatus =
  | 'AWAITING_RECEIPT_CHECK'
  | 'REFUND_PENDING'
  | 'PROVIDER_REPORTED_SETTLED';

export type PreorderPaymentSettlementSourceStatus = 'PAYMENT_REPORTED' | 'PAYMENT_CONFIRMED';

export interface PreorderPaymentSettlementRow {
  settlement_id: string;
  order_id: string;
  offer_id: string;
  buyer_line_user_id: string;
  status: PreorderPaymentSettlementStatus;
  source_order_status: PreorderPaymentSettlementSourceStatus;
  created_by_line_user_id: string;
  created_by_display_name: string;
  latest_note: string | null;
  settled_reported_at: string | null;
  settled_reported_by_line_user_id: string | null;
  settled_reported_by_display_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface PreorderPaymentSettlementHistoryRow {
  history_id: string;
  settlement_id: string;
  from_status: PreorderPaymentSettlementStatus | null;
  to_status: PreorderPaymentSettlementStatus;
  actor_line_user_id: string;
  actor_display_name: string;
  note: string | null;
  created_at: string;
}

export function remainingQuantity(row: PreorderProductRow): number | null {
  if (row.quantity_limit == null) return null;
  return Math.max(0, Number(row.quantity_limit) - Number(row.ordered_quantity));
}

export async function insertPreorderOffer(
  db: D1Database,
  values: Omit<PreorderOfferRow, never>,
): Promise<void> {
  await prepareInsertPreorderOffer(db, values).run();
}

export function prepareInsertPreorderOffer(
  db: D1Database,
  values: Omit<PreorderOfferRow, never>,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO preorder_offers (
        offer_id, event_id, group_id, provider_line_user_id, provider_display_name,
        title, merchant_name, description, order_deadline, payment_instructions,
        payment_url, shared_menu_version_id, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      values.offer_id,
      values.event_id,
      values.group_id,
      values.provider_line_user_id,
      values.provider_display_name,
      values.title,
      values.merchant_name,
      values.description,
      values.order_deadline,
      values.payment_instructions,
      values.payment_url,
      values.shared_menu_version_id,
      values.status,
      values.created_at,
      values.updated_at,
    );
}

export async function updatePreorderOfferRow(
  db: D1Database,
  offerId: string,
  values: {
    title: string;
    merchantName: string;
    description: string;
    orderDeadline: string;
    paymentInstructions: string;
    paymentUrl: string | null;
    updatedAt: string;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE preorder_offers
       SET title = ?, merchant_name = ?, description = ?, order_deadline = ?,
           payment_instructions = ?, payment_url = ?, updated_at = ?
       WHERE offer_id = ?`,
    )
    .bind(
      values.title,
      values.merchantName,
      values.description,
      values.orderDeadline,
      values.paymentInstructions,
      values.paymentUrl,
      values.updatedAt,
      offerId,
    )
    .run();
}

export async function setPreorderOfferStatus(
  db: D1Database,
  offerId: string,
  status: PreorderOfferStatus,
  updatedAt: string,
): Promise<void> {
  await db
    .prepare(`UPDATE preorder_offers SET status = ?, updated_at = ? WHERE offer_id = ?`)
    .bind(status, updatedAt, offerId)
    .run();
}

export async function getPreorderOffer(
  db: D1Database,
  offerId: string,
): Promise<PreorderOfferRow | null> {
  return (
    (await db
      .prepare(`SELECT * FROM preorder_offers WHERE offer_id = ?`)
      .bind(offerId)
      .first<PreorderOfferRow>()) ?? null
  );
}

export async function listPreorderOffersForEvent(
  db: D1Database,
  eventId: string,
  groupId: string,
): Promise<PreorderOfferRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM preorder_offers
       WHERE event_id = ? AND group_id = ? AND status != 'CANCELLED'
       ORDER BY created_at ASC`,
    )
    .bind(eventId, groupId)
    .all<PreorderOfferRow>();
  return results ?? [];
}

export async function listPreorderOffersByProvider(
  db: D1Database,
  eventId: string,
  providerLineUserId: string,
): Promise<PreorderOfferRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM preorder_offers
       WHERE event_id = ? AND provider_line_user_id = ? AND status != 'CANCELLED'
       ORDER BY created_at ASC`,
    )
    .bind(eventId, providerLineUserId)
    .all<PreorderOfferRow>();
  return results ?? [];
}

export async function insertPreorderProduct(
  db: D1Database,
  values: PreorderProductRow,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO preorder_products (
        product_id, offer_id, name, description, source_menu_product_id, specification, unit_price, quantity_limit,
        ordered_quantity, sort_order, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      values.product_id,
      values.offer_id,
      values.name,
      values.description,
      values.source_menu_product_id,
      values.specification,
      values.unit_price,
      values.quantity_limit,
      values.ordered_quantity,
      values.sort_order,
      values.is_active,
      values.created_at,
      values.updated_at,
    )
    .run();
}

export function prepareInsertPreorderProduct(
  db: D1Database,
  values: PreorderProductRow,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO preorder_products (
        product_id, offer_id, name, description, source_menu_product_id, specification, unit_price, quantity_limit,
        ordered_quantity, sort_order, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      values.product_id,
      values.offer_id,
      values.name,
      values.description,
      values.source_menu_product_id,
      values.specification,
      values.unit_price,
      values.quantity_limit,
      values.ordered_quantity,
      values.sort_order,
      values.is_active,
      values.created_at,
      values.updated_at,
    );
}

export async function updatePreorderProductRow(
  db: D1Database,
  productId: string,
  values: {
    name: string;
    description: string;
    specification: string | null;
    unitPrice: number;
    quantityLimit: number | null;
    sortOrder: number;
    isActive: boolean;
    updatedAt: string;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE preorder_products
       SET name = ?, description = ?, specification = ?, unit_price = ?, quantity_limit = ?,
           sort_order = ?, is_active = ?, updated_at = ?
       WHERE product_id = ?`,
    )
    .bind(
      values.name,
      values.description,
      values.specification,
      values.unitPrice,
      values.quantityLimit,
      values.sortOrder,
      values.isActive ? 1 : 0,
      values.updatedAt,
      productId,
    )
    .run();
}

export async function deactivatePreorderProduct(
  db: D1Database,
  productId: string,
  updatedAt: string,
): Promise<void> {
  await db
    .prepare(`UPDATE preorder_products SET is_active = 0, updated_at = ? WHERE product_id = ?`)
    .bind(updatedAt, productId)
    .run();
}

export async function deletePreorderProductIfUnused(
  db: D1Database,
  productId: string,
): Promise<boolean> {
  const used = await db
    .prepare(`SELECT 1 AS ok FROM preorder_order_items WHERE product_id = ? LIMIT 1`)
    .bind(productId)
    .first<{ ok: number }>();
  if (used) return false;
  await db
    .prepare(
      `DELETE FROM preorder_product_option_values
       WHERE option_group_id IN (
         SELECT option_group_id FROM preorder_product_option_groups WHERE product_id = ?
       )`,
    )
    .bind(productId)
    .run();
  await db
    .prepare(`DELETE FROM preorder_product_option_groups WHERE product_id = ?`)
    .bind(productId)
    .run();
  await db.prepare(`DELETE FROM preorder_products WHERE product_id = ?`).bind(productId).run();
  return true;
}

export async function listPreorderProducts(
  db: D1Database,
  offerId: string,
): Promise<PreorderProductRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM preorder_products
       WHERE offer_id = ?
       ORDER BY sort_order ASC, created_at ASC`,
    )
    .bind(offerId)
    .all<PreorderProductRow>();
  return results ?? [];
}

export async function getPreorderProduct(
  db: D1Database,
  productId: string,
): Promise<PreorderProductRow | null> {
  return (
    (await db
      .prepare(`SELECT * FROM preorder_products WHERE product_id = ?`)
      .bind(productId)
      .first<PreorderProductRow>()) ?? null
  );
}

export async function countActiveProducts(db: D1Database, offerId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM preorder_products WHERE offer_id = ? AND is_active = 1`,
    )
    .bind(offerId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function getActiveOrderForBuyer(
  db: D1Database,
  offerId: string,
  buyerLineUserId: string,
): Promise<PreorderOrderRow | null> {
  return (
    (await db
      .prepare(
        `SELECT * FROM preorder_orders
         WHERE offer_id = ? AND buyer_line_user_id = ? AND status != 'CANCELLED'`,
      )
      .bind(offerId, buyerLineUserId)
      .first<PreorderOrderRow>()) ?? null
  );
}

export async function getOrderByIdempotencyKey(
  db: D1Database,
  offerId: string,
  buyerLineUserId: string,
  idempotencyKey: string,
): Promise<PreorderOrderRow | null> {
  return (
    (await db
      .prepare(
        `SELECT * FROM preorder_orders
         WHERE offer_id = ? AND buyer_line_user_id = ? AND idempotency_key = ?`,
      )
      .bind(offerId, buyerLineUserId, idempotencyKey)
      .first<PreorderOrderRow>()) ?? null
  );
}

export async function getPreorderOrder(
  db: D1Database,
  orderId: string,
): Promise<PreorderOrderRow | null> {
  return (
    (await db
      .prepare(`SELECT * FROM preorder_orders WHERE order_id = ?`)
      .bind(orderId)
      .first<PreorderOrderRow>()) ?? null
  );
}

export async function listPreorderOrdersForOffer(
  db: D1Database,
  offerId: string,
): Promise<PreorderOrderRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM preorder_orders
       WHERE offer_id = ?
       ORDER BY created_at ASC`,
    )
    .bind(offerId)
    .all<PreorderOrderRow>();
  return results ?? [];
}

export async function listPreorderOrderItems(
  db: D1Database,
  orderId: string,
): Promise<PreorderOrderItemRow[]> {
  const { results } = await db
    .prepare(`SELECT * FROM preorder_order_items WHERE order_id = ? ORDER BY created_at ASC`)
    .bind(orderId)
    .all<PreorderOrderItemRow>();
  return results ?? [];
}

export async function listPreorderOrderItemsForOrders(
  db: D1Database,
  orderIds: string[],
): Promise<PreorderOrderItemRow[]> {
  if (orderIds.length === 0) return [];
  const placeholders = orderIds.map(() => '?').join(', ');
  const { results } = await db
    .prepare(
      `SELECT * FROM preorder_order_items
       WHERE order_id IN (${placeholders})
       ORDER BY created_at ASC`,
    )
    .bind(...orderIds)
    .all<PreorderOrderItemRow>();
  return results ?? [];
}

export async function countOrderItemsForProduct(
  db: D1Database,
  productId: string,
): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS count FROM preorder_order_items WHERE product_id = ?`)
    .bind(productId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/** Adjust reserved quantity atomically; returns false if constraint violated. */
export async function adjustProductOrderedQuantity(
  db: D1Database,
  productId: string,
  delta: number,
  updatedAt: string,
): Promise<boolean> {
  if (delta === 0) return true;
  if (delta > 0) {
    const result = await db
      .prepare(
        `UPDATE preorder_products
         SET ordered_quantity = ordered_quantity + ?, updated_at = ?
         WHERE product_id = ?
           AND ordered_quantity + ? >= 0
           AND (quantity_limit IS NULL OR ordered_quantity + ? <= quantity_limit)`,
      )
      .bind(delta, updatedAt, productId, delta, delta)
      .run();
    return (result.meta.changes ?? 0) === 1;
  }
  const result = await db
    .prepare(
      `UPDATE preorder_products
       SET ordered_quantity = ordered_quantity + ?, updated_at = ?
       WHERE product_id = ?
         AND ordered_quantity + ? >= 0`,
    )
    .bind(delta, updatedAt, productId, delta)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export async function insertPreorderOrder(
  db: D1Database,
  values: PreorderOrderRow,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO preorder_orders (
        order_id, offer_id, event_id, group_id, buyer_line_user_id, buyer_display_name,
        status, total_amount, cancellation_reason, payment_reported_at, payment_confirmed_at,
        fulfilled_at, idempotency_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      values.order_id,
      values.offer_id,
      values.event_id,
      values.group_id,
      values.buyer_line_user_id,
      values.buyer_display_name,
      values.status,
      values.total_amount,
      values.cancellation_reason,
      values.payment_reported_at,
      values.payment_confirmed_at,
      values.fulfilled_at,
      values.idempotency_key,
      values.created_at,
      values.updated_at,
    )
    .run();
}

export async function updatePreorderOrderRow(
  db: D1Database,
  orderId: string,
  values: {
    status: PreorderOrderStatus;
    totalAmount: number;
    cancellationReason: string | null;
    paymentReportedAt: string | null;
    paymentConfirmedAt: string | null;
    fulfilledAt: string | null;
    updatedAt: string;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE preorder_orders
       SET status = ?, total_amount = ?, cancellation_reason = ?,
           payment_reported_at = ?, payment_confirmed_at = ?, fulfilled_at = ?, updated_at = ?
       WHERE order_id = ?`,
    )
    .bind(
      values.status,
      values.totalAmount,
      values.cancellationReason,
      values.paymentReportedAt,
      values.paymentConfirmedAt,
      values.fulfilledAt,
      values.updatedAt,
      orderId,
    )
    .run();
}

export async function deletePreorderOrderItems(db: D1Database, orderId: string): Promise<void> {
  await db
    .prepare(
      `DELETE FROM preorder_order_item_options
       WHERE order_item_id IN (
         SELECT order_item_id FROM preorder_order_items WHERE order_id = ?
       )`,
    )
    .bind(orderId)
    .run();
  await db.prepare(`DELETE FROM preorder_order_items WHERE order_id = ?`).bind(orderId).run();
}

export async function insertPreorderOrderItem(
  db: D1Database,
  values: PreorderOrderItemRow,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO preorder_order_items (
        order_item_id, order_id, product_id, product_name_snapshot, specification_snapshot,
        unit_price_snapshot, option_price_snapshot, quantity, subtotal, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      values.order_item_id,
      values.order_id,
      values.product_id,
      values.product_name_snapshot,
      values.specification_snapshot,
      values.unit_price_snapshot,
      values.option_price_snapshot,
      values.quantity,
      values.subtotal,
      values.created_at,
    )
    .run();
}

export function prepareInsertPreorderOptionGroup(
  db: D1Database,
  row: PreorderOptionGroupRow,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO preorder_product_option_groups (
        option_group_id, product_id, source_option_group_id, name, type,
        is_required, min_selections, max_selections, sort_order, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.option_group_id,
      row.product_id,
      row.source_option_group_id,
      row.name,
      row.type,
      row.is_required,
      row.min_selections,
      row.max_selections,
      row.sort_order,
      row.created_at,
    );
}

export function prepareInsertPreorderOptionValue(
  db: D1Database,
  row: PreorderOptionValueRow,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO preorder_product_option_values (
        option_value_id, option_group_id, source_option_value_id, name,
        price_adjustment, is_active, sort_order, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.option_value_id,
      row.option_group_id,
      row.source_option_value_id,
      row.name,
      row.price_adjustment,
      row.is_active,
      row.sort_order,
      row.created_at,
    );
}

export async function listPreorderOptionGroups(
  db: D1Database,
  productIds: string[],
): Promise<PreorderOptionGroupRow[]> {
  if (productIds.length === 0) return [];
  const placeholders = productIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT * FROM preorder_product_option_groups
       WHERE product_id IN (${placeholders})
       ORDER BY sort_order, option_group_id`,
    )
    .bind(...productIds)
    .all<PreorderOptionGroupRow>();
  return results;
}

export async function listPreorderOptionValues(
  db: D1Database,
  groupIds: string[],
): Promise<PreorderOptionValueRow[]> {
  if (groupIds.length === 0) return [];
  const placeholders = groupIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT * FROM preorder_product_option_values
       WHERE option_group_id IN (${placeholders})
       ORDER BY sort_order, option_value_id`,
    )
    .bind(...groupIds)
    .all<PreorderOptionValueRow>();
  return results;
}

export async function replacePreorderProductOptions(
  db: D1Database,
  productId: string,
  groups: PreorderOptionGroupRow[],
  values: PreorderOptionValueRow[],
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM preorder_product_option_values
       WHERE option_group_id IN (
         SELECT option_group_id FROM preorder_product_option_groups WHERE product_id = ?
       )`,
    )
    .bind(productId)
    .run();
  await db
    .prepare(`DELETE FROM preorder_product_option_groups WHERE product_id = ?`)
    .bind(productId)
    .run();
  const statements = [
    ...groups.map((row) => prepareInsertPreorderOptionGroup(db, row)),
    ...values.map((row) => prepareInsertPreorderOptionValue(db, row)),
  ];
  if (statements.length > 0) await db.batch(statements);
}

export async function insertPreorderOrderItemOption(
  db: D1Database,
  row: PreorderOrderItemOptionRow,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO preorder_order_item_options (
        order_item_option_id, order_item_id, option_group_id, option_value_id,
        group_name_snapshot, option_name_snapshot, price_adjustment_snapshot,
        text_value_snapshot, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.order_item_option_id,
      row.order_item_id,
      row.option_group_id,
      row.option_value_id,
      row.group_name_snapshot,
      row.option_name_snapshot,
      row.price_adjustment_snapshot,
      row.text_value_snapshot,
      row.created_at,
    )
    .run();
}

export async function listPreorderOrderItemOptions(
  db: D1Database,
  itemIds: string[],
): Promise<PreorderOrderItemOptionRow[]> {
  if (itemIds.length === 0) return [];
  const placeholders = itemIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT * FROM preorder_order_item_options
       WHERE order_item_id IN (${placeholders})
       ORDER BY created_at, order_item_option_id`,
    )
    .bind(...itemIds)
    .all<PreorderOrderItemOptionRow>();
  return results;
}

export async function insertOrderStatusHistory(
  db: D1Database,
  values: {
    historyId: string;
    orderId: string;
    fromStatus: string | null;
    toStatus: string;
    changedByLineUserId: string;
    reason: string | null;
    createdAt: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO preorder_order_status_history (
        history_id, order_id, from_status, to_status, changed_by_line_user_id, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      values.historyId,
      values.orderId,
      values.fromStatus,
      values.toStatus,
      values.changedByLineUserId,
      values.reason,
      values.createdAt,
    )
    .run();
}

export async function listBlockingOrdersForBuyer(
  db: D1Database,
  eventId: string,
  buyerLineUserId: string,
): Promise<Array<PreorderOrderRow & { offer_title: string }>> {
  const { results } = await db
    .prepare(
      `SELECT o.*, f.title AS offer_title
       FROM preorder_orders o
       INNER JOIN preorder_offers f ON f.offer_id = o.offer_id
       WHERE o.event_id = ?
         AND o.buyer_line_user_id = ?
         AND o.status IN ('PENDING_PAYMENT', 'PAYMENT_REPORTED', 'PAYMENT_CONFIRMED', 'FULFILLED')`,
    )
    .bind(eventId, buyerLineUserId)
    .all<PreorderOrderRow & { offer_title: string }>();
  return results ?? [];
}

export async function countActiveOrdersForOffer(db: D1Database, offerId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM preorder_orders
       WHERE offer_id = ? AND status != 'CANCELLED'`,
    )
    .bind(offerId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function countConfirmedPaymentOrdersForEventBuyer(
  db: D1Database,
  eventId: string,
  buyerLineUserId: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM preorder_orders
       WHERE event_id = ?
         AND buyer_line_user_id = ?
         AND status IN ('PAYMENT_CONFIRMED', 'FULFILLED')`,
    )
    .bind(eventId, buyerLineUserId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function countActiveOrdersForEventOffersByProvider(
  db: D1Database,
  eventId: string,
  providerLineUserId: string,
): Promise<{ orderCount: number; offerTitles: string[] }> {
  const { results } = await db
    .prepare(
      `SELECT f.title AS title, COUNT(o.order_id) AS order_count
       FROM preorder_offers f
       LEFT JOIN preorder_orders o
         ON o.offer_id = f.offer_id AND o.status != 'CANCELLED'
       WHERE f.event_id = ?
         AND f.provider_line_user_id = ?
         AND f.status != 'CANCELLED'
       GROUP BY f.offer_id`,
    )
    .bind(eventId, providerLineUserId)
    .all<{ title: string; order_count: number }>();
  const rows = results ?? [];
  const withOrders = rows.filter((r) => Number(r.order_count) > 0);
  return {
    orderCount: withOrders.reduce((sum, r) => sum + Number(r.order_count), 0),
    offerTitles: withOrders.map((r) => r.title),
  };
}

export const CANCEL_BATCH_ABORT_MESSAGE = 'JOYIN_CANCEL_ABORT';
export const D1_BATCH_STATEMENT_LIMIT = 50;

export class PreorderCancelBatchConflict extends Error {
  constructor(message = CANCEL_BATCH_ABORT_MESSAGE) {
    super(message);
    this.name = 'PreorderCancelBatchConflict';
  }
}

export class PreorderCancelBatchTooLarge extends Error {
  constructor() {
    super('JOYIN_CANCEL_TOO_LARGE');
    this.name = 'PreorderCancelBatchTooLarge';
  }
}

export type CancelOrderBatchInput = {
  order: PreorderOrderRow;
  items: Array<{ product_id: string; quantity: number }>;
  cancellationReason: string;
  actorLineUserId: string;
  actorDisplayName: string;
  historyNote: string | null;
  updatedAt: string;
  orderHistoryId: string;
  settlementId: string;
  settlementHistoryId: string;
};

function settlementStatusForCancelledSource(
  status: PreorderOrderStatus,
): PreorderPaymentSettlementStatus | null {
  if (status === 'PAYMENT_REPORTED') return 'AWAITING_RECEIPT_CHECK';
  if (status === 'PAYMENT_CONFIRMED') return 'REFUND_PENDING';
  return null;
}

function prepareAbortIfMissing(
  db: D1Database,
  sql: string,
  values: unknown[],
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO preorder_order_status_history (
         history_id, order_id, from_status, to_status, changed_by_line_user_id, reason, created_at
       )
       SELECT NULL, NULL, NULL, NULL, NULL, NULL, NULL
       WHERE NOT EXISTS (${sql})`,
    )
    .bind(...values);
}

export function buildCancelOrderStatements(
  db: D1Database,
  input: CancelOrderBatchInput,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE preorder_orders
         SET status = 'CANCELLED',
             cancellation_reason = ?,
             updated_at = ?
         WHERE order_id = ? AND status = ?`,
      )
      .bind(
        input.cancellationReason,
        input.updatedAt,
        input.order.order_id,
        input.order.status,
      ),
    prepareAbortIfMissing(
      db,
      `SELECT 1 FROM preorder_orders
       WHERE order_id = ? AND status = 'CANCELLED' AND updated_at = ?`,
      [input.order.order_id, input.updatedAt],
    ),
  ];

  const qtyByProduct = new Map<string, number>();
  for (const item of input.items) {
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    qtyByProduct.set(item.product_id, (qtyByProduct.get(item.product_id) ?? 0) + quantity);
  }
  for (const [productId, quantity] of qtyByProduct) {
    statements.push(
      db
        .prepare(
          `UPDATE preorder_products
           SET ordered_quantity = ordered_quantity - ?, updated_at = ?
           WHERE product_id = ? AND ordered_quantity >= ?`,
        )
        .bind(quantity, input.updatedAt, productId, quantity),
    );
    statements.push(
      prepareAbortIfMissing(
        db,
        `SELECT 1 FROM preorder_products WHERE product_id = ? AND updated_at = ?`,
        [productId, input.updatedAt],
      ),
    );
  }

  statements.push(
    db
      .prepare(
        `INSERT INTO preorder_order_status_history (
          history_id, order_id, from_status, to_status, changed_by_line_user_id, reason, created_at
        ) VALUES (?, ?, ?, 'CANCELLED', ?, ?, ?)`,
      )
      .bind(
        input.orderHistoryId,
        input.order.order_id,
        input.order.status,
        input.actorLineUserId,
        input.cancellationReason,
        input.updatedAt,
      ),
  );

  const settlementStatus = settlementStatusForCancelledSource(input.order.status);
  if (settlementStatus) {
    statements.push(
      db
        .prepare(
          `INSERT INTO preorder_payment_settlements (
            settlement_id, order_id, offer_id, buyer_line_user_id, status, source_order_status,
            created_by_line_user_id, created_by_display_name, latest_note,
            settled_reported_at, settled_reported_by_line_user_id, settled_reported_by_display_name,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`,
        )
        .bind(
          input.settlementId,
          input.order.order_id,
          input.order.offer_id,
          input.order.buyer_line_user_id,
          settlementStatus,
          input.order.status,
          input.actorLineUserId,
          input.actorDisplayName,
          input.updatedAt,
          input.updatedAt,
        ),
    );
    statements.push(
      db
        .prepare(
          `INSERT INTO preorder_payment_settlement_history (
            history_id, settlement_id, from_status, to_status,
            actor_line_user_id, actor_display_name, note, created_at
          ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.settlementHistoryId,
          input.settlementId,
          settlementStatus,
          input.actorLineUserId,
          input.actorDisplayName,
          input.historyNote,
          input.updatedAt,
        ),
    );
  }

  return statements;
}

export function isCancelBatchAbort(error: unknown): boolean {
  if (error instanceof PreorderCancelBatchConflict) return true;
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes(CANCEL_BATCH_ABORT_MESSAGE) ||
    message.includes('NOT NULL') ||
    message.includes('not null') ||
    message.includes('FOREIGN KEY')
  );
}

export async function applyPreorderCancelBatch(
  db: D1Database,
  statements: D1PreparedStatement[],
): Promise<void> {
  try {
    await db.batch(statements);
  } catch (error) {
    if (isCancelBatchAbort(error)) {
      throw new PreorderCancelBatchConflict();
    }
    throw error;
  }
}

export async function cancelSingleOrderAtomic(
  db: D1Database,
  input: Omit<CancelOrderBatchInput, 'orderHistoryId' | 'settlementId' | 'settlementHistoryId'> & {
    orderHistoryId?: string;
    settlementId?: string;
    settlementHistoryId?: string;
  },
): Promise<void> {
  await applyPreorderCancelBatch(
    db,
    buildCancelOrderStatements(db, {
      ...input,
      orderHistoryId: input.orderHistoryId ?? newId(),
      settlementId: input.settlementId ?? newId(),
      settlementHistoryId: input.settlementHistoryId ?? newId(),
    }),
  );
}

export async function cancelOpenOrdersForBuyerOnEvent(
  db: D1Database,
  eventId: string,
  buyerLineUserId: string,
  reason: string,
  updatedAt: string,
): Promise<PreorderOrderRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM preorder_orders
       WHERE event_id = ?
         AND buyer_line_user_id = ?
         AND status IN ('PENDING_PAYMENT', 'PAYMENT_REPORTED')`,
    )
    .bind(eventId, buyerLineUserId)
    .all<PreorderOrderRow>();
  const orders = results ?? [];
  if (orders.length === 0) return [];

  const statements: D1PreparedStatement[] = [];
  for (const order of orders) {
    const items = await listPreorderOrderItems(db, order.order_id);
    statements.push(
      ...buildCancelOrderStatements(db, {
        order,
        items,
        cancellationReason: reason,
        actorLineUserId: buyerLineUserId,
        actorDisplayName: order.buyer_display_name,
        historyNote: reason,
        updatedAt,
        orderHistoryId: newId(),
        settlementId: newId(),
        settlementHistoryId: newId(),
      }),
    );
  }
  if (statements.length > D1_BATCH_STATEMENT_LIMIT) {
    throw new PreorderCancelBatchTooLarge();
  }
  await applyPreorderCancelBatch(db, statements);
  return orders;
}

export async function listCancelledOrdersForBuyerOnOffer(
  db: D1Database,
  offerId: string,
  buyerLineUserId: string,
): Promise<PreorderOrderRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM preorder_orders
       WHERE offer_id = ? AND buyer_line_user_id = ? AND status = 'CANCELLED'
       ORDER BY updated_at DESC, created_at DESC`,
    )
    .bind(offerId, buyerLineUserId)
    .all<PreorderOrderRow>();
  return results ?? [];
}

export async function insertPreorderPaymentSettlement(
  db: D1Database,
  values: PreorderPaymentSettlementRow,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO preorder_payment_settlements (
        settlement_id, order_id, offer_id, buyer_line_user_id, status, source_order_status,
        created_by_line_user_id, created_by_display_name, latest_note,
        settled_reported_at, settled_reported_by_line_user_id, settled_reported_by_display_name,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      values.settlement_id,
      values.order_id,
      values.offer_id,
      values.buyer_line_user_id,
      values.status,
      values.source_order_status,
      values.created_by_line_user_id,
      values.created_by_display_name,
      values.latest_note,
      values.settled_reported_at,
      values.settled_reported_by_line_user_id,
      values.settled_reported_by_display_name,
      values.created_at,
      values.updated_at,
    )
    .run();
}

export async function insertPreorderPaymentSettlementHistory(
  db: D1Database,
  values: PreorderPaymentSettlementHistoryRow,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO preorder_payment_settlement_history (
        history_id, settlement_id, from_status, to_status,
        actor_line_user_id, actor_display_name, note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      values.history_id,
      values.settlement_id,
      values.from_status,
      values.to_status,
      values.actor_line_user_id,
      values.actor_display_name,
      values.note,
      values.created_at,
    )
    .run();
}

export async function getPreorderPaymentSettlementByOrderId(
  db: D1Database,
  orderId: string,
): Promise<PreorderPaymentSettlementRow | null> {
  return (
    (await db
      .prepare(`SELECT * FROM preorder_payment_settlements WHERE order_id = ?`)
      .bind(orderId)
      .first<PreorderPaymentSettlementRow>()) ?? null
  );
}

export async function listPreorderPaymentSettlementsByOrderIds(
  db: D1Database,
  orderIds: string[],
): Promise<PreorderPaymentSettlementRow[]> {
  if (orderIds.length === 0) return [];
  const placeholders = orderIds.map(() => '?').join(', ');
  const { results } = await db
    .prepare(
      `SELECT * FROM preorder_payment_settlements
       WHERE order_id IN (${placeholders})`,
    )
    .bind(...orderIds)
    .all<PreorderPaymentSettlementRow>();
  return results ?? [];
}

export async function listPreorderPaymentSettlementHistory(
  db: D1Database,
  settlementId: string,
): Promise<PreorderPaymentSettlementHistoryRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM preorder_payment_settlement_history
       WHERE settlement_id = ?
       ORDER BY created_at ASC, history_id ASC`,
    )
    .bind(settlementId)
    .all<PreorderPaymentSettlementHistoryRow>();
  return results ?? [];
}

export async function listPreorderPaymentSettlementHistoryBySettlementIds(
  db: D1Database,
  settlementIds: string[],
): Promise<PreorderPaymentSettlementHistoryRow[]> {
  if (settlementIds.length === 0) return [];
  const placeholders = settlementIds.map(() => '?').join(', ');
  const { results } = await db
    .prepare(
      `SELECT * FROM preorder_payment_settlement_history
       WHERE settlement_id IN (${placeholders})
       ORDER BY created_at ASC, history_id ASC`,
    )
    .bind(...settlementIds)
    .all<PreorderPaymentSettlementHistoryRow>();
  return results ?? [];
}

export async function markPreorderPaymentSettlementHandled(
  db: D1Database,
  settlementId: string,
  values: {
    latestNote: string;
    settledReportedAt: string;
    settledReportedByLineUserId: string;
    settledReportedByDisplayName: string;
    updatedAt: string;
  },
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE preorder_payment_settlements
       SET status = 'PROVIDER_REPORTED_SETTLED',
           latest_note = ?,
           settled_reported_at = ?,
           settled_reported_by_line_user_id = ?,
           settled_reported_by_display_name = ?,
           updated_at = ?
       WHERE settlement_id = ?
         AND status IN ('AWAITING_RECEIPT_CHECK', 'REFUND_PENDING')`,
    )
    .bind(
      values.latestNote,
      values.settledReportedAt,
      values.settledReportedByLineUserId,
      values.settledReportedByDisplayName,
      values.updatedAt,
      settlementId,
    )
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export async function reportSettlementHandledAtomic(
  db: D1Database,
  input: {
    settlement: PreorderPaymentSettlementRow;
    note: string;
    actorLineUserId: string;
    actorDisplayName: string;
    historyId: string;
    updatedAt: string;
  },
): Promise<void> {
  const statements = [
    db
      .prepare(
        `UPDATE preorder_payment_settlements
         SET status = 'PROVIDER_REPORTED_SETTLED',
             latest_note = ?,
             settled_reported_at = ?,
             settled_reported_by_line_user_id = ?,
             settled_reported_by_display_name = ?,
             updated_at = ?
         WHERE settlement_id = ?
           AND status IN ('AWAITING_RECEIPT_CHECK', 'REFUND_PENDING')`,
      )
      .bind(
        input.note,
        input.updatedAt,
        input.actorLineUserId,
        input.actorDisplayName,
        input.updatedAt,
        input.settlement.settlement_id,
      ),
    prepareAbortIfMissing(
      db,
      `SELECT 1 FROM preorder_payment_settlements
       WHERE settlement_id = ? AND status = 'PROVIDER_REPORTED_SETTLED' AND updated_at = ?`,
      [input.settlement.settlement_id, input.updatedAt],
    ),
    db
      .prepare(
        `INSERT INTO preorder_payment_settlement_history (
          history_id, settlement_id, from_status, to_status,
          actor_line_user_id, actor_display_name, note, created_at
        ) VALUES (?, ?, ?, 'PROVIDER_REPORTED_SETTLED', ?, ?, ?, ?)`,
      )
      .bind(
        input.historyId,
        input.settlement.settlement_id,
        input.settlement.status,
        input.actorLineUserId,
        input.actorDisplayName,
        input.note,
        input.updatedAt,
      ),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    if (isCancelBatchAbort(error)) {
      throw new PreorderCancelBatchConflict();
    }
    throw error;
  }
}

export async function cancelEmptyOffersForProvider(
  db: D1Database,
  eventId: string,
  providerLineUserId: string,
  updatedAt: string,
): Promise<number> {
  const offers = await listPreorderOffersByProvider(db, eventId, providerLineUserId);
  let cancelled = 0;
  for (const offer of offers) {
    const count = await countActiveOrdersForOffer(db, offer.offer_id);
    if (count === 0) {
      await setPreorderOfferStatus(db, offer.offer_id, 'CANCELLED', updatedAt);
      cancelled += 1;
    }
  }
  return cancelled;
}

export async function countActiveOrdersForEvent(db: D1Database, eventId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM preorder_orders
       WHERE event_id = ? AND status != 'CANCELLED'`,
    )
    .bind(eventId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export { asBoolean };
