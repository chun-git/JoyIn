import type { MiddlewareHandler } from 'hono';
import type { AppEnv, AuthUser } from '../env';
import { AppError, Errors } from '../lib/errors';
import {
  describeIdTokenSafe,
  extractBearerToken,
  isJwtIdTokenFormat,
} from '../lib/auth-token';
import {
  describeTokenSafe,
  LiffContextError,
  verifyLiffContext,
} from '../lib/liff-context';

interface LineVerifyResponse {
  iss?: string;
  sub?: string;
  name?: string;
  picture?: string;
  error?: string;
  error_description?: string;
}

/** User-facing copy when group context is missing */
export const GROUP_CONTEXT_REQUIRED_MESSAGE =
  '請回到 LINE 群組輸入 /list，並從活動卡片開啟 JoyIn';

/** User-facing copy when a context token is present but invalid */
export const GROUP_CONTEXT_INVALID_MESSAGE = '活動連結已失效，請重新輸入 /list';

function parseTestToken(token: string): AuthUser | null {
  if (token === 'dev-token') {
    return { lineUserId: 'U-dev', displayName: '開發者' };
  }
  if (token.startsWith('test:')) {
    const parts = token.split(':');
    if (parts.length >= 3) {
      const lineUserId = parts[1];
      const displayName = decodeURIComponent(parts.slice(2).join(':'));
      if (lineUserId && displayName) {
        return { lineUserId, displayName };
      }
    }
  }
  return null;
}

function lineVerifyErrorMessage(data: LineVerifyResponse | null): string {
  const raw = data?.error_description ?? data?.error;
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  if (typeof raw === 'number' || typeof raw === 'boolean') {
    return String(raw);
  }
  return 'LIFF 身分驗證失敗';
}

/** Classify LINE verify failures. Never return raw LINE text to end users. */
export function classifyLineVerifyFailure(data: LineVerifyResponse | null): {
  code: 'auth_token_expired' | 'auth_token_invalid';
  message: string;
  lineError: string;
} {
  const lineError = lineVerifyErrorMessage(data);
  const normalized = lineError.toLowerCase().replace(/\s+/g, ' ');
  if (
    normalized.includes('idtoken expired') ||
    normalized.includes('id token expired') ||
    /\btoken expired\b/.test(normalized)
  ) {
    return {
      code: 'auth_token_expired',
      message: 'LINE 登入已過期',
      lineError,
    };
  }
  return {
    code: 'auth_token_invalid',
    message: '無法驗證登入身分',
    lineError,
  };
}

export async function verifyLiffIdToken(
  idToken: string,
  channelId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AuthUser> {
  const clientId = (channelId || '').trim();
  if (!clientId) {
    console.error('[JoyIn auth]', {
      reason: 'auth_token_invalid',
      ...describeIdTokenSafe(idToken),
      hasChannelId: false,
      note: 'LINE_CHANNEL_ID_missing',
    });
    throw new AppError(401, 'auth_token_invalid', '登入驗證設定不完整');
  }

  let response: Response;
  try {
    const body = new URLSearchParams({
      id_token: idToken,
      client_id: clientId,
    });
    response = await fetchImpl('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch (err) {
    console.error('[JoyIn auth]', {
      reason: 'auth_token_invalid',
      ...describeIdTokenSafe(idToken),
      hasChannelId: true,
      note: 'line_verify_fetch_failed',
      errorName: err instanceof Error ? err.name : typeof err,
    });
    throw new AppError(401, 'auth_token_invalid', '無法連線至 LINE 驗證服務');
  }

  let data: LineVerifyResponse | null = null;
  try {
    data = (await response.json()) as LineVerifyResponse;
  } catch (err) {
    console.error('[JoyIn auth]', {
      reason: 'auth_token_invalid',
      ...describeIdTokenSafe(idToken),
      hasChannelId: true,
      note: 'line_verify_body_not_json',
      httpStatus: response.status,
      errorName: err instanceof Error ? err.name : typeof err,
    });
    throw new AppError(401, 'auth_token_invalid', 'LINE 身分驗證回應無效');
  }

  const sub = typeof data?.sub === 'string' ? data.sub.trim() : '';
  if (!response.ok || !sub) {
    const classified = classifyLineVerifyFailure(data);
    console.error('[JoyIn auth]', {
      reason: classified.code,
      ...describeIdTokenSafe(idToken),
      hasChannelId: true,
      httpStatus: response.status,
      lineError: classified.lineError.slice(0, 80),
    });
    throw new AppError(401, classified.code, classified.message);
  }

  const displayName =
    typeof data?.name === 'string' && data.name.trim() ? data.name.trim() : 'LINE 使用者';
  const pictureUrl = typeof data?.picture === 'string' ? data.picture : undefined;

  return {
    lineUserId: sub,
    displayName,
    pictureUrl,
  };
}

/**
 * Resolve groupId only from a verified X-JoyIn-Context token.
 * Never trusts X-Line-Group-Id or any client-supplied group identifier.
 * Never compares context to the current Authorization user — group tokens are shared.
 */
async function resolveVerifiedGroupId(c: {
  req: { header: (name: string) => string | undefined };
  env: AppEnv['Bindings'];
}): Promise<string> {
  const token = (c.req.header('X-JoyIn-Context') || '').trim();
  const tokenDiag = describeTokenSafe(token);
  if (!token) {
    console.info('[JoyIn context]', { reason: 'context_missing', ...tokenDiag });
    return '';
  }
  try {
    // Verify group context alone. Do not pass c.get('user') — no user binding check.
    const verified = await verifyLiffContext(c.env.LIFF_CONTEXT_SIGNING_SECRET, token);
    console.info('[JoyIn context]', {
      reason: 'ok',
      ...tokenDiag,
      hasExpiresAt: Boolean(verified.expiresAt),
      hasNonce: Boolean(verified.nonce),
      groupIdLength: verified.groupId.length,
    });
    return verified.groupId;
  } catch (err) {
    if (err instanceof LiffContextError) {
      console.error('[JoyIn context]', {
        reason: err.code,
        ...tokenDiag,
      });
      throw new AppError(401, err.code, GROUP_CONTEXT_INVALID_MESSAGE);
    }
    throw err;
  }
}

export const liffAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('Authorization') || '';
  const extracted = extractBearerToken(header);
  if (!extracted.ok) {
    console.error('[JoyIn auth]', {
      reason: extracted.code,
      hasAuthorizationHeader: Boolean(header.trim()),
      hasLiffId: Boolean(c.env.LIFF_ID),
    });
    throw new AppError(
      401,
      extracted.code,
      extracted.code === 'auth_token_missing' ? '請先透過 LIFF 登入' : '登入 Token 格式錯誤',
    );
  }

  const token = extracted.token;
  const idDiag = describeIdTokenSafe(token);
  console.info('[JoyIn auth]', {
    reason: 'received',
    hasAuthorizationHeader: true,
    ...idDiag,
    hasLiffId: Boolean(c.env.LIFF_ID),
  });

  const allowTest = c.env.ALLOW_TEST_AUTH === 'true';
  if (allowTest) {
    const testUser = parseTestToken(token);
    if (testUser) {
      c.set('user', testUser);
      c.set('groupId', await resolveVerifiedGroupId(c));
      await next();
      return;
    }
  }

  if (!isJwtIdTokenFormat(token)) {
    console.error('[JoyIn auth]', {
      reason: 'auth_token_malformed',
      ...idDiag,
      hasLiffId: Boolean(c.env.LIFF_ID),
      note: 'expected_three_part_jwt_id_token',
    });
    throw new AppError(401, 'auth_token_malformed', '登入 Token 格式錯誤（需要 LIFF ID Token）');
  }

  const user = await verifyLiffIdToken(token, c.env.LINE_CHANNEL_ID);
  c.set('user', user);
  c.set('groupId', await resolveVerifiedGroupId(c));
  await next();
};
