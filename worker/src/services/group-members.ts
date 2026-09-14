import type { GroupMemberPublic } from '../../../shared/types';
import {
  getCachedGroupMembersByIds,
  getGroupMembersCacheSyncedAt,
  listCachedGroupMembers,
  replaceGroupMembersCache,
  type GroupMemberRow,
} from '../db/repo';
import { Errors } from '../lib/errors';
import { nowIso } from '../lib/datetime';
import {
  fetchGroupMemberProfile,
  listGroupMemberIds,
} from '../lib/line-group';

/** Refresh group member cache when older than this. */
export const GROUP_MEMBERS_CACHE_TTL_MS = 30 * 60 * 1000;

function toPublic(row: GroupMemberRow): GroupMemberPublic {
  return {
    lineUserId: row.line_user_id,
    displayName: row.display_name,
    pictureUrl: row.picture_url,
  };
}

function isFresh(syncedAt: string | null, nowMs: number): boolean {
  if (!syncedAt) return false;
  const ts = Date.parse(syncedAt);
  if (!Number.isFinite(ts)) return false;
  return nowMs - ts < GROUP_MEMBERS_CACHE_TTL_MS;
}

/**
 * Sync member ids + profiles from LINE into D1.
 * Never returns an empty list as success when LINE failed.
 */
export async function syncGroupMembersFromLine(
  db: D1Database,
  groupId: string,
  channelAccessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GroupMemberRow[]> {
  const memberIds = await listGroupMemberIds(channelAccessToken, groupId, fetchImpl);
  const profiles: Array<{
    lineUserId: string;
    displayName: string;
    pictureUrl: string | null;
  }> = [];

  // Bound concurrency to avoid hammering LINE.
  const chunkSize = 8;
  for (let i = 0; i < memberIds.length; i += chunkSize) {
    const chunk = memberIds.slice(i, i + chunkSize);
    const settled = await Promise.all(
      chunk.map(async (userId) => {
        const profile = await fetchGroupMemberProfile(
          channelAccessToken,
          groupId,
          userId,
          fetchImpl,
        );
        if (!profile) {
          return {
            lineUserId: userId,
            displayName: 'LINE 使用者',
            pictureUrl: null,
          };
        }
        return {
          lineUserId: profile.userId,
          displayName: profile.displayName.trim() || 'LINE 使用者',
          pictureUrl: profile.pictureUrl,
        };
      }),
    );
    profiles.push(...settled);
  }

  const syncedAt = nowIso();
  await replaceGroupMembersCache(db, groupId, profiles, syncedAt);
  return listCachedGroupMembers(db, groupId);
}

export async function listGroupMembersForClient(
  db: D1Database,
  groupId: string,
  channelAccessToken: string,
  options?: {
    fetchImpl?: typeof fetch;
    nowMs?: number;
    forceRefresh?: boolean;
  },
): Promise<{ members: GroupMemberPublic[]; syncedAt: string | null }> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const nowMs = options?.nowMs ?? Date.now();
  const syncedAt = await getGroupMembersCacheSyncedAt(db, groupId);
  const cached = await listCachedGroupMembers(db, groupId);

  if (!options?.forceRefresh && cached.length > 0 && isFresh(syncedAt, nowMs)) {
    return { members: cached.map(toPublic), syncedAt };
  }

  try {
    const rows = await syncGroupMembersFromLine(db, groupId, channelAccessToken, fetchImpl);
    const nextSynced = await getGroupMembersCacheSyncedAt(db, groupId);
    return { members: rows.map(toPublic), syncedAt: nextSynced };
  } catch (err) {
    // Never pretend success with an empty list when LINE failed and cache is empty.
    if (cached.length > 0 && !options?.forceRefresh) {
      return { members: cached.map(toPublic), syncedAt };
    }
    if (err instanceof Error && 'code' in err) throw err;
    throw Errors.groupMembersUnavailable();
  }
}

export async function resolvePreselectedMembers(
  db: D1Database,
  groupId: string,
  memberIds: string[],
  channelAccessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GroupMemberRow[]> {
  const uniqueIds = [...new Set(memberIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) return [];

  let rows = await getCachedGroupMembersByIds(db, groupId, uniqueIds);
  if (rows.length !== uniqueIds.length) {
    await syncGroupMembersFromLine(db, groupId, channelAccessToken, fetchImpl);
    rows = await getCachedGroupMembersByIds(db, groupId, uniqueIds);
  }

  if (rows.length !== uniqueIds.length) {
    throw Errors.validation('部分預選成員不在目前群組名單中，請重新整理後再試');
  }
  return rows;
}
