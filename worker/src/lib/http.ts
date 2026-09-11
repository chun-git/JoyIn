import type { Context } from 'hono';
import type { AppEnv, AuthUser } from '../env';
import { AppError, Errors } from './errors';
import { DATE_RE, TIME_RE, isRangeInvalid, toEventAt } from './datetime';

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

export function requireDate(value: unknown, field = '活動日期'): string {
  const date = requireString(value, field, 10, 10);
  if (!DATE_RE.test(date)) {
    throw Errors.validation(`${field}格式需為 YYYY-MM-DD`);
  }
  return date;
}

export function requireTime(value: unknown, field = '活動時間'): string {
  const time = requireString(value, field, 5, 5);
  if (!TIME_RE.test(time)) {
    throw Errors.validation(`${field}格式需為 HH:MM`);
  }
  return time;
}

export function eventAtFromParts(eventDate: string, eventTime: string, field = '活動時間'): string {
  try {
    return toEventAt(eventDate, eventTime);
  } catch {
    throw Errors.validation(`${field}無效`);
  }
}

export function requireTimeRange(body: Record<string, unknown>): {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  startAt: string;
  endAt: string;
} {
  const startDate = requireDate(body.startDate, '開始日期');
  const startTime = requireTime(body.startTime, '開始時間');
  const endDate = requireDate(body.endDate, '結束日期');
  const endTime = requireTime(body.endTime, '結束時間');
  const startAt = eventAtFromParts(startDate, startTime, '開始時間');
  const endAt = eventAtFromParts(endDate, endTime, '結束時間');
  if (isRangeInvalid(startAt, endAt)) {
    throw Errors.validation('結束時間必須晚於開始時間');
  }
  return { startDate, startTime, endDate, endTime, startAt, endAt };
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
