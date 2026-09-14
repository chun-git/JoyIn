import { useMemo, useState } from 'react';
import type { GroupMemberPublic } from '../../../shared/types';

export function MemberPreselectList({
  members,
  capacity,
  selectedIds,
  onChange,
  loading,
  error,
  onRetry,
}: {
  members: GroupMemberPublic[];
  capacity: number;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
}) {
  const [query, setQuery] = useState('');
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => m.displayName.toLowerCase().includes(q));
  }, [members, query]);

  function toggle(userId: string) {
    const next = new Set(selected);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    onChange([...next]);
  }

  return (
    <section className="member-preselect" aria-label="預先報名成員">
      <div className="member-preselect-header">
        <h3>預先報名成員</h3>
        <p className="hint member-preselect-count">
          已選擇 {selectedIds.length} 人／人數上限 {capacity} 人
        </p>
      </div>
      {error ? (
        <div className="member-preselect-error" role="alert">
          <p className="error" style={{ padding: 0, textAlign: 'left' }}>
            {error}
          </p>
          {onRetry ? (
            <button className="btn secondary btn-compact" type="button" onClick={onRetry}>
              重新整理
            </button>
          ) : null}
        </div>
      ) : null}
      {loading ? <p className="hint">正在載入群組成員…</p> : null}
      {!loading && !error ? (
        <>
          <label className="field" htmlFor="member-search">
            <span>搜尋成員</span>
            <input
              id="member-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="輸入顯示名稱"
              autoComplete="off"
            />
          </label>
          {filtered.length === 0 ? (
            <p className="hint">沒有符合的成員</p>
          ) : (
            <ul className="member-preselect-list">
              {filtered.map((member) => {
                const checked = selected.has(member.lineUserId);
                return (
                  <li key={member.lineUserId}>
                    <button
                      type="button"
                      className={`member-preselect-row${checked ? ' is-selected' : ''}`}
                      onClick={() => toggle(member.lineUserId)}
                      aria-pressed={checked}
                    >
                      <span className="member-preselect-avatar" aria-hidden="true">
                        {member.pictureUrl ? (
                          <img src={member.pictureUrl} alt="" width={40} height={40} />
                        ) : (
                          <span className="member-preselect-avatar-fallback">
                            {member.displayName.slice(0, 1)}
                          </span>
                        )}
                      </span>
                      <span className="member-preselect-name">{member.displayName}</span>
                      <span className="member-preselect-check" aria-hidden="true">
                        <input type="checkbox" checked={checked} readOnly tabIndex={-1} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}
