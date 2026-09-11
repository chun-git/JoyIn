import type { CreateEventInput, EventDetail, EventSummary, UpdateEventInput } from '../../../shared/types';
import { Errors } from '../lib/errors';
import { isDateTimeInPast, isExpired, nowIso } from '../lib/datetime';
import { newId, toRegistrationRecord } from '../lib/ids';
import {
  getEventRow,
  insertEvent,
  insertOrganizerTransfer,
  listRegistrations,
  listUpcomingEvents,
  setEventStatus,
  toEventSummary,
  transferOrganizerRow,
  updateEventRow,
} from '../db/repo';
import type { AuthUser } from '../env';
import { eventAtFromParts } from '../lib/http';

export async function listEvents(
  db: D1Database,
  groupId: string,
  limit?: number,
): Promise<EventSummary[]> {
  return listUpcomingEvents(db, groupId, nowIso(), limit);
}

export async function getVisibleEvent(db: D1Database, eventId: string, groupId?: string) {
  const row = await getEventRow(db, eventId);
  if (!row || row.status === 'DELETED') {
    throw Errors.notFound('找不到活動');
  }
  if (groupId && row.group_id !== groupId) {
    throw Errors.forbidden('此活動不屬於目前群組');
  }
  if (isExpired(row.event_at)) {
    throw Errors.gone('活動已結束');
  }
  return row;
}

export async function getEventDetail(
  db: D1Database,
  eventId: string,
  user: AuthUser,
  groupId?: string,
): Promise<EventDetail> {
  const row = await getVisibleEvent(db, eventId, groupId);
  const summary = toEventSummary(row);
  const registrations = await listRegistrations(db, eventId);
  const records = registrations.map((item) =>
    toRegistrationRecord(item, user.lineUserId, row.organizer_line_user_id),
  );
  const confirmed = records.filter((item) => item.status === 'CONFIRMED');
  const waitlist = records
    .filter((item) => item.status === 'WAITLIST')
    .sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0));

  return {
    ...summary,
    confirmedCount: confirmed.length,
    waitlistCount: waitlist.length,
    registrations: { confirmed, waitlist },
    viewer: {
      isOrganizer: user.lineUserId === row.organizer_line_user_id,
      selfRegistration:
        records.find((item) => item.type === 'SELF' && item.createdByLineUserId === user.lineUserId) ??
        null,
      proxyRegistrations: records.filter(
        (item) => item.type === 'PROXY' && item.createdByLineUserId === user.lineUserId,
      ),
    },
  };
}

export async function createEvent(
  db: D1Database,
  groupId: string,
  user: AuthUser,
  input: CreateEventInput,
): Promise<EventSummary> {
  if (isDateTimeInPast(input.eventDate, input.eventTime)) {
    throw Errors.validation('活動時間不可早於現在');
  }

  const createdAt = nowIso();
  const eventId = newId();
  await insertEvent(db, {
    eventId,
    groupId,
    name: input.name,
    eventDate: input.eventDate,
    eventTime: input.eventTime,
    eventAt: eventAtFromParts(input.eventDate, input.eventTime),
    address: input.address,
    capacity: input.capacity,
    waitlistEnabled: input.waitlistEnabled,
    organizerLineUserId: user.lineUserId,
    organizerDisplayName: user.displayName,
    createdAt,
  });

  const row = await getEventRow(db, eventId);
  if (!row) {
    throw Errors.notFound('建立活動失敗');
  }
  return toEventSummary(row);
}

export async function updateEvent(
  db: D1Database,
  eventId: string,
  user: AuthUser,
  groupId: string,
  input: UpdateEventInput,
): Promise<EventSummary> {
  const row = await getVisibleEvent(db, eventId, groupId);
  if (row.organizer_line_user_id !== user.lineUserId) {
    throw Errors.forbidden('只有主揪可以編輯活動');
  }
  if (row.status === 'CLOSED') {
    throw Errors.conflict('報名已關閉，無法再修改活動內容');
  }

  const next = {
    name: input.name ?? row.name,
    eventDate: input.eventDate ?? row.event_date,
    eventTime: input.eventTime ?? row.event_time,
    address: input.address ?? row.address,
    capacity: input.capacity ?? row.capacity,
    waitlistEnabled: input.waitlistEnabled ?? Boolean(row.waitlist_enabled),
  };

  const timeOrLocationChanged =
    next.eventDate !== row.event_date ||
    next.eventTime !== row.event_time ||
    next.address !== row.address;

  if (timeOrLocationChanged && !input.confirmTimeLocationChange) {
    throw Errors.validation('修改時間或地點前請先確認');
  }

  if (isDateTimeInPast(next.eventDate, next.eventTime)) {
    throw Errors.validation('活動時間不可早於現在');
  }

  const confirmedCount = row.confirmed_count ?? 0;
  if (next.capacity < confirmedCount) {
    throw Errors.validation(`人數上限不可低於目前正式報名人數（${confirmedCount}）`);
  }

  if (row.waitlist_enabled && !next.waitlistEnabled && (row.waitlist_count ?? 0) > 0) {
    throw Errors.conflict('仍有候補名單時，無法關閉候補');
  }

  await updateEventRow(db, eventId, {
    ...next,
    eventAt: eventAtFromParts(next.eventDate, next.eventTime),
    updatedAt: nowIso(),
  });

  const updated = await getEventRow(db, eventId);
  if (!updated) {
    throw Errors.notFound();
  }
  return toEventSummary(updated);
}

export async function closeEvent(
  db: D1Database,
  eventId: string,
  user: AuthUser,
  groupId: string,
): Promise<EventSummary> {
  const row = await getVisibleEvent(db, eventId, groupId);
  if (row.organizer_line_user_id !== user.lineUserId) {
    throw Errors.forbidden('只有主揪可以關閉報名');
  }
  if (row.status !== 'OPEN') {
    throw Errors.conflict('活動不是開放報名狀態');
  }
  await setEventStatus(db, eventId, 'CLOSED', nowIso());
  const updated = await getEventRow(db, eventId);
  if (!updated) {
    throw Errors.notFound();
  }
  return toEventSummary(updated);
}

export async function deleteEvent(
  db: D1Database,
  eventId: string,
  user: AuthUser,
  groupId: string,
): Promise<void> {
  const row = await getVisibleEvent(db, eventId, groupId);
  if (row.organizer_line_user_id !== user.lineUserId) {
    throw Errors.forbidden('只有主揪可以刪除活動');
  }
  await setEventStatus(db, eventId, 'DELETED', nowIso());
}

export async function transferOrganizer(
  db: D1Database,
  eventId: string,
  user: AuthUser,
  groupId: string,
  toLineUserId: string,
  toDisplayName: string,
): Promise<EventSummary> {
  const row = await getVisibleEvent(db, eventId, groupId);
  if (row.organizer_line_user_id !== user.lineUserId) {
    throw Errors.forbidden('只有主揪可以轉移主揪');
  }
  if (toLineUserId === user.lineUserId) {
    throw Errors.validation('不能轉移給自己');
  }

  const createdAt = nowIso();
  await insertOrganizerTransfer(db, {
    transferId: newId(),
    eventId,
    fromLineUserId: user.lineUserId,
    fromDisplayName: user.displayName,
    toLineUserId,
    toDisplayName,
    createdAt,
  });
  await transferOrganizerRow(db, eventId, toLineUserId, toDisplayName, createdAt);
  const updated = await getEventRow(db, eventId);
  if (!updated) {
    throw Errors.notFound();
  }
  return toEventSummary(updated);
}
