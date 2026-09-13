import {
  AUTH_EXPIRED_BODY,
  AUTH_EXTERNAL_BROWSER_MESSAGE,
} from './auth-recovery-keys';
import { buildContextDiag, getJoyInContextToken, preserveJoyInContextBeforeInit, type JoyInContextSource } from './liff-context';
import { describeIdTokenSafe, requireLiffIdToken } from './auth-token';
import { nowUnixSeconds, readIdTokenExpiry, type DecodedIdTokenClaims } from './id-token-expiry';
import {
  cleanOauthParamsFromUrl,
  consumePendingRoute,
  preservePendingRoute,
} from './liff-deep-link';
import {
  detectOs,
  logSafeDiag,
  type JoyInFlowPhase,
  type SafeLiffDiag,
} from './liff-diag';

export type { JoyInContextSource, JoyInFlowPhase, SafeLiffDiag };
export { CONTEXT_MISSING_MESSAGE, CONTEXT_INVALID_MESSAGE, buildLiffLoginRedirectUri } from './liff-context';
export { detectOs, logSafeDiag } from './liff-diag';
export { AUTH_EXPIRED_BODY, AUTH_EXPIRED_TITLE, AUTH_EXTERNAL_BROWSER_MESSAGE } from './auth-recovery-keys';

export interface LiffSession {
  lineUserId: string;
  displayName: string;
  /** Signed LIFF context token from /list Flex URL. Never a raw groupId. */
  contextToken: string;
  inClient: boolean;
  /**
   * Always read the current ID Token from LIFF (or test stub).
   * Never cache the raw string in React state for API reuse.
   */
  getIdToken: () => string | null;
  /** Optional decoded claims from LIFF SDK (exp/iat). */
  getDecodedIdToken?: () => DecodedIdTokenClaims | null;
  /** Safe diagnostics — never includes the context token value. */
  contextDiag?: {
    hasContextToken: boolean;
    contextTokenLength: number;
    contextSource: JoyInContextSource;
    formatOk?: boolean;
    loadedAt: string;
  };
}

export const LIFF_INIT_TIMEOUT_MS = 10_000;

/**
 * sessionStorage: withLoginOnExternalBrowser already had one chance this session.
 * Prevents infinite external-browser redirect loops when login is cancelled.
 */
export const JOYIN_LOGIN_ATTEMPTED_KEY = 'joyin_liff_login_attempted';

export type LiffBootStatus = 'ready' | 'redirecting' | 'failed';
export class LiffBootError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly phase: JoyInFlowPhase,
    public readonly canRetryLogin = false,
    public readonly canCloseWindow = false,
  ) {
    super(message);
    this.name = 'LiffBootError';
  }
}

export interface LiffBootResult {
  status: LiffBootStatus;
  phase: JoyInFlowPhase;
  session?: LiffSession;
  error?: LiffBootError;
  /** True when UI may offer init retry (not for expired in-client tokens). */
  canRetryLogin?: boolean;
  /** True when UI should offer「關閉頁面」(LIFF Browser). */
  canCloseWindow?: boolean;
  /** Safe in-app route restored after LIFF/OAuth (e.g. /events/{id}). */
  pendingRoute?: string;
}

export type PhaseListener = (phase: JoyInFlowPhase, detail?: Partial<SafeLiffDiag>) => void;

const DEFAULT_ENDPOINT = 'https://joyin-web.pages.dev';

type LiffLike = {
  init: (config: { liffId: string; withLoginOnExternalBrowser?: boolean }) => Promise<void>;
  isLoggedIn: () => boolean;
  isInClient: () => boolean;
  login: (config?: { redirectUri?: string }) => void;
  logout?: () => void;
  closeWindow?: () => void;
  getIDToken: () => string | null;
  getDecodedIDToken?: () => DecodedIdTokenClaims | null;
  getProfile: () => Promise<{ userId: string; displayName: string }>;
  getOS?: () => string;
  getVersion?: () => string;
};

export type { LiffLike };

export type LiffModule = { default: LiffLike };

export interface InitSessionDeps {
  importLiff?: () => Promise<LiffModule>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  storage?: Storage;
  locationSearch?: string;
  historyReplaceState?: (data: unknown, unused: string, url?: string | null) => void;
  endpointOrigin?: string;
  onPhase?: PhaseListener;
  /** Clear one-shot external auto-login flag and retry init (no manual liff.login). */
  forceLogin?: boolean;
  initTimeoutMs?: number;
  /** Test-only: inject already-loaded liff */
  liff?: LiffLike;
  liffId?: string;
  /** @deprecated Production ignores this; use VITE_DEV_AUTH=true for local dev boot. */
  allowDev?: boolean;
}

function getSessionStorage(storage?: Storage): Storage | undefined {
  if (storage) return storage;
  if (typeof window !== 'undefined') return window.sessionStorage;
  return undefined;
}

function setPhase(phase: JoyInFlowPhase, detail?: Partial<SafeLiffDiag>) {
  activeOnPhase?.(phase, detail);
}

function safeGetItem(storage: Storage | undefined, key: string): string {
  if (!storage) return '';
  try {
    return (storage.getItem(key) || '').trim();
  } catch {
    return '';
  }
}

function safeSetItem(storage: Storage | undefined, key: string, value: string): void {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // ignore
  }
}

function safeRemoveItem(storage: Storage | undefined, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // ignore
  }
}

/**
 * Race a promise against a timeout. Does not cancel the underlying work.
 * Used so hanging liff.init() cannot leave the UI on forever-loading.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  timeoutCode = 'init_timeout',
  timeoutMessage = 'LIFF 初始化逾時，請重新整理或稍後再試',
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new LiffBootError(timeoutCode, timeoutMessage, 'failed'));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function resolveLiffConfig(
  fetchImpl: typeof fetch,
): Promise<{ liffId: string; endpointUrl: string }> {
  let liffId =
    import.meta.env.VITE_LIFF_ID && import.meta.env.VITE_LIFF_ID !== 'your-liff-id'
      ? import.meta.env.VITE_LIFF_ID
      : '';
  let endpointUrl = DEFAULT_ENDPOINT;

  try {
    const response = await fetchImpl(`${import.meta.env.VITE_API_BASE_URL || ''}/api/config`);
    if (response.ok) {
      const data = (await response.json()) as { liffId?: string; endpointUrl?: string };
      if (!liffId && data.liffId) liffId = data.liffId;
      if (data.endpointUrl) endpointUrl = data.endpointUrl.replace(/\/$/, '') || DEFAULT_ENDPOINT;
    }
  } catch {
    // ignore and fall through
  }

  return { liffId, endpointUrl };
}

/** Ensure redirectUri stays under the LIFF Endpoint origin (Pages). */
export function assertEndpointRedirectUri(redirectUri: string, endpointUrl: string): string {
  const endpoint = new URL(endpointUrl.endsWith('/') ? endpointUrl : `${endpointUrl}/`);
  const redirect = new URL(redirectUri);
  if (redirect.origin !== endpoint.origin) {
    throw new LiffBootError(
      'redirect_uri_invalid',
      '登入導向網址必須為 JoyIn Endpoint',
      'failed',
    );
  }
  return `${endpoint.origin}/`;
}

// ——— Module singletons (survive StrictMode remounts) ———

let sessionBootPromise: Promise<LiffBootResult> | null = null;
/** Underlying liff.init() promise — shared while in-flight or after success. */
let liffInitPromise: Promise<void> | null = null;
let liffInitSucceeded = false;
let cachedLiff: LiffLike | null = null;
/**
 * Generation for the active init attempt. Bumped on timeout / manual retry so a
 * late-resolving init cannot mark success or drive UI after we already failed.
 */
let liffInitGeneration = 0;
/** Boot attempt id — stale runBoot results must not update phase listeners. */
let bootAttemptId = 0;
/** Latest UI phase listener (StrictMode remount may replace it). */
let activeOnPhase: PhaseListener | undefined;

/** Test helper: reset module singletons between tests. */
export function resetLiffBootStateForTests(): void {
  sessionBootPromise = null;
  liffInitPromise = null;
  liffInitSucceeded = false;
  cachedLiff = null;
  liffInitGeneration = 0;
  bootAttemptId = 0;
  activeOnPhase = undefined;
}

/**
 * Clear failed/in-flight init cache so「重試」can call liff.init() again.
 * Does not clear a successful init, and never touches group context storage.
 */
export function clearLiffInitFailureCache(): void {
  sessionBootPromise = null;
  if (!liffInitSucceeded) {
    liffInitGeneration += 1;
    liffInitPromise = null;
    cachedLiff = null;
  }
}

/**
 * Site-wide singleton for liff.init().
 * React StrictMode / remounts reuse the same promise — never double-init while healthy.
 * On reject or timeout the cached promise is cleared so retry can re-init.
 */
export function initLiffSingleton(
  liff: LiffLike,
  liffId: string,
  options?: {
    timeoutMs?: number;
    onPhase?: PhaseListener;
    os?: string;
    /** Default true; set false after one external auto-login attempt. */
    withLoginOnExternalBrowser?: boolean;
  },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? LIFF_INIT_TIMEOUT_MS;
  const os = options?.os ?? detectOs();
  const withLoginOnExternalBrowser = options?.withLoginOnExternalBrowser ?? true;

  if (liffInitSucceeded && cachedLiff === liff) {
    return Promise.resolve();
  }

  if (!liffInitPromise) {
    if (options?.onPhase) activeOnPhase = options.onPhase;
    const generation = ++liffInitGeneration;
    logSafeDiag({
      event: 'init_start',
      phase: 'initializing_liff',
      os,
      liffSdkVersion: typeof liff.getVersion === 'function' ? liff.getVersion() : undefined,
      at: new Date().toISOString(),
    });
    setPhase('initializing_liff');

    liffInitPromise = liff
      .init({ liffId, withLoginOnExternalBrowser })
      .then(() => {
        // Late resolve after timeout/retry must not overwrite failed state.
        if (generation !== liffInitGeneration) {
          return;
        }
        liffInitSucceeded = true;
        cachedLiff = liff;
        logSafeDiag({
          event: 'init_success',
          phase: 'initializing_liff',
          isInClient: safeIsInClient(liff),
          isLoggedIn: safeIsLoggedIn(liff),
          os,
          liffSdkVersion: typeof liff.getVersion === 'function' ? liff.getVersion() : undefined,
          at: new Date().toISOString(),
        });
      })
      .catch((err: unknown) => {
        if (generation === liffInitGeneration) {
          liffInitPromise = null;
          liffInitSucceeded = false;
          cachedLiff = null;
        }
        const message = err instanceof Error ? err.message : 'LIFF init failed';
        logSafeDiag({
          event: 'init_error',
          phase: 'failed',
          os,
          code: 'init_error',
          message,
          at: new Date().toISOString(),
        });
        throw new LiffBootError('init_error', `LIFF 初始化失敗：${message}`, 'failed', true);
      });
  }

  const trackedGeneration = liffInitGeneration;
  return withTimeout(liffInitPromise, timeoutMs).catch((err: unknown) => {
    if (err instanceof LiffBootError && err.code === 'init_timeout') {
      // Invalidate this attempt and drop the cached promise so retry can re-init.
      if (trackedGeneration === liffInitGeneration) {
        liffInitGeneration += 1;
        liffInitPromise = null;
        liffInitSucceeded = false;
        cachedLiff = null;
      }
      logSafeDiag({
        event: 'init_timeout',
        phase: 'failed',
        os,
        code: 'init_timeout',
        message: err.message,
        at: new Date().toISOString(),
      });
    } else if (trackedGeneration === liffInitGeneration && !liffInitSucceeded) {
      liffInitPromise = null;
    }
    throw err;
  });
}

function safeIsInClient(liff: LiffLike): boolean {
  try {
    return Boolean(liff.isInClient());
  } catch {
    return false;
  }
}

function safeIsLoggedIn(liff: LiffLike): boolean {
  try {
    return Boolean(liff.isLoggedIn());
  } catch {
    return false;
  }
}

function safeGetDecodedIdToken(liff: LiffLike): DecodedIdTokenClaims | null {
  try {
    if (typeof liff.getDecodedIDToken !== 'function') return null;
    return liff.getDecodedIDToken() ?? null;
  } catch {
    return null;
  }
}

/**
 * Boot LIFF session. Always settles (ready | redirecting | failed) so UI never sticks on loading.
 * Does not store ID Token in localStorage or sessionStorage.
 * Never calls liff.logout(); never calls liff.login() (external login via withLoginOnExternalBrowser only).
 */
export function initSession(deps: InitSessionDeps = {}): Promise<LiffBootResult> {
  if (deps.onPhase) {
    activeOnPhase = deps.onPhase;
  }
  if (deps.forceLogin) {
    sessionBootPromise = null;
  }
  if (!sessionBootPromise) {
    const attempt = ++bootAttemptId;
    sessionBootPromise = runBoot(deps, attempt).then((result) => {
      if (result.status === 'failed') {
        sessionBootPromise = null;
      }
      return result;
    });
  }
  return sessionBootPromise;
}

/**
 * Soft retry: clear init failure cache. Never clears a valid JoyIn group context.
 * Does not call liff.login().
 */
export function retryInitSession(deps: InitSessionDeps = {}): Promise<LiffBootResult> {
  clearLiffInitFailureCache();
  return initSession(deps);
}

/** Return the LIFF instance from a successful init. */
export function getCachedLiff(): LiffLike | null {
  return cachedLiff;
}

async function runBoot(deps: InitSessionDeps, attempt: number): Promise<LiffBootResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const storage = getSessionStorage(deps.storage);
  const os = detectOs();
  const timeoutMs = deps.initTimeoutMs ?? LIFF_INIT_TIMEOUT_MS;
  const isCurrent = () => attempt === bootAttemptId;

  const fail = (error: LiffBootError): LiffBootResult => {
    if (isCurrent()) {
      setPhase(error.phase === 'login_required' ? 'login_required' : 'failed', {
        code: error.code,
        message: error.message,
      });
      logSafeDiag({
        event: 'boot_failed',
        phase: 'failed',
        os,
        code: error.code,
        message: error.message,
        at: new Date().toISOString(),
      });
    }
    return {
      status: 'failed',
      phase: error.phase === 'login_required' ? 'login_required' : 'failed',
      error,
      canRetryLogin: error.canRetryLogin,
      canCloseWindow: error.canCloseWindow,
    };
  };

  try {
    // Static compare so production builds tree-shake the entire dev boot module.
    // Do not route through a helper — Vite must see `=== 'true'` literally.
    if (import.meta.env.VITE_DEV_AUTH === 'true') {
      if (isCurrent()) setPhase('preserving_context');
      const { runDevBoot } = await import('./liff-dev');
      const devResult = await runDevBoot(deps);
      if (isCurrent()) setPhase('ready');
      return devResult;
    }

    // ——— 1. Preserve shared group context + deep-link route before init/redirect ———
    if (isCurrent()) setPhase('preserving_context');
    preserveJoyInContextBeforeInit({
      search: deps.locationSearch,
      storage,
      nowMs: deps.now?.() ?? Date.now(),
    });
    preservePendingRoute(
      storage,
      typeof window !== 'undefined' ? window.location.pathname : undefined,
      deps.locationSearch ?? (typeof window !== 'undefined' ? window.location.search : undefined),
    );
    const contextPreview = getJoyInContextToken({
      search: deps.locationSearch,
      storage,
      clearStorageOnRestore: false,
      nowMs: deps.now?.() ?? Date.now(),
    });

    // ——— 2. Resolve LIFF id ———
    let liffId = deps.liffId || '';
    if (!liffId) {
      const config = await resolveLiffConfig(fetchImpl);
      liffId = config.liffId;
    }
    if (!liffId) {
      return fail(
        new LiffBootError(
          'liff_id_missing',
          '尚未設定 LIFF ID，請設定 VITE_LIFF_ID 或 Worker 的 LIFF_ID',
          'failed',
        ),
      );
    }

    // ——— 3. Singleton init (external login only via withLoginOnExternalBrowser, at most once) ———
    if (isCurrent()) setPhase('initializing_liff');
    const alreadyAttemptedExternal = Boolean(safeGetItem(storage, JOYIN_LOGIN_ATTEMPTED_KEY));
    const allowExternalAutoLogin = deps.forceLogin || !alreadyAttemptedExternal;
    if (allowExternalAutoLogin) {
      // Mark before init so a cancelled OAuth return does not redirect forever.
      safeSetItem(storage, JOYIN_LOGIN_ATTEMPTED_KEY, '1');
    }

    let liff: LiffLike;
    try {
      if (deps.liff) {
        liff = deps.liff;
      } else {
        const mod = deps.importLiff
          ? await deps.importLiff()
          : ((await import('@line/liff')) as unknown as LiffModule);
        liff = mod.default;
      }
      if (!isCurrent()) {
        return fail(new LiffBootError('boot_cancelled', '啟動已取消', 'failed'));
      }
      await initLiffSingleton(liff, liffId, {
        timeoutMs,
        onPhase: activeOnPhase,
        os,
        withLoginOnExternalBrowser: allowExternalAutoLogin,
      });
    } catch (err) {
      if (!isCurrent()) {
        return fail(new LiffBootError('boot_cancelled', '啟動已取消', 'failed'));
      }
      if (err instanceof LiffBootError) return fail(err);
      const message = err instanceof Error ? err.message : 'LIFF 初始化失敗';
      return fail(new LiffBootError('init_error', message, 'failed', true));
    }

    if (!isCurrent()) {
      return fail(new LiffBootError('boot_cancelled', '啟動已取消', 'failed'));
    }

    const inClient = safeIsInClient(liff);
    const loggedIn = safeIsLoggedIn(liff);

    // ——— 4. Not logged in: never call logout/login; stop cleanly ———
    if (!loggedIn) {
      setPhase('login_required');
      if (inClient) {
        return fail(
          new LiffBootError(
            'auth_token_expired',
            AUTH_EXPIRED_BODY,
            'login_required',
            false,
            true,
          ),
        );
      }
      return fail(
        new LiffBootError(
          'external_browser_required',
          AUTH_EXTERNAL_BROWSER_MESSAGE,
          'login_required',
          false,
          false,
        ),
      );
    }

    // ——— 5. Profile + live ID Token accessors (never store raw token on session) ———
    setPhase('retrieving_id_token');
    let profile: { userId: string; displayName: string };
    try {
      profile = await liff.getProfile();
    } catch (err) {
      const message = err instanceof Error ? err.message : '無法取得個人資料';
      return fail(
        new LiffBootError(
          'profile_error',
          `無法取得 LINE 個人資料：${message}。請確認 LIFF Scope 包含 profile。`,
          'failed',
          true,
        ),
      );
    }

    const rawToken = liff.getIDToken();
    const tokenDiag = describeIdTokenSafe(typeof rawToken === 'string' ? rawToken : '');
    const decoded = safeGetDecodedIdToken(liff);
    const nowSec = nowUnixSeconds(deps.now?.() ?? Date.now());
    const expiry = readIdTokenExpiry(decoded, nowSec);

    logSafeDiag({
      event: expiry.expired ? 'id_token_expired' : 'id_token_ok',
      phase: 'retrieving_id_token',
      isInClient: inClient,
      isLoggedIn: true,
      os,
      liffSdkVersion: typeof liff.getVersion === 'function' ? liff.getVersion() : undefined,
      jwtPartCount: tokenDiag.partCount,
      idTokenFormatOk: tokenDiag.formatOk,
      idTokenPresent: tokenDiag.present,
      iat: expiry.iat,
      exp: expiry.exp,
      now: expiry.now,
      secondsUntilExpiry: expiry.secondsUntilExpiry,
      hasContext: Boolean(contextPreview.token),
      contextLength: contextPreview.token.length,
      at: new Date().toISOString(),
    });

    if (expiry.expired) {
      return fail(
        new LiffBootError(
          'auth_token_expired',
          AUTH_EXPIRED_BODY,
          'failed',
          false,
          inClient,
        ),
      );
    }

    try {
      requireLiffIdToken(rawToken);
    } catch (err) {
      logSafeDiag({
        event: 'id_token_error',
        phase: 'failed',
        isInClient: inClient,
        isLoggedIn: true,
        os,
        jwtPartCount: tokenDiag.partCount,
        idTokenFormatOk: tokenDiag.formatOk,
        idTokenPresent: tokenDiag.present,
        code: 'auth_token_invalid',
        message: err instanceof Error ? err.message : 'ID Token invalid',
        at: new Date().toISOString(),
      });
      return fail(
        new LiffBootError(
          'auth_token_invalid',
          inClient ? AUTH_EXPIRED_BODY : AUTH_EXTERNAL_BROWSER_MESSAGE,
          'failed',
          false,
          inClient,
        ),
      );
    }

    const { token: contextToken, source } = getJoyInContextToken({
      search: deps.locationSearch,
      storage,
      clearStorageOnRestore: false,
      nowMs: deps.now?.() ?? Date.now(),
    });
    const contextDiag = buildContextDiag(contextToken, source);

    // Guard: never persist ID Token
    assertNoAuthInSessionStorage(storage);

    if (!isCurrent()) {
      return fail(new LiffBootError('boot_cancelled', '啟動已取消', 'failed'));
    }

    const pendingRoute = consumePendingRoute(storage);
    cleanOauthParamsFromUrl(deps.historyReplaceState);

    const session: LiffSession = {
      lineUserId: profile.userId,
      displayName: profile.displayName,
      contextToken,
      inClient,
      contextDiag,
      getIdToken: () => {
        try {
          return liff.getIDToken();
        } catch {
          return null;
        }
      },
      getDecodedIdToken: () => safeGetDecodedIdToken(liff),
    };

    setPhase('ready');
    logSafeDiag({
      event: 'boot_ready',
      phase: 'ready',
      isInClient: inClient,
      isLoggedIn: true,
      os,
      hasContext: contextDiag.hasContextToken,
      contextLength: contextDiag.contextTokenLength,
      jwtPartCount: tokenDiag.partCount,
      idTokenFormatOk: tokenDiag.formatOk,
      idTokenPresent: tokenDiag.present,
      iat: expiry.iat,
      exp: expiry.exp,
      now: expiry.now,
      secondsUntilExpiry: expiry.secondsUntilExpiry,
      at: new Date().toISOString(),
    });

    return { status: 'ready', phase: 'ready', session, pendingRoute: pendingRoute || undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : '無法開啟 JoyIn';
    return fail(new LiffBootError('boot_error', message, 'failed', true));
  }
}

/** Dev/test guard: sessionStorage must not hold Authorization or ID Token material. */
export function assertNoAuthInSessionStorage(storage?: Storage): void {
  const store = getSessionStorage(storage);
  if (!store) return;
  const forbiddenKeys = ['Authorization', 'idToken', 'id_token', 'access_token', 'accessToken'];
  for (const key of forbiddenKeys) {
    if (safeGetItem(store, key)) {
      safeRemoveItem(store, key);
      throw new LiffBootError(
        'auth_storage_forbidden',
        '禁止將登入 Token 寫入 sessionStorage',
        'failed',
      );
    }
  }
}

/**
 * Allow one more withLoginOnExternalBrowser attempt (clears one-shot flag).
 * Never calls liff.login() / liff.logout(). Does not clear JoyIn group context.
 */
export function startManualLineLogin(deps: InitSessionDeps = {}): Promise<LiffBootResult> {
  const storage = getSessionStorage(deps.storage);
  clearLiffInitFailureCache();
  safeRemoveItem(storage, JOYIN_LOGIN_ATTEMPTED_KEY);
  return initSession({ ...deps, forceLogin: true });
}
