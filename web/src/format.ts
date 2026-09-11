import type { EventSummary } from '../../shared/types';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export function formatEventDateTime(eventDate: string, eventTime: string): string {
  const date = new Date(`${eventDate}T${eventTime}:00+08:00`);
  if (Number.isNaN(date.getTime())) {
    return `${eventDate} ${eventTime}`;
  }
  const weekday = WEEKDAYS[date.getDay()];
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${date.getFullYear()}年${month}月${day}日（${weekday}）${eventTime}`;
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
