import type { EventStatus } from '../../../shared/types';
import type { EventSummary } from '../../../shared/types';
import { asBoolean } from '../lib/ids';

export interface EventRow {
  event_id: string;
  group_id: string;
  name: string;
  event_date: string;
  event_time: string;
  event_at: string;
  address: string;
  capacity: number;
  waitlist_enabled: number;
  status: EventStatus;
  organizer_line_user_id: string;
  organizer_display_name: string;
  created_at: string;
  updated_at: string;
  confirmed_count?: number;
  waitlist_count?: number;
}

export interface RegistrationRow {
  registration_id: string;
  event_id: string;
  type: 'SELF' | 'PROXY';
  status: 'CONFIRMED' | 'WAITLIST';
  waitlist_position: number | null;
  participant_name: string;
  line_user_id: string | null;
  created_by_line_user_id: string;
  created_by_display_name: string;
  created_at: string;
  updated_at: string;
}

export function toEventSummary(row: EventRow): EventSummary {
  return {
    eventId: row.event_id,
    groupId: row.group_id,
    name: row.name,
    eventDate: row.event_date,
    eventTime: row.event_time,
    eventAt: row.event_at,
    address: row.address,
    capacity: row.capacity,
    waitlistEnabled: asBoolean(row.waitlist_enabled),
    status: row.status,
    confirmedCount: row.confirmed_count ?? 0,
    waitlistCount: row.waitlist_count ?? 0,
    organizerLineUserId: row.organizer_line_user_id,
    organizerDisplayName: row.organizer_display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const EVENT_LIST_SQL = `
  SELECT
    e.*,
    (
      SELECT COUNT(*) FROM registrations r
      WHERE r.event_id = e.event_id AND r.status = 'CONFIRMED'
    ) AS confirmed_count,
    (
      SELECT COUNT(*) FROM registrations r
      WHERE r.event_id = e.event_id AND r.status = 'WAITLIST'
    ) AS waitlist_count
  FROM events e
`;

export async function listUpcomingEvents(
  db: D1Database,
  groupId: string,
  nowIso: string,
  limit?: number,
): Promise<EventSummary[]> {
  const limitSql = typeof limit === 'number' ? 'LIMIT ?' : '';
  const sql = `
    ${EVENT_LIST_SQL}
    WHERE e.group_id = ?
      AND e.status != 'DELETED'
      AND e.event_at > ?
    ORDER BY e.event_at ASC
    ${limitSql}
  `;
  const stmt = typeof limit === 'number'
    ? db.prepare(sql).bind(groupId, nowIso, limit)
    : db.prepare(sql).bind(groupId, nowIso);
  const { results } = await stmt.all<EventRow>();
  return results.map(toEventSummary);
}

export async function getEventRow(
  db: D1Database,
  eventId: string,
): Promise<EventRow | null> {
  const row = await db
    .prepare(`${EVENT_LIST_SQL} WHERE e.event_id = ?`)
    .bind(eventId)
    .first<EventRow>();
  return row ?? null;
}

export async function insertEvent(
  db: D1Database,
  values: {
    eventId: string;
    groupId: string;
    name: string;
    eventDate: string;
    eventTime: string;
    eventAt: string;
    address: string;
    capacity: number;
    waitlistEnabled: boolean;
    organizerLineUserId: string;
    organizerDisplayName: string;
    createdAt: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO events (
        event_id, group_id, name, event_date, event_time, event_at, address,
        capacity, waitlist_enabled, status, organizer_line_user_id,
        organizer_display_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?)`,
    )
    .bind(
      values.eventId,
      values.groupId,
      values.name,
      values.eventDate,
      values.eventTime,
      values.eventAt,
      values.address,
      values.capacity,
      values.waitlistEnabled ? 1 : 0,
      values.organizerLineUserId,
      values.organizerDisplayName,
      values.createdAt,
      values.createdAt,
    )
    .run();
}

export async function updateEventRow(
  db: D1Database,
  eventId: string,
  patch: {
    name: string;
    eventDate: string;
    eventTime: string;
    eventAt: string;
    address: string;
    capacity: number;
    waitlistEnabled: boolean;
    updatedAt: string;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE events
       SET name = ?, event_date = ?, event_time = ?, event_at = ?, address = ?,
           capacity = ?, waitlist_enabled = ?, updated_at = ?
       WHERE event_id = ?`,
    )
    .bind(
      patch.name,
      patch.eventDate,
      patch.eventTime,
      patch.eventAt,
      patch.address,
      patch.capacity,
      patch.waitlistEnabled ? 1 : 0,
      patch.updatedAt,
      eventId,
    )
    .run();
}

export async function setEventStatus(
  db: D1Database,
  eventId: string,
  status: EventStatus,
  updatedAt: string,
): Promise<void> {
  await db
    .prepare('UPDATE events SET status = ?, updated_at = ? WHERE event_id = ?')
    .bind(status, updatedAt, eventId)
    .run();
}

export async function transferOrganizerRow(
  db: D1Database,
  eventId: string,
  toLineUserId: string,
  toDisplayName: string,
  updatedAt: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE events
       SET organizer_line_user_id = ?, organizer_display_name = ?, updated_at = ?
       WHERE event_id = ?`,
    )
    .bind(toLineUserId, toDisplayName, updatedAt, eventId)
    .run();
}

export async function insertOrganizerTransfer(
  db: D1Database,
  values: {
    transferId: string;
    eventId: string;
    fromLineUserId: string;
    fromDisplayName: string;
    toLineUserId: string;
    toDisplayName: string;
    createdAt: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO organizer_transfers (
        transfer_id, event_id, from_line_user_id, from_display_name,
        to_line_user_id, to_display_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      values.transferId,
      values.eventId,
      values.fromLineUserId,
      values.fromDisplayName,
      values.toLineUserId,
      values.toDisplayName,
      values.createdAt,
    )
    .run();
}

export async function listRegistrations(db: D1Database, eventId: string): Promise<RegistrationRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM registrations
       WHERE event_id = ?
       ORDER BY CASE status WHEN 'CONFIRMED' THEN 0 ELSE 1 END, created_at ASC`,
    )
    .bind(eventId)
    .all<RegistrationRow>();
  return results;
}

export async function getRegistration(
  db: D1Database,
  registrationId: string,
): Promise<RegistrationRow | null> {
  const row = await db
    .prepare('SELECT * FROM registrations WHERE registration_id = ?')
    .bind(registrationId)
    .first<RegistrationRow>();
  return row ?? null;
}

export async function countConfirmed(db: D1Database, eventId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS count FROM registrations WHERE event_id = ? AND status = 'CONFIRMED'`)
    .bind(eventId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function insertRegistration(
  db: D1Database,
  values: {
    registrationId: string;
    eventId: string;
    type: 'SELF' | 'PROXY';
    status: 'CONFIRMED' | 'WAITLIST';
    waitlistPosition: number | null;
    participantName: string;
    lineUserId: string | null;
    createdByLineUserId: string;
    createdByDisplayName: string;
    createdAt: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO registrations (
        registration_id, event_id, type, status, waitlist_position,
        participant_name, line_user_id, created_by_line_user_id,
        created_by_display_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      values.registrationId,
      values.eventId,
      values.type,
      values.status,
      values.waitlistPosition,
      values.participantName,
      values.lineUserId,
      values.createdByLineUserId,
      values.createdByDisplayName,
      values.createdAt,
      values.createdAt,
    )
    .run();
}

export async function deleteRegistrationRow(db: D1Database, registrationId: string): Promise<void> {
  await db.prepare('DELETE FROM registrations WHERE registration_id = ?').bind(registrationId).run();
}

export async function listWaitlist(db: D1Database, eventId: string): Promise<RegistrationRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM registrations
       WHERE event_id = ? AND status = 'WAITLIST'
       ORDER BY created_at ASC`,
    )
    .bind(eventId)
    .all<RegistrationRow>();
  return results;
}

export async function promoteRegistration(
  db: D1Database,
  registrationId: string,
  updatedAt: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE registrations
       SET status = 'CONFIRMED', waitlist_position = NULL, updated_at = ?
       WHERE registration_id = ?`,
    )
    .bind(updatedAt, registrationId)
    .run();
}

export async function updateWaitlistPosition(
  db: D1Database,
  registrationId: string,
  position: number,
  updatedAt: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE registrations
       SET waitlist_position = ?, updated_at = ?
       WHERE registration_id = ?`,
    )
    .bind(position, updatedAt, registrationId)
    .run();
}

export async function demoteOverflowToWaitlist(
  db: D1Database,
  eventId: string,
  capacity: number,
  updatedAt: string,
): Promise<void> {
  const { results } = await db
    .prepare(
      `SELECT registration_id FROM registrations
       WHERE event_id = ? AND status = 'CONFIRMED'
       ORDER BY created_at ASC`,
    )
    .bind(eventId)
    .all<{ registration_id: string }>();

  const overflow = results.slice(capacity);
  for (const row of overflow) {
    await db
      .prepare(
        `UPDATE registrations
         SET status = 'WAITLIST', updated_at = ?
         WHERE registration_id = ?`,
      )
      .bind(updatedAt, row.registration_id)
      .run();
  }
}

export async function findSelfRegistration(
  db: D1Database,
  eventId: string,
  lineUserId: string,
): Promise<RegistrationRow | null> {
  const row = await db
    .prepare(
      `SELECT * FROM registrations
       WHERE event_id = ? AND type = 'SELF' AND line_user_id = ?`,
    )
    .bind(eventId, lineUserId)
    .first<RegistrationRow>();
  return row ?? null;
}

export async function findProxyRegistration(
  db: D1Database,
  eventId: string,
  createdByLineUserId: string,
  participantName: string,
): Promise<RegistrationRow | null> {
  const row = await db
    .prepare(
      `SELECT * FROM registrations
       WHERE event_id = ? AND type = 'PROXY'
         AND created_by_line_user_id = ? AND participant_name = ?`,
    )
    .bind(eventId, createdByLineUserId, participantName)
    .first<RegistrationRow>();
  return row ?? null;
}

export async function insertWebhookEvent(
  db: D1Database,
  webhookEventId: string,
  eventType: string,
  receivedAt: string,
): Promise<boolean> {
  try {
    await db
      .prepare(
        'INSERT INTO webhook_events (webhook_event_id, event_type, received_at) VALUES (?, ?, ?)',
      )
      .bind(webhookEventId, eventType, receivedAt)
      .run();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('UNIQUE') || message.includes('unique')) {
      return false;
    }
    throw error;
  }
}

export async function cleanupExpiredData(db: D1Database, nowIso: string): Promise<{
  events: number;
  registrations: number;
  transfers: number;
  webhooks: number;
}> {
  const expired = await db
    .prepare('SELECT event_id FROM events WHERE event_at <= ?')
    .bind(nowIso)
    .all<{ event_id: string }>();
  const ids = expired.results.map((row) => row.event_id);

  let registrations = 0;
  let transfers = 0;
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(', ');
    const reg = await db
      .prepare(`DELETE FROM registrations WHERE event_id IN (${placeholders})`)
      .bind(...ids)
      .run();
    registrations = reg.meta.changes ?? 0;
    const trans = await db
      .prepare(`DELETE FROM organizer_transfers WHERE event_id IN (${placeholders})`)
      .bind(...ids)
      .run();
    transfers = trans.meta.changes ?? 0;
    await db.prepare(`DELETE FROM events WHERE event_id IN (${placeholders})`).bind(...ids).run();
  }

  const sevenDaysAgo = new Date(new Date(nowIso).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const webhook = await db
    .prepare('DELETE FROM webhook_events WHERE received_at < ?')
    .bind(sevenDaysAgo)
    .run();

  return {
    events: ids.length,
    registrations,
    transfers,
    webhooks: webhook.meta.changes ?? 0,
  };
}
