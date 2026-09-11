import type { EventSummary } from '../../shared/types';
import { APP_TIME_ZONE, toEventAt } from '../../shared/datetime';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export function formatEventDateTime(eventDate: string, eventTime: string): string {
  try {
    const date = new Date(toEventAt(eventDate, eventTime));
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: APP_TIME_ZONE,
      weekday: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(date);
    const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
    const weekdayMap: Record<string, string> = {
      Sun: '日',
      Mon: '一',
      Tue: '二',
      Wed: '三',
      Thu: '四',
      Fri: '五',
      Sat: '六',
    };
    const weekday = weekdayMap[get('weekday')] ?? WEEKDAYS[date.getUTCDay()];
    return `${get('year')}年${get('month')}月${get('day')}日（${weekday}）${eventTime}`;
  } catch {
    return `${eventDate} ${eventTime}`;
  }
}

export function formatEventRange(
  event: Pick<EventSummary, 'startDate' | 'startTime' | 'endDate' | 'endTime'>,
): string {
  const start = formatEventDateTime(event.startDate, event.startTime);
  if (event.startDate === event.endDate) {
    return `${start} – ${event.endTime}`;
  }
  return `${start} – ${formatEventDateTime(event.endDate, event.endTime)}`;
}

export function waitlistLabel(event: Pick<EventSummary, 'capacity' | 'confirmedCount' | 'waitlistCount' | 'waitlistEnabled'>): string {
  if (event.confirmedCount < event.capacity) {
    return '尚有名額';
  }
  if (event.waitlistEnabled) {
    return event.waitlistCount > 0 ? `候補 ${event.waitlistCount} 人` : '開放候補';
  }
  return '已額滿';
}

export function eventStatusLabel(
  event: Pick<EventSummary, 'status' | 'capacity' | 'confirmedCount' | 'waitlistEnabled'>,
): string {
  if (event.status === 'CLOSED') {
    return '已關閉報名';
  }
  if (event.confirmedCount >= event.capacity) {
    return event.waitlistEnabled ? '候補中' : '已額滿';
  }
  return '報名中';
}

export function eventStatusTone(
  event: Pick<EventSummary, 'status' | 'capacity' | 'confirmedCount' | 'waitlistEnabled'>,
): 'open' | 'wait' | 'closed' | 'full' {
  if (event.status === 'CLOSED') return 'closed';
  if (event.confirmedCount >= event.capacity) {
    return event.waitlistEnabled ? 'wait' : 'full';
  }
  return 'open';
}
