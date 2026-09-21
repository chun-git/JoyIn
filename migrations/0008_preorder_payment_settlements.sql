-- Independent payment-settlement records for cancelled preorder orders.
-- Order status remains CANCELLED; this table does not verify transfers or refunds.
-- Non-destructive: CREATE only.

CREATE TABLE preorder_payment_settlements (
  settlement_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  offer_id TEXT NOT NULL,
  buyer_line_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'AWAITING_RECEIPT_CHECK',
      'REFUND_PENDING',
      'PROVIDER_REPORTED_SETTLED'
    )
  ),
  source_order_status TEXT NOT NULL CHECK (
    source_order_status IN ('PAYMENT_REPORTED', 'PAYMENT_CONFIRMED')
  ),
  created_by_line_user_id TEXT NOT NULL,
  created_by_display_name TEXT NOT NULL,
  latest_note TEXT,
  settled_reported_at TEXT,
  settled_reported_by_line_user_id TEXT,
  settled_reported_by_display_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES preorder_orders (order_id),
  FOREIGN KEY (offer_id) REFERENCES preorder_offers (offer_id)
);

CREATE INDEX idx_preorder_settlements_offer_status
  ON preorder_payment_settlements (offer_id, status);

CREATE INDEX idx_preorder_settlements_buyer
  ON preorder_payment_settlements (offer_id, buyer_line_user_id, status);

CREATE TABLE preorder_payment_settlement_history (
  history_id TEXT PRIMARY KEY,
  settlement_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_line_user_id TEXT NOT NULL,
  actor_display_name TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (settlement_id) REFERENCES preorder_payment_settlements (settlement_id)
);

CREATE INDEX idx_preorder_settlement_history_settlement
  ON preorder_payment_settlement_history (settlement_id, created_at);
