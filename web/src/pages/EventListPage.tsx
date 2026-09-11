import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { EventSummary } from '../../../shared/types';
import { EventCard } from '../components/EventCard';
import { StateBlock } from '../components/StateBlock';
import { closeLiff } from '../liff';
import type { LiffSession } from '../liff';

export function EventListPage({
  session,
  events,
  loading,
  error,
}: {
  session: LiffSession;
  events: EventSummary[];
  loading: boolean;
  error: string;
}) {
  const navigate = useNavigate();
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const sorted = useMemo(() => {
    const copy = [...events];
    copy.sort((a, b) =>
      order === 'asc'
        ? a.eventAt.localeCompare(b.eventAt)
        : b.eventAt.localeCompare(a.eventAt),
    );
    return copy;
  }, [events, order]);

  return (
    <div className="stack">
      <div className="topbar">
        <div className="brand">
          <strong>JoyIn</strong>
          <span>嗨 {session.displayName}，來看看群組活動</span>
        </div>
        <button className="btn ghost" type="button" onClick={() => closeLiff()}>
          返回 LINE
        </button>
      </div>
      <div className="row">
        <button className="btn" type="button" onClick={() => navigate('/events/new')}>
          新增活動
        </button>
        <button
          className="btn secondary"
          type="button"
          onClick={() => setOrder((value) => (value === 'asc' ? 'desc' : 'asc'))}
        >
          {order === 'asc' ? '時間：由近到遠' : '時間：由遠到近'}
        </button>
      </div>
      {loading ? <StateBlock kind="loading" title="活動載入中…" /> : null}
      {error ? <StateBlock kind="error" title="無法載入活動">{error}</StateBlock> : null}
      {!loading && !error && sorted.length === 0 ? (
        <StateBlock kind="empty" title="目前沒有尚未結束的活動">
          任何群組成員都可以建立第一場活動。
        </StateBlock>
      ) : null}
      <div className="event-grid">
        {sorted.map((event) => (
          <EventCard
            key={event.eventId}
            event={event}
            onClick={() => navigate(`/events/${event.eventId}`)}
          />
        ))}
      </div>
    </div>
  );
}
