-- Preorder (代訂) MVP tables. Non-destructive: CREATE only.

CREATE TABLE preorder_offers (
  offer_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  provider_line_user_id TEXT NOT NULL,
  provider_display_name TEXT NOT NULL,
  title TEXT NOT NULL,
  merchant_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  order_deadline TEXT NOT NULL,
  payment_instructions TEXT NOT NULL DEFAULT '',
  payment_url TEXT,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED', 'CANCELLED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events (event_id)
);

CREATE INDEX idx_preorder_offers_event ON preorder_offers (event_id, status);
CREATE INDEX idx_preorder_offers_group ON preorder_offers (group_id, event_id);
CREATE INDEX idx_preorder_offers_provider ON preorder_offers (event_id, provider_line_user_id);

CREATE TABLE preorder_products (
  product_id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL,
  name TEXT NOT NULL,
  specification TEXT,
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  quantity_limit INTEGER CHECK (quantity_limit IS NULL OR quantity_limit >= 1),
  ordered_quantity INTEGER NOT NULL DEFAULT 0 CHECK (ordered_quantity >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (offer_id) REFERENCES preorder_offers (offer_id)
);

CREATE INDEX idx_preorder_products_offer ON preorder_products (offer_id, sort_order, created_at);

CREATE TABLE preorder_orders (
  order_id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  buyer_line_user_id TEXT NOT NULL,
  buyer_display_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'PENDING_PAYMENT',
      'PAYMENT_REPORTED',
      'PAYMENT_CONFIRMED',
      'CANCELLED',
      'FULFILLED'
    )
  ),
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  cancellation_reason TEXT,
  payment_reported_at TEXT,
  payment_confirmed_at TEXT,
  fulfilled_at TEXT,
  idempotency_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (offer_id) REFERENCES preorder_offers (offer_id),
  FOREIGN KEY (event_id) REFERENCES events (event_id)
);

CREATE UNIQUE INDEX idx_preorder_orders_buyer_active
  ON preorder_orders (offer_id, buyer_line_user_id)
  WHERE status != 'CANCELLED';

CREATE UNIQUE INDEX idx_preorder_orders_idempotency
  ON preorder_orders (offer_id, buyer_line_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_preorder_orders_offer_status ON preorder_orders (offer_id, status);
CREATE INDEX idx_preorder_orders_event_buyer ON preorder_orders (event_id, buyer_line_user_id);

CREATE TABLE preorder_order_items (
  order_item_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name_snapshot TEXT NOT NULL,
  specification_snapshot TEXT,
  unit_price_snapshot INTEGER NOT NULL CHECK (unit_price_snapshot >= 0),
  quantity INTEGER NOT NULL CHECK (quantity >= 1),
  subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES preorder_orders (order_id),
  FOREIGN KEY (product_id) REFERENCES preorder_products (product_id)
);

CREATE INDEX idx_preorder_order_items_order ON preorder_order_items (order_id);

CREATE TABLE preorder_order_status_history (
  history_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by_line_user_id TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES preorder_orders (order_id)
);

CREATE INDEX idx_preorder_order_history_order ON preorder_order_status_history (order_id, created_at);
