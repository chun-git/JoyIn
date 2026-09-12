/** Safe LIFF / boot diagnostics — never log secrets or full identifiers. */

export type JoyInFlowPhase =
  | 'idle'
  | 'preserving_context'
  | 'initializing_liff'
  | 'login_required'
  | 'redirecting_login'
  | 'retrieving_id_token'
  | 'loading_events'
  | 'ready'
  | 'failed';

export type LiffDiagEvent =
  | 'init_start'
  | 'init_success'
  | 'init_timeout'
  | 'init_error'
  | 'login_start'
  | 'login_skipped_already_attempted'
  | 'id_token_ok'
  | 'id_token_error'
  | 'boot_failed'
  | 'boot_ready';

export interface SafeLiffDiag {
  event: LiffDiagEvent | string;
  phase: JoyInFlowPhase;
  isInClient?: boolean;
  isLoggedIn?: boolean;
  os?: string;
  liffSdkVersion?: string;
  hasContext?: boolean;
  contextLength?: number;
  jwtPartCount?: number;
  idTokenFormatOk?: boolean;
  code?: string;
  message?: string;
  at: string;
}

export function detectOs(userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : ''): string {
  const ua = userAgent || '';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac OS X/i.test(ua)) return 'macos';
  if (/Linux/i.test(ua)) return 'linux';
  return 'unknown';
}

export function logSafeDiag(diag: SafeLiffDiag): void {
  // Never include ID Token, context token, Authorization, or full groupId.
  console.info('[JoyIn liff]', {
    event: diag.event,
    phase: diag.phase,
    isInClient: diag.isInClient,
    isLoggedIn: diag.isLoggedIn,
    os: diag.os,
    liffSdkVersion: diag.liffSdkVersion,
    hasContext: diag.hasContext,
    contextLength: diag.contextLength,
    jwtPartCount: diag.jwtPartCount,
    idTokenFormatOk: diag.idTokenFormatOk,
    code: diag.code,
    message: diag.message ? String(diag.message).slice(0, 120) : undefined,
    at: diag.at,
  });
}
