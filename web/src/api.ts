import type {
  CopyEventInput,
  CreateEventInput,
  EventDetail,
  EventSummary,
  TransferInviteCreated,
  TransferInvitePreview,
  UpdateEventInput,
} from '../../shared/types';
import { AUTH_EXPIRED_BODY } from './auth-recovery-keys';
import { buildAuthorizationHeader, describeIdTokenSafe } from './auth-token';
import { readIdTokenExpiry, nowUnixSeconds } from './id-token-expiry';
import { getCachedLiff, logSafeDiag, type LiffSession } from './liff';

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

/**
 * Resolve a fresh ID Token immediately before each request.
 * Never reuses a string cached on React state / closures from boot time.
 */
export function resolveFreshIdToken(session: LiffSession, nowMs = Date.now()): string {
  const liff = getCachedLiff();
  const decoded =
    (liff && typeof liff.getDecodedIDToken === 'function' ? liff.getDecodedIDToken() : null) ??
    session.getDecodedIdToken?.() ??
    null;
  const expiry = readIdTokenExpiry(decoded, nowUnixSeconds(nowMs));

  const raw = liff ? liff.getIDToken() : session.getIdToken();
  const tokenDiag = describeIdTokenSafe(typeof raw === 'string' ? raw : '');

  logSafeDiag({
    event: expiry.expired ? 'id_token_expired' : 'id_token_ok',
    phase: 'loading_events',
    isInClient: session.inClient,
    idTokenPresent: tokenDiag.present,
    jwtPartCount: tokenDiag.partCount,
    idTokenFormatOk: tokenDiag.formatOk,
    iat: expiry.iat,
    exp: expiry.exp,
    now: expiry.now,
    secondsUntilExpiry: expiry.secondsUntilExpiry,
    at: new Date().toISOString(),
  });

  if (expiry.expired) {
    throw new ApiError(401, 'auth_token_expired', AUTH_EXPIRED_BODY);
  }

  if (raw == null || typeof raw !== 'string' || !raw.trim()) {
    throw new ApiError(401, 'auth_token_missing', '缺少 LIFF ID Token');
  }

  return raw.trim();
}

async function request<T>(
  path: string,
  session: LiffSession,
  init: RequestInit = {},
  options?: { omitContext?: boolean },
): Promise<T> {
  const idToken = resolveFreshIdToken(session);
  const headers = new Headers(init.headers);
  headers.set('Authorization', buildAuthorizationHeader(idToken));
  if (!options?.omitContext && session.contextToken) {
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
    throw new ApiError(
      response.status,
      typeof data.error === 'string' ? data.error : 'ERROR',
      typeof data.message === 'string' ? data.message : '請求失敗',
    );
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
  /** Refresh expired context — send token in body only (not X-JoyIn-Context). */
  refreshContext: (session: LiffSession, contextToken: string) =>
    request<{ context: string }>(
      '/api/context/refresh',
      session,
      { method: 'POST', body: JSON.stringify({ context: contextToken }) },
      { omitContext: true },
    ),
  /** Recover context from legacy eventId deep link. */
  recoverContextFromEvent: (session: LiffSession, eventId: string) =>
    request<{ context: string }>(
      '/api/context/recover-event',
      session,
      { method: 'POST', body: JSON.stringify({ eventId }) },
      { omitContext: true },
    ),
};
