import type { MiddlewareHandler } from 'hono';
import type { AppEnv, AuthUser } from '../env';
import { Errors } from '../lib/errors';

interface LineVerifyResponse {
  iss?: string;
  sub?: string;
  name?: string;
  picture?: string;
  error?: string;
  error_description?: string;
}

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

export async function verifyLiffIdToken(
  idToken: string,
  channelId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AuthUser> {
  const body = new URLSearchParams({
    id_token: idToken,
    client_id: channelId,
  });

  const response = await fetchImpl('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = (await response.json()) as LineVerifyResponse;
  if (!response.ok || !data.sub) {
    throw Errors.unauthorized(data.error_description || 'LIFF 身分驗證失敗');
  }

  return {
    lineUserId: data.sub,
    displayName: data.name || 'LINE 使用者',
    pictureUrl: data.picture,
  };
}

export const liffAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    throw Errors.unauthorized();
  }

  const allowTest = c.env.ALLOW_TEST_AUTH === 'true';
  if (allowTest) {
    const testUser = parseTestToken(token);
    if (testUser) {
      c.set('user', testUser);
      c.set('groupId', c.req.header('X-Line-Group-Id') || '');
      await next();
      return;
    }
  }

  const user = await verifyLiffIdToken(token, c.env.LINE_CHANNEL_ID);
  c.set('user', user);
  c.set('groupId', c.req.header('X-Line-Group-Id') || '');
  await next();
};
