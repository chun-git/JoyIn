export interface LiffSession {
  idToken: string;
  lineUserId: string;
  displayName: string;
  /** Signed LIFF context token from /list Flex URL (?context=). Never a raw groupId. */
  contextToken: string;
  inClient: boolean;
  /** Safe diagnostics — never includes the context token value. */
  contextDiag?: {
    hasContextToken: boolean;
    contextTokenLength: number;
    loadedAt: string;
  };
}

const CONTEXT_STORAGE_KEY = 'joyin_liff_context';

function envFlag(value: string | undefined): boolean {
  return value === 'true';
}

function buildContextDiag(contextToken: string): LiffSession['contextDiag'] {
  return {
    hasContextToken: Boolean(contextToken),
    contextTokenLength: contextToken.length,
    loadedAt: new Date().toISOString(),
  };
}

/**
 * Read context after liff.init() only. Do not mutate LIFF query params before init.
 * Prefer URL ?context=, then sessionStorage (survives login redirect).
 */
function readContextTokenFromPage(): string {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = (params.get('context') || '').trim();
  if (fromUrl) {
    try {
      sessionStorage.setItem(CONTEXT_STORAGE_KEY, fromUrl);
    } catch {
      // ignore quota / private mode
    }
    return fromUrl;
  }
  try {
    return (sessionStorage.getItem(CONTEXT_STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

async function mintDevContextToken(idToken: string): Promise<string> {
  const groupId = import.meta.env.VITE_DEV_GROUP_ID || 'G-dev';
  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || ''}/api/dev/context`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ groupId }),
  });
  if (!response.ok) {
    return '';
  }
  const data = (await response.json()) as { context?: string };
  const token = (data.context || '').trim();
  if (token) {
    try {
      sessionStorage.setItem(CONTEXT_STORAGE_KEY, token);
    } catch {
      // ignore
    }
  }
  return token;
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
    const idToken = `test:${import.meta.env.VITE_DEV_USER_ID || 'U-dev'}:${encodeURIComponent(import.meta.env.VITE_DEV_DISPLAY_NAME || '開發者')}`;
    let contextToken = readContextTokenFromPage();
    if (!contextToken) {
      contextToken = await mintDevContextToken(idToken);
    }
    return {
      idToken,
      lineUserId: import.meta.env.VITE_DEV_USER_ID || 'U-dev',
      displayName: import.meta.env.VITE_DEV_DISPLAY_NAME || '開發者',
      contextToken,
      inClient: false,
      contextDiag: buildContextDiag(contextToken),
    };
  }

  const liffId = await resolveLiffId();
  if (!liffId) {
    throw new Error('尚未設定 LIFF ID，請設定 VITE_LIFF_ID 或 Worker 的 LIFF_ID');
  }

  const liff = (await import('@line/liff')).default;
  await liff.init({ liffId });

  // Only read ?context= after init — never rewrite liff query params beforehand.
  const contextTokenEarly = readContextTokenFromPage();

  if (!liff.isLoggedIn()) {
    liff.login();
    throw new Error('REDIRECTING');
  }
  const profile = await liff.getProfile();
  const idToken = liff.getIDToken();
  if (!idToken) {
    throw new Error('缺少 LIFF ID Token，請確認 LIFF 設定已開啟 openid');
  }

  const contextToken = contextTokenEarly || readContextTokenFromPage();
  const contextDiag = buildContextDiag(contextToken);
  // Safe diagnostics only — never log tokens or Authorization.
  console.info('[JoyIn diag]', {
    hasContextToken: contextDiag?.hasContextToken,
    contextTokenLength: contextDiag?.contextTokenLength,
    loadedAt: contextDiag?.loadedAt,
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
