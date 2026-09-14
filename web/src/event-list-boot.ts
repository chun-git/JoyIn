import { ApiError, api, isAuthTokenError } from './api';
import {
  CONTEXT_EXPIRED_BODY,
  CONTEXT_EXPIRED_TITLE,
  CONTEXT_MISSING_BODY,
  CONTEXT_MISSING_TITLE,
  SERVER_ERROR_TITLE,
} from './auth-recovery-keys';
import {
  applyContextTokenToSession,
  isContextTokenExpired,
  isJoyInContextTokenFormat,
} from './liff-context';
import type { LiffSession } from './liff';
import type { EventSummary } from '../../shared/types';

export type EventListBootResult =
  | { kind: 'ready'; events: EventSummary[] }
  | { kind: 'auth'; code: string }
  | { kind: 'context_missing' }
  | { kind: 'context_invalid'; title: string; body: string }
  | { kind: 'server'; message: string }
  | { kind: 'error'; title: string; message: string };

async function tryRefreshContext(session: LiffSession, token: string): Promise<boolean> {
  if (!isJoyInContextTokenFormat(token)) return false;
  try {
    const result = await api.refreshContext(session, token);
    if (result.context && isJoyInContextTokenFormat(result.context)) {
      applyContextTokenToSession(session, result.context);
      return true;
    }
  } catch (err) {
    if (err instanceof ApiError && isAuthTokenError(err)) {
      throw err;
    }
  }
  return false;
}

/**
 * Load /events with context refresh and strict auth/context error separation.
 * Never maps auth_token_* to /list guidance.
 */
export async function bootEventListPage(session: LiffSession): Promise<EventListBootResult> {
  const context = (session.contextToken || '').trim();

  if (!context) {
    return { kind: 'context_missing' };
  }

  if (isContextTokenExpired(context)) {
    try {
      const refreshed = await tryRefreshContext(session, context);
      if (!refreshed) {
        return {
          kind: 'context_invalid',
          title: CONTEXT_EXPIRED_TITLE,
          body: CONTEXT_EXPIRED_BODY,
        };
      }
    } catch (err) {
      if (err instanceof ApiError && isAuthTokenError(err)) {
        return { kind: 'auth', code: err.code };
      }
      return {
        kind: 'context_invalid',
        title: CONTEXT_EXPIRED_TITLE,
        body: CONTEXT_EXPIRED_BODY,
      };
    }
  }

  try {
    const result = await api.listEvents(session);
    return { kind: 'ready', events: Array.isArray(result.events) ? result.events : [] };
  } catch (err) {
    if (!(err instanceof ApiError)) {
      return { kind: 'error', title: SERVER_ERROR_TITLE, message: '載入失敗' };
    }

    if (isAuthTokenError(err)) {
      return { kind: 'auth', code: err.code };
    }

    if (err.code === 'context_expired') {
      const refreshed = await tryRefreshContext(session, session.contextToken);
      if (refreshed) {
        try {
          const again = await api.listEvents(session);
          return { kind: 'ready', events: Array.isArray(again.events) ? again.events : [] };
        } catch (retryErr) {
          if (retryErr instanceof ApiError && isAuthTokenError(retryErr)) {
            return { kind: 'auth', code: retryErr.code };
          }
        }
      }
      return {
        kind: 'context_invalid',
        title: CONTEXT_EXPIRED_TITLE,
        body: CONTEXT_EXPIRED_BODY,
      };
    }

    if (err.code === 'context_missing') {
      return { kind: 'context_missing' };
    }

    if (err.code.startsWith('context_')) {
      return {
        kind: 'context_invalid',
        title: CONTEXT_MISSING_TITLE,
        body: CONTEXT_MISSING_BODY,
      };
    }

    if (err.status >= 500) {
      return {
        kind: 'server',
        message: `伺服器發生錯誤（${err.code}）。請稍後再試。`,
      };
    }

    return { kind: 'error', title: SERVER_ERROR_TITLE, message: err.message || '載入失敗' };
  }
}
