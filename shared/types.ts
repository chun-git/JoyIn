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
}

export interface UpdateEventInput extends Partial<Omit<CreateEventInput, 'preselectedMemberIds'>> {
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
