export function nowIso(date = new Date()): string {
  return date.toISOString();
}

export function toEventAt(eventDate: string, eventTime: string): string {
  const iso = `${eventDate}T${eventTime}:00+08:00`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('INVALID_DATETIME');
  }
  return parsed.toISOString();
}

export function isExpired(eventAt: string, now = new Date()): boolean {
  return new Date(eventAt).getTime() <= now.getTime();
}

export function isDateTimeInPast(eventDate: string, eventTime: string, now = new Date()): boolean {
  return isExpired(toEventAt(eventDate, eventTime), now);
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
