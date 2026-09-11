export type EventStatus = 'OPEN' | 'CLOSED' | 'DELETED';
export type RegistrationType = 'SELF' | 'PROXY';
export type RegistrationStatus = 'CONFIRMED' | 'WAITLIST';

export interface EventSummary {
  eventId: string;
  groupId: string;
  name: string;
  eventDate: string;
  eventTime: string;
  eventAt: string;
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

export interface CreateEventInput {
  name: string;
  eventDate: string;
  eventTime: string;
  address: string;
  capacity: number;
  waitlistEnabled: boolean;
}

export interface UpdateEventInput {
  name?: string;
  eventDate?: string;
  eventTime?: string;
  address?: string;
  capacity?: number;
  waitlistEnabled?: boolean;
  confirmTimeLocationChange?: boolean;
}

export interface ApiErrorBody {
  error: string;
  message: string;
}
