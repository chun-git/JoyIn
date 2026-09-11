export interface LiffSession {
  idToken: string;
  lineUserId: string;
  displayName: string;
  groupId: string;
  inClient: boolean;
}

function envFlag(value: string | undefined): boolean {
  return value === 'true';
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
    return {
      idToken: `test:${import.meta.env.VITE_DEV_USER_ID || 'U-dev'}:${encodeURIComponent(import.meta.env.VITE_DEV_DISPLAY_NAME || '開發者')}`,
      lineUserId: import.meta.env.VITE_DEV_USER_ID || 'U-dev',
      displayName: import.meta.env.VITE_DEV_DISPLAY_NAME || '開發者',
      groupId: import.meta.env.VITE_DEV_GROUP_ID || 'G-dev',
      inClient: false,
    };
  }

  const liffId = await resolveLiffId();
  if (!liffId) {
    throw new Error('尚未設定 LIFF ID，請設定 VITE_LIFF_ID 或 Worker 的 LIFF_ID');
  }

  const liff = (await import('@line/liff')).default;
  await liff.init({ liffId });
  if (!liff.isLoggedIn()) {
    liff.login();
    throw new Error('REDIRECTING');
  }
  const profile = await liff.getProfile();
  const context = liff.getContext();
  const idToken = liff.getIDToken();
  if (!idToken) {
    throw new Error('缺少 LIFF ID Token，請確認 LIFF 設定已開啟 openid');
  }
  return {
    idToken,
    lineUserId: profile.userId,
    displayName: profile.displayName,
    groupId: context?.groupId || '',
    inClient: liff.isInClient(),
  };
}

export async function closeLiff(): Promise<void> {
  try {
    const liff = (await import('@line/liff')).default;
    if (liff.isInClient()) {
      liff.closeWindow();
      return;
    }
  } catch {
    // ignore
  }
  window.close();
}
