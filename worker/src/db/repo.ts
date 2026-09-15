import type { EventStatus } from '../../../shared/types';
import type { EventSummary } from '../../../shared/types';
import { normalizeProxyName } from '../../../shared/preselect';
import { historyRetentionCutoffIso } from '../lib/datetime';
import { asBoolean } from '../lib/ids';

export interface EventRow {
  event_id: string;
  group_id: string;
  name: string;
  event_date: string;
  event_time: string;
  event_at: string;
  start_at: string | null;
  end_at: string | null;
  address: string;
  google_maps_url: string | null;
  fee_amount: number | null;
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
  participant_line_user_id?: string | null;
  registration_source?: string | null;
  created_by_line_user_id: string;
  created_by_display_name: string;
  created_at: string;
  updated_at: string;
}

export interface GroupMemberRow {
  group_id: string;
  line_user_id: string;
  display_name: string;
  picture_url: string | null;
  synced_at: string;
}

function taipeiParts(iso: string): { date: string; time: string } {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}

export function toEventSummary(row: EventRow): EventSummary {
  const startAt = row.start_at || row.event_at;
  const endAt = row.end_at || row.event_at;
  const start = taipeiParts(startAt);
  const end = taipeiParts(endAt);
  return {
    eventId: row.event_id,
    groupId: row.group_id,
    name: row.name,
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    startAt,
    endAt,
    address: row.address,
    googleMapsUrl:
      typeof row.google_maps_url === 'string' && row.google_maps_url.trim()
        ? row.google_maps_url.trim()
        : null,
    feeAmount: Number.isFinite(Number(row.fee_amount)) ? Math.trunc(Number(row.fee_amount)) : 0,
    capacity: Number(row.capacity) || 0,
    waitlistEnabled: asBoolean(row.waitlist_enabled),
    status: row.status,
    confirmedCount: Number(row.confirmed_count ?? 0) || 0,
    waitlistCount: Number(row.waitlist_count ?? 0) || 0,
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
      AND COALESCE(e.end_at, e.event_at) > ?
    ORDER BY COALESCE(e.start_at, e.event_at) ASC
    ${limitSql}
  `;
  if (!groupId) {
    return [];
  }
  const stmt = typeof limit === 'number'
    ? db.prepare(sql).bind(groupId, nowIso, limit)
    : db.prepare(sql).bind(groupId, nowIso);
  const result = await stmt.all<EventRow>();
  const rows = result.results ?? [];
  return rows.map(toEventSummary);
}

/**
 * Ended events within retention that the viewer participated in
 * (organizer / SELF / PROXY creator). Sorted by end_at DESC.
 */
export async function listHistoryEventsForUser(
  db: D1Database,
  groupId: string,
  lineUserId: string,
  nowIso: string,
  retentionCutoffIso: string,
): Promise<EventRow[]> {
  if (!groupId || !lineUserId) return [];
  const { results } = await db
    .prepare(
      `${EVENT_LIST_SQL}
       WHERE e.group_id = ?
         AND e.status != 'DELETED'
         AND COALESCE(e.end_at, e.event_at) <= ?
         AND COALESCE(e.end_at, e.event_at) > ?
         AND (
           e.organizer_line_user_id = ?
           OR EXISTS (
             SELECT 1 FROM registrations r
             WHERE r.event_id = e.event_id
               AND (
                 (
                   r.type = 'SELF'
                   AND TRIM(COALESCE(NULLIF(r.participant_line_user_id, ''), r.line_user_id, '')) = ?
                 )
                 OR (
                   r.type = 'PROXY'
                   AND r.created_by_line_user_id = ?
                 )
               )
           )
         )
       ORDER BY COALESCE(e.end_at, e.event_at) DESC`,
    )
    .bind(groupId, nowIso, retentionCutoffIso, lineUserId, lineUserId, lineUserId)
    .all<EventRow>();
  return results ?? [];
}

export async function listRegistrationsForEventIds(
  db: D1Database,
  eventIds: string[],
): Promise<RegistrationRow[]> {
  if (eventIds.length === 0) return [];
  const placeholders = eventIds.map(() => '?').join(', ');
  const { results } = await db
    .prepare(
      `SELECT * FROM registrations
       WHERE event_id IN (${placeholders})
       ORDER BY created_at ASC`,
    )
    .bind(...eventIds)
    .all<RegistrationRow>();
  return results ?? [];
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
    startDate: string;
    startTime: string;
    startAt: string;
    endDate: string;
    endTime: string;
    endAt: string;
    address: string;
    googleMapsUrl: string | null;
    feeAmount: number;
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
        event_id, group_id, name, event_date, event_time, event_at, start_at, end_at, address,
        google_maps_url, fee_amount, capacity, waitlist_enabled, status, organizer_line_user_id,
        organizer_display_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?)`,
    )
    .bind(
      values.eventId,
      values.groupId,
      values.name,
      values.startDate,
      values.startTime,
      values.startAt,
      values.startAt,
      values.endAt,
      values.address,
      values.googleMapsUrl,
      values.feeAmount,
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
    startDate: string;
    startTime: string;
    startAt: string;
    endAt: string;
    address: string;
    googleMapsUrl: string | null;
    feeAmount: number;
    capacity: number;
    waitlistEnabled: boolean;
    updatedAt: string;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE events
       SET name = ?, event_date = ?, event_time = ?, event_at = ?, start_at = ?, end_at = ?,
           address = ?, google_maps_url = ?, fee_amount = ?, capacity = ?, waitlist_enabled = ?,
           updated_at = ?
       WHERE event_id = ?`,
    )
    .bind(
      patch.name,
      patch.startDate,
      patch.startTime,
      patch.startAt,
      patch.startAt,
      patch.endAt,
      patch.address,
      patch.googleMapsUrl,
      patch.feeAmount,
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
  expectedFromLineUserId?: string,
): Promise<boolean> {
  if (expectedFromLineUserId) {
    const result = await db
      .prepare(
        `UPDATE events
         SET organizer_line_user_id = ?, organizer_display_name = ?, updated_at = ?
         WHERE event_id = ? AND organizer_line_user_id = ? AND status != 'DELETED'`,
      )
      .bind(toLineUserId, toDisplayName, updatedAt, eventId, expectedFromLineUserId)
      .run();
    return (result.meta.changes ?? 0) > 0;
  }
  const result = await db
    .prepare(
      `UPDATE events
       SET organizer_line_user_id = ?, organizer_display_name = ?, updated_at = ?
       WHERE event_id = ?`,
    )
    .bind(toLineUserId, toDisplayName, updatedAt, eventId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/**
 * Atomically accept a transfer invite in one D1 batch (transaction).
 * Later statements are gated on the invite having been accepted by this user,
 * so a lost CAS on the invite cannot still transfer the organizer seat or write audit.
 */
export async function acceptTransferInviteAtomic(
  db: D1Database,
  values: {
    inviteId: string;
    eventId: string;
    fromLineUserId: string;
    fromDisplayName: string;
    toLineUserId: string;
    toDisplayName: string;
    acceptedAt: string;
    transferId: string;
    nowIso: string;
  },
): Promise<{ inviteAccepted: boolean; organizerUpdated: boolean }> {
  const results = await db.batch([
    // 1) CAS: only one concurrent accepter can flip PENDING → ACCEPTED
    db
      .prepare(
        `UPDATE organizer_transfer_invites
         SET status = 'ACCEPTED',
             accepted_at = ?,
             accepted_by_line_user_id = ?,
             accepted_by_display_name = ?
         WHERE invite_id = ?
           AND status = 'PENDING'
           AND expires_at > ?`,
      )
      .bind(
        values.acceptedAt,
        values.toLineUserId,
        values.toDisplayName,
        values.inviteId,
        values.nowIso,
      ),
    // 2) CAS organizer only if this invite is ACCEPTED by this user
    db
      .prepare(
        `UPDATE events
         SET organizer_line_user_id = ?, organizer_display_name = ?, updated_at = ?
         WHERE event_id = ?
           AND organizer_line_user_id = ?
           AND status != 'DELETED'
           AND EXISTS (
             SELECT 1 FROM organizer_transfer_invites
             WHERE invite_id = ?
               AND status = 'ACCEPTED'
               AND accepted_by_line_user_id = ?
           )`,
      )
      .bind(
        values.toLineUserId,
        values.toDisplayName,
        values.acceptedAt,
        values.eventId,
        values.fromLineUserId,
        values.inviteId,
        values.toLineUserId,
      ),
    // 3) Invalidate other pending invites only after this accept succeeded
    db
      .prepare(
        `UPDATE organizer_transfer_invites
         SET status = 'CANCELLED'
         WHERE event_id = ?
           AND status = 'PENDING'
           AND invite_id != ?
           AND EXISTS (
             SELECT 1 FROM organizer_transfer_invites
             WHERE invite_id = ?
               AND status = 'ACCEPTED'
               AND accepted_by_line_user_id = ?
           )`,
      )
      .bind(values.eventId, values.inviteId, values.inviteId, values.toLineUserId),
    // 4) Audit row only if organizer seat actually moved to accepter
    db
      .prepare(
        `INSERT INTO organizer_transfers (
          transfer_id, event_id, from_line_user_id, from_display_name,
          to_line_user_id, to_display_name, created_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM events
          WHERE event_id = ?
            AND organizer_line_user_id = ?
        )
        AND EXISTS (
          SELECT 1 FROM organizer_transfer_invites
          WHERE invite_id = ?
            AND status = 'ACCEPTED'
            AND accepted_by_line_user_id = ?
        )`,
      )
      .bind(
        values.transferId,
        values.eventId,
        values.fromLineUserId,
        values.fromDisplayName,
        values.toLineUserId,
        values.toDisplayName,
        values.acceptedAt,
        values.eventId,
        values.toLineUserId,
        values.inviteId,
        values.toLineUserId,
      ),
  ]);

  const inviteAccepted = (results[0]?.meta.changes ?? 0) > 0;
  const organizerUpdated = (results[1]?.meta.changes ?? 0) > 0;

  // If invite flipped but organizer CAS lost (should be rare), compensate invite.
  if (inviteAccepted && !organizerUpdated) {
    await db
      .prepare(
        `UPDATE organizer_transfer_invites
         SET status = 'CANCELLED',
             accepted_at = NULL,
             accepted_by_line_user_id = NULL,
             accepted_by_display_name = NULL
         WHERE invite_id = ?
           AND status = 'ACCEPTED'
           AND accepted_by_line_user_id = ?`,
      )
      .bind(values.inviteId, values.toLineUserId)
      .run();
    return { inviteAccepted: false, organizerUpdated: false };
  }

  return { inviteAccepted, organizerUpdated };
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
    registrationSource?: 'SELF_JOIN' | 'PROXY' | 'ORGANIZER_PRESELECT';
    participantLineUserId?: string | null;
  },
): Promise<void> {
  const source =
    values.registrationSource ??
    (values.type === 'PROXY' ? 'PROXY' : 'SELF_JOIN');
  const participantLineUserId =
    values.participantLineUserId !== undefined
      ? values.participantLineUserId
      : values.type === 'SELF'
        ? values.lineUserId
        : null;
  await db
    .prepare(
      `INSERT INTO registrations (
        registration_id, event_id, type, status, waitlist_position,
        participant_name, line_user_id, created_by_line_user_id,
        created_by_display_name, created_at, updated_at,
        registration_source, participant_line_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      source,
      participantLineUserId,
    )
    .run();
}

export function prepareInsertRegistrationStatement(
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
    registrationSource: 'SELF_JOIN' | 'PROXY' | 'ORGANIZER_PRESELECT';
    participantLineUserId: string | null;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO registrations (
        registration_id, event_id, type, status, waitlist_position,
        participant_name, line_user_id, created_by_line_user_id,
        created_by_display_name, created_at, updated_at,
        registration_source, participant_line_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      values.registrationSource,
      values.participantLineUserId,
    );
}

export function prepareInsertEventStatement(
  db: D1Database,
  values: {
    eventId: string;
    groupId: string;
    name: string;
    startDate: string;
    startTime: string;
    startAt: string;
    endDate: string;
    endTime: string;
    endAt: string;
    address: string;
    googleMapsUrl: string | null;
    feeAmount: number;
    capacity: number;
    waitlistEnabled: boolean;
    organizerLineUserId: string;
    organizerDisplayName: string;
    createdAt: string;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO events (
        event_id, group_id, name, event_date, event_time, event_at, start_at, end_at, address,
        google_maps_url, fee_amount, capacity, waitlist_enabled, status, organizer_line_user_id,
        organizer_display_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?)`,
    )
    .bind(
      values.eventId,
      values.groupId,
      values.name,
      values.startDate,
      values.startTime,
      values.startAt,
      values.startAt,
      values.endAt,
      values.address,
      values.googleMapsUrl,
      values.feeAmount,
      values.capacity,
      values.waitlistEnabled ? 1 : 0,
      values.organizerLineUserId,
      values.organizerDisplayName,
      values.createdAt,
      values.createdAt,
    );
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
       WHERE event_id = ?
         AND type = 'SELF'
         AND TRIM(COALESCE(NULLIF(participant_line_user_id, ''), line_user_id, '')) = ?`,
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

export async function upsertGroupProxyCandidates(
  db: D1Database,
  groupId: string,
  candidates: Array<{ displayName: string; lastUsedAt: string }>,
): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const displayName = candidate.displayName.trim().replace(/\s+/g, ' ');
    const normalized = normalizeProxyName(displayName);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    statements.push(
      db
        .prepare(
          `INSERT INTO group_proxy_candidates (group_id, normalized_name, display_name, last_used_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(group_id, normalized_name) DO UPDATE SET
             display_name = excluded.display_name,
             last_used_at = CASE
               WHEN excluded.last_used_at > group_proxy_candidates.last_used_at
               THEN excluded.last_used_at
               ELSE group_proxy_candidates.last_used_at
             END`,
        )
        .bind(groupId, normalized, displayName, candidate.lastUsedAt),
    );
  }
  if (statements.length > 0) {
    await db.batch(statements);
  }
}

export async function listGroupProxyCandidates(
  db: D1Database,
  groupId: string,
): Promise<Array<{ display_name: string; normalized_name: string; last_used_at: string }>> {
  const { results } = await db
    .prepare(
      `SELECT display_name, normalized_name, last_used_at
       FROM group_proxy_candidates
       WHERE group_id = ?
       ORDER BY last_used_at DESC, display_name COLLATE NOCASE ASC`,
    )
    .bind(groupId)
    .all<{ display_name: string; normalized_name: string; last_used_at: string }>();
  return results ?? [];
}

const CLEANUP_BATCH_SIZE = 20;

async function preserveEventCandidatesBeforeDelete(
  db: D1Database,
  eventIds: string[],
): Promise<void> {
  if (eventIds.length === 0) return;
  const placeholders = eventIds.map(() => '?').join(', ');
  const { results: events } = await db
    .prepare(
      `SELECT event_id, group_id FROM events WHERE event_id IN (${placeholders})`,
    )
    .bind(...eventIds)
    .all<{ event_id: string; group_id: string }>();
  const groupByEvent = new Map((events ?? []).map((e) => [e.event_id, e.group_id]));

  const { results: regs } = await db
    .prepare(
      `SELECT
         event_id,
         type,
         participant_name,
         COALESCE(NULLIF(participant_line_user_id, ''), line_user_id) AS line_user_id,
         created_at
       FROM registrations
       WHERE event_id IN (${placeholders})`,
    )
    .bind(...eventIds)
    .all<{
      event_id: string;
      type: 'SELF' | 'PROXY';
      participant_name: string;
      line_user_id: string | null;
      created_at: string;
    }>();

  const lineByGroup = new Map<
    string,
    Array<{ lineUserId: string; displayName: string; pictureUrl: string | null }>
  >();
  const proxyByGroup = new Map<string, Array<{ displayName: string; lastUsedAt: string }>>();

  for (const row of regs ?? []) {
    const groupId = groupByEvent.get(row.event_id);
    if (!groupId) continue;
    if (row.type === 'SELF') {
      const lineUserId = (row.line_user_id || '').trim();
      const displayName = (row.participant_name || '').trim();
      if (!lineUserId || !displayName) continue;
      const list = lineByGroup.get(groupId) ?? [];
      list.push({ lineUserId, displayName, pictureUrl: null });
      lineByGroup.set(groupId, list);
    } else if (row.type === 'PROXY') {
      const displayName = (row.participant_name || '').trim().replace(/\s+/g, ' ');
      if (!displayName) continue;
      const list = proxyByGroup.get(groupId) ?? [];
      list.push({ displayName, lastUsedAt: row.created_at });
      proxyByGroup.set(groupId, list);
    }
  }

  const syncedAt = new Date().toISOString();
  for (const [groupId, members] of lineByGroup) {
    // Dedupe keeping last name.
    const byId = new Map<string, { lineUserId: string; displayName: string; pictureUrl: string | null }>();
    for (const member of members) byId.set(member.lineUserId, member);
    await upsertGroupMembersCache(db, groupId, [...byId.values()], syncedAt);
  }
  for (const [groupId, proxies] of proxyByGroup) {
    await upsertGroupProxyCandidates(db, groupId, proxies);
  }
}

/**
 * Delete events whose end_at is older than the history retention cutoff.
 * Never deletes ongoing (not-yet-ended) events. Batched to avoid huge DELETEs.
 */
export async function cleanupExpiredData(db: D1Database, nowIsoValue: string): Promise<{
  events: number;
  registrations: number;
  transfers: number;
  webhooks: number;
}> {
  const cutoff = historyRetentionCutoffIso(new Date(nowIsoValue));

  let eventsDeleted = 0;
  let registrations = 0;
  let transfers = 0;

  for (let round = 0; round < 50; round += 1) {
    const expired = await db
      .prepare(
        `SELECT event_id FROM events
         WHERE COALESCE(end_at, event_at) < ?
         ORDER BY COALESCE(end_at, event_at) ASC
         LIMIT ?`,
      )
      .bind(cutoff, CLEANUP_BATCH_SIZE)
      .all<{ event_id: string }>();
    const ids = (expired.results ?? []).map((row) => row.event_id);
    if (ids.length === 0) break;

    await preserveEventCandidatesBeforeDelete(db, ids);

    const placeholders = ids.map(() => '?').join(', ');
    const reg = await db
      .prepare(`DELETE FROM registrations WHERE event_id IN (${placeholders})`)
      .bind(...ids)
      .run();
    registrations += reg.meta.changes ?? 0;
    const trans = await db
      .prepare(`DELETE FROM organizer_transfers WHERE event_id IN (${placeholders})`)
      .bind(...ids)
      .run();
    transfers += trans.meta.changes ?? 0;
    await db
      .prepare(`DELETE FROM organizer_transfer_invites WHERE event_id IN (${placeholders})`)
      .bind(...ids)
      .run();
    await db.prepare(`DELETE FROM events WHERE event_id IN (${placeholders})`).bind(...ids).run();
    eventsDeleted += ids.length;
    if (ids.length < CLEANUP_BATCH_SIZE) break;
  }

  const sevenDaysAgo = new Date(
    new Date(nowIsoValue).getTime() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const webhook = await db
    .prepare('DELETE FROM webhook_events WHERE received_at < ?')
    .bind(sevenDaysAgo)
    .run();

  return {
    events: eventsDeleted,
    registrations,
    transfers,
    webhooks: webhook.meta.changes ?? 0,
  };
}

export interface TransferInviteRow {
  invite_id: string;
  event_id: string;
  token_hash: string;
  from_line_user_id: string;
  from_display_name: string;
  status: 'PENDING' | 'ACCEPTED' | 'CANCELLED';
  expires_at: string;
  created_at: string;
  accepted_at: string | null;
  accepted_by_line_user_id: string | null;
  accepted_by_display_name: string | null;
}

export async function cancelPendingInvites(db: D1Database, eventId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE organizer_transfer_invites
       SET status = 'CANCELLED'
       WHERE event_id = ? AND status = 'PENDING'`,
    )
    .bind(eventId)
    .run();
}

export async function insertTransferInvite(
  db: D1Database,
  values: {
    inviteId: string;
    eventId: string;
    tokenHash: string;
    fromLineUserId: string;
    fromDisplayName: string;
    expiresAt: string;
    createdAt: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO organizer_transfer_invites (
        invite_id, event_id, token_hash, from_line_user_id, from_display_name,
        status, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
    )
    .bind(
      values.inviteId,
      values.eventId,
      values.tokenHash,
      values.fromLineUserId,
      values.fromDisplayName,
      values.expiresAt,
      values.createdAt,
    )
    .run();
}

export async function getInviteByHash(
  db: D1Database,
  tokenHash: string,
): Promise<TransferInviteRow | null> {
  const row = await db
    .prepare('SELECT * FROM organizer_transfer_invites WHERE token_hash = ?')
    .bind(tokenHash)
    .first<TransferInviteRow>();
  return row ?? null;
}

export async function acceptInviteRow(
  db: D1Database,
  inviteId: string,
  acceptedAt: string,
  acceptedByLineUserId: string,
  acceptedByDisplayName: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE organizer_transfer_invites
       SET status = 'ACCEPTED',
           accepted_at = ?,
           accepted_by_line_user_id = ?,
           accepted_by_display_name = ?
       WHERE invite_id = ? AND status = 'PENDING'`,
    )
    .bind(acceptedAt, acceptedByLineUserId, acceptedByDisplayName, inviteId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function listCachedGroupMembers(
  db: D1Database,
  groupId: string,
): Promise<GroupMemberRow[]> {
  const { results } = await db
    .prepare(
      `SELECT group_id, line_user_id, display_name, picture_url, synced_at
       FROM group_members
       WHERE group_id = ?
       ORDER BY display_name COLLATE NOCASE ASC`,
    )
    .bind(groupId)
    .all<GroupMemberRow>();
  return results ?? [];
}

export async function getCachedGroupMembersByIds(
  db: D1Database,
  groupId: string,
  lineUserIds: string[],
): Promise<GroupMemberRow[]> {
  if (lineUserIds.length === 0) return [];
  const placeholders = lineUserIds.map(() => '?').join(', ');
  const { results } = await db
    .prepare(
      `SELECT group_id, line_user_id, display_name, picture_url, synced_at
       FROM group_members
       WHERE group_id = ? AND line_user_id IN (${placeholders})`,
    )
    .bind(groupId, ...lineUserIds)
    .all<GroupMemberRow>();
  return results ?? [];
}

export async function upsertGroupMembersCache(
  db: D1Database,
  groupId: string,
  members: Array<{
    lineUserId: string;
    displayName: string;
    pictureUrl: string | null;
  }>,
  syncedAt: string,
): Promise<void> {
  if (members.length === 0) return;
  const statements = members.map((member) =>
    db
      .prepare(
        `INSERT INTO group_members (group_id, line_user_id, display_name, picture_url, synced_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(group_id, line_user_id) DO UPDATE SET
           display_name = excluded.display_name,
           picture_url = excluded.picture_url,
           synced_at = excluded.synced_at`,
      )
      .bind(
        groupId,
        member.lineUserId,
        member.displayName,
        member.pictureUrl,
        syncedAt,
      ),
  );
  await db.batch(statements);
}

/** Remove cached members not present in a successful full LINE sync. Never prune to empty wipe. */
export async function pruneGroupMembersNotIn(
  db: D1Database,
  groupId: string,
  keepLineUserIds: string[],
): Promise<void> {
  if (keepLineUserIds.length === 0) return;
  const placeholders = keepLineUserIds.map(() => '?').join(', ');
  await db
    .prepare(
      `DELETE FROM group_members
       WHERE group_id = ? AND line_user_id NOT IN (${placeholders})`,
    )
    .bind(groupId, ...keepLineUserIds)
    .run();
}

/** @deprecated Prefer upsertGroupMembersCache + pruneGroupMembersNotIn */
export async function replaceGroupMembersCache(
  db: D1Database,
  groupId: string,
  members: Array<{
    lineUserId: string;
    displayName: string;
    pictureUrl: string | null;
  }>,
  syncedAt: string,
): Promise<void> {
  await upsertGroupMembersCache(db, groupId, members, syncedAt);
  await pruneGroupMembersNotIn(
    db,
    groupId,
    members.map((m) => m.lineUserId),
  );
  if (members.length === 0) {
    // Keep existing rows when LINE returns an empty member list — never wipe blindly.
  }
}

export async function getGroupMembersCacheSyncedAt(
  db: D1Database,
  groupId: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT MAX(synced_at) AS synced_at FROM group_members WHERE group_id = ?`,
    )
    .bind(groupId)
    .first<{ synced_at: string | null }>();
  return row?.synced_at ?? null;
}

export interface RosterParticipantRow {
  event_id: string;
  event_created_at: string;
  type: 'SELF' | 'PROXY';
  status: 'CONFIRMED' | 'WAITLIST';
  waitlist_position: number | null;
  created_at: string;
  participant_name: string;
  line_user_id: string | null;
}

/**
 * Active registrations for one event (SELF with LINE id, or PROXY with name).
 * Cancelled rows are deleted, so they never appear.
 */
export async function listEventRosterParticipants(
  db: D1Database,
  eventId: string,
): Promise<RosterParticipantRow[]> {
  const { results } = await db
    .prepare(
      `SELECT
         r.event_id AS event_id,
         e.created_at AS event_created_at,
         r.type AS type,
         r.status AS status,
         r.waitlist_position AS waitlist_position,
         r.created_at AS created_at,
         r.participant_name AS participant_name,
         CASE
           WHEN r.type = 'SELF'
             THEN COALESCE(NULLIF(r.participant_line_user_id, ''), r.line_user_id)
           ELSE NULL
         END AS line_user_id
       FROM registrations r
       INNER JOIN events e ON e.event_id = r.event_id
       WHERE r.event_id = ?
         AND (
           (
             r.type = 'SELF'
             AND TRIM(COALESCE(NULLIF(r.participant_line_user_id, ''), r.line_user_id, '')) != ''
           )
           OR (
             r.type = 'PROXY'
             AND TRIM(r.participant_name) != ''
           )
         )
       ORDER BY
         CASE r.status WHEN 'CONFIRMED' THEN 0 ELSE 1 END,
         CASE r.type WHEN 'SELF' THEN 0 ELSE 1 END,
         CASE r.status WHEN 'WAITLIST' THEN COALESCE(r.waitlist_position, 999999) ELSE 0 END,
         r.created_at ASC`,
    )
    .bind(eventId)
    .all<RosterParticipantRow>();
  return results ?? [];
}

/** Most recently created non-deleted event in the group (by created_at DESC). */
export async function getLatestGroupEventId(
  db: D1Database,
  groupId: string,
  excludeEventId?: string,
): Promise<string | null> {
  const sql = excludeEventId
    ? `SELECT event_id FROM events
       WHERE group_id = ? AND status != 'DELETED' AND event_id != ?
       ORDER BY created_at DESC
       LIMIT 1`
    : `SELECT event_id FROM events
       WHERE group_id = ? AND status != 'DELETED'
       ORDER BY created_at DESC
       LIMIT 1`;
  const row = excludeEventId
    ? await db.prepare(sql).bind(groupId, excludeEventId).first<{ event_id: string }>()
    : await db.prepare(sql).bind(groupId).first<{ event_id: string }>();
  return row?.event_id ?? null;
}

/**
 * Historical registrations across non-deleted events in the group.
 * Newer events first; within an event, confirmed then waitlist order.
 */
export async function listGroupHistoryRosterParticipants(
  db: D1Database,
  groupId: string,
  options?: { excludeEventIds?: string[] },
): Promise<RosterParticipantRow[]> {
  const exclude = (options?.excludeEventIds ?? []).filter(Boolean);
  const excludeSql =
    exclude.length > 0
      ? `AND e.event_id NOT IN (${exclude.map(() => '?').join(', ')})`
      : '';
  const { results } = await db
    .prepare(
      `SELECT
         r.event_id AS event_id,
         e.created_at AS event_created_at,
         r.type AS type,
         r.status AS status,
         r.waitlist_position AS waitlist_position,
         r.created_at AS created_at,
         r.participant_name AS participant_name,
         CASE
           WHEN r.type = 'SELF'
             THEN COALESCE(NULLIF(r.participant_line_user_id, ''), r.line_user_id)
           ELSE NULL
         END AS line_user_id
       FROM registrations r
       INNER JOIN events e ON e.event_id = r.event_id
       WHERE e.group_id = ?
         AND e.status != 'DELETED'
         ${excludeSql}
         AND (
           (
             r.type = 'SELF'
             AND TRIM(COALESCE(NULLIF(r.participant_line_user_id, ''), r.line_user_id, '')) != ''
           )
           OR (
             r.type = 'PROXY'
             AND TRIM(r.participant_name) != ''
           )
         )
       ORDER BY
         e.created_at DESC,
         CASE r.status WHEN 'CONFIRMED' THEN 0 ELSE 1 END,
         CASE r.type WHEN 'SELF' THEN 0 ELSE 1 END,
         CASE r.status WHEN 'WAITLIST' THEN COALESCE(r.waitlist_position, 999999) ELSE 0 END,
         r.created_at ASC`,
    )
    .bind(groupId, ...exclude)
    .all<RosterParticipantRow>();
  return results ?? [];
}

/** @deprecated Prefer listEventRosterParticipants */
export async function listEventLineParticipants(
  db: D1Database,
  eventId: string,
): Promise<
  Array<{
    line_user_id: string;
    participant_name: string;
    status: 'CONFIRMED' | 'WAITLIST';
    waitlist_position: number | null;
    created_at: string;
  }>
> {
  const rows = await listEventRosterParticipants(db, eventId);
  return rows
    .filter((row) => row.type === 'SELF' && row.line_user_id)
    .map((row) => ({
      line_user_id: row.line_user_id as string,
      participant_name: row.participant_name,
      status: row.status,
      waitlist_position: row.waitlist_position,
      created_at: row.created_at,
    }));
}

export async function lookupParticipantNamesByLineIds(
  db: D1Database,
  groupId: string,
  lineUserIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (lineUserIds.length === 0) return map;
  const placeholders = lineUserIds.map(() => '?').join(', ');
  const { results } = await db
    .prepare(
      `SELECT
         COALESCE(NULLIF(r.participant_line_user_id, ''), r.line_user_id) AS line_user_id,
         r.participant_name AS participant_name,
         r.created_at AS created_at
       FROM registrations r
       INNER JOIN events e ON e.event_id = r.event_id
       WHERE e.group_id = ?
         AND r.type = 'SELF'
         AND COALESCE(NULLIF(r.participant_line_user_id, ''), r.line_user_id) IN (${placeholders})
       ORDER BY r.created_at DESC`,
    )
    .bind(groupId, ...lineUserIds)
    .all<{ line_user_id: string; participant_name: string; created_at: string }>();
  for (const row of results ?? []) {
    if (!map.has(row.line_user_id) && row.participant_name?.trim()) {
      map.set(row.line_user_id, row.participant_name.trim());
    }
  }
  return map;
}

