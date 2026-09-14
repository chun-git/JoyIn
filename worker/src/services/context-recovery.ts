import type { AuthUser } from '../env';
import { getEventRow } from '../db/repo';
import { AppError, Errors } from '../lib/errors';
import {
  LiffContextError,
  signLiffContext,
  verifyLiffContextSignature,
} from '../lib/liff-context';
import { checkGroupMember } from '../lib/line-group';
import { consumeRateLimit } from '../lib/rate-limit';

const REFRESH_LIMIT = 8;
const RECOVER_LIMIT = 5;
const WINDOW_MS = 60_000;

function assertRefreshRateLimit(userId: string, action: 'refresh' | 'recover'): void {
  const ok = consumeRateLimit(`ctx:${action}:${userId}`, action === 'refresh' ? REFRESH_LIMIT : RECOVER_LIMIT, WINDOW_MS);
  if (!ok) {
    throw Errors.rateLimited();
  }
}

/**
 * Refresh an expired-but-valid-signature group context after membership proof.
 * Never trusts a client-supplied groupId.
 */
export async function refreshExpiredContext(options: {
  secret: string;
  channelAccessToken: string;
  contextToken: string;
  user: AuthUser;
  allowTestAuth: boolean;
  fetchImpl?: typeof fetch;
  nowMs?: number;
}): Promise<{ context: string }> {
  assertRefreshRateLimit(options.user.lineUserId, 'refresh');

  let verified: { groupId: string; expired: boolean };
  try {
    verified = await verifyLiffContextSignature(
      options.secret,
      options.contextToken,
      options.nowMs ?? Date.now(),
    );
  } catch (err) {
    if (err instanceof LiffContextError) {
      // Signature / malformed — never refresh.
      throw new AppError(401, err.code, '活動連結已失效，請重新輸入 /list');
    }
    throw err;
  }

  if (!verified.expired) {
    // Still fresh — mint a new short-lived token anyway (same group) after membership check.
  }

  const member = await proveMembership({
    channelAccessToken: options.channelAccessToken,
    groupId: verified.groupId,
    user: options.user,
    allowTestAuth: options.allowTestAuth,
    fetchImpl: options.fetchImpl,
  });
  if (!member) {
    throw Errors.linkUnrecoverable();
  }

  const context = await signLiffContext(options.secret, verified.groupId);
  return { context };
}

/**
 * Recover group context from a legacy card that only has eventId (no context).
 * Never returns event payload. Failed checks use one external error.
 */
export async function recoverContextFromEventId(options: {
  db: D1Database;
  secret: string;
  channelAccessToken: string;
  eventId: string;
  user: AuthUser;
  allowTestAuth: boolean;
  fetchImpl?: typeof fetch;
}): Promise<{ context: string }> {
  assertRefreshRateLimit(options.user.lineUserId, 'recover');

  const eventId = (options.eventId || '').trim();
  if (!eventId) {
    throw Errors.linkUnrecoverable();
  }

  const row = await getEventRow(options.db, eventId);
  // Uniform failure path — do not reveal missing vs cross-group vs deleted.
  if (!row || !row.group_id) {
    throw Errors.linkUnrecoverable();
  }

  const member = await proveMembership({
    channelAccessToken: options.channelAccessToken,
    groupId: row.group_id,
    user: options.user,
    allowTestAuth: options.allowTestAuth,
    fetchImpl: options.fetchImpl,
  });
  if (!member) {
    throw Errors.linkUnrecoverable();
  }

  const context = await signLiffContext(options.secret, row.group_id);
  return { context };
}

async function proveMembership(options: {
  channelAccessToken: string;
  groupId: string;
  user: AuthUser;
  allowTestAuth: boolean;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  if (options.allowTestAuth && options.user.lineUserId.startsWith('U-')) {
    // Vitest / local test tokens cannot call LINE; treat as members when test auth is on.
    return true;
  }
  const result = await checkGroupMember(
    options.channelAccessToken,
    options.groupId,
    options.user.lineUserId,
    options.fetchImpl,
  );
  return result.ok;
}
