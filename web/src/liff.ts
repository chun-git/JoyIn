import {
  buildContextDiag,
  buildLiffLoginRedirectUri,
  getJoyInContextToken,
  preserveJoyInContextBeforeInit,
  type JoyInContextSource,
} from './liff-context';
import { buildAuthorizationHeader, describeIdTokenSafe, requireLiffIdToken } from './auth-token';

export type { JoyInContextSource };
export { CONTEXT_MISSING_MESSAGE, CONTEXT_INVALID_MESSAGE, buildLiffLoginRedirectUri } from './liff-context';

export interface LiffSession {
  idToken: string;
  lineUserId: string;
  displayName: string;
  /** Signed LIFF context token from /list Flex URL. Never a raw groupId. */
  contextToken: string;
  inClient: boolean;
  /** Safe diagnostics — never includes the context token value. */
  contextDiag?: {
    hasContextToken: boolean;
    contextTokenLength: number;
    contextSource: JoyInContextSource;
    formatOk?: boolean;
    loadedAt: string;
  };
}

const DEFAULT_ENDPOINT = 'https://joyin-web.pages.dev';

function envFlag(value: string | undefined): boolean {
  return value === 'true';
}

async function mintDevContextToken(idToken: string): Promise<string> {
  const groupId = import.meta.env.VITE_DEV_GROUP_ID || 'G-dev';
  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || ''}/api/dev/context`, {
    method: 'POST',
    headers: {
      Authorization: buildAuthorizationHeader(idToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ groupId }),
  });
  if (!response.ok) {
    return '';
  }
  const data = (await response.json()) as { context?: string };
  return (data.context || '').trim();
}

async function resolveLiffConfig(): Promise<{ liffId: string; endpointUrl: string }> {
  let liffId =
    import.meta.env.VITE_LIFF_ID && import.meta.env.VITE_LIFF_ID !== 'your-liff-id'
      ? import.meta.env.VITE_LIFF_ID
      : '';
  let endpointUrl = DEFAULT_ENDPOINT;

  try {
    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || ''}/api/config`);
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

/** Prevent React StrictMode double-mount from starting two login redirects. */
let sessionPromise: Promise<LiffSession> | null = null;

export function initSession(): Promise<LiffSession> {
  if (!sessionPromise) {
    sessionPromise = initSessionOnce().catch((err) => {
      sessionPromise = null;
      throw err;
    });
  }
  return sessionPromise;
}

async function initSessionOnce(): Promise<LiffSession> {
  const allowDev = envFlag(import.meta.env.VITE_DEV_AUTH);

  if (allowDev) {
    const idToken = `test:${import.meta.env.VITE_DEV_USER_ID || 'U-dev'}:${encodeURIComponent(import.meta.env.VITE_DEV_DISPLAY_NAME || '開發者')}`;
    preserveJoyInContextBeforeInit();
    let { token: contextToken, source } = getJoyInContextToken();
    if (!contextToken) {
      contextToken = await mintDevContextToken(idToken);
      source = contextToken ? 'sessionStorage' : '';
    }
    return {
      idToken,
      lineUserId: import.meta.env.VITE_DEV_USER_ID || 'U-dev',
      displayName: import.meta.env.VITE_DEV_DISPLAY_NAME || '開發者',
      contextToken,
      inClient: false,
      contextDiag: buildContextDiag(contextToken, source),
    };
  }

  const { liffId, endpointUrl } = await resolveLiffConfig();
  if (!liffId) {
    throw new Error('尚未設定 LIFF ID，請設定 VITE_LIFF_ID 或 Worker 的 LIFF_ID');
  }

  // Capture context before init — do not mutate LIFF query params until init resolves.
  preserveJoyInContextBeforeInit();

  const liff = (await import('@line/liff')).default;
  await liff.init({ liffId, withLoginOnExternalBrowser: true });

  if (!liff.isLoggedIn()) {
    // LIFF browser: consent is handled by LINE during open; calling login() here
    // is unsupported and often returns HTTP 400 for first-time users.
    if (liff.isInClient()) {
      throw new Error(
        '尚未完成 LINE 授權。請關閉後從群組新的活動卡片重新開啟，並在授權畫面點選「允許」。',
      );
    }

    // In-app / external browser (Endpoint URL Flex links land here).
    // Context is already in sessionStorage; redirectUri must match Endpoint URL.
    const redirectUri = buildLiffLoginRedirectUri(`${endpointUrl}/`);
    try {
      window.history.replaceState(null, '', '/');
    } catch {
      // ignore
    }
    liff.login({ redirectUri });
    throw new Error('REDIRECTING');
  }

  let profile;
  try {
    profile = await liff.getProfile();
  } catch {
    throw new Error('無法取得 LINE 個人資料，請確認 LIFF Scope 包含 profile，並重新授權。');
  }

  let idToken: string;
  try {
    idToken = requireLiffIdToken(liff.getIDToken());
  } catch {
    throw new Error(
      '缺少 LIFF ID Token。請到 LINE Developers → LIFF → Scope 勾選 openid（與 profile），儲存後請新成員重新從卡片開啟。',
    );
  }
  const idDiag = describeIdTokenSafe(idToken);

  const { token: contextToken, source } = getJoyInContextToken({ clearStorageOnRestore: true });
  const contextDiag = buildContextDiag(contextToken, source);
  console.info('[JoyIn diag]', {
    idTokenPresent: idDiag.present,
    idTokenLength: idDiag.tokenLength,
    idTokenParts: idDiag.partCount,
    idTokenFormatOk: idDiag.formatOk,
    hasContextToken: contextDiag.hasContextToken,
    contextTokenLength: contextDiag.contextTokenLength,
    contextSource: contextDiag.contextSource,
    formatOk: contextDiag.formatOk,
    loadedAt: contextDiag.loadedAt,
    inClient: liff.isInClient(),
  });

  return {
    idToken,
    lineUserId: profile.userId,
    displayName: profile.displayName,
    contextToken,
    inClient: liff.isInClient(),
    contextDiag,
  };
}
