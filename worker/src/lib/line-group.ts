import type { AuthUser } from '../env';
import { Errors } from './errors';

export type GroupMemberCheckResult =
  | { ok: true }
  | { ok: false; reason: 'not_member' | 'bot_not_in_group' | 'line_api_error' };

export interface LineGroupMemberProfile {
  userId: string;
  displayName: string;
  pictureUrl: string | null;
}

/**
 * Verify the LINE user is still a member of the Messaging API group.
 * GET /v2/bot/group/{groupId}/member/{userId}
 * Never logs groupId, userId, or Authorization.
 */
export async function checkGroupMember(
  channelAccessToken: string,
  groupId: string,
  lineUserId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GroupMemberCheckResult> {
  const token = (channelAccessToken || '').trim();
  const gid = (groupId || '').trim();
  const uid = (lineUserId || '').trim();
  if (!token || !gid || !uid) {
    return { ok: false, reason: 'line_api_error' };
  }

  try {
    const response = await fetchImpl(
      `https://api.line.me/v2/bot/group/${encodeURIComponent(gid)}/member/${encodeURIComponent(uid)}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (response.status === 200) {
      return { ok: true };
    }
    if (response.status === 404) {
      return { ok: false, reason: 'not_member' };
    }
    if (response.status === 403) {
      return { ok: false, reason: 'bot_not_in_group' };
    }
    console.error('[JoyIn group-member]', {
      reason: 'line_api_error',
      status: response.status,
      groupIdLength: gid.length,
      userIdLength: uid.length,
    });
    return { ok: false, reason: 'line_api_error' };
  } catch {
    console.error('[JoyIn group-member]', {
      reason: 'line_api_error',
      note: 'fetch_failed',
      groupIdLength: gid.length,
      userIdLength: uid.length,
    });
    return { ok: false, reason: 'line_api_error' };
  }
}

/**
 * List all member user ids in a group (handles continuationToken pagination).
 * GET /v2/bot/group/{groupId}/members/ids
 */
export async function listGroupMemberIds(
  channelAccessToken: string,
  groupId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ids: string[]; pageCount: number; lastStatus: number }> {
  const token = (channelAccessToken || '').trim();
  const gid = (groupId || '').trim();
  if (!token || !gid) {
    throw Errors.groupMembersUnavailable();
  }

  const ids: string[] = [];
  let start: string | undefined;
  let pageCount = 0;
  let lastStatus = 0;
  for (let page = 0; page < 40; page += 1) {
    const url = new URL(
      `https://api.line.me/v2/bot/group/${encodeURIComponent(gid)}/members/ids`,
    );
    if (start) url.searchParams.set('start', start);

    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      console.error('[JoyIn group-members-ids]', {
        note: 'fetch_failed',
        groupIdLength: gid.length,
        pageCount,
        memberCount: ids.length,
      });
      throw Errors.groupMembersUnavailable();
    }

    lastStatus = response.status;
    pageCount += 1;
    if (!response.ok) {
      console.error('[JoyIn group-members-ids]', {
        status: response.status,
        groupIdLength: gid.length,
        pageCount,
        memberCount: ids.length,
      });
      throw Errors.groupMembersUnavailable();
    }

    let body: { memberIds?: unknown; next?: unknown };
    try {
      body = (await response.json()) as { memberIds?: unknown; next?: unknown };
    } catch {
      throw Errors.groupMembersUnavailable();
    }

    const pageIds = Array.isArray(body.memberIds)
      ? body.memberIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : [];
    ids.push(...pageIds);

    if (typeof body.next === 'string' && body.next.trim()) {
      start = body.next.trim();
      continue;
    }
    break;
  }

  const unique = [...new Set(ids)];
  console.info('[JoyIn group-members-ids]', {
    status: lastStatus,
    groupIdLength: gid.length,
    pageCount,
    memberCount: unique.length,
  });
  return { ids: unique, pageCount, lastStatus };
}

/**
 * GET /v2/bot/group/{groupId}/member/{userId}
 */
export async function fetchGroupMemberProfile(
  channelAccessToken: string,
  groupId: string,
  lineUserId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LineGroupMemberProfile | null> {
  const token = (channelAccessToken || '').trim();
  const gid = (groupId || '').trim();
  const uid = (lineUserId || '').trim();
  if (!token || !gid || !uid) return null;

  try {
    const response = await fetchImpl(
      `https://api.line.me/v2/bot/group/${encodeURIComponent(gid)}/member/${encodeURIComponent(uid)}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as {
      userId?: unknown;
      displayName?: unknown;
      pictureUrl?: unknown;
    };
    if (typeof body.userId !== 'string' || typeof body.displayName !== 'string') return null;
    return {
      userId: body.userId,
      displayName: body.displayName,
      pictureUrl: typeof body.pictureUrl === 'string' ? body.pictureUrl : null,
    };
  } catch {
    return null;
  }
}

export type { AuthUser };
