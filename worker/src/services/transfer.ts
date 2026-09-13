import type { TransferInviteCreated, TransferInvitePreview } from '../../../shared/types';
import type { AuthUser } from '../env';
import {
  acceptTransferInviteAtomic,
  cancelPendingInvites,
  getEventRow,
  getInviteByHash,
  insertTransferInvite,
  toEventSummary,
} from '../db/repo';
import { Errors } from '../lib/errors';
import { TRANSFER_INVITE_TTL_MS, nowIso, sha256Hex, newTransferToken } from '../lib/datetime';
import { newId } from '../lib/ids';
import { getVisibleEvent } from './events';

export async function createTransferInvite(
  db: D1Database,
  eventId: string,
  user: AuthUser,
  groupId: string,
): Promise<TransferInviteCreated> {
  const event = await getVisibleEvent(db, eventId, groupId);
  if (event.organizer_line_user_id !== user.lineUserId) {
    throw Errors.forbidden('只有主揪可以產生轉移連結');
  }

  const createdAt = nowIso();
  await cancelPendingInvites(db, eventId);

  const token = newTransferToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + TRANSFER_INVITE_TTL_MS).toISOString();
  await insertTransferInvite(db, {
    inviteId: newId(),
    eventId,
    tokenHash,
    fromLineUserId: user.lineUserId,
    fromDisplayName: user.displayName,
    expiresAt,
    createdAt,
  });

  return {
    token,
    expiresAt,
    sharePath: `/transfer/${token}`,
  };
}

export async function cancelTransferInvites(
  db: D1Database,
  eventId: string,
  user: AuthUser,
  groupId: string,
): Promise<void> {
  const event = await getVisibleEvent(db, eventId, groupId);
  if (event.organizer_line_user_id !== user.lineUserId) {
    throw Errors.forbidden('只有主揪可以取消轉移連結');
  }
  await cancelPendingInvites(db, eventId);
}

export async function previewTransferInvite(
  db: D1Database,
  token: string,
  user: AuthUser,
): Promise<TransferInvitePreview> {
  const invite = await getInviteByHash(db, await sha256Hex(token));
  if (!invite) {
    throw Errors.notFound('找不到轉移邀請');
  }
  if (invite.status === 'ACCEPTED') {
    throw Errors.transferInviteUsed();
  }
  if (invite.status === 'CANCELLED') {
    throw Errors.transferInviteInvalid();
  }
  if (new Date(invite.expires_at).getTime() <= Date.now()) {
    throw Errors.transferInviteExpired();
  }

  const event = await getEventRow(db, invite.event_id);
  if (!event || event.status === 'DELETED') {
    throw Errors.notFound('找不到活動');
  }

  return {
    eventId: event.event_id,
    eventName: event.name,
    organizerDisplayName: event.organizer_display_name,
    status: invite.status,
    expiresAt: invite.expires_at,
    isOrganizer: user.lineUserId === event.organizer_line_user_id,
  };
}

function classifyInviteFailure(
  invite: Awaited<ReturnType<typeof getInviteByHash>>,
  nowMs: number,
): never {
  if (!invite) {
    throw Errors.notFound('找不到轉移邀請');
  }
  if (invite.status === 'ACCEPTED') {
    throw Errors.transferInviteUsed();
  }
  if (invite.status === 'CANCELLED') {
    throw Errors.transferInviteInvalid();
  }
  if (new Date(invite.expires_at).getTime() <= nowMs) {
    throw Errors.transferInviteExpired();
  }
  throw Errors.transferInviteInvalid();
}

/**
 * Accept transfer with a single D1 batch (atomic transaction):
 * - CAS invite PENDING + not expired → ACCEPTED (+ accepted_by)
 * - CAS event organizer still equals invite.from → new organizer
 * - cancel other PENDING invites for the event
 * - insert organizer_transfers audit
 */
export async function acceptTransferInvite(db: D1Database, token: string, user: AuthUser) {
  const nowMs = Date.now();
  const invite = await getInviteByHash(db, await sha256Hex(token));
  if (!invite) {
    throw Errors.notFound('找不到轉移邀請');
  }
  if (invite.status === 'CANCELLED') {
    throw Errors.transferInviteInvalid();
  }
  if (invite.status === 'ACCEPTED') {
    throw Errors.transferInviteUsed();
  }
  if (new Date(invite.expires_at).getTime() <= nowMs) {
    throw Errors.transferInviteExpired();
  }
  if (invite.from_line_user_id === user.lineUserId) {
    throw Errors.validation('不能把主揪轉移給自己');
  }

  const event = await getEventRow(db, invite.event_id);
  if (!event || event.status === 'DELETED') {
    throw Errors.notFound('找不到活動');
  }
  if (event.organizer_line_user_id !== invite.from_line_user_id) {
    throw Errors.transferInviteInvalid('活動主揪已變更，此連結無法使用');
  }
  if (event.organizer_line_user_id === user.lineUserId) {
    throw Errors.validation('不能把主揪轉移給自己');
  }

  const acceptedAt = nowIso();
  const { inviteAccepted, organizerUpdated } = await acceptTransferInviteAtomic(db, {
    inviteId: invite.invite_id,
    eventId: event.event_id,
    fromLineUserId: invite.from_line_user_id,
    fromDisplayName: invite.from_display_name,
    toLineUserId: user.lineUserId,
    toDisplayName: user.displayName,
    acceptedAt,
    transferId: newId(),
    nowIso: acceptedAt,
  });

  if (!inviteAccepted || !organizerUpdated) {
    // Batch rolled back — re-read to return the precise client code.
    const again = await getInviteByHash(db, await sha256Hex(token));
    classifyInviteFailure(again, Date.now());
  }

  const updated = await getEventRow(db, event.event_id);
  if (!updated) {
    throw Errors.notFound();
  }
  return toEventSummary(updated);
}
