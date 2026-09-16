import type {
  ProductOptionGroup,
  ProductOptionGroupInput,
  SharedMenuDetail,
  SharedMenuProduct,
  SharedMenuProductInput,
  SharedMenuStatus,
  SharedMenuSummary,
  SharedMenuVersion,
  SharedMenuVersionInput,
} from '../../../shared/types';
import type { AuthUser } from '../env';
import {
  getSharedMenu,
  getSharedMenuVersion,
  insertMenuOptionGroupStatement,
  insertMenuOptionValueStatement,
  insertMenuProductStatement,
  insertMenuStatement,
  insertVersionStatement,
  listMenuOptionGroups,
  listMenuOptionValues,
  listSharedMenuProducts,
  listSharedMenus,
  listSharedMenuVersions,
  publishMenuVersionConditionally,
  type MenuOptionGroupRow,
  type MenuOptionValueRow,
  type SharedMenuProductRow,
  type SharedMenuRow,
  type SharedMenuVersionRow,
} from '../db/menu-repo';
import { Errors } from '../lib/errors';
import { newId } from '../lib/ids';
import { nowIso } from '../lib/datetime';

function optionalHttpsUrl(value: string | null | undefined, label: string): string | null {
  const trimmed = value?.trim() || '';
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:') throw new Error('protocol');
    return url.toString();
  } catch {
    throw Errors.validation(`${label}只接受有效的 HTTPS 網址`);
  }
}

function normalizeOptionGroups(inputs: ProductOptionGroupInput[] = []): ProductOptionGroupInput[] {
  return inputs.map((group, groupIndex) => {
    const name = group.name?.trim();
    if (!name || name.length > 60) throw Errors.validation('選項群組名稱長度需為 1 到 60 字');
    if (!['SINGLE', 'MULTIPLE', 'TEXT'].includes(group.type)) {
      throw Errors.validation('選項群組類型無效');
    }
    const values = group.type === 'TEXT' ? [] : group.values ?? [];
    if (group.type !== 'TEXT' && values.length === 0) {
      throw Errors.validation(`${name}至少需要一個選項值`);
    }
    const min = group.isRequired ? Math.max(1, Number(group.minSelections ?? 1)) : 0;
    const defaultMax = group.type === 'SINGLE' ? 1 : null;
    const max =
      group.type === 'TEXT'
        ? null
        : group.maxSelections == null
          ? defaultMax
          : Number(group.maxSelections);
    if (!Number.isInteger(min) || min < 0) throw Errors.validation(`${name}最少選擇數無效`);
    if (max != null && (!Number.isInteger(max) || max < 1 || max < min)) {
      throw Errors.validation(`${name}最多選擇數無效`);
    }
    if (group.type === 'SINGLE' && max !== 1) {
      throw Errors.validation(`${name}為單選，最多選擇數必須為 1`);
    }
    return {
      ...group,
      name,
      minSelections: min,
      maxSelections: max,
      sortOrder: Number.isInteger(group.sortOrder) ? Number(group.sortOrder) : groupIndex,
      values: values.map((value, valueIndex) => {
        const valueName = value.name?.trim();
        if (!valueName || valueName.length > 60) {
          throw Errors.validation(`${name}的選項名稱長度需為 1 到 60 字`);
        }
        const adjustment = Number(value.priceAdjustment ?? 0);
        if (!Number.isInteger(adjustment) || adjustment < 0) {
          throw Errors.validation('選項加價必須是非負整數');
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

function normalizeProducts(inputs: SharedMenuProductInput[]): SharedMenuProductInput[] {
  if (!Array.isArray(inputs) || inputs.length === 0) throw Errors.validation('菜單至少需要一項商品');
  return inputs.map((product, index) => {
    const name = product.name?.trim();
    if (!name || name.length > 100) throw Errors.validation('商品名稱長度需為 1 到 100 字');
    const price = Number(product.basePrice);
    if (!Number.isInteger(price) || price < 0) throw Errors.validation('商品基本價格需為非負整數');
    return {
      ...product,
      name,
      description: product.description?.trim().slice(0, 500) || '',
      basePrice: price,
      isActive: product.isActive !== false,
      sortOrder: Number.isInteger(product.sortOrder) ? Number(product.sortOrder) : index,
      optionGroups: normalizeOptionGroups(product.optionGroups),
    };
  });
}

function normalizeVersionInput(input: SharedMenuVersionInput): SharedMenuVersionInput {
  const merchantName = input.merchantName?.trim();
  if (!merchantName || merchantName.length > 100) {
    throw Errors.validation('店家名稱長度需為 1 到 100 字');
  }
  return {
    ...input,
    merchantName,
    category: input.category?.trim().slice(0, 60) || '',
    description: input.description?.trim().slice(0, 1000) || '',
    merchantUrl: optionalHttpsUrl(input.merchantUrl, '店家網址'),
    menuImageUrl: optionalHttpsUrl(input.menuImageUrl, '菜單圖片網址'),
    sourceUrl: optionalHttpsUrl(input.sourceUrl, '資料來源網址'),
    products: normalizeProducts(input.products),
  };
}

function toSummary(
  row: SharedMenuRow & { product_count?: number },
): SharedMenuSummary {
  return {
    menuId: row.menu_id,
    currentVersionId: row.current_version_id,
    merchantName: row.merchant_name,
    category: row.category,
    status: row.status,
    productCount: Number(row.product_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function hydrateProducts(
  db: D1Database,
  versionId: string,
): Promise<SharedMenuProduct[]> {
  const products = await listSharedMenuProducts(db, versionId);
  const groups = await listMenuOptionGroups(
    db,
    products.map((p) => p.menu_product_id),
  );
  const values = await listMenuOptionValues(
    db,
    groups.map((g) => g.option_group_id),
  );
  return products.map((product) => ({
    menuProductId: product.menu_product_id,
    name: product.name,
    description: product.description,
    basePrice: Number(product.base_price),
    isActive: Boolean(product.is_active),
    sortOrder: Number(product.sort_order),
    optionGroups: groups
      .filter((group) => group.menu_product_id === product.menu_product_id)
      .map(
        (group): ProductOptionGroup => ({
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
        }),
      ),
  }));
}

async function toVersion(db: D1Database, row: SharedMenuVersionRow): Promise<SharedMenuVersion> {
  return {
    versionId: row.version_id,
    menuId: row.menu_id,
    versionNumber: Number(row.version_number),
    previousVersionId: row.previous_version_id,
    merchantName: row.merchant_name,
    category: row.category,
    description: row.description,
    merchantUrl: row.merchant_url,
    menuImageUrl: row.menu_image_url,
    sourceUrl: row.source_url,
    aiParseId: row.ai_parse_id,
    status: row.status,
    createdAt: row.created_at,
    publishedAt: row.published_at,
    products: await hydrateProducts(db, row.version_id),
  };
}

function versionStatements(
  db: D1Database,
  row: SharedMenuVersionRow,
  products: SharedMenuProductInput[],
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [insertVersionStatement(db, row)];
  for (const [productIndex, product] of products.entries()) {
    const productId = newId();
    const productRow: SharedMenuProductRow = {
      menu_product_id: productId,
      version_id: row.version_id,
      name: product.name,
      description: product.description || '',
      base_price: Number(product.basePrice),
      is_active: product.isActive === false ? 0 : 1,
      sort_order: product.sortOrder ?? productIndex,
      created_at: row.created_at,
    };
    statements.push(insertMenuProductStatement(db, productRow));
    for (const [groupIndex, group] of (product.optionGroups ?? []).entries()) {
      const groupId = newId();
      const groupRow: MenuOptionGroupRow = {
        option_group_id: groupId,
        menu_product_id: productId,
        name: group.name,
        type: group.type,
        is_required: group.isRequired ? 1 : 0,
        min_selections: Number(group.minSelections ?? (group.isRequired ? 1 : 0)),
        max_selections: group.maxSelections ?? (group.type === 'SINGLE' ? 1 : null),
        sort_order: group.sortOrder ?? groupIndex,
      };
      statements.push(insertMenuOptionGroupStatement(db, groupRow));
      for (const [valueIndex, value] of (group.values ?? []).entries()) {
        const valueRow: MenuOptionValueRow = {
          option_value_id: newId(),
          option_group_id: groupId,
          name: value.name,
          price_adjustment: Number(value.priceAdjustment),
          is_active: value.isActive === false ? 0 : 1,
          sort_order: value.sortOrder ?? valueIndex,
        };
        statements.push(insertMenuOptionValueStatement(db, valueRow));
      }
    }
  }
  return statements;
}

export async function searchMenus(
  db: D1Database,
  search: string,
): Promise<SharedMenuSummary[]> {
  return (await listSharedMenus(db, search)).map(toSummary);
}

export async function getMenuDetail(db: D1Database, menuId: string): Promise<SharedMenuDetail> {
  const menu = await getSharedMenu(db, menuId);
  if (!menu) throw Errors.notFound('找不到共用菜單');
  const current = menu.current_version_id
    ? await getSharedMenuVersion(db, menu.current_version_id)
    : null;
  return {
    menu: toSummary(menu),
    currentVersion: current ? await toVersion(db, current) : null,
  };
}

export async function getMenuVersion(
  db: D1Database,
  menuId: string,
  versionId: string,
): Promise<SharedMenuVersion> {
  const row = await getSharedMenuVersion(db, versionId);
  if (!row || row.menu_id !== menuId) throw Errors.notFound('找不到菜單版本');
  return toVersion(db, row);
}

export async function getMenuVersionById(
  db: D1Database,
  versionId: string,
): Promise<SharedMenuVersion> {
  const row = await getSharedMenuVersion(db, versionId);
  if (!row) throw Errors.notFound('找不到菜單版本');
  return toVersion(db, row);
}

export async function getMenuVersionHistory(
  db: D1Database,
  menuId: string,
): Promise<SharedMenuVersion[]> {
  const menu = await getSharedMenu(db, menuId);
  if (!menu) throw Errors.notFound('找不到共用菜單');
  const rows = await listSharedMenuVersions(db, menuId);
  return Promise.all(rows.map((row) => toVersion(db, row)));
}

export async function createMenuDraft(
  db: D1Database,
  user: AuthUser,
  input: SharedMenuVersionInput,
  idempotencyKey?: string,
): Promise<SharedMenuVersion> {
  const normalized = normalizeVersionInput(input);
  const now = nowIso();
  const menuId = newId();
  const versionId = newId();
  const menu: SharedMenuRow = {
    menu_id: menuId,
    current_version_id: null,
    merchant_name: normalized.merchantName,
    category: normalized.category || '',
    status: 'DRAFT',
    created_by_line_user_id: user.lineUserId,
    last_updated_by_line_user_id: user.lineUserId,
    created_at: now,
    updated_at: now,
  };
  const version: SharedMenuVersionRow = {
    version_id: versionId,
    menu_id: menuId,
    version_number: 1,
    previous_version_id: null,
    merchant_name: normalized.merchantName,
    category: normalized.category || '',
    description: normalized.description || '',
    merchant_url: normalized.merchantUrl || null,
    menu_image_url: normalized.menuImageUrl || null,
    source_url: normalized.sourceUrl || null,
    ai_parse_id: normalized.aiParseId || null,
    status: 'DRAFT',
    created_by_line_user_id: user.lineUserId,
    created_at: now,
    published_at: null,
  };
  await db.batch([
    ...(idempotencyKey
      ? [
          db
            .prepare(
              `INSERT INTO menu_idempotency_keys
               (scope, line_user_id, idempotency_key, resource_id, created_at)
               VALUES ('create_menu', ?, ?, ?, ?)`,
            )
            .bind(user.lineUserId, idempotencyKey, versionId, now),
        ]
      : []),
    insertMenuStatement(db, menu),
    ...versionStatements(db, version, normalized.products),
  ]);
  return toVersion(db, version);
}

export async function createNextMenuVersionDraft(
  db: D1Database,
  menuId: string,
  user: AuthUser,
  input: SharedMenuVersionInput,
  idempotencyKey?: string,
): Promise<SharedMenuVersion> {
  const menu = await getSharedMenu(db, menuId);
  if (!menu) throw Errors.notFound('找不到共用菜單');
  if (menu.status === 'DISABLED') throw Errors.conflict('共用菜單已停用');
  if (input.expectedCurrentVersionId !== menu.current_version_id) {
    throw Errors.conflict('菜單已有其他人發布新版本，請重新整理後再編輯');
  }
  const normalized = normalizeVersionInput(input);
  const latest = await db
    .prepare(`SELECT MAX(version_number) AS n FROM shared_menu_versions WHERE menu_id = ?`)
    .bind(menuId)
    .first<{ n: number | null }>();
  const now = nowIso();
  const row: SharedMenuVersionRow = {
    version_id: newId(),
    menu_id: menuId,
    version_number: Number(latest?.n ?? 0) + 1,
    previous_version_id: menu.current_version_id,
    merchant_name: normalized.merchantName,
    category: normalized.category || '',
    description: normalized.description || '',
    merchant_url: normalized.merchantUrl || null,
    menu_image_url: normalized.menuImageUrl || null,
    source_url: normalized.sourceUrl || null,
    ai_parse_id: normalized.aiParseId || null,
    status: 'DRAFT',
    created_by_line_user_id: user.lineUserId,
    created_at: now,
    published_at: null,
  };
  try {
    await db.batch([
      ...(idempotencyKey
        ? [
            db
              .prepare(
                `INSERT INTO menu_idempotency_keys
                 (scope, line_user_id, idempotency_key, resource_id, created_at)
                 VALUES (?, ?, ?, ?, ?)`,
              )
              .bind(
                `create_menu_version:${menuId}`,
                user.lineUserId,
                idempotencyKey,
                row.version_id,
                now,
              ),
          ]
        : []),
      ...versionStatements(db, row, normalized.products),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/unique|constraint/i.test(message)) {
      throw Errors.conflict('菜單已有其他人建立新版本，請重新整理後再試');
    }
    throw err;
  }
  return toVersion(db, row);
}

export async function publishMenuVersion(
  db: D1Database,
  menuId: string,
  versionId: string,
  user: AuthUser,
  expectedCurrentVersionId: string | null,
  confirmed: boolean,
): Promise<SharedMenuDetail> {
  if (!confirmed) throw Errors.validation('發布前必須確認菜單內容與價格正確');
  const menu = await getSharedMenu(db, menuId);
  const version = await getSharedMenuVersion(db, versionId);
  if (!menu || !version || version.menu_id !== menuId) throw Errors.notFound('找不到菜單版本');
  if (version.status !== 'DRAFT') throw Errors.conflict('此版本已發布或停用');
  if (menu.current_version_id !== expectedCurrentVersionId) {
    throw Errors.conflict('菜單已有其他人發布新版本，請重新整理後再試');
  }
  const now = nowIso();
  const updated = await publishMenuVersionConditionally(
    db,
    menuId,
    expectedCurrentVersionId,
    versionId,
    version.merchant_name,
    version.category,
    user.lineUserId,
    now,
  );
  if (!updated) throw Errors.conflict('菜單版本已變更，請重新整理後再試');
  await db
    .prepare(
      `UPDATE shared_menu_versions
       SET status = 'PUBLISHED', published_at = ?
       WHERE version_id = ? AND status = 'DRAFT'`,
    )
    .bind(now, versionId)
    .run();
  if (version.ai_parse_id) {
    await db
      .prepare(
        `UPDATE menu_ai_parse_results
         SET status = 'CONFIRMED', confirmed_at = ?
         WHERE parse_id = ? AND status = 'DRAFT'`,
      )
      .bind(now, version.ai_parse_id)
      .run();
  }
  return getMenuDetail(db, menuId);
}

export async function disableMenu(
  db: D1Database,
  menuId: string,
  user: AuthUser,
): Promise<SharedMenuDetail> {
  const menu = await getSharedMenu(db, menuId);
  if (!menu) throw Errors.notFound('找不到共用菜單');
  const now = nowIso();
  await db.batch([
    db
      .prepare(
        `UPDATE shared_menus
         SET status = 'DISABLED', last_updated_by_line_user_id = ?, updated_at = ?
         WHERE menu_id = ?`,
      )
      .bind(user.lineUserId, now, menuId),
    db
      .prepare(
        `UPDATE shared_menu_versions SET status = 'DISABLED'
         WHERE version_id = ? AND status = 'PUBLISHED'`,
      )
      .bind(menu.current_version_id),
  ]);
  return getMenuDetail(db, menuId);
}

export async function checkMenuIdempotency(
  db: D1Database,
  scope: string,
  userId: string,
  key: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT resource_id FROM menu_idempotency_keys
       WHERE scope = ? AND line_user_id = ? AND idempotency_key = ?`,
    )
    .bind(scope, userId, key)
    .first<{ resource_id: string }>();
  return row?.resource_id ?? null;
}

export async function saveMenuIdempotency(
  db: D1Database,
  scope: string,
  userId: string,
  key: string,
  resourceId: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO menu_idempotency_keys
       (scope, line_user_id, idempotency_key, resource_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(scope, userId, key, resourceId, nowIso())
    .run();
}

export function isMenuStatus(value: string): value is SharedMenuStatus {
  return ['DRAFT', 'PUBLISHED', 'DISABLED'].includes(value);
}
