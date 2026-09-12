import {
  JOYIN_CONTEXT_STORAGE_KEY,
  buildLiffLoginRedirectUri,
  isJoyInContextTokenFormat,
} from './liff-context';
import {
  AUTH_EXPIRED_USER_MESSAGE,
  AUTH_RECOVERY_FAILED_MESSAGE,
  JOYIN_AUTH_RECOVERY_ATTEMPTED_KEY,
} from './auth-recovery-keys';
import {
  assertEndpointRedirectUri,
  clearLiffInitFailureCache,
  JOYIN_LOGIN_ATTEMPTED_KEY,
  type LiffLike,
} from './liff';
import { logSafeDiag } from './liff-diag';

export {
  AUTH_EXPIRED_USER_MESSAGE,
  AUTH_RECOVERY_FAILED_MESSAGE,
  JOYIN_AUTH_RECOVERY_ATTEMPTED_KEY,
};

export type AuthRecoveryStatus = 'redirecting' | 'manual_required' | 'failed';

const DEFAULT_ENDPOINT = 'https://joyin-web.pages.dev';

function safeGet(storage: Storage | undefined, key: string): string {
  if (!storage) return '';
  try {
    return (storage.getItem(key) || '').trim();
  } catch {
    return '';
  }
}

function safeSet(storage: Storage | undefined, key: string, value: string): void {
  if (!storage || !value) return;
  try {
    storage.setItem(key, value);
  } catch {
    // ignore
  }
}

function safeRemove(storage: Storage | undefined, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // ignore
  }
}

export function hasAuthRecoveryAttempted(storage?: Storage): boolean {
  const store = storage ?? (typeof window !== 'undefined' ? window.sessionStorage : undefined);
  return Boolean(safeGet(store, JOYIN_AUTH_RECOVERY_ATTEMPTED_KEY));
}

export function clearAuthRecoveryState(storage?: Storage): void {
  const store = storage ?? (typeof window !== 'undefined' ? window.sessionStorage : undefined);
  safeRemove(store, JOYIN_AUTH_RECOVERY_ATTEMPTED_KEY);
  safeRemove(store, JOYIN_LOGIN_ATTEMPTED_KEY);
}

/**
 * Preserve group context only (never ID Token). New /list context already overwrites via callers.
 */
export function preserveContextForAuthRecovery(
  contextToken: string | undefined,
  storage?: Storage,
): void {
  const store = storage ?? (typeof window !== 'undefined' ? window.sessionStorage : undefined);
  const token = (contextToken || '').trim();
  if (token && isJoyInContextTokenFormat(token)) {
    safeSet(store, JOYIN_CONTEXT_STORAGE_KEY, token);
  }
}

export interface RecoverExpiredOptions {
  contextToken?: string;
  storage?: Storage;
  endpointUrl?: string;
  liff?: LiffLike | null;
  /** Manual「重新登入 LINE」— clears the one-shot recovery flag and tries again. */
  force?: boolean;
  historyReplaceState?: (data: unknown, unused: string, url?: string | null) => void;
}

/**
 * Auto-recover from auth_token_expired at most once per browser session.
 * Preserves group context; never stores ID Token.
 */
export async function recoverFromExpiredIdToken(
  options: RecoverExpiredOptions = {},
): Promise<AuthRecoveryStatus> {
  const storage =
    options.storage ?? (typeof window !== 'undefined' ? window.sessionStorage : undefined);
  const endpointUrl = (options.endpointUrl || DEFAULT_ENDPOINT).replace(/\/$/, '');

  preserveContextForAuthRecovery(options.contextToken, storage);

  if (!options.force && hasAuthRecoveryAttempted(storage)) {
    logSafeDiag({
      event: 'auth_recovery_blocked',
      phase: 'login_required',
      code: 'auth_token_expired',
      message: 'recovery already attempted',
      hasContext: Boolean(safeGet(storage, JOYIN_CONTEXT_STORAGE_KEY)),
      contextLength: safeGet(storage, JOYIN_CONTEXT_STORAGE_KEY).length,
      at: new Date().toISOString(),
    });
    return 'manual_required';
  }

  // One automatic attempt (or forced manual). Clear prior loginAttempted so boot can login again.
  clearAuthRecoveryState(storage);
  safeSet(storage, JOYIN_AUTH_RECOVERY_ATTEMPTED_KEY, '1');
  clearLiffInitFailureCache();

  const liff = options.liff;
  if (!liff) {
    logSafeDiag({
      event: 'auth_recovery_failed',
      phase: 'failed',
      code: 'auth_token_expired',
      message: 'liff instance missing',
      at: new Date().toISOString(),
    });
    return 'failed';
  }

  let redirectUri: string;
  try {
    redirectUri = assertEndpointRedirectUri(
      buildLiffLoginRedirectUri(`${endpointUrl}/`),
      endpointUrl,
    );
  } catch {
    return 'failed';
  }

  try {
    if (typeof liff.logout === 'function') {
      liff.logout();
    }
  } catch {
    // continue to login even if logout throws
  }

  try {
    const replace =
      options.historyReplaceState ??
      (typeof window !== 'undefined' ? window.history.replaceState.bind(window.history) : undefined);
    try {
      replace?.(null, '', '/');
    } catch {
      // ignore
    }
    logSafeDiag({
      event: 'auth_recovery_login',
      phase: 'redirecting_login',
      code: 'auth_token_expired',
      hasContext: Boolean(safeGet(storage, JOYIN_CONTEXT_STORAGE_KEY)),
      contextLength: safeGet(storage, JOYIN_CONTEXT_STORAGE_KEY).length,
      at: new Date().toISOString(),
    });
    liff.login({ redirectUri });
    return 'redirecting';
  } catch {
    return 'failed';
  }
}
