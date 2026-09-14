import { ApiError, api } from './api';
import {
  LINK_UNRECOVERABLE_MESSAGE,
  applyContextTokenToSession,
  isContextTokenExpired,
  isJoyInContextTokenFormat,
} from './liff-context';
import type { LiffSession } from './liff';
import type { EventDetail } from '../../shared/types';

export type EventDetailBootResult =
  | { kind: 'ready'; event: EventDetail }
  | { kind: 'redirect_list'; toast: string }
  | { kind: 'unrecoverable'; message: string }
  | { kind: 'error'; message: string };

function listToastForEventError(err: ApiError): string | null {
  switch (err.code) {
    case 'event_ended':
    case 'GONE':
      return '此活動已結束';
    case 'event_deleted':
      return '此活動已刪除';
    case 'event_not_found':
    case 'NOT_FOUND':
      return '找不到此活動';
    default:
      return null;
  }
}

async function tryRefreshContext(session: LiffSession, token: string): Promise<boolean> {
  if (!isJoyInContextTokenFormat(token)) return false;
  try {
    const result = await api.refreshContext(session, token);
    if (result.context && isJoyInContextTokenFormat(result.context)) {
      applyContextTokenToSession(session, result.context);
      return true;
    }
  } catch (err) {
    if (err instanceof ApiError) {
      // Signature / malformed must not look like a soft success.
      if (
        err.code === 'context_signature_mismatch' ||
        err.code === 'context_malformed' ||
        err.code === 'context_payload_invalid' ||
        err.code === 'context_user_binding_error'
      ) {
        return false;
      }
    }
  }
  return false;
}

/**
 * Load /events/{eventId} with recovery:
 * valid context → event; ended/deleted/missing → list toast;
 * expired context → refresh → list; no context → recover-event → list.
 */
export async function bootEventDetailPage(
  session: LiffSession,
  eventId: string,
): Promise<EventDetailBootResult> {
  const id = (eventId || '').trim();
  if (!id) {
    return { kind: 'unrecoverable', message: LINK_UNRECOVERABLE_MESSAGE };
  }

  const context = (session.contextToken || '').trim();

  if (context && isContextTokenExpired(context)) {
    const refreshed = await tryRefreshContext(session, context);
    if (refreshed) {
      return { kind: 'redirect_list', toast: '' };
    }
    return { kind: 'unrecoverable', message: LINK_UNRECOVERABLE_MESSAGE };
  }

  if (context) {
    try {
      const result = await api.getEvent(session, id);
      return { kind: 'ready', event: result.event };
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'context_expired') {
          const refreshed = await tryRefreshContext(session, context);
          if (refreshed) {
            return { kind: 'redirect_list', toast: '' };
          }
          return { kind: 'unrecoverable', message: LINK_UNRECOVERABLE_MESSAGE };
        }
        const toast = listToastForEventError(err);
        if (toast) {
          return { kind: 'redirect_list', toast };
        }
        if (err.code.startsWith('context_')) {
          return { kind: 'unrecoverable', message: LINK_UNRECOVERABLE_MESSAGE };
        }
        return { kind: 'error', message: err.message };
      }
      return { kind: 'error', message: err instanceof Error ? err.message : '無法載入活動' };
    }
  }

  // No context — try legacy eventId recovery (membership-gated).
  try {
    const recovered = await api.recoverContextFromEvent(session, id);
    if (recovered.context && isJoyInContextTokenFormat(recovered.context)) {
      applyContextTokenToSession(session, recovered.context);
      return { kind: 'redirect_list', toast: '' };
    }
  } catch {
    // uniform external message
  }
  return { kind: 'unrecoverable', message: LINK_UNRECOVERABLE_MESSAGE };
}
