import type { GroupMemberPublic, PreselectMemberItem, PreselectMemberRoster } from '../../../shared/types';
import {
  lineCandidateKey,
  normalizeProxyName,
  proxyCandidateKey,
} from '../../../shared/preselect';
import {
  getCachedGroupMembersByIds,
  getGroupMembersCacheSyncedAt,
  getLatestGroupEventId,
  listCachedGroupMembers,
  listEventRosterParticipants,
  listGroupHistoryRosterParticipants,
  listGroupProxyCandidates,
  lookupParticipantNamesByLineIds,
  pruneGroupMembersNotIn,
  upsertGroupMembersCache,
  type GroupMemberRow,
  type RosterParticipantRow,
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

function logLineSyncFailure(note: string, groupIdLength: number, extra?: Record<string, number>): void {
  console.error('[JoyIn group-members]', {
    reason: 'line_api_error',
    note,
    groupIdLength,
    ...extra,
  });
}

/**
 * Sync member ids + profiles from LINE into D1 (upsert; never wipe on failure).
 * Throws on members/ids failure — callers decide fallback.
 */
export async function syncGroupMembersFromLine(
  db: D1Database,
  groupId: string,
  channelAccessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GroupMemberRow[]> {
  const listed = await listGroupMemberIds(channelAccessToken, groupId, fetchImpl);
  const memberIds = listed.ids;
  const profiles: Array<{
    lineUserId: string;
    displayName: string;
    pictureUrl: string | null;
  }> = [];
  let profileSuccess = 0;
  let profileFailure = 0;

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
          profileFailure += 1;
          return {
            lineUserId: userId,
            displayName: 'LINE 使用者',
            pictureUrl: null,
          };
        }
        profileSuccess += 1;
        return {
          lineUserId: profile.userId,
          displayName: profile.displayName.trim() || 'LINE 使用者',
          pictureUrl: profile.pictureUrl,
        };
      }),
    );
    profiles.push(...settled);
  }

  console.info('[JoyIn group-members]', {
    note: 'line_sync_complete',
    groupIdLength: groupId.length,
    memberCount: memberIds.length,
    pageCount: listed.pageCount,
    profileSuccess,
    profileFailure,
  });

  const syncedAt = nowIso();
  await upsertGroupMembersCache(db, groupId, profiles, syncedAt);
  if (profiles.length > 0) {
    await pruneGroupMembersNotIn(
      db,
      groupId,
      profiles.map((p) => p.lineUserId),
    );
  }
  return listCachedGroupMembers(db, groupId);
}

type Draft = {
  key: string;
  kind: 'line' | 'proxy';
  lineUserId: string | null;
  proxyName: string | null;
  displayName: string;
  pictureUrl: string | null;
  section: PreselectMemberItem['section'];
  defaultSelected: boolean;
  badge: PreselectMemberItem['badge'];
};

function enrichLine(
  cache: GroupMemberRow[],
  lineUserId: string,
  fallbackName: string,
): Pick<Draft, 'displayName' | 'pictureUrl'> {
  const hit = cache.find((row) => row.line_user_id === lineUserId);
  return {
    displayName: hit?.display_name?.trim() || fallbackName.trim() || 'LINE 使用者',
    pictureUrl: hit?.picture_url ?? null,
  };
}

function draftFromRow(
  row: RosterParticipantRow,
  cache: GroupMemberRow[],
  section: Draft['section'],
  defaultSelected: boolean,
  badge: Draft['badge'],
): Draft | null {
  if (row.type === 'SELF') {
    const lineUserId = (row.line_user_id || '').trim();
    if (!lineUserId) return null;
    const enriched = enrichLine(cache, lineUserId, row.participant_name);
    return {
      key: lineCandidateKey(lineUserId),
      kind: 'line',
      lineUserId,
      proxyName: null,
      displayName: enriched.displayName,
      pictureUrl: enriched.pictureUrl,
      section,
      defaultSelected,
      badge,
    };
  }
  const proxyName = row.participant_name.trim().replace(/\s+/g, ' ');
  if (!proxyName || !normalizeProxyName(proxyName)) return null;
  return {
    key: proxyCandidateKey(proxyName),
    kind: 'proxy',
    lineUserId: null,
    proxyName,
    displayName: proxyName,
    pictureUrl: null,
    section,
    defaultSelected,
    badge: badge === 'waitlist' ? 'waitlist' : 'proxy',
  };
}

function pushUnique(
  seenLine: Set<string>,
  seenProxy: Set<string>,
  bucket: Draft[],
  draft: Draft,
): boolean {
  if (draft.kind === 'line') {
    const id = draft.lineUserId || '';
    if (!id || seenLine.has(id)) return false;
    seenLine.add(id);
  } else {
    const normalized = normalizeProxyName(draft.proxyName || '');
    if (!normalized || seenProxy.has(normalized)) return false;
    seenProxy.add(normalized);
  }
  bucket.push(draft);
  return true;
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
  const isCopy = Boolean(copyEventId);

  let lineSyncStatus: PreselectMemberRoster['lineSyncStatus'] = 'skipped';
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
      logLineSyncFailure(options?.forceRefresh ? 'force_refresh_failed' : 'sync_failed', groupId.length, {
        cachedMemberCount: cache.length,
      });
      lineSyncStatus = 'failed';
    }
  } else if (!(channelAccessToken || '').trim()) {
    lineSyncStatus = 'unavailable';
  }

  const seenLine = new Set<string>();
  const seenProxy = new Set<string>();
  const attended: Draft[] = [];
  const proxies: Draft[] = [];
  const waitlist: Draft[] = [];
  const history: Draft[] = [];
  const other: Draft[] = [];
  const defaultSelectedKeys: string[] = [];

  const attendedTitle = isCopy ? '原活動參加者' : '上次參加者';
  const proxyTitle = isCopy ? '原活動代報者' : '歷史代報名單';
  const waitlistTitle = isCopy ? '原活動候補' : '上次候補';
  const historyTitle = '其他曾參加者';
  const otherTitle = '其他群組成員';
  const waitlistBadge: Draft['badge'] = 'waitlist';

  let primaryEventId = '';
  if (isCopy) {
    primaryEventId = copyEventId;
    const sourceRows = await listEventRosterParticipants(db, copyEventId);
    for (const row of sourceRows) {
      if (row.status === 'CONFIRMED' && row.type === 'SELF') {
        const draft = draftFromRow(row, cache, 'attended', true, null);
        if (draft && pushUnique(seenLine, seenProxy, attended, draft)) {
          defaultSelectedKeys.push(draft.key);
        }
      }
    }
    for (const row of sourceRows) {
      if (row.status === 'CONFIRMED' && row.type === 'PROXY') {
        const draft = draftFromRow(row, cache, 'proxy', true, 'proxy');
        if (draft && pushUnique(seenLine, seenProxy, proxies, draft)) {
          defaultSelectedKeys.push(draft.key);
        }
      }
    }
    for (const row of sourceRows) {
      if (row.status === 'WAITLIST') {
        const draft = draftFromRow(row, cache, 'waitlist', false, waitlistBadge);
        if (draft) pushUnique(seenLine, seenProxy, waitlist, draft);
      }
    }
  } else {
    const latestId = await getLatestGroupEventId(db, groupId);
    if (latestId) {
      primaryEventId = latestId;
      const recent = await listEventRosterParticipants(db, latestId);
      for (const row of recent) {
        if (row.status === 'CONFIRMED' && row.type === 'SELF') {
          const draft = draftFromRow(row, cache, 'attended', false, null);
          if (draft) pushUnique(seenLine, seenProxy, attended, draft);
        }
      }
      for (const row of recent) {
        if (row.status === 'CONFIRMED' && row.type === 'PROXY') {
          const draft = draftFromRow(row, cache, 'proxy', false, 'proxy');
          if (draft) pushUnique(seenLine, seenProxy, proxies, draft);
        }
      }
      for (const row of recent) {
        if (row.status === 'WAITLIST') {
          const draft = draftFromRow(row, cache, 'waitlist', false, waitlistBadge);
          if (draft) pushUnique(seenLine, seenProxy, waitlist, draft);
        }
      }
    }
  }

  const historyRows = await listGroupHistoryRosterParticipants(db, groupId, {
    excludeEventIds: primaryEventId ? [primaryEventId] : [],
  });
  for (const row of historyRows) {
    if (isCopy) {
      const draft = draftFromRow(
        row,
        cache,
        'history',
        false,
        row.type === 'PROXY' ? 'proxy' : row.status === 'WAITLIST' ? 'waitlist' : null,
      );
      if (draft) pushUnique(seenLine, seenProxy, history, draft);
    } else if (row.type === 'PROXY') {
      const draft = draftFromRow(row, cache, 'proxy', false, 'proxy');
      if (draft) pushUnique(seenLine, seenProxy, proxies, draft);
    } else {
      const draft = draftFromRow(
        row,
        cache,
        'history',
        false,
        row.status === 'WAITLIST' ? 'waitlist' : null,
      );
      if (draft) pushUnique(seenLine, seenProxy, history, draft);
    }
  }

  const storedProxies = await listGroupProxyCandidates(db, groupId);
  for (const row of storedProxies) {
    const proxyName = row.display_name.trim().replace(/\s+/g, ' ');
    if (!proxyName) continue;
    pushUnique(seenLine, seenProxy, isCopy ? history : proxies, {
      key: proxyCandidateKey(proxyName),
      kind: 'proxy',
      lineUserId: null,
      proxyName,
      displayName: proxyName,
      pictureUrl: null,
      section: isCopy ? 'history' : 'proxy',
      defaultSelected: false,
      badge: 'proxy',
    });
  }

  // Persist historical LINE ids into cache so D1 is not empty after LINE failures.
  const nameByLineId = new Map<string, string>();
  for (const draft of [...attended, ...waitlist, ...history]) {
    if (draft.kind === 'line' && draft.lineUserId) {
      nameByLineId.set(draft.lineUserId, draft.displayName);
    }
  }
  const historyLineUpserts = [...seenLine]
    .filter((id) => !cache.some((row) => row.line_user_id === id))
    .map((id) => ({
      lineUserId: id,
      displayName: nameByLineId.get(id) || 'LINE 使用者',
      pictureUrl: null as string | null,
    }));
  if (historyLineUpserts.length > 0) {
    await upsertGroupMembersCache(db, groupId, historyLineUpserts, syncedAt || nowIso());
    cache = await listCachedGroupMembers(db, groupId);
  }

  const others = [...cache].sort((a, b) =>
    a.display_name.localeCompare(b.display_name, 'zh-Hant', { sensitivity: 'base' }),
  );
  for (const row of others) {
    pushUnique(seenLine, seenProxy, other, {
      key: lineCandidateKey(row.line_user_id),
      kind: 'line',
      lineUserId: row.line_user_id,
      proxyName: null,
      displayName: row.display_name,
      pictureUrl: row.picture_url,
      section: 'other',
      defaultSelected: false,
      badge: null,
    });
  }

  const flat = [...attended, ...proxies, ...waitlist, ...history, ...other].map((m) => {
    if (m.kind === 'line' && m.lineUserId) {
      const enriched = enrichLine(cache, m.lineUserId, m.displayName);
      return { ...m, displayName: enriched.displayName, pictureUrl: enriched.pictureUrl };
    }
    return m;
  });

  console.info('[JoyIn group-members]', {
    note: 'roster_built',
    groupIdLength: groupId.length,
    candidateCount: flat.length,
    lineSyncStatus,
    cachedMemberCount: cache.length,
  });

  const hint =
    flat.length > 0 && (lineSyncStatus === 'failed' || lineSyncStatus === 'unavailable')
      ? LINE_FAIL_HINT
      : null;

  return {
    members: flat,
    sections: {
      attended: flat.filter((m) => m.section === 'attended'),
      proxy: flat.filter((m) => m.section === 'proxy'),
      waitlist: flat.filter((m) => m.section === 'waitlist'),
      history: flat.filter((m) => m.section === 'history'),
      other: flat.filter((m) => m.section === 'other'),
    },
    attendedTitle,
    proxyTitle,
    waitlistTitle,
    historyTitle,
    otherTitle,
    defaultSelectedKeys: [...new Set(defaultSelectedKeys)],
    defaultSelectedIds: [
      ...new Set(
        flat
          .filter((m) => m.defaultSelected && m.kind === 'line' && m.lineUserId)
          .map((m) => m.lineUserId as string),
      ),
    ],
    lineSyncStatus,
    hint,
    emptyMessage: flat.length === 0 ? '目前還沒有可選擇的會員' : null,
    syncedAt,
  };
}

/** @deprecated Prefer buildPreselectMemberRoster */
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
    members: roster.members
      .filter((m) => m.kind === 'line' && m.lineUserId)
      .map((m) => ({
        lineUserId: m.lineUserId as string,
        displayName: m.displayName,
        pictureUrl: m.pictureUrl,
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

export function resolvePreselectedProxyNames(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of names) {
    const display = (raw || '').trim().replace(/\s+/g, ' ');
    const normalized = normalizeProxyName(display);
    if (!normalized || seen.has(normalized)) continue;
    if (display.length > 40) continue;
    seen.add(normalized);
    result.push(display);
  }
  return result;
}
