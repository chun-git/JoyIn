import type { GroupMemberPublic, PreselectMemberRoster } from '../../../shared/types';
import {
  getCachedGroupMembersByIds,
  getGroupMembersCacheSyncedAt,
  getLatestGroupEventId,
  listCachedGroupMembers,
  listEventLineParticipants,
  lookupParticipantNamesByLineIds,
  replaceGroupMembersCache,
  type GroupMemberRow,
} from '../db/repo';
import { nowIso } from '../lib/datetime';
import {
  fetchGroupMemberProfile,
  listGroupMemberIds,
} from '../lib/line-group';

/** Refresh group member cache when older than this. */
export const GROUP_MEMBERS_CACHE_TTL_MS = 30 * 60 * 1000;

const LINE_FAIL_HINT = '目前顯示最近使用過的會員名單';

function isFresh(syncedAt: string | null, nowMs: number): boolean {
  if (!syncedAt) return false;
  const ts = Date.parse(syncedAt);
  if (!Number.isFinite(ts)) return false;
  return nowMs - ts < GROUP_MEMBERS_CACHE_TTL_MS;
}

function logLineSyncFailure(note: string, groupIdLength: number): void {
  console.error('[JoyIn group-members]', {
    reason: 'line_api_error',
    note,
    groupIdLength,
  });
}

/**
 * Sync member ids + profiles from LINE into D1.
 * Throws on LINE failure — callers decide fallback.
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

type RosterDraftMember = {
  lineUserId: string;
  displayName: string;
  pictureUrl: string | null;
  defaultSelected: boolean;
};

function upsertById(
  seen: Map<string, RosterDraftMember>,
  bucket: RosterDraftMember[],
  member: RosterDraftMember,
): void {
  if (seen.has(member.lineUserId)) return;
  seen.set(member.lineUserId, member);
  bucket.push(member);
}

function enrichFromCache(
  cache: GroupMemberRow[],
  lineUserId: string,
  fallbackName: string,
): Pick<RosterDraftMember, 'displayName' | 'pictureUrl'> {
  const hit = cache.find((row) => row.line_user_id === lineUserId);
  return {
    displayName: hit?.display_name?.trim() || fallbackName || 'LINE 使用者',
    pictureUrl: hit?.picture_url ?? null,
  };
}

/**
 * Build prioritized preselect roster. LINE sync is optional enrichment only.
 */
export async function buildPreselectMemberRoster(
  db: D1Database,
  groupId: string,
  channelAccessToken: string,
  options?: {
    copyEventId?: string;
    fetchImpl?: typeof fetch;
    nowMs?: number;
    forceRefresh?: boolean;
  },
): Promise<PreselectMemberRoster> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const nowMs = options?.nowMs ?? Date.now();
  const copyEventId = options?.copyEventId?.trim() || '';

  let lineSyncStatus: PreselectMemberRoster['lineSyncStatus'] = 'skipped';
  let hint: string | null = null;
  let syncedAt = await getGroupMembersCacheSyncedAt(db, groupId);
  let cache = await listCachedGroupMembers(db, groupId);

  const shouldSync =
    Boolean(options?.forceRefresh) || cache.length === 0 || !isFresh(syncedAt, nowMs);

  if (shouldSync && (channelAccessToken || '').trim()) {
    try {
      cache = await syncGroupMembersFromLine(db, groupId, channelAccessToken, fetchImpl);
      syncedAt = await getGroupMembersCacheSyncedAt(db, groupId);
      lineSyncStatus = 'ok';
    } catch {
      logLineSyncFailure(options?.forceRefresh ? 'force_refresh_failed' : 'sync_failed', groupId.length);
      lineSyncStatus = 'failed';
    }
  } else if (!(channelAccessToken || '').trim()) {
    lineSyncStatus = 'unavailable';
  }

  const seen = new Map<string, RosterDraftMember>();
  const attended: RosterDraftMember[] = [];
  const waitlist: RosterDraftMember[] = [];
  const other: RosterDraftMember[] = [];
  let attendedTitle = '上次參加';
  let waitlistTitle = '上次候補';
  const defaultSelectedIds: string[] = [];

  if (copyEventId) {
    attendedTitle = '原活動參加者';
    waitlistTitle = '原活動候補';
    const sourceParticipants = await listEventLineParticipants(db, copyEventId);
    for (const row of sourceParticipants) {
      const enriched = enrichFromCache(cache, row.line_user_id, row.participant_name);
      const member: RosterDraftMember = {
        lineUserId: row.line_user_id,
        displayName: enriched.displayName,
        pictureUrl: enriched.pictureUrl,
        defaultSelected: row.status === 'CONFIRMED',
      };
      if (row.status === 'CONFIRMED') {
        upsertById(seen, attended, member);
        defaultSelectedIds.push(row.line_user_id);
      } else {
        upsertById(seen, waitlist, { ...member, defaultSelected: false });
      }
    }
  } else {
    const latestId = await getLatestGroupEventId(db, groupId);
    if (latestId) {
      const recent = await listEventLineParticipants(db, latestId);
      for (const row of recent) {
        const enriched = enrichFromCache(cache, row.line_user_id, row.participant_name);
        const member: RosterDraftMember = {
          lineUserId: row.line_user_id,
          displayName: enriched.displayName,
          pictureUrl: enriched.pictureUrl,
          defaultSelected: false,
        };
        if (row.status === 'CONFIRMED') {
          upsertById(seen, attended, member);
        } else {
          upsertById(seen, waitlist, member);
        }
      }
    }
  }

  const others = [...cache].sort((a, b) =>
    a.display_name.localeCompare(b.display_name, 'zh-Hant', { sensitivity: 'base' }),
  );
  for (const row of others) {
    upsertById(seen, other, {
      lineUserId: row.line_user_id,
      displayName: row.display_name,
      pictureUrl: row.picture_url,
      defaultSelected: false,
    });
  }

  const attendedIds = new Set(attended.map((m) => m.lineUserId));
  const waitlistIds = new Set(waitlist.map((m) => m.lineUserId));
  const flat = [...attended, ...waitlist, ...other].map((m) => ({
    lineUserId: m.lineUserId,
    displayName: m.displayName,
    pictureUrl: m.pictureUrl,
    section: (attendedIds.has(m.lineUserId)
      ? 'attended'
      : waitlistIds.has(m.lineUserId)
        ? 'waitlist'
        : 'other') as 'attended' | 'waitlist' | 'other',
    defaultSelected: m.defaultSelected,
  }));

  if (
    flat.length > 0 &&
    (lineSyncStatus === 'failed' || lineSyncStatus === 'unavailable')
  ) {
    hint = LINE_FAIL_HINT;
  } else {
    hint = null;
  }

  return {
    members: flat,
    sections: {
      attended: flat.filter((m) => m.section === 'attended'),
      waitlist: flat.filter((m) => m.section === 'waitlist'),
      other: flat.filter((m) => m.section === 'other'),
    },
    attendedTitle,
    waitlistTitle,
    defaultSelectedIds: [...new Set(defaultSelectedIds)],
    lineSyncStatus,
    hint,
    emptyMessage: flat.length === 0 ? '目前還沒有可選擇的會員' : null,
    syncedAt,
  };
}

/** @deprecated Prefer buildPreselectMemberRoster — kept for focused sync tests. */
export async function listGroupMembersForClient(
  db: D1Database,
  groupId: string,
  channelAccessToken: string,
  options?: {
    fetchImpl?: typeof fetch;
    nowMs?: number;
    forceRefresh?: boolean;
  },
): Promise<{
  members: GroupMemberPublic[];
  syncedAt: string | null;
  lineSyncStatus: PreselectMemberRoster['lineSyncStatus'];
  hint: string | null;
  emptyMessage: string | null;
}> {
  const roster = await buildPreselectMemberRoster(db, groupId, channelAccessToken, options);
  return {
    members: roster.members.map(({ lineUserId, displayName, pictureUrl }) => ({
      lineUserId,
      displayName,
      pictureUrl,
    })),
    syncedAt: roster.syncedAt,
    lineSyncStatus: roster.lineSyncStatus,
    hint: roster.hint,
    emptyMessage: roster.emptyMessage,
  };
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
  const missing = () =>
    uniqueIds.filter((id) => !rows.some((row) => row.line_user_id === id));

  if (missing().length > 0 && (channelAccessToken || '').trim()) {
    try {
      await syncGroupMembersFromLine(db, groupId, channelAccessToken, fetchImpl);
      rows = await getCachedGroupMembersByIds(db, groupId, uniqueIds);
    } catch {
      logLineSyncFailure('resolve_preselect_sync_failed', groupId.length);
    }
  }

  const stillMissing = missing();
  if (stillMissing.length > 0) {
    const names = await lookupParticipantNamesByLineIds(db, groupId, stillMissing);
    const syncedAt = nowIso();
    for (const id of stillMissing) {
      rows.push({
        group_id: groupId,
        line_user_id: id,
        display_name: names.get(id) || 'LINE 使用者',
        picture_url: null,
        synced_at: syncedAt,
      });
    }
  }

  // Preserve caller order.
  const byId = new Map(rows.map((row) => [row.line_user_id, row]));
  return uniqueIds.map((id) => {
    const row = byId.get(id);
    if (!row) {
      return {
        group_id: groupId,
        line_user_id: id,
        display_name: 'LINE 使用者',
        picture_url: null,
        synced_at: nowIso(),
      };
    }
    return row;
  });
}
