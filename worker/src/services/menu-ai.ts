import type {
  AiMenuDraft,
  AiMenuFieldConfidence,
  AiMenuQuota,
  ProductOptionGroupInput,
} from '../../../shared/types';
import type { AuthUser, Bindings } from '../env';
import { Errors } from '../lib/errors';
import { nowIso } from '../lib/datetime';
import { newId } from '../lib/ids';
import { fetchSafeMenuImage } from '../lib/safe-image-fetch';

export const DEFAULT_MENU_AI_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
export const DEFAULT_MONTHLY_AI_LIMIT = 1;
export const DEFAULT_PLATFORM_DAILY_LIMIT = 50;
const RESERVATION_STALE_MS = 2 * 60 * 1000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function menuAiLimits(env: Pick<Bindings, 'MENU_AI_MONTHLY_FREE_LIMIT' | 'MENU_AI_PLATFORM_DAILY_LIMIT'>) {
  return {
    monthly: positiveInt(env.MENU_AI_MONTHLY_FREE_LIMIT, DEFAULT_MONTHLY_AI_LIMIT),
    daily: positiveInt(env.MENU_AI_PLATFORM_DAILY_LIMIT, DEFAULT_PLATFORM_DAILY_LIMIT),
  };
}

export function taipeiUsageKeys(now = new Date()): {
  monthKey: string;
  dateKey: string;
  nextResetAt: string;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const dateKey = `${get('year')}-${get('month')}-${get('day')}`;
  const monthKey = `${get('year')}-${get('month')}`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextResetAt = new Date(
    `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+08:00`,
  ).toISOString();
  return { monthKey, dateKey, nextResetAt };
}

async function reserveQuota(
  db: D1Database,
  userId: string,
  monthlyLimit: number,
  dailyLimit: number,
  now = new Date(),
): Promise<{ monthKey: string; dateKey: string }> {
  const { monthKey, dateKey } = taipeiUsageKeys(now);
  const nowValue = now.toISOString();
  const stale = new Date(now.getTime() - RESERVATION_STALE_MS).toISOString();
  const monthly = await db
    .prepare(
      `INSERT INTO menu_ai_monthly_usage
        (line_user_id, month_key, successful_count, reserved_at, updated_at)
       VALUES (?, ?, 0, ?, ?)
       ON CONFLICT(line_user_id, month_key) DO UPDATE SET
         reserved_at = excluded.reserved_at,
         updated_at = excluded.updated_at
       WHERE menu_ai_monthly_usage.successful_count < ?
         AND (
           menu_ai_monthly_usage.reserved_at IS NULL
           OR menu_ai_monthly_usage.reserved_at < ?
         )`,
    )
    .bind(userId, monthKey, nowValue, nowValue, monthlyLimit, stale)
    .run();
  if ((monthly.meta.changes ?? 0) !== 1) {
    throw Errors.aiMonthlyLimit();
  }

  const daily = await db
    .prepare(
      `INSERT INTO menu_ai_daily_usage (date_key, execution_count, updated_at)
       VALUES (?, 1, ?)
       ON CONFLICT(date_key) DO UPDATE SET
         execution_count = menu_ai_daily_usage.execution_count + 1,
         updated_at = excluded.updated_at
       WHERE menu_ai_daily_usage.execution_count < ?`,
    )
    .bind(dateKey, nowValue, dailyLimit)
    .run();
  if ((daily.meta.changes ?? 0) !== 1) {
    await db
      .prepare(
        `UPDATE menu_ai_monthly_usage SET reserved_at = NULL, updated_at = ?
         WHERE line_user_id = ? AND month_key = ? AND reserved_at = ?`,
      )
      .bind(nowValue, userId, monthKey, nowValue)
      .run();
    throw Errors.aiDailyLimit();
  }
  return { monthKey, dateKey };
}

async function releaseQuota(
  db: D1Database,
  userId: string,
  monthKey: string,
): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `UPDATE menu_ai_monthly_usage SET reserved_at = NULL, updated_at = ?
       WHERE line_user_id = ? AND month_key = ? AND successful_count = 0`,
    )
    .bind(now, userId, monthKey)
    .run();
}

async function consumeQuota(
  db: D1Database,
  userId: string,
  monthKey: string,
): Promise<void> {
  const result = await db
    .prepare(
      `UPDATE menu_ai_monthly_usage
       SET successful_count = successful_count + 1, reserved_at = NULL, updated_at = ?
       WHERE line_user_id = ? AND month_key = ? AND reserved_at IS NOT NULL`,
    )
    .bind(nowIso(), userId, monthKey)
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw Errors.conflict('AI 額度狀態已變更，請重新整理');
  }
}

function confidence(value: unknown): AiMenuFieldConfidence {
  if (value && typeof value === 'object') {
    const row = value as { value?: unknown; confidence?: unknown };
    return {
      value:
        typeof row.value === 'string' || typeof row.value === 'number' || row.value == null
          ? (row.value ?? null)
          : String(row.value),
      confidence: Math.max(0, Math.min(1, Number(row.confidence) || 0)),
    };
  }
  return {
    value: typeof value === 'string' || typeof value === 'number' ? value : null,
    confidence: 0,
  };
}

function parseOptionGroups(value: unknown): ProductOptionGroupInput[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((group, groupIndex) => ({
      name: String(group.name || '').trim().slice(0, 60),
      type: ['SINGLE', 'MULTIPLE', 'TEXT'].includes(String(group.type))
        ? (String(group.type) as ProductOptionGroupInput['type'])
        : 'SINGLE',
      isRequired: Boolean(group.isRequired),
      minSelections: Math.max(0, Number(group.minSelections) || 0),
      maxSelections:
        group.maxSelections == null ? null : Math.max(1, Number(group.maxSelections) || 1),
      sortOrder: groupIndex,
      values: Array.isArray(group.values)
        ? group.values
            .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
            .map((option, optionIndex) => ({
              name: String(option.name || '').trim().slice(0, 60),
              priceAdjustment: Math.round(Number(option.priceAdjustment) || 0),
              isActive: true,
              sortOrder: optionIndex,
            }))
            .filter((option) => option.name)
        : [],
    }))
    .filter((group) => group.name);
}

function parseAiPayload(
  raw: unknown,
  parseId: string,
  cacheHit: boolean,
  modelName: string,
  parsedAt: string,
): AiMenuDraft {
  let value: unknown = raw;
  if (value && typeof value === 'object' && 'response' in value) {
    value = (value as { response?: unknown }).response;
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/^```(?:json)?\s*|\s*```$/g, '');
    try {
      value = JSON.parse(cleaned);
    } catch {
      throw Errors.aiParseFailed('AI 無法產生可編輯的菜單草稿，請重試或改用手動輸入');
    }
  }
  if (!value || typeof value !== 'object') {
    throw Errors.aiParseFailed('AI 無法產生可編輯的菜單草稿，請重試或改用手動輸入');
  }
  const payload = value as Record<string, unknown>;
  const products = Array.isArray(payload.products)
    ? payload.products
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .map((product) => ({
          name: confidence(product.name),
          description: confidence(product.description),
          basePrice: confidence(product.basePrice),
          optionGroups: parseOptionGroups(product.optionGroups),
        }))
        .filter((product) => String(product.name.value || '').trim())
    : [];
  if (products.length === 0) {
    throw Errors.aiParseFailed('AI 未辨識到商品，請換一張較清楚的圖片或手動輸入');
  }
  return {
    parseId,
    cacheHit,
    merchantName: confidence(payload.merchantName),
    category: confidence(payload.category),
    products,
    modelName,
    parsedAt,
  };
}

const MENU_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    merchantName: {
      type: 'object',
      additionalProperties: false,
      properties: { value: { type: ['string', 'null'] }, confidence: { type: 'number' } },
      required: ['value', 'confidence'],
    },
    category: {
      type: 'object',
      additionalProperties: false,
      properties: { value: { type: ['string', 'null'] }, confidence: { type: 'number' } },
      required: ['value', 'confidence'],
    },
    products: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: {
            type: 'object',
            additionalProperties: false,
            properties: {
              value: { type: ['string', 'null'] },
              confidence: { type: 'number' },
            },
            required: ['value', 'confidence'],
          },
          description: {
            type: 'object',
            additionalProperties: false,
            properties: {
              value: { type: ['string', 'null'] },
              confidence: { type: 'number' },
            },
            required: ['value', 'confidence'],
          },
          basePrice: {
            type: 'object',
            additionalProperties: false,
            properties: {
              value: { type: ['number', 'null'] },
              confidence: { type: 'number' },
            },
            required: ['value', 'confidence'],
          },
          optionGroups: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string' },
                type: { type: 'string', enum: ['SINGLE', 'MULTIPLE', 'TEXT'] },
                isRequired: { type: 'boolean' },
                minSelections: { type: 'integer' },
                maxSelections: { type: ['integer', 'null'] },
                values: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      name: { type: 'string' },
                      priceAdjustment: { type: 'integer' },
                    },
                    required: ['name', 'priceAdjustment'],
                  },
                },
              },
              required: [
                'name',
                'type',
                'isRequired',
                'minSelections',
                'maxSelections',
                'values',
              ],
            },
          },
        },
        required: ['name', 'description', 'basePrice', 'optionGroups'],
      },
    },
  },
  required: ['merchantName', 'category', 'products'],
};

export async function getMyAiMenuQuota(
  db: D1Database,
  user: AuthUser,
  env: Pick<Bindings, 'MENU_AI_MONTHLY_FREE_LIMIT' | 'MENU_AI_PLATFORM_DAILY_LIMIT'>,
  now = new Date(),
): Promise<AiMenuQuota> {
  const limits = menuAiLimits(env);
  const { monthKey, dateKey, nextResetAt } = taipeiUsageKeys(now);
  const [monthly, daily] = await Promise.all([
    db
      .prepare(
        `SELECT successful_count FROM menu_ai_monthly_usage
         WHERE line_user_id = ? AND month_key = ?`,
      )
      .bind(user.lineUserId, monthKey)
      .first<{ successful_count: number }>(),
    db
      .prepare(`SELECT execution_count FROM menu_ai_daily_usage WHERE date_key = ?`)
      .bind(dateKey)
      .first<{ execution_count: number }>(),
  ]);
  return {
    used: Number(monthly?.successful_count ?? 0),
    limit: limits.monthly,
    nextResetAt,
    platformDailyRemaining: Math.max(0, limits.daily - Number(daily?.execution_count ?? 0)),
  };
}

export async function getAiMenuDraftById(
  db: D1Database,
  parseId: string,
): Promise<AiMenuDraft> {
  const row = await db
    .prepare(
      `SELECT parse_id, structured_result_json, model_name, parsed_at
       FROM menu_ai_parse_results WHERE parse_id = ? AND status IN ('DRAFT', 'CONFIRMED')`,
    )
    .bind(parseId)
    .first<{
      parse_id: string;
      structured_result_json: string;
      model_name: string;
      parsed_at: string;
    }>();
  if (!row) throw Errors.notFound('找不到 AI 菜單草稿');
  return parseAiPayload(
    JSON.parse(row.structured_result_json),
    row.parse_id,
    true,
    row.model_name,
    row.parsed_at,
  );
}

export async function parseMenuImageUrl(
  db: D1Database,
  env: Bindings,
  user: AuthUser,
  imageUrl: string,
  options: {
    fetchImpl?: typeof fetch;
    resolveHost?: (hostname: string) => Promise<string[]>;
    aiRun?: (model: string, input: Record<string, unknown>) => Promise<unknown>;
    now?: Date;
  } = {},
): Promise<AiMenuDraft> {
  const image = await fetchSafeMenuImage(imageUrl, {
    fetchImpl: options.fetchImpl,
    resolveHost: options.resolveHost,
  });
  const cached = await db
    .prepare(
      `SELECT parse_id, structured_result_json, model_name, parsed_at
       FROM menu_ai_parse_results
       WHERE image_hash = ? AND status IN ('DRAFT', 'CONFIRMED')`,
    )
    .bind(image.sha256)
    .first<{
      parse_id: string;
      structured_result_json: string;
      model_name: string;
      parsed_at: string;
    }>();
  if (cached) {
    return parseAiPayload(
      JSON.parse(cached.structured_result_json),
      cached.parse_id,
      true,
      cached.model_name,
      cached.parsed_at,
    );
  }

  const limits = menuAiLimits(env);
  const reservation = await reserveQuota(
    db,
    user.lineUserId,
    limits.monthly,
    limits.daily,
    options.now,
  );
  const model = env.MENU_AI_MODEL || DEFAULT_MENU_AI_MODEL;
  const aiRun =
    options.aiRun ??
    ((modelName: string, input: Record<string, unknown>) =>
      env.AI.run(modelName as Parameters<Ai['run']>[0], input as never));
  const parsedAt = (options.now ?? new Date()).toISOString();
  const parseId = newId();
  let storedResult = false;
  try {
    const result = await aiRun(model, {
      image: `data:${image.contentType};base64,${bytesToBase64(image.bytes)}`,
      messages: [
        {
          role: 'system',
          content:
            '你是菜單 OCR 助理。只輸出符合 schema 的 JSON；不要猜測看不清楚的內容，所有文字使用繁體中文。',
        },
        {
          role: 'user',
          content:
            '辨識店家、分類、商品名稱、說明、基本價格與可見選項。confidence 使用 0 到 1。',
        },
      ],
      max_tokens: 4096,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'joyin_menu', strict: true, schema: MENU_JSON_SCHEMA },
      },
    });
    const draft = parseAiPayload(result, parseId, false, model, parsedAt);
    await db
      .prepare(
        `INSERT INTO menu_ai_parse_results (
          parse_id, image_hash, source_url_safe, model_name, structured_result_json,
          status, created_by_line_user_id, parsed_at, confirmed_at
         ) VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, NULL)`,
      )
      .bind(
        parseId,
        image.sha256,
        image.safeUrl,
        model,
        JSON.stringify({
          merchantName: draft.merchantName,
          category: draft.category,
          products: draft.products,
        }),
        user.lineUserId,
        parsedAt,
      )
      .run();
    storedResult = true;
    await consumeQuota(db, user.lineUserId, reservation.monthKey);
    return draft;
  } catch (err) {
    console.error('[JoyIn menu AI]', {
      operation: 'parse_menu_image',
      model,
      errorName: err instanceof Error ? err.name : typeof err,
      errorMessage:
        err instanceof Error ? err.message.slice(0, 180) : String(err).slice(0, 180),
    });
    if (storedResult) {
      await db
        .prepare(`UPDATE menu_ai_parse_results SET status = 'FAILED' WHERE parse_id = ?`)
        .bind(parseId)
        .run();
    }
    await releaseQuota(db, user.lineUserId, reservation.monthKey);
    const racedCache = await db
      .prepare(
        `SELECT parse_id, structured_result_json, model_name, parsed_at
         FROM menu_ai_parse_results
         WHERE image_hash = ? AND status IN ('DRAFT', 'CONFIRMED')`,
      )
      .bind(image.sha256)
      .first<{
        parse_id: string;
        structured_result_json: string;
        model_name: string;
        parsed_at: string;
      }>();
    if (!storedResult && racedCache) {
      return parseAiPayload(
        JSON.parse(racedCache.structured_result_json),
        racedCache.parse_id,
        true,
        racedCache.model_name,
        racedCache.parsed_at,
      );
    }
    if (err instanceof Error && 'status' in err) throw err;
    throw Errors.aiParseFailed();
  }
}
