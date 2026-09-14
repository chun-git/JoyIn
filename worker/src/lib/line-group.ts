import type { AuthUser } from '../env';

export type GroupMemberCheckResult =
  | { ok: true }
  | { ok: false; reason: 'not_member' | 'bot_not_in_group' | 'line_api_error' };

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
      // LINE returns 404 when the user is not in the group, or the group/bot relation is gone.
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

/** Test helper surface — keep AuthUser typed for callers. */
export type { AuthUser };
