export type EventStatus = 'OPEN' | 'CLOSED' | 'DELETED';
export type RegistrationType = 'SELF' | 'PROXY';
export type RegistrationStatus = 'CONFIRMED' | 'WAITLIST';
export type RegistrationSource = 'SELF_JOIN' | 'PROXY' | 'ORGANIZER_PRESELECT';
export type TransferInviteStatus = 'PENDING' | 'ACCEPTED' | 'CANCELLED';

export interface EventSummary {
  eventId: string;
  groupId: string;
  name: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  startAt: string;
  endAt: string;
  address: string;
  /** Optional Google Maps https URL; null when unset. */
  googleMapsUrl: string | null;
  /** Per-person fee in TWD; 0 means free. */
  feeAmount: number;
  capacity: number;
  waitlistEnabled: boolean;
  status: EventStatus;
  confirmedCount: number;
  waitlistCount: number;
  organizerLineUserId: string;
  organizerDisplayName: string;
  createdAt: string;
  updatedAt: string;
}

export interface RegistrationRecord {
  registrationId: string;
  eventId: string;
  type: RegistrationType;
  status: RegistrationStatus;
  registrationSource: RegistrationSource;
  waitlistPosition: number | null;
  participantName: string;
  displayLabel: string;
  lineUserId: string | null;
  /** LINE user id of the attendee when known (SELF / ORGANIZER_PRESELECT). */
  participantLineUserId: string | null;
  createdByLineUserId: string;
  createdByDisplayName: string;
  createdAt: string;
  canCancel: boolean;
}

export interface GroupMemberPublic {
  lineUserId: string;
  displayName: string;
  pictureUrl: string | null;
}

export type PreselectCandidateKind = 'line' | 'proxy';
export type PreselectMemberSection =
  | 'attended'
  | 'proxy'
  | 'waitlist'
  | 'history'
  | 'other';
export type PreselectMemberBadge = 'proxy' | 'waitlist' | null;

export interface PreselectMemberItem {
  /** Stable selection key: `line:{userId}` or `proxy:{normalizedName}`. */
  key: string;
  kind: PreselectCandidateKind;
  lineUserId: string | null;
  proxyName: string | null;
  displayName: string;
  pictureUrl: string | null;
  section: PreselectMemberSection;
  defaultSelected: boolean;
  badge: PreselectMemberBadge;
}

export interface PreselectMemberRoster {
  members: PreselectMemberItem[];
  sections: {
    attended: PreselectMemberItem[];
    proxy: PreselectMemberItem[];
    waitlist: PreselectMemberItem[];
    history: PreselectMemberItem[];
    other: PreselectMemberItem[];
  };
  attendedTitle: string;
  proxyTitle: string;
  waitlistTitle: string;
  historyTitle: string;
  otherTitle: string;
  defaultSelectedKeys: string[];
  /** @deprecated Prefer defaultSelectedKeys */
  defaultSelectedIds: string[];
  lineSyncStatus: 'ok' | 'failed' | 'skipped' | 'unavailable';
  hint: string | null;
  emptyMessage: string | null;
  syncedAt: string | null;
}

export interface EventDetail extends EventSummary {
  registrations: {
    confirmed: RegistrationRecord[];
    waitlist: RegistrationRecord[];
  };
  viewer: {
    isOrganizer: boolean;
    selfRegistration: RegistrationRecord | null;
    proxyRegistrations: RegistrationRecord[];
  };
}

export interface EventTimeRangeInput {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}

export interface CreateEventInput extends EventTimeRangeInput {
  name: string;
  address: string;
  googleMapsUrl: string | null;
  feeAmount: number;
  capacity: number;
  waitlistEnabled: boolean;
  /** LINE user ids to pre-register as CONFIRMED (organizer preselect). */
  preselectedMemberIds?: string[];
  /** Proxy display names to pre-register as PROXY (organizer preselect). */
  preselectedProxyNames?: string[];
}

export interface UpdateEventInput extends Partial<Omit<CreateEventInput, 'preselectedMemberIds' | 'preselectedProxyNames'>> {
  confirmTimeLocationChange?: boolean;
}

export interface CopyEventInput extends EventTimeRangeInput {
  name?: string;
  address?: string;
  googleMapsUrl?: string | null;
  feeAmount?: number;
  capacity?: number;
  waitlistEnabled?: boolean;
  preselectedMemberIds?: string[];
  preselectedProxyNames?: string[];
}

export interface TransferInviteCreated {
  token: string;
  expiresAt: string;
  sharePath: string;
}

export interface TransferInvitePreview {
  eventId: string;
  eventName: string;
  organizerDisplayName: string;
  status: TransferInviteStatus;
  expiresAt: string;
  isOrganizer: boolean;
}

export interface ApiErrorBody {
  error: string;
  message: string;
}
