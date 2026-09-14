import type { RegistrationRecord } from '../../../shared/types';
import type { AuthUser } from '../env';
import {
  countConfirmed,
  deleteRegistrationRow,
  demoteOverflowToWaitlist,
  findProxyRegistration,
  findSelfRegistration,
  getEventRow,
  getRegistration,
  insertRegistration,
  listWaitlist,
  promoteRegistration,
  updateWaitlistPosition,
} from '../db/repo';
import { Errors } from '../lib/errors';
import { nowIso } from '../lib/datetime';
import { newId, toRegistrationRecord } from '../lib/ids';
import { getVisibleEvent } from './events';

async function resequenceWaitlist(db: D1Database, eventId: string): Promise<void> {
  const waitlist = await listWaitlist(db, eventId);
  const updatedAt = nowIso();
  for (let index = 0; index < waitlist.length; index += 1) {
    const position = index + 1;
    if (waitlist[index].waitlist_position !== position) {
      await updateWaitlistPosition(db, waitlist[index].registration_id, position, updatedAt);
    }
  }
}

async function nextStatus(
  db: D1Database,
  eventId: string,
  capacity: number,
  waitlistEnabled: boolean,
): Promise<{ status: 'CONFIRMED' | 'WAITLIST'; waitlistPosition: number | null }> {
  const confirmed = await countConfirmed(db, eventId);
  if (confirmed < capacity) {
    return { status: 'CONFIRMED', waitlistPosition: null };
  }
  if (waitlistEnabled) {
    const waitlist = await listWaitlist(db, eventId);
    return { status: 'WAITLIST', waitlistPosition: waitlist.length + 1 };
  }
  throw Errors.conflict('活動已額滿且未開放候補');
}

async function enforceCapacity(db: D1Database, eventId: string, capacity: number): Promise<void> {
  await demoteOverflowToWaitlist(db, eventId, capacity, nowIso());
  await resequenceWaitlist(db, eventId);
}

async function promoteFirstWaitlist(db: D1Database, eventId: string, capacity: number): Promise<void> {
  const confirmed = await countConfirmed(db, eventId);
  if (confirmed >= capacity) {
    await resequenceWaitlist(db, eventId);
    return;
  }
  const waitlist = await listWaitlist(db, eventId);
  const first = waitlist[0];
  if (!first) {
    return;
  }
  await promoteRegistration(db, first.registration_id, nowIso());
  await resequenceWaitlist(db, eventId);
}

function isUniqueConstraint(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('UNIQUE') || message.includes('unique') || message.includes('constraint');
}

export async function joinSelf(
  db: D1Database,
  eventId: string,
  user: AuthUser,
  groupId: string,
): Promise<RegistrationRecord> {
  const event = await getVisibleEvent(db, eventId, groupId);
  if (event.status !== 'OPEN') {
    throw Errors.conflict('活動已關閉報名');
  }

  const existing = await findSelfRegistration(db, eventId, user.lineUserId);
  if (existing) {
    throw Errors.conflict('你已經報名或加入候補');
  }

  const { status, waitlistPosition } = await nextStatus(
    db,
    eventId,
    event.capacity,
    Boolean(event.waitlist_enabled),
  );

  const createdAt = nowIso();
  const registrationId = newId();
  try {
    await insertRegistration(db, {
      registrationId,
      eventId,
      type: 'SELF',
      status,
      waitlistPosition,
      participantName: user.displayName,
      lineUserId: user.lineUserId,
      createdByLineUserId: user.lineUserId,
      createdByDisplayName: user.displayName,
      registrationSource: 'SELF_JOIN',
      participantLineUserId: user.lineUserId,
      createdAt,
    });
  } catch (error) {
    if (isUniqueConstraint(error)) {
      throw Errors.conflict('你已經報名或加入候補');
    }
    throw error;
  }

  await enforceCapacity(db, eventId, event.capacity);
  const saved = await getRegistration(db, registrationId);
  if (!saved) {
    throw Errors.notFound('報名失敗');
  }
  return toRegistrationRecord(saved, user.lineUserId, event.organizer_line_user_id);
}

export async function joinProxy(
  db: D1Database,
  eventId: string,
  user: AuthUser,
  groupId: string,
  participantName: string,
): Promise<RegistrationRecord> {
  const event = await getVisibleEvent(db, eventId, groupId);
  if (event.status !== 'OPEN') {
    throw Errors.conflict('活動已關閉報名');
  }

  const existing = await findProxyRegistration(db, eventId, user.lineUserId, participantName);
  if (existing) {
    throw Errors.conflict('你已經代報過相同姓名');
  }

  const { status, waitlistPosition } = await nextStatus(
    db,
    eventId,
    event.capacity,
    Boolean(event.waitlist_enabled),
  );

  const createdAt = nowIso();
  const registrationId = newId();
  try {
    await insertRegistration(db, {
      registrationId,
      eventId,
      type: 'PROXY',
      status,
      waitlistPosition,
      participantName,
      lineUserId: null,
      createdByLineUserId: user.lineUserId,
      createdByDisplayName: user.displayName,
      registrationSource: 'PROXY',
      participantLineUserId: null,
      createdAt,
    });
  } catch (error) {
    if (isUniqueConstraint(error)) {
      throw Errors.conflict('你已經代報過相同姓名');
    }
    throw error;
  }

  await enforceCapacity(db, eventId, event.capacity);
  const saved = await getRegistration(db, registrationId);
  if (!saved) {
    throw Errors.notFound('代報失敗');
  }
  return toRegistrationRecord(saved, user.lineUserId, event.organizer_line_user_id);
}

export async function cancelRegistration(
  db: D1Database,
  registrationId: string,
  user: AuthUser,
  groupId?: string,
): Promise<{ promoted: boolean }> {
  const registration = await getRegistration(db, registrationId);
  if (!registration) {
    throw Errors.notFound('找不到報名紀錄');
  }

  const event = await getVisibleEvent(db, registration.event_id, groupId);
  const isOrganizer = event.organizer_line_user_id === user.lineUserId;
  const isOwner = registration.created_by_line_user_id === user.lineUserId;
  const participantId =
    registration.participant_line_user_id ??
    (registration.type === 'SELF' ? registration.line_user_id : null);
  const isParticipant = Boolean(participantId) && participantId === user.lineUserId;
  if (!isOrganizer && !isOwner && !isParticipant) {
    throw Errors.forbidden('不能取消其他人建立的報名');
  }

  const wasConfirmed = registration.status === 'CONFIRMED';
  await deleteRegistrationRow(db, registrationId);

  let promoted = false;
  if (wasConfirmed) {
    const before = await countConfirmed(db, event.event_id);
    await promoteFirstWaitlist(db, event.event_id, event.capacity);
    const after = await countConfirmed(db, event.event_id);
    promoted = after > before;
  } else {
    await resequenceWaitlist(db, event.event_id);
  }

  return { promoted };
}

export async function getEventForRegistration(db: D1Database, eventId: string) {
  return getEventRow(db, eventId);
}
