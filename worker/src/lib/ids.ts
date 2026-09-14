import type {
  RegistrationRecord,
  RegistrationSource,
  RegistrationStatus,
  RegistrationType,
} from '../../../shared/types';

export function newId(): string {
  return crypto.randomUUID();
}

export function asBoolean(value: number | boolean): boolean {
  return value === true || value === 1;
}

export function displayLabel(
  type: RegistrationType,
  participantName: string,
  createdByDisplayName: string,
): string {
  if (type === 'PROXY') {
    return `${participantName}（${createdByDisplayName} 代報）`;
  }
  return participantName;
}

function resolveRegistrationSource(
  row: {
    type: RegistrationType;
    registration_source?: string | null;
  },
): RegistrationSource {
  if (row.registration_source === 'ORGANIZER_PRESELECT') return 'ORGANIZER_PRESELECT';
  if (row.registration_source === 'PROXY' || row.type === 'PROXY') return 'PROXY';
  return 'SELF_JOIN';
}

export function toRegistrationRecord(
  row: {
    registration_id: string;
    event_id: string;
    type: RegistrationType;
    status: RegistrationStatus;
    waitlist_position: number | null;
    participant_name: string;
    line_user_id: string | null;
    participant_line_user_id?: string | null;
    registration_source?: string | null;
    created_by_line_user_id: string;
    created_by_display_name: string;
    created_at: string;
  },
  viewerLineUserId: string,
  organizerLineUserId: string,
): RegistrationRecord {
  const participantLineUserId =
    row.participant_line_user_id ??
    (row.type === 'SELF' ? row.line_user_id : null);
  const canCancel =
    viewerLineUserId === organizerLineUserId ||
    (Boolean(participantLineUserId) && viewerLineUserId === participantLineUserId);

  return {
    registrationId: row.registration_id,
    eventId: row.event_id,
    type: row.type,
    status: row.status,
    registrationSource: resolveRegistrationSource(row),
    waitlistPosition: row.waitlist_position,
    participantName: row.participant_name,
    displayLabel: displayLabel(row.type, row.participant_name, row.created_by_display_name),
    lineUserId: row.line_user_id,
    participantLineUserId,
    createdByLineUserId: row.created_by_line_user_id,
    createdByDisplayName: row.created_by_display_name,
    createdAt: row.created_at,
    canCancel,
  };
}

export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < aBytes.length; i += 1) {
    mismatch |= aBytes[i] ^ bBytes[i];
  }
  return mismatch === 0;
}
