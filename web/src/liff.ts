import {
  buildContextDiag,
  getJoyInContextToken,
  preserveJoyInContextBeforeInit,
  type JoyInContextSource,
} from './liff-context';
import { buildAuthorizationHeader, describeIdTokenSafe, requireLiffIdToken } from './auth-token';

export type { JoyInContextSource };
export { CONTEXT_MISSING_MESSAGE, CONTEXT_INVALID_MESSAGE } from './liff-context';

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

async function resolveLiffId(): Promise<string> {
  if (import.meta.env.VITE_LIFF_ID && import.meta.env.VITE_LIFF_ID !== 'your-liff-id') {
    return import.meta.env.VITE_LIFF_ID;
  }
  try {
    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || ''}/api/config`);
    if (response.ok) {
      const data = (await response.json()) as { liffId?: string };
      if (data.liffId) return data.liffId;
    }
  } catch {
    // ignore and fall through to dev mode
  }
  return '';
}

export async function initSession(): Promise<LiffSession> {
  const allowDev = envFlag(import.meta.env.VITE_DEV_AUTH);

  if (allowDev) {
    // Dev-only synthetic token — never used when VITE_DEV_AUTH=false (production builds).
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

  const liffId = await resolveLiffId();
  if (!liffId) {
    throw new Error('尚未設定 LIFF ID，請設定 VITE_LIFF_ID 或 Worker 的 LIFF_ID');
  }

  // Capture context before init — LIFF may rewrite/clear query params during init.
  // Do not mutate location or liff.* query parameters.
  preserveJoyInContextBeforeInit();

  const liff = (await import('@line/liff')).default;
  await liff.init({ liffId });

  if (!liff.isLoggedIn()) {
    // Must not call APIs after login() — redirect first, then re-init on return.
    liff.login();
    throw new Error('REDIRECTING');
  }

  const profile = await liff.getProfile();
  // Must use ID Token (JWT), never Access Token.
  const idToken = requireLiffIdToken(liff.getIDToken());
  const idDiag = describeIdTokenSafe(idToken);

  const { token: contextToken, source } = getJoyInContextToken({ clearStorageOnRestore: true });
  const contextDiag = buildContextDiag(contextToken, source);
  // Safe diagnostics only — never log tokens or Authorization.
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
