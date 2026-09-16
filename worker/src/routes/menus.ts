import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { parseJson, requireGroupId, requireString, userOf } from '../lib/http';
import {
  checkMenuIdempotency,
  createMenuDraft,
  createNextMenuVersionDraft,
  disableMenu,
  getMenuDetail,
  getMenuVersion,
  getMenuVersionById,
  getMenuVersionHistory,
  publishMenuVersion,
  saveMenuIdempotency,
  searchMenus,
} from '../services/menus';
import { getAiMenuDraftById, getMyAiMenuQuota, parseMenuImageUrl } from '../services/menu-ai';
import type { SharedMenuVersionInput } from '../../../shared/types';

export const menuRoutes = new Hono<AppEnv>();

function idempotencyKey(c: Parameters<typeof requireGroupId>[0]): string {
  return requireString(c.req.header('Idempotency-Key'), 'Idempotency-Key', 8, 120);
}

menuRoutes.get('/menus', async (c) => {
  requireGroupId(c);
  const menus = await searchMenus(c.env.DB, c.req.query('q') || '');
  return c.json({ menus });
});

menuRoutes.post('/menus/drafts', async (c) => {
  requireGroupId(c);
  const user = userOf(c);
  const key = idempotencyKey(c);
  const existing = await checkMenuIdempotency(c.env.DB, 'create_menu', user.lineUserId, key);
  if (existing) {
    const version = await getMenuVersionById(c.env.DB, existing);
    return c.json({ version, idempotencyHit: true });
  }
  const body = parseJson<SharedMenuVersionInput>(await c.req.json());
  try {
    const version = await createMenuDraft(c.env.DB, user, body, key);
    return c.json({ version, idempotencyHit: false }, 201);
  } catch (err) {
    const raced = await checkMenuIdempotency(c.env.DB, 'create_menu', user.lineUserId, key);
    if (!raced) throw err;
    return c.json({ version: await getMenuVersionById(c.env.DB, raced), idempotencyHit: true });
  }
});

menuRoutes.get('/menus/:menuId', async (c) => {
  requireGroupId(c);
  const detail = await getMenuDetail(c.env.DB, requireString(c.req.param('menuId'), 'menuId'));
  return c.json(detail);
});

menuRoutes.get('/menus/:menuId/versions', async (c) => {
  requireGroupId(c);
  const versions = await getMenuVersionHistory(
    c.env.DB,
    requireString(c.req.param('menuId'), 'menuId'),
  );
  return c.json({ versions });
});

menuRoutes.get('/menus/:menuId/versions/:versionId', async (c) => {
  requireGroupId(c);
  const version = await getMenuVersion(
    c.env.DB,
    requireString(c.req.param('menuId'), 'menuId'),
    requireString(c.req.param('versionId'), 'versionId'),
  );
  return c.json({ version });
});

menuRoutes.post('/menus/:menuId/versions', async (c) => {
  requireGroupId(c);
  const user = userOf(c);
  const key = idempotencyKey(c);
  const menuId = requireString(c.req.param('menuId'), 'menuId');
  const existing = await checkMenuIdempotency(
    c.env.DB,
    `create_menu_version:${menuId}`,
    user.lineUserId,
    key,
  );
  if (existing) {
    const version = await getMenuVersion(c.env.DB, menuId, existing);
    return c.json({ version, idempotencyHit: true });
  }
  const body = parseJson<SharedMenuVersionInput>(await c.req.json());
  try {
    const version = await createNextMenuVersionDraft(c.env.DB, menuId, user, body, key);
    return c.json({ version, idempotencyHit: false }, 201);
  } catch (err) {
    const raced = await checkMenuIdempotency(
      c.env.DB,
      `create_menu_version:${menuId}`,
      user.lineUserId,
      key,
    );
    if (!raced) throw err;
    return c.json({ version: await getMenuVersion(c.env.DB, menuId, raced), idempotencyHit: true });
  }
});

menuRoutes.post('/menus/:menuId/versions/:versionId/publish', async (c) => {
  requireGroupId(c);
  const user = userOf(c);
  const key = idempotencyKey(c);
  const menuId = requireString(c.req.param('menuId'), 'menuId');
  const versionId = requireString(c.req.param('versionId'), 'versionId');
  const scope = `publish_menu_version:${versionId}`;
  const existing = await checkMenuIdempotency(c.env.DB, scope, user.lineUserId, key);
  if (existing) return c.json(await getMenuDetail(c.env.DB, menuId));
  const body = parseJson<Record<string, unknown>>(await c.req.json());
  const detail = await publishMenuVersion(
    c.env.DB,
    menuId,
    versionId,
    user,
    body.expectedCurrentVersionId == null ? null : String(body.expectedCurrentVersionId),
    body.confirmed === true,
  );
  await saveMenuIdempotency(c.env.DB, scope, user.lineUserId, key, versionId);
  return c.json(detail);
});

menuRoutes.post('/menus/:menuId/disable', async (c) => {
  requireGroupId(c);
  const user = userOf(c);
  const key = idempotencyKey(c);
  const menuId = requireString(c.req.param('menuId'), 'menuId');
  const scope = `disable_menu:${menuId}`;
  const existing = await checkMenuIdempotency(c.env.DB, scope, user.lineUserId, key);
  if (existing) return c.json(await getMenuDetail(c.env.DB, menuId));
  const detail = await disableMenu(
    c.env.DB,
    menuId,
    user,
  );
  await saveMenuIdempotency(c.env.DB, scope, user.lineUserId, key, menuId);
  return c.json(detail);
});

menuRoutes.get('/menus/ai/quota/me', async (c) => {
  requireGroupId(c);
  const quota = await getMyAiMenuQuota(c.env.DB, userOf(c), c.env);
  return c.json({ quota });
});

menuRoutes.post('/menus/ai/parse-image', async (c) => {
  requireGroupId(c);
  const user = userOf(c);
  const key = idempotencyKey(c);
  const existing = await checkMenuIdempotency(c.env.DB, 'ai_menu_parse', user.lineUserId, key);
  if (existing) return c.json({ draft: await getAiMenuDraftById(c.env.DB, existing) });
  const body = parseJson<Record<string, unknown>>(await c.req.json());
  const imageUrl = requireString(body.imageUrl, '圖片網址', 8, 2048);
  const draft = await parseMenuImageUrl(c.env.DB, c.env, user, imageUrl);
  await saveMenuIdempotency(c.env.DB, 'ai_menu_parse', user.lineUserId, key, draft.parseId);
  return c.json({ draft });
});
