export type EventStatus = 'OPEN' | 'CLOSED' | 'DELETED';
export type RegistrationType = 'SELF' | 'PROXY';
export type RegistrationStatus = 'CONFIRMED' | 'WAITLIST';
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
  waitlistPosition: number | null;
  participantName: string;
  displayLabel: string;
  lineUserId: string | null;
  createdByLineUserId: string;
  createdByDisplayName: string;
  createdAt: string;
  canCancel: boolean;
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
  capacity: number;
  waitlistEnabled: boolean;
}

export interface UpdateEventInput extends Partial<CreateEventInput> {
  confirmTimeLocationChange?: boolean;
}

export interface CopyEventInput extends EventTimeRangeInput {
  name?: string;
  address?: string;
  capacity?: number;
  waitlistEnabled?: boolean;
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
