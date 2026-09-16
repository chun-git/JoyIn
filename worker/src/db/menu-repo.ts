export interface SharedMenuRow {
  menu_id: string;
  current_version_id: string | null;
  merchant_name: string;
  category: string;
  status: 'DRAFT' | 'PUBLISHED' | 'DISABLED';
  created_by_line_user_id: string;
  last_updated_by_line_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface SharedMenuVersionRow {
  version_id: string;
  menu_id: string;
  version_number: number;
  previous_version_id: string | null;
  merchant_name: string;
  category: string;
  description: string;
  merchant_url: string | null;
  menu_image_url: string | null;
  source_url: string | null;
  ai_parse_id: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'DISABLED';
  created_by_line_user_id: string;
  created_at: string;
  published_at: string | null;
}

export interface SharedMenuProductRow {
  menu_product_id: string;
  version_id: string;
  name: string;
  description: string;
  base_price: number;
  is_active: number;
  sort_order: number;
  created_at: string;
}

export interface MenuOptionGroupRow {
  option_group_id: string;
  menu_product_id: string;
  name: string;
  type: 'SINGLE' | 'MULTIPLE' | 'TEXT';
  is_required: number;
  min_selections: number;
  max_selections: number | null;
  sort_order: number;
}

export interface MenuOptionValueRow {
  option_value_id: string;
  option_group_id: string;
  name: string;
  price_adjustment: number;
  is_active: number;
  sort_order: number;
}

export async function listSharedMenus(
  db: D1Database,
  search: string,
  limit = 30,
): Promise<Array<SharedMenuRow & { product_count: number }>> {
  const q = `%${search.trim().slice(0, 80)}%`;
  const { results } = await db
    .prepare(
      `SELECT m.*,
        (SELECT COUNT(*) FROM shared_menu_products p
          WHERE p.version_id = m.current_version_id AND p.is_active = 1) AS product_count
       FROM shared_menus m
       WHERE m.status = 'PUBLISHED'
         AND (
           ? = '%%'
           OR m.merchant_name LIKE ? COLLATE NOCASE
           OR m.category LIKE ? COLLATE NOCASE
           OR EXISTS (
             SELECT 1 FROM shared_menu_products p
             WHERE p.version_id = m.current_version_id
               AND p.name LIKE ? COLLATE NOCASE
           )
         )
       ORDER BY m.updated_at DESC
       LIMIT ?`,
    )
    .bind(q, q, q, q, Math.min(Math.max(limit, 1), 50))
    .all<SharedMenuRow & { product_count: number }>();
  return results;
}

export async function getSharedMenu(db: D1Database, menuId: string): Promise<SharedMenuRow | null> {
  return (
    (await db
      .prepare(`SELECT * FROM shared_menus WHERE menu_id = ?`)
      .bind(menuId)
      .first<SharedMenuRow>()) ?? null
  );
}

export async function getSharedMenuVersion(
  db: D1Database,
  versionId: string,
): Promise<SharedMenuVersionRow | null> {
  return (
    (await db
      .prepare(`SELECT * FROM shared_menu_versions WHERE version_id = ?`)
      .bind(versionId)
      .first<SharedMenuVersionRow>()) ?? null
  );
}

export async function listSharedMenuVersions(
  db: D1Database,
  menuId: string,
): Promise<SharedMenuVersionRow[]> {
  const { results } = await db
    .prepare(`SELECT * FROM shared_menu_versions WHERE menu_id = ? ORDER BY version_number DESC`)
    .bind(menuId)
    .all<SharedMenuVersionRow>();
  return results;
}

export async function listSharedMenuProducts(
  db: D1Database,
  versionId: string,
): Promise<SharedMenuProductRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM shared_menu_products
       WHERE version_id = ? ORDER BY sort_order, created_at`,
    )
    .bind(versionId)
    .all<SharedMenuProductRow>();
  return results;
}

export async function listMenuOptionGroups(
  db: D1Database,
  productIds: string[],
): Promise<MenuOptionGroupRow[]> {
  if (productIds.length === 0) return [];
  const placeholders = productIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT * FROM shared_menu_option_groups
       WHERE menu_product_id IN (${placeholders})
       ORDER BY sort_order, option_group_id`,
    )
    .bind(...productIds)
    .all<MenuOptionGroupRow>();
  return results;
}

export async function listMenuOptionValues(
  db: D1Database,
  groupIds: string[],
): Promise<MenuOptionValueRow[]> {
  if (groupIds.length === 0) return [];
  const placeholders = groupIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT * FROM shared_menu_option_values
       WHERE option_group_id IN (${placeholders})
       ORDER BY sort_order, option_value_id`,
    )
    .bind(...groupIds)
    .all<MenuOptionValueRow>();
  return results;
}

export function insertMenuStatement(db: D1Database, row: SharedMenuRow): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO shared_menus (
        menu_id, current_version_id, merchant_name, category, status,
        created_by_line_user_id, last_updated_by_line_user_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.menu_id,
      row.current_version_id,
      row.merchant_name,
      row.category,
      row.status,
      row.created_by_line_user_id,
      row.last_updated_by_line_user_id,
      row.created_at,
      row.updated_at,
    );
}

export function insertVersionStatement(
  db: D1Database,
  row: SharedMenuVersionRow,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO shared_menu_versions (
        version_id, menu_id, version_number, previous_version_id,
        merchant_name, category, description, merchant_url, menu_image_url, source_url, ai_parse_id,
        status, created_by_line_user_id, created_at, published_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.version_id,
      row.menu_id,
      row.version_number,
      row.previous_version_id,
      row.merchant_name,
      row.category,
      row.description,
      row.merchant_url,
      row.menu_image_url,
      row.source_url,
      row.ai_parse_id,
      row.status,
      row.created_by_line_user_id,
      row.created_at,
      row.published_at,
    );
}

export function insertMenuProductStatement(
  db: D1Database,
  row: SharedMenuProductRow,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO shared_menu_products (
        menu_product_id, version_id, name, description, base_price,
        is_active, sort_order, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.menu_product_id,
      row.version_id,
      row.name,
      row.description,
      row.base_price,
      row.is_active,
      row.sort_order,
      row.created_at,
    );
}

export function insertMenuOptionGroupStatement(
  db: D1Database,
  row: MenuOptionGroupRow,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO shared_menu_option_groups (
        option_group_id, menu_product_id, name, type, is_required,
        min_selections, max_selections, sort_order
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.option_group_id,
      row.menu_product_id,
      row.name,
      row.type,
      row.is_required,
      row.min_selections,
      row.max_selections,
      row.sort_order,
    );
}

export function insertMenuOptionValueStatement(
  db: D1Database,
  row: MenuOptionValueRow,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO shared_menu_option_values (
        option_value_id, option_group_id, name, price_adjustment, is_active, sort_order
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.option_value_id,
      row.option_group_id,
      row.name,
      row.price_adjustment,
      row.is_active,
      row.sort_order,
    );
}

export async function publishMenuVersionConditionally(
  db: D1Database,
  menuId: string,
  expectedVersionId: string | null,
  nextVersionId: string,
  merchantName: string,
  category: string,
  changedBy: string,
  updatedAt: string,
): Promise<boolean> {
  const result = expectedVersionId
    ? await db
        .prepare(
          `UPDATE shared_menus
           SET current_version_id = ?, merchant_name = ?, category = ?,
               status = 'PUBLISHED', last_updated_by_line_user_id = ?, updated_at = ?
           WHERE menu_id = ? AND current_version_id = ?`,
        )
        .bind(
          nextVersionId,
          merchantName,
          category,
          changedBy,
          updatedAt,
          menuId,
          expectedVersionId,
        )
        .run()
    : await db
        .prepare(
          `UPDATE shared_menus
           SET current_version_id = ?, merchant_name = ?, category = ?,
               status = 'PUBLISHED', last_updated_by_line_user_id = ?, updated_at = ?
           WHERE menu_id = ? AND current_version_id IS NULL`,
        )
        .bind(nextVersionId, merchantName, category, changedBy, updatedAt, menuId)
        .run();
  return (result.meta.changes ?? 0) === 1;
}
