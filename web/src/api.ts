import type {
  CopyEventInput,
  CreateEventInput,
  CreatePreorderOfferInput,
  CreatePreorderFromMenuInput,
  EventDetail,
  EventPreorderCancelImpact,
  EventPreorderListResponse,
  EventSummary,
  HistoryEventSummary,
  MyPreorderOrderResponse,
  PreorderOfferDetail,
  PreorderOfferOrderSummary,
  PreorderOrder,
  PreorderOrderItemInput,
  PreorderProduct,
  PreorderProductInput,
  PreselectMemberRoster,
  RegistrationRecord,
  AiMenuDraft,
  AiMenuQuota,
  SharedMenuDetail,
  SharedMenuSummary,
  SharedMenuVersion,
  SharedMenuVersionInput,
  TransferInviteCreated,
  TransferInvitePreview,
  UpdateEventInput,
  UpdatePreorderOfferInput,
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

/** One silent ID-token recovery per page lifetime — never login/logout loops. */
let authRecoveryUsed = false;

/** Test helper */
export function resetApiAuthRecoveryForTests(): void {
  authRecoveryUsed = false;
}

export function isAuthTokenError(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    (err.code === 'auth_token_expired' ||
      err.code === 'auth_token_invalid' ||
      err.code === 'auth_token_missing' ||
      err.code === 'auth_token_malformed')
  );
}

/**
 * Re-read liff.getIDToken() once. Does not call login/logout.
 * @returns true when a non-expired JWT is available
 */
export function tryRefreshIdTokenOnce(session: LiffSession, nowMs = Date.now()): boolean {
  if (authRecoveryUsed) return false;
  authRecoveryUsed = true;
  const liff = getCachedLiff();
  const raw = liff ? liff.getIDToken() : session.getIdToken();
  const tokenDiag = describeIdTokenSafe(typeof raw === 'string' ? raw : '');
  const decoded =
    (liff && typeof liff.getDecodedIDToken === 'function' ? liff.getDecodedIDToken() : null) ??
    session.getDecodedIdToken?.() ??
    null;
  const expiry = readIdTokenExpiry(decoded, nowUnixSeconds(nowMs));
  logSafeDiag({
    event: 'id_token_recovery_attempt',
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
  if (!raw || typeof raw !== 'string' || !raw.trim()) return false;
  if (tokenDiag.partCount !== 3) return false;
  if (expiry.expired) return false;
  return true;
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
    hasContext: Boolean(session.contextToken),
    contextLength: session.contextToken?.length ?? 0,
    at: new Date().toISOString(),
  });

  if (expiry.expired) {
    throw new ApiError(401, 'auth_token_expired', AUTH_EXPIRED_BODY);
  }

  if (raw == null || typeof raw !== 'string' || !raw.trim()) {
    throw new ApiError(401, 'auth_token_missing', '缺少 LIFF ID Token');
  }

  if (tokenDiag.partCount !== 3 && !raw.startsWith('test:') && raw !== 'dev-token') {
    throw new ApiError(401, 'auth_token_malformed', '登入 Token 格式錯誤');
  }

  return raw.trim();
}

async function requestOnce<T>(
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

async function request<T>(
  path: string,
  session: LiffSession,
  init: RequestInit = {},
  options?: { omitContext?: boolean },
): Promise<T> {
  try {
    return await requestOnce(path, session, init, options);
  } catch (err) {
    if (!isAuthTokenError(err)) throw err;
    // One silent recovery: re-read getIDToken only (no login/logout).
    if (!tryRefreshIdTokenOnce(session)) throw err;
    try {
      return await requestOnce(path, session, init, options);
    } catch (retryErr) {
      // Keep original auth classification for UI (never map to /list).
      throw retryErr instanceof ApiError && isAuthTokenError(retryErr) ? retryErr : err;
    }
  }
}

export const api = {
  listEvents: (session: LiffSession) =>
    request<{ events: EventSummary[] }>('/api/events', session),
  listHistoryEvents: (session: LiffSession) =>
    request<{ events: HistoryEventSummary[] }>('/api/events/history', session),
  listGroupMembers: (
    session: LiffSession,
    options?: { refresh?: boolean; copyEventId?: string },
  ) => {
    const params = new URLSearchParams();
    if (options?.refresh) params.set('refresh', '1');
    if (options?.copyEventId) params.set('copyEventId', options.copyEventId);
    const qs = params.toString();
    return request<PreselectMemberRoster>(`/api/group/members${qs ? `?${qs}` : ''}`, session);
  },
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
    request<{ registration: RegistrationRecord }>(`/api/events/${eventId}/join`, session, {
      method: 'POST',
    }),
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
  refreshContext: (session: LiffSession, contextToken: string) =>
    request<{ context: string }>(
      '/api/context/refresh',
      session,
      { method: 'POST', body: JSON.stringify({ context: contextToken }) },
      { omitContext: true },
    ),
  recoverContextFromEvent: (session: LiffSession, eventId: string) =>
    request<{ context: string }>(
      '/api/context/recover-event',
      session,
      { method: 'POST', body: JSON.stringify({ eventId }) },
      { omitContext: true },
    ),
  listEventPreorders: (session: LiffSession, eventId: string) =>
    request<EventPreorderListResponse>(`/api/events/${eventId}/preorders`, session),
  preorderCancelCheck: (session: LiffSession, eventId: string) =>
    request<EventPreorderCancelImpact>(`/api/events/${eventId}/preorder-cancel-check`, session),
  createPreorder: (
    session: LiffSession,
    eventId: string,
    input: CreatePreorderOfferInput,
    idempotencyKey = crypto.randomUUID(),
  ) =>
    request<{ offer: PreorderOfferDetail }>(`/api/events/${eventId}/preorders`, session, {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
  getPreorder: (session: LiffSession, offerId: string) =>
    request<{ offer: PreorderOfferDetail }>(`/api/preorders/${offerId}`, session),
  updatePreorder: (session: LiffSession, offerId: string, input: UpdatePreorderOfferInput) =>
    request<{ offer: PreorderOfferDetail }>(`/api/preorders/${offerId}`, session, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  closePreorder: (session: LiffSession, offerId: string) =>
    request<{ offer: PreorderOfferDetail }>(`/api/preorders/${offerId}/close`, session, {
      method: 'POST',
    }),
  cancelPreorder: (session: LiffSession, offerId: string) =>
    request<{ offer: PreorderOfferDetail }>(`/api/preorders/${offerId}/cancel`, session, {
      method: 'POST',
    }),
  addPreorderProduct: (session: LiffSession, offerId: string, input: PreorderProductInput) =>
    request<{ product: PreorderProduct }>(`/api/preorders/${offerId}/products`, session, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updatePreorderProduct: (
    session: LiffSession,
    offerId: string,
    productId: string,
    input: PreorderProductInput,
  ) =>
    request<{ product: PreorderProduct }>(
      `/api/preorders/${offerId}/products/${productId}`,
      session,
      { method: 'PATCH', body: JSON.stringify(input) },
    ),
  deletePreorderProduct: (session: LiffSession, offerId: string, productId: string) =>
    request<{ deactivated: boolean }>(
      `/api/preorders/${offerId}/products/${productId}`,
      session,
      { method: 'DELETE' },
    ),
  listPreorderOrders: (session: LiffSession, offerId: string) =>
    request<{ orders: PreorderOrder[] }>(`/api/preorders/${offerId}/orders`, session),
  getPreorderSummary: (session: LiffSession, offerId: string) =>
    request<{ summary: PreorderOfferOrderSummary }>(`/api/preorders/${offerId}/summary`, session),
  getMyPreorderOrder: (session: LiffSession, offerId: string) =>
    request<MyPreorderOrderResponse>(`/api/preorders/${offerId}/my-order`, session),
  upsertMyPreorderOrder: (
    session: LiffSession,
    offerId: string,
    items: PreorderOrderItemInput[],
    idempotencyKey?: string,
  ) =>
    request<{ order: PreorderOrder }>(`/api/preorders/${offerId}/my-order`, session, {
      method: 'PUT',
      body: JSON.stringify({ items }),
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    }),
  reportMyPreorderPayment: (session: LiffSession, offerId: string) =>
    request<{ order: PreorderOrder }>(
      `/api/preorders/${offerId}/my-order/report-payment`,
      session,
      { method: 'POST' },
    ),
  cancelMyPreorderOrder: (session: LiffSession, offerId: string, reason?: string) =>
    request<{ order: PreorderOrder }>(`/api/preorders/${offerId}/my-order/cancel`, session, {
      method: 'POST',
      body: JSON.stringify({ reason: reason || '' }),
    }),
  confirmPreorderPayment: (session: LiffSession, offerId: string, orderId: string) =>
    request<{ order: PreorderOrder }>(
      `/api/preorders/${offerId}/orders/${orderId}/confirm-payment`,
      session,
      { method: 'POST' },
    ),
  fulfillPreorderOrder: (session: LiffSession, offerId: string, orderId: string) =>
    request<{ order: PreorderOrder }>(
      `/api/preorders/${offerId}/orders/${orderId}/fulfill`,
      session,
      { method: 'POST' },
    ),
  cancelPreorderOrder: (session: LiffSession, offerId: string, orderId: string, reason: string) =>
    request<{ order: PreorderOrder }>(
      `/api/preorders/${offerId}/orders/${orderId}/cancel`,
      session,
      { method: 'POST', body: JSON.stringify({ reason }) },
    ),
  reportPreorderSettlementHandled: (
    session: LiffSession,
    offerId: string,
    orderId: string,
    note: string,
  ) =>
    request<{ order: PreorderOrder }>(
      `/api/preorders/${offerId}/orders/${orderId}/settlement/report-handled`,
      session,
      { method: 'POST', body: JSON.stringify({ note }) },
    ),
  listSharedMenus: (session: LiffSession, search = '') =>
    request<{ menus: SharedMenuSummary[] }>(
      `/api/menus${search ? `?q=${encodeURIComponent(search)}` : ''}`,
      session,
    ),
  getSharedMenu: (session: LiffSession, menuId: string) =>
    request<SharedMenuDetail>(`/api/menus/${menuId}`, session),
  getSharedMenuVersions: (session: LiffSession, menuId: string) =>
    request<{ versions: SharedMenuVersion[] }>(`/api/menus/${menuId}/versions`, session),
  createSharedMenuDraft: (
    session: LiffSession,
    input: SharedMenuVersionInput,
    idempotencyKey: string,
  ) =>
    request<{ version: SharedMenuVersion; idempotencyHit: boolean }>(
      '/api/menus/drafts',
      session,
      {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Idempotency-Key': idempotencyKey },
      },
    ),
  createSharedMenuVersion: (
    session: LiffSession,
    menuId: string,
    input: SharedMenuVersionInput,
    idempotencyKey: string,
  ) =>
    request<{ version: SharedMenuVersion; idempotencyHit: boolean }>(
      `/api/menus/${menuId}/versions`,
      session,
      {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Idempotency-Key': idempotencyKey },
      },
    ),
  publishSharedMenuVersion: (
    session: LiffSession,
    menuId: string,
    versionId: string,
    expectedCurrentVersionId: string | null,
    confirmed: boolean,
    idempotencyKey = crypto.randomUUID(),
  ) =>
    request<SharedMenuDetail>(`/api/menus/${menuId}/versions/${versionId}/publish`, session, {
      method: 'POST',
      body: JSON.stringify({ expectedCurrentVersionId, confirmed }),
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
  disableSharedMenu: (
    session: LiffSession,
    menuId: string,
    idempotencyKey = crypto.randomUUID(),
  ) =>
    request<SharedMenuDetail>(`/api/menus/${menuId}/disable`, session, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
  getMyAiMenuQuota: (session: LiffSession) =>
    request<{ quota: AiMenuQuota }>('/api/menus/ai/quota/me', session),
  parseMenuImage: (session: LiffSession, imageUrl: string, idempotencyKey: string) =>
    request<{ draft: AiMenuDraft }>('/api/menus/ai/parse-image', session, {
      method: 'POST',
      body: JSON.stringify({ imageUrl }),
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
  createPreorderFromMenu: (
    session: LiffSession,
    eventId: string,
    input: CreatePreorderFromMenuInput,
    idempotencyKey: string,
  ) =>
    request<{ offer: PreorderOfferDetail }>(`/api/events/${eventId}/preorders/from-menu`, session, {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
};
