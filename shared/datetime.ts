export const APP_TIME_ZONE = 'Asia/Taipei';
export const TAIPEI_OFFSET = '+08:00';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function nowIso(date = new Date()): string {
  return date.toISOString();
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function taipeiParts(now = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}

export function toEventAt(eventDate: string, eventTime: string): string {
  if (!DATE_RE.test(eventDate) || !TIME_RE.test(eventTime)) {
    throw new Error('INVALID_DATETIME');
  }
  const iso = `${eventDate}T${eventTime}:00${TAIPEI_OFFSET}`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('INVALID_DATETIME');
  }
  return parsed.toISOString();
}

export function isExpired(eventAt: string, now = new Date()): boolean {
  return new Date(eventAt).getTime() <= now.getTime();
}

/** Keep ended events readable/listable for this many days after end_at. */
export const HISTORY_RETENTION_DAYS = 30;

export function historyRetentionCutoffIso(now = new Date()): string {
  return new Date(
    now.getTime() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
}

/** True when end_at is past and older than the retention window. */
export function isBeyondHistoryRetention(endAt: string, now = new Date()): boolean {
  const endMs = new Date(endAt).getTime();
  if (!Number.isFinite(endMs)) return true;
  return endMs <= now.getTime() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

export function isRangeInvalid(startAt: string, endAt: string): boolean {
  return new Date(endAt).getTime() <= new Date(startAt).getTime();
}

export function addOneMinute(time: string): string | null {
  if (!TIME_RE.test(time)) return null;
  const [hours, minutes] = time.split(':').map(Number);
  const total = hours * 60 + minutes + 1;
  if (total >= 24 * 60) return null;
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

export interface EventScheduleInput {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}

export type EventScheduleResult =
  | { ok: true; startAt: string; endAt: string }
  | { ok: false; message: string };

export function validateEventSchedule(
  input: EventScheduleInput,
  options: { now?: Date; requireStartInFuture?: boolean } = {},
): EventScheduleResult {
  const now = options.now ?? new Date();
  const requireStartInFuture = options.requireStartInFuture ?? true;

  let startAt: string;
  let endAt: string;
  try {
    startAt = toEventAt(input.startDate, input.startTime);
    endAt = toEventAt(input.endDate, input.endTime);
  } catch {
    return { ok: false, message: '時間無效，請使用完整的日期與時間' };
  }

  if (requireStartInFuture && new Date(startAt).getTime() <= now.getTime()) {
    return { ok: false, message: '開始時間必須晚於現在' };
  }
  if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
    return { ok: false, message: '結束時間必須晚於開始時間' };
  }
  return { ok: true, startAt, endAt };
}
