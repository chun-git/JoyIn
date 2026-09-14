import { useMemo, useState } from 'react';
import type { PreselectMemberItem } from '../../../shared/types';

function badgeLabel(member: PreselectMemberItem, waitlistTitle: string): string | null {
  if (member.badge === 'waitlist') return waitlistTitle;
  if (member.badge === 'proxy' || member.kind === 'proxy') return '代報';
  return null;
}

export function MemberPreselectList({
  members,
  attendedTitle = '上次參加者',
  proxyTitle = '歷史代報名單',
  waitlistTitle = '上次候補',
  historyTitle = '其他曾參加者',
  otherTitle = '其他群組成員',
  capacity,
  selectedKeys,
  onChange,
  loading,
  hint,
  emptyMessage,
  onRefresh,
}: {
  members: PreselectMemberItem[];
  attendedTitle?: string;
  proxyTitle?: string;
  waitlistTitle?: string;
  historyTitle?: string;
  otherTitle?: string;
  capacity: number;
  selectedKeys: string[];
  onChange: (keys: string[]) => void;
  loading?: boolean;
  hint?: string | null;
  emptyMessage?: string | null;
  onRefresh?: () => void;
}) {
  const [query, setQuery] = useState('');
  const selected = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => m.displayName.toLowerCase().includes(q));
  }, [members, query]);

  const sections = useMemo(() => {
    return [
      { key: 'attended' as const, title: attendedTitle, items: filtered.filter((m) => m.section === 'attended') },
      { key: 'proxy' as const, title: proxyTitle, items: filtered.filter((m) => m.section === 'proxy') },
      { key: 'waitlist' as const, title: waitlistTitle, items: filtered.filter((m) => m.section === 'waitlist') },
      { key: 'history' as const, title: historyTitle, items: filtered.filter((m) => m.section === 'history') },
      { key: 'other' as const, title: otherTitle, items: filtered.filter((m) => m.section === 'other') },
    ].filter((section) => section.items.length > 0);
  }, [attendedTitle, filtered, historyTitle, otherTitle, proxyTitle, waitlistTitle]);

  function toggle(key: string) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange([...next]);
  }

  return (
    <section className="member-preselect" aria-label="預先報名成員">
      <div className="member-preselect-header">
        <h3>預先報名成員</h3>
        <p className="hint member-preselect-count">
          已選擇 {selectedKeys.length} 人／人數上限 {capacity} 人
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
                      const checked = selected.has(member.key);
                      const badge = badgeLabel(member, waitlistTitle);
                      return (
                        <li key={member.key}>
                          <button
                            type="button"
                            className={`member-preselect-row${checked ? ' is-selected' : ''}`}
                            onClick={() => toggle(member.key)}
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
                            <span className="member-preselect-meta">
                              <span className="member-preselect-name">{member.displayName}</span>
                              {badge ? (
                                <span className="member-preselect-badge">{badge}</span>
                              ) : null}
                            </span>
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
