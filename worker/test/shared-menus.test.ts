import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import type { Bindings } from '../src/env';
import { AppError } from '../src/lib/errors';
import { assertSafeImageUrl, fetchSafeMenuImage } from '../src/lib/safe-image-fetch';
import { getMyAiMenuQuota, parseMenuImageUrl, taipeiUsageKeys } from '../src/services/menu-ai';
import { authHeaders, createEvent, json } from './helpers';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

const menuPayload = {
  merchantName: '共用茶店',
  category: '飲料',
  description: '測試菜單',
  products: [
    {
      name: '珍珠奶茶',
      description: '招牌',
      basePrice: 60,
      optionGroups: [
        {
          name: '糖度',
          type: 'SINGLE',
          isRequired: true,
          minSelections: 1,
          maxSelections: 1,
          values: [
            { name: '無糖', priceAdjustment: 0 },
            { name: '正常糖', priceAdjustment: 0 },
          ],
        },
        {
          name: '加料',
          type: 'MULTIPLE',
          isRequired: false,
          minSelections: 0,
          maxSelections: 2,
          values: [
            { name: '椰果', priceAdjustment: 10 },
            { name: '珍珠', priceAdjustment: 15 },
          ],
        },
        {
          name: '備註',
          type: 'TEXT',
          isRequired: true,
          values: [],
        },
      ],
    },
  ],
};

async function headers(userId: string, key = crypto.randomUUID()) {
  return { ...(await authHeaders(userId, userId)), 'Idempotency-Key': key };
}

describe('shared menus, versions, and preorder snapshots', () => {
  it('lets any signed-in user publish a new immutable version and snapshots options into an offer', async () => {
    const created = await json<{ version: { menuId: string; versionId: string } }>(
      '/api/menus/drafts',
      {
        method: 'POST',
        headers: await headers('U-menu-a'),
        body: JSON.stringify(menuPayload),
      },
    );
    expect(created.status).toBe(201);
    const { menuId, versionId } = created.body.version;
    const published = await json(`/api/menus/${menuId}/versions/${versionId}/publish`, {
      method: 'POST',
      headers: await headers('U-menu-a'),
      body: JSON.stringify({ expectedCurrentVersionId: null, confirmed: true }),
    });
    expect(published.status).toBe(200);

    const next = await json<{ version: { versionId: string } }>(`/api/menus/${menuId}/versions`, {
      method: 'POST',
      headers: await headers('U-menu-b'),
      body: JSON.stringify({
        ...menuPayload,
        expectedCurrentVersionId: versionId,
        products: [{ ...menuPayload.products[0], basePrice: 70 }],
      }),
    });
    expect(next.status).toBe(201);
    const nextVersionId = next.body.version.versionId;
    expect(nextVersionId).not.toBe(versionId);
    expect(
      (
        await json<{ version: { products: Array<{ basePrice: number }> } }>(
          `/api/menus/${menuId}/versions/${versionId}`,
          { headers: await authHeaders('U-menu-b', 'B') },
        )
      ).body.version.products[0].basePrice,
    ).toBe(60);

    const event = await createEvent('U-menu-a', 'A', { capacity: 3 });
    await json(`/api/events/${event.body.event.eventId}/join`, {
      method: 'POST',
      headers: await authHeaders('U-menu-a', 'A'),
    });
    const fromMenu = await json<{
      offer: {
        offerId: string;
        products: Array<{
          productId: string;
          sourceMenuProductId: string | null;
          optionGroups: Array<{ optionGroupId: string; values: Array<{ optionValueId: string }> }>;
        }>;
      };
    }>(`/api/events/${event.body.event.eventId}/preorders/from-menu`, {
      method: 'POST',
      headers: await headers('U-menu-a'),
      body: JSON.stringify({
        title: '共用菜單代訂',
        orderDeadline: new Date(Date.now() + 86400000).toISOString(),
        menuId,
        menuVersionId: versionId,
        selectedMenuProductIds: [
          (
            await json<{ version: { products: Array<{ menuProductId: string }> } }>(
              `/api/menus/${menuId}/versions/${versionId}`,
              { headers: await authHeaders('U-menu-a', 'A') },
            )
          ).body.version.products[0].menuProductId,
        ],
      }),
    });
    expect(fromMenu.status).toBe(201);
    const product = fromMenu.body.offer.products[0];
    expect(product.sourceMenuProductId).not.toBeNull();
    expect(product.optionGroups).toHaveLength(3);

    const sugar = product.optionGroups[0];
    const topping = product.optionGroups[1];
    const note = product.optionGroups[2];
    const invalid = await json(`/api/preorders/${fromMenu.body.offer.offerId}/my-order`, {
      method: 'PUT',
      headers: await headers('U-menu-a'),
      body: JSON.stringify({
        items: [{ productId: product.productId, quantity: 1, options: [] }],
      }),
    });
    expect(invalid.status).toBe(400);
    const order = await json<{
      order: {
        totalAmount: number;
        items: Array<{ quantity: number; optionPriceSnapshot: number }>;
      };
    }>(
      `/api/preorders/${fromMenu.body.offer.offerId}/my-order`,
      {
        method: 'PUT',
        headers: await headers('U-menu-a'),
        body: JSON.stringify({
          items: [
            {
              productId: product.productId,
              quantity: 1,
              options: [
                { optionGroupId: sugar.optionGroupId, optionValueIds: [sugar.values[0].optionValueId] },
                { optionGroupId: topping.optionGroupId, optionValueIds: [topping.values[0].optionValueId] },
                { optionGroupId: note.optionGroupId, textValue: 'A 杯' },
              ],
            },
            {
              productId: product.productId,
              quantity: 1,
              options: [
                { optionGroupId: sugar.optionGroupId, optionValueIds: [sugar.values[1].optionValueId] },
                { optionGroupId: topping.optionGroupId, optionValueIds: [topping.values[1].optionValueId] },
                { optionGroupId: note.optionGroupId, textValue: 'B 杯' },
              ],
            },
            {
              productId: product.productId,
              quantity: 2,
              options: [
                { optionGroupId: sugar.optionGroupId, optionValueIds: [sugar.values[0].optionValueId] },
                { optionGroupId: topping.optionGroupId, optionValueIds: [topping.values[0].optionValueId] },
                { optionGroupId: note.optionGroupId, textValue: 'A 杯' },
              ],
            },
          ],
        }),
      },
    );
    expect(order.status, JSON.stringify(order.body)).toBe(200);
    expect(order.body.order.totalAmount).toBe(285);
    expect(order.body.order.items).toHaveLength(2);
    expect(order.body.order.items.map((item) => item.quantity).sort()).toEqual([1, 3]);
    expect(order.body.order.items.map((item) => item.optionPriceSnapshot).sort()).toEqual([10, 15]);
    const storedProduct = await env.DB
      .prepare('SELECT ordered_quantity FROM preorder_products WHERE product_id = ?')
      .bind(product.productId)
      .first<{ ordered_quantity: number }>();
    expect(storedProduct?.ordered_quantity).toBe(4);
  });
});

describe('safe menu image fetch and AI quotas', () => {
  it('rejects SSRF, redirects to private targets, oversized and unsupported content', async () => {
    expect(() => assertSafeImageUrl('http://example.com/menu.jpg')).toThrow(/HTTPS/);
    expect(() => assertSafeImageUrl('https://127.0.0.1/menu.jpg')).toThrow(/內部網路/);
    await expect(
      fetchSafeMenuImage('https://example.com/menu.jpg', {
        resolveHost: async () => ['93.184.216.34'],
        fetchImpl: vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/meta' } })) as typeof fetch,
      }),
    ).rejects.toThrow(/內部網路/);
    await expect(
      fetchSafeMenuImage('https://example.com/loop.jpg', {
        resolveHost: async () => ['93.184.216.34'],
        maxRedirects: 1,
        fetchImpl: vi.fn(async () =>
          new Response(null, { status: 302, headers: { location: '/loop.jpg' } }),
        ) as typeof fetch,
      }),
    ).rejects.toThrow(/重新導向次數過多/);
    await expect(
      fetchSafeMenuImage('https://example.com/menu.txt', {
        resolveHost: async () => ['93.184.216.34'],
        fetchImpl: vi.fn(async () => new Response('hello', { headers: { 'content-type': 'text/plain' } })) as typeof fetch,
      }),
    ).rejects.toThrow(/JPEG/);
    await expect(
      fetchSafeMenuImage('https://example.com/large.png', {
        resolveHost: async () => ['93.184.216.34'],
        fetchImpl: vi.fn(async () =>
          new Response(PNG_BYTES, {
            headers: { 'content-type': 'image/png', 'content-length': String(6 * 1024 * 1024) },
          }),
        ) as typeof fetch,
      }),
    ).rejects.toThrow(/5MB/);
    await expect(
      fetchSafeMenuImage('https://example.com/slow.png', {
        resolveHost: async () => ['93.184.216.34'],
        timeoutMs: 5,
        fetchImpl: vi.fn(
          async (_url, init) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () =>
                reject(new DOMException('aborted', 'AbortError')),
              );
            }),
        ) as typeof fetch,
      }),
    ).rejects.toThrow(/逾時/);
  });

  it('charges only successful AI execution, reuses hash cache for free, and resets in Taipei month', async () => {
    const user = { lineUserId: `U-ai-${crypto.randomUUID()}`, displayName: 'AI' };
    const cachedUser = { lineUserId: `U-ai-cache-${crypto.randomUUID()}`, displayName: 'Cache' };
    const aiRun = vi.fn(async () => ({
      response: JSON.stringify({
        merchantName: { value: 'AI 茶店', confidence: 0.9 },
        category: { value: '飲料', confidence: 0.8 },
        products: [
          {
            name: { value: '紅茶', confidence: 0.95 },
            description: { value: '', confidence: 0.5 },
            basePrice: { value: 30, confidence: 0.9 },
            optionGroups: [],
          },
        ],
      }),
    }));
    const fetchImpl = vi.fn(async () =>
      new Response(PNG_BYTES, {
        headers: { 'content-type': 'image/png', 'content-length': String(PNG_BYTES.length) },
      }),
    ) as typeof fetch;
    const bindings = {
      ...(env as unknown as Bindings),
      MENU_AI_MONTHLY_FREE_LIMIT: '1',
      MENU_AI_PLATFORM_DAILY_LIMIT: '50',
    };
    const first = await parseMenuImageUrl(env.DB, bindings, user, 'https://example.com/menu.png', {
      fetchImpl,
      resolveHost: async () => ['93.184.216.34'],
      aiRun,
    });
    expect(first.cacheHit).toBe(false);
    expect((await getMyAiMenuQuota(env.DB, user, bindings)).used).toBe(1);

    const cached = await parseMenuImageUrl(
      env.DB,
      bindings,
      cachedUser,
      'https://cdn.example.com/same.png?token=secret',
      { fetchImpl, resolveHost: async () => ['93.184.216.34'], aiRun },
    );
    expect(cached.cacheHit).toBe(true);
    expect(aiRun).toHaveBeenCalledTimes(1);
    expect((await getMyAiMenuQuota(env.DB, cachedUser, bindings)).used).toBe(0);

    const before = taipeiUsageKeys(new Date('2026-09-30T15:59:59.000Z'));
    const after = taipeiUsageKeys(new Date('2026-09-30T16:00:00.000Z'));
    expect(before.monthKey).toBe('2026-09');
    expect(after.monthKey).toBe('2026-10');
  });

  it('does not charge failed AI parsing', async () => {
    const user = { lineUserId: `U-ai-fail-${crypto.randomUUID()}`, displayName: 'Fail' };
    const bindings = {
      ...(env as unknown as Bindings),
      MENU_AI_MONTHLY_FREE_LIMIT: '1',
      MENU_AI_PLATFORM_DAILY_LIMIT: '50',
    };
    await expect(
      parseMenuImageUrl(env.DB, bindings, user, 'https://example.com/fail.png', {
        fetchImpl: vi.fn(async () =>
          new Response(new Uint8Array([...PNG_BYTES, 9]), { headers: { 'content-type': 'image/png' } }),
        ) as typeof fetch,
        resolveHost: async () => ['93.184.216.34'],
        aiRun: async () => {
          throw new Error('model down');
        },
      }),
    ).rejects.toBeInstanceOf(AppError);
    expect((await getMyAiMenuQuota(env.DB, user, bindings)).used).toBe(0);
  });

  it('atomically blocks concurrent monthly overuse and enforces the platform daily limit', async () => {
    const now = new Date('2031-03-10T02:00:00.000Z');
    const monthlyUser = { lineUserId: `U-ai-race-${crypto.randomUUID()}`, displayName: 'Race' };
    const bindings = {
      ...(env as unknown as Bindings),
      MENU_AI_MONTHLY_FREE_LIMIT: '1',
      MENU_AI_PLATFORM_DAILY_LIMIT: '5',
    };
    const aiRun = async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return {
        response: JSON.stringify({
          merchantName: { value: '並行店', confidence: 1 },
          category: { value: '', confidence: 1 },
          products: [
            {
              name: { value: '商品', confidence: 1 },
              description: { value: '', confidence: 1 },
              basePrice: { value: 10, confidence: 1 },
              optionGroups: [],
            },
          ],
        }),
      };
    };
    const calls = await Promise.allSettled(
      [1, 2].map((suffix) =>
        parseMenuImageUrl(
          env.DB,
          bindings,
          monthlyUser,
          `https://example.com/race-${suffix}.png`,
          {
            now,
            resolveHost: async () => ['93.184.216.34'],
            fetchImpl: vi.fn(async () =>
              new Response(new Uint8Array([...PNG_BYTES, suffix]), {
                headers: { 'content-type': 'image/png' },
              }),
            ) as typeof fetch,
            aiRun,
          },
        ),
      ),
    );
    expect(calls.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(calls.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const dailyBindings = { ...bindings, MENU_AI_PLATFORM_DAILY_LIMIT: '1' };
    const otherUser = { lineUserId: `U-ai-daily-${crypto.randomUUID()}`, displayName: 'Daily' };
    await expect(
      parseMenuImageUrl(env.DB, dailyBindings, otherUser, 'https://example.com/daily.png', {
        now,
        resolveHost: async () => ['93.184.216.34'],
        fetchImpl: vi.fn(async () =>
          new Response(new Uint8Array([...PNG_BYTES, 99]), {
            headers: { 'content-type': 'image/png' },
          }),
        ) as typeof fetch,
        aiRun,
      }),
    ).rejects.toMatchObject({ status: 429 });
    expect((await getMyAiMenuQuota(env.DB, otherUser, dailyBindings, now)).used).toBe(0);
  });
});
