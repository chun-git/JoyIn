import {
  buildContextDiag,
  getJoyInContextToken,
  preserveJoyInContextBeforeInit,
} from './liff-context';
import { buildAuthorizationHeader } from './auth-token';
import type { InitSessionDeps, LiffBootResult, LiffSession } from './liff';

/**
 * Development-only boot path. Imported only when VITE_DEV_AUTH === 'true'
 * so production bundles can tree-shake this module away.
 */
export async function runDevBoot(deps: InitSessionDeps): Promise<LiffBootResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const storage =
    deps.storage ?? (typeof window !== 'undefined' ? window.sessionStorage : undefined);

  const idToken = `test:${import.meta.env.VITE_DEV_USER_ID || 'U-dev'}:${encodeURIComponent(import.meta.env.VITE_DEV_DISPLAY_NAME || '開發者')}`;
  preserveJoyInContextBeforeInit({
    search: deps.locationSearch,
    storage,
  });
  let { token: contextToken, source } = getJoyInContextToken({
    search: deps.locationSearch,
    storage,
    clearStorageOnRestore: false,
  });
  if (!contextToken) {
    contextToken = await mintDevContextToken(idToken, fetchImpl);
    source = contextToken ? 'sessionStorage' : '';
  }
  const session: LiffSession = {
    idToken,
    lineUserId: import.meta.env.VITE_DEV_USER_ID || 'U-dev',
    displayName: import.meta.env.VITE_DEV_DISPLAY_NAME || '開發者',
    contextToken,
    inClient: false,
    contextDiag: buildContextDiag(contextToken, source),
  };
  return { status: 'ready', phase: 'ready', session };
}

async function mintDevContextToken(idToken: string, fetchImpl: typeof fetch): Promise<string> {
  const groupId = import.meta.env.VITE_DEV_GROUP_ID || 'G-dev';
  const response = await fetchImpl(`${import.meta.env.VITE_API_BASE_URL || ''}/api/dev/context`, {
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
