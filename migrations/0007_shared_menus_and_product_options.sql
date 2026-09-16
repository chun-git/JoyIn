-- Shared menu library, immutable versions, flexible product options, and AI import quotas.
-- Non-destructive: only ALTER TABLE, CREATE TABLE, and CREATE INDEX.

ALTER TABLE preorder_offers ADD COLUMN shared_menu_version_id TEXT;
ALTER TABLE preorder_products ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE preorder_products ADD COLUMN source_menu_product_id TEXT;
CREATE INDEX idx_preorder_products_source_menu
  ON preorder_products (source_menu_product_id);
ALTER TABLE preorder_order_items ADD COLUMN option_price_snapshot INTEGER NOT NULL DEFAULT 0;

CREATE TABLE shared_menus (
  menu_id TEXT PRIMARY KEY,
  current_version_id TEXT,
  merchant_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'DISABLED')),
  created_by_line_user_id TEXT NOT NULL,
  last_updated_by_line_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_shared_menus_search
  ON shared_menus (status, merchant_name, category, updated_at DESC);

CREATE TABLE shared_menu_versions (
  version_id TEXT PRIMARY KEY,
  menu_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  previous_version_id TEXT,
  merchant_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  merchant_url TEXT,
  menu_image_url TEXT,
  source_url TEXT,
  ai_parse_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'DISABLED')),
  created_by_line_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT,
  FOREIGN KEY (menu_id) REFERENCES shared_menus (menu_id),
  FOREIGN KEY (previous_version_id) REFERENCES shared_menu_versions (version_id),
  UNIQUE (menu_id, version_number)
);

CREATE INDEX idx_shared_menu_versions_menu
  ON shared_menu_versions (menu_id, version_number DESC);

CREATE TABLE shared_menu_products (
  menu_product_id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  base_price INTEGER NOT NULL CHECK (base_price >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (version_id) REFERENCES shared_menu_versions (version_id)
);

CREATE INDEX idx_shared_menu_products_version
  ON shared_menu_products (version_id, sort_order, created_at);
CREATE INDEX idx_shared_menu_products_name
  ON shared_menu_products (name);

CREATE TABLE shared_menu_option_groups (
  option_group_id TEXT PRIMARY KEY,
  menu_product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('SINGLE', 'MULTIPLE', 'TEXT')),
  is_required INTEGER NOT NULL DEFAULT 0 CHECK (is_required IN (0, 1)),
  min_selections INTEGER NOT NULL DEFAULT 0 CHECK (min_selections >= 0),
  max_selections INTEGER CHECK (max_selections IS NULL OR max_selections >= 1),
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (menu_product_id) REFERENCES shared_menu_products (menu_product_id)
);

CREATE INDEX idx_shared_menu_option_groups_product
  ON shared_menu_option_groups (menu_product_id, sort_order);

CREATE TABLE shared_menu_option_values (
  option_value_id TEXT PRIMARY KEY,
  option_group_id TEXT NOT NULL,
  name TEXT NOT NULL,
  price_adjustment INTEGER NOT NULL DEFAULT 0 CHECK (price_adjustment >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (option_group_id) REFERENCES shared_menu_option_groups (option_group_id)
);

CREATE INDEX idx_shared_menu_option_values_group
  ON shared_menu_option_values (option_group_id, sort_order);

CREATE TABLE preorder_product_option_groups (
  option_group_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  source_option_group_id TEXT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('SINGLE', 'MULTIPLE', 'TEXT')),
  is_required INTEGER NOT NULL DEFAULT 0 CHECK (is_required IN (0, 1)),
  min_selections INTEGER NOT NULL DEFAULT 0 CHECK (min_selections >= 0),
  max_selections INTEGER CHECK (max_selections IS NULL OR max_selections >= 1),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES preorder_products (product_id)
);

CREATE INDEX idx_preorder_option_groups_product
  ON preorder_product_option_groups (product_id, sort_order);

CREATE TABLE preorder_product_option_values (
  option_value_id TEXT PRIMARY KEY,
  option_group_id TEXT NOT NULL,
  source_option_value_id TEXT,
  name TEXT NOT NULL,
  price_adjustment INTEGER NOT NULL DEFAULT 0 CHECK (price_adjustment >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (option_group_id) REFERENCES preorder_product_option_groups (option_group_id)
);

CREATE INDEX idx_preorder_option_values_group
  ON preorder_product_option_values (option_group_id, sort_order);

CREATE TABLE preorder_order_item_options (
  order_item_option_id TEXT PRIMARY KEY,
  order_item_id TEXT NOT NULL,
  option_group_id TEXT NOT NULL,
  option_value_id TEXT,
  group_name_snapshot TEXT NOT NULL,
  option_name_snapshot TEXT NOT NULL,
  price_adjustment_snapshot INTEGER NOT NULL DEFAULT 0 CHECK (price_adjustment_snapshot >= 0),
  text_value_snapshot TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (order_item_id) REFERENCES preorder_order_items (order_item_id)
);

CREATE INDEX idx_preorder_order_item_options_item
  ON preorder_order_item_options (order_item_id);

CREATE TABLE menu_ai_parse_results (
  parse_id TEXT PRIMARY KEY,
  image_hash TEXT NOT NULL,
  source_url_safe TEXT NOT NULL,
  model_name TEXT NOT NULL,
  structured_result_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'CONFIRMED', 'FAILED')),
  created_by_line_user_id TEXT NOT NULL,
  parsed_at TEXT NOT NULL,
  confirmed_at TEXT
);

CREATE UNIQUE INDEX idx_menu_ai_parse_success_hash
  ON menu_ai_parse_results (image_hash)
  WHERE status IN ('DRAFT', 'CONFIRMED');
CREATE INDEX idx_menu_ai_parse_user
  ON menu_ai_parse_results (created_by_line_user_id, parsed_at DESC);

CREATE TABLE menu_ai_monthly_usage (
  line_user_id TEXT NOT NULL,
  month_key TEXT NOT NULL,
  successful_count INTEGER NOT NULL DEFAULT 0 CHECK (successful_count >= 0),
  reserved_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (line_user_id, month_key)
);

CREATE TABLE menu_ai_daily_usage (
  date_key TEXT PRIMARY KEY,
  execution_count INTEGER NOT NULL DEFAULT 0 CHECK (execution_count >= 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE menu_idempotency_keys (
  scope TEXT NOT NULL,
  line_user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (scope, line_user_id, idempotency_key)
);
