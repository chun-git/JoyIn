import type { Context } from 'hono';
import type { AppEnv, AuthUser } from '../env';
import { AppError, Errors } from './errors';
import { DATE_RE, TIME_RE, toEventAt } from './datetime';

export function requireGroupId(c: Context<AppEnv>): string {
  const groupId = c.get('groupId') || c.req.header('X-Line-Group-Id') || '';
  if (!groupId) {
    throw Errors.validation('請從 LINE 群組開啟 JoyIn');
  }
  return groupId;
}

export function parseJson<T>(value: unknown): T {
  if (!value || typeof value !== 'object') {
    throw Errors.payload();
  }
  return value as T;
}

export function requireString(value: unknown, field: string, min = 1, max = 80): string {
  if (typeof value !== 'string') {
    throw Errors.validation(`${field} 為必填`);
  }
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw Errors.validation(`${field} 長度需介於 ${min} 到 ${max} 字`);
  }
  return trimmed;
}

export function requireCapacity(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(num) || num < 1 || num > 500) {
    throw Errors.validation('正式報名人數上限需為 1 到 500 的整數');
  }
  return num;
}

export function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  throw Errors.validation(`${field} 需為布林值`);
}

export function requireDate(value: unknown): string {
  const date = requireString(value, '活動日期', 10, 10);
  if (!DATE_RE.test(date)) {
    throw Errors.validation('活動日期格式需為 YYYY-MM-DD');
  }
  return date;
}

export function requireTime(value: unknown): string {
  const time = requireString(value, '活動時間', 5, 5);
  if (!TIME_RE.test(time)) {
    throw Errors.validation('活動時間格式需為 HH:MM');
  }
  return time;
}

export function eventAtFromParts(eventDate: string, eventTime: string): string {
  try {
    return toEventAt(eventDate, eventTime);
  } catch {
    throw Errors.validation('活動日期或時間無效');
  }
}

export function handleRouteError(err: unknown): { status: number; body: { error: string; message: string } } {
  if (err instanceof AppError) {
    return { status: err.status, body: { error: err.code, message: err.message } };
  }
  console.error(err);
  return { status: 500, body: { error: 'INTERNAL', message: '伺服器發生錯誤' } };
}

export function userOf(c: Context<AppEnv>): AuthUser {
  return c.get('user');
}
