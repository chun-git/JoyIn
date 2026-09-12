/**
 * Auth failure helpers for expired LIFF ID Tokens.
 * Intentionally does NOT call liff.logout() or liff.login() — that caused
 * LIFF Browser redirect loops (expired → logout → login → init timeout → again).
 */

export {
  AUTH_EXPIRED_BODY,
  AUTH_EXPIRED_TITLE,
  AUTH_EXTERNAL_BROWSER_MESSAGE,
} from './auth-recovery-keys';

import type { LiffLike } from './liff';

export function closeLiffWindowIfInClient(liff: LiffLike | null | undefined): boolean {
  if (!liff) return false;
  try {
    if (!liff.isInClient()) return false;
    if (typeof liff.closeWindow === 'function') {
      liff.closeWindow();
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}
