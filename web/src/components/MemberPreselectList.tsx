import { useMemo, useState } from 'react';
import type { PreselectMemberItem } from '../../../shared/types';

export function MemberPreselectList({
  members,
  attendedTitle = '上次參加',
  waitlistTitle = '上次候補',
  otherTitle = '其他群組成員',
  capacity,
  selectedIds,
  onChange,
  loading,
  hint,
  emptyMessage,
  onRefresh,
}: {
  members: PreselectMemberItem[];
  attendedTitle?: string;
  waitlistTitle?: string;
  otherTitle?: string;
  capacity: number;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  loading?: boolean;
  hint?: string | null;
  emptyMessage?: string | null;
  onRefresh?: () => void;
}) {
  const [query, setQuery] = useState('');
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => m.displayName.toLowerCase().includes(q));
  }, [members, query]);

  const sections = useMemo(() => {
    const attended = filtered.filter((m) => m.section === 'attended');
    const waitlist = filtered.filter((m) => m.section === 'waitlist');
    const other = filtered.filter((m) => m.section === 'other');
    return [
      { key: 'attended' as const, title: attendedTitle, items: attended },
      { key: 'waitlist' as const, title: waitlistTitle, items: waitlist },
      { key: 'other' as const, title: otherTitle, items: other },
    ].filter((section) => section.items.length > 0);
  }, [attendedTitle, filtered, otherTitle, waitlistTitle]);

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
      {hint ? (
        <div className="member-preselect-hint">
          <p className="hint" style={{ margin: 0 }}>
            {hint}
          </p>
          {onRefresh ? (
            <button className="btn secondary btn-compact" type="button" onClick={onRefresh}>
              更新名單
            </button>
          ) : null}
        </div>
      ) : null}
      {loading ? <p className="hint">正在載入群組成員…</p> : null}
      {!loading ? (
        <>
          {members.length > 0 ? (
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
          ) : null}
          {members.length === 0 ? (
            <p className="hint">{emptyMessage || '目前還沒有可選擇的會員'}</p>
          ) : filtered.length === 0 ? (
            <p className="hint">沒有符合的成員</p>
          ) : (
            <div className="member-preselect-sections">
              {sections.map((section) => (
                <div key={section.key} className="member-preselect-section">
                  <h4 className="member-preselect-section-title">{section.title}</h4>
                  <ul className="member-preselect-list">
                    {section.items.map((member) => {
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
                </div>
              ))}
            </div>
          )}
          {!hint && onRefresh && members.length > 0 ? (
            <div className="member-preselect-actions">
              <button className="btn secondary btn-compact" type="button" onClick={onRefresh}>
                更新名單
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
