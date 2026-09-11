import type {
  CopyEventInput,
  CreateEventInput,
  EventDetail,
  EventSummary,
  TransferInviteCreated,
  TransferInvitePreview,
  UpdateEventInput,
} from '../../shared/types';
import type { LiffSession } from './liff';
import { buildAuthorizationHeader } from './auth-token';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, session: LiffSession, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  // Single Bearer + raw ID Token string — no encodeURIComponent / JSON.stringify / extra quotes.
  headers.set('Authorization', buildAuthorizationHeader(session.idToken));
  if (session.contextToken) {
    headers.set('X-JoyIn-Context', session.contextToken);
  }
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  } & T;

  if (!response.ok) {
    throw new ApiError(response.status, data.error || 'ERROR', data.message || '請求失敗');
  }
  return data;
}

export const api = {
  listEvents: (session: LiffSession) =>
    request<{ events: EventSummary[] }>('/api/events', session),
  getEvent: (session: LiffSession, eventId: string) =>
    request<{ event: EventDetail }>(`/api/events/${eventId}`, session),
  createEvent: (session: LiffSession, input: CreateEventInput) =>
    request<{ event: EventSummary }>('/api/events', session, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateEvent: (session: LiffSession, eventId: string, input: UpdateEventInput) =>
    request<{ event: EventSummary }>(`/api/events/${eventId}`, session, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  copyEvent: (session: LiffSession, eventId: string, input: CopyEventInput) =>
    request<{ event: EventSummary }>(`/api/events/${eventId}/copy`, session, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  join: (session: LiffSession, eventId: string) =>
    request(`/api/events/${eventId}/join`, session, { method: 'POST' }),
  proxyJoin: (session: LiffSession, eventId: string, participantName: string) =>
    request(`/api/events/${eventId}/proxy-join`, session, {
      method: 'POST',
      body: JSON.stringify({ participantName }),
    }),
  cancel: (session: LiffSession, registrationId: string) =>
    request(`/api/registrations/${registrationId}`, session, { method: 'DELETE' }),
  closeEvent: (session: LiffSession, eventId: string) =>
    request(`/api/events/${eventId}/close`, session, { method: 'POST' }),
  deleteEvent: (session: LiffSession, eventId: string) =>
    request(`/api/events/${eventId}`, session, { method: 'DELETE' }),
  createTransferInvite: (session: LiffSession, eventId: string) =>
    request<{ invite: TransferInviteCreated }>(`/api/events/${eventId}/transfer-invites`, session, {
      method: 'POST',
    }),
  cancelTransferInvites: (session: LiffSession, eventId: string) =>
    request(`/api/events/${eventId}/transfer-invites`, session, { method: 'DELETE' }),
  previewTransferInvite: (session: LiffSession, token: string) =>
    request<{ invite: TransferInvitePreview }>(`/api/transfer-invites/${token}`, session),
  acceptTransferInvite: (session: LiffSession, token: string) =>
    request<{ event: EventSummary }>(`/api/transfer-invites/${token}/accept`, session, {
      method: 'POST',
    }),
};
