import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { EventSummary } from '../../../shared/types';
import { api, ApiError } from '../api';
import { EventCard } from '../components/EventCard';
import { StateBlock } from '../components/StateBlock';
import { SiteNav } from '../components/SiteNav';
import { CONTEXT_INVALID_MESSAGE, CONTEXT_MISSING_MESSAGE } from '../liff-context';
import type { LiffSession } from '../liff';

export function EventListPage({ session }: { session: LiffSession }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const showDiag = searchParams.get('diag') === '1';
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [errorTitle, setErrorTitle] = useState('無法載入活動');
  const [listStatus, setListStatus] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setErrorTitle('無法載入活動');
    setListStatus(null);
    api
      .listEvents(session)
      .then((result) => {
        if (!cancelled) {
          setEvents(Array.isArray(result.events) ? result.events : []);
          setListStatus(200);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          const status =
            err instanceof ApiError
              ? err.status
              : 'status' in err && typeof (err as { status?: number }).status === 'number'
                ? (err as { status: number }).status
                : null;
          setListStatus(status);
          if (status === 401) {
            const code = err instanceof ApiError ? err.code : '';
            const apiMessage = err instanceof ApiError ? err.message : err.message;
            if (code.startsWith('context_')) {
              setErrorTitle(code === 'context_missing' ? CONTEXT_MISSING_MESSAGE : CONTEXT_INVALID_MESSAGE);
              setError(
                code === 'context_missing'
                  ? apiMessage
                  : `驗證失敗（${code}）。請回到 LINE 群組重新輸入 /list，並從新的活動卡片開啟。`,
              );
            } else if (
              code === 'auth_token_missing' ||
              code === 'auth_token_malformed' ||
              code === 'auth_token_invalid'
            ) {
              setErrorTitle('無法驗證登入身分');
              setError(`${apiMessage}${code ? `（${code}）` : ''}`);
            } else if (apiMessage.includes('失效') || apiMessage.includes('/list')) {
              setErrorTitle(CONTEXT_INVALID_MESSAGE);
              setError(apiMessage);
            } else {
              setErrorTitle('無法驗證登入身分');
              setError(apiMessage || '請重新從 LINE 開啟 JoyIn');
            }
          } else if (status === 500) {
            setErrorTitle('無法載入活動');
            const code = err instanceof ApiError ? err.code : 'INTERNAL';
            setError(`伺服器發生錯誤${code ? `（${code}）` : ''}。請稍後再試，或重新從 /list 卡片開啟。`);
          } else {
            setError(err.message || '載入失敗');
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const sorted = useMemo(
    () => [...events].sort((a, b) => a.startAt.localeCompare(b.startAt)),
    [events],
  );

  return (
    <div className="stack">
      <SiteNav current="events" />
      <p className="list-greeting">嗨 {session.displayName}，來看看群組活動</p>
      {showDiag ? (
        <section className="panel" aria-label="群組診斷">
          <strong>群組診斷（僅 ?diag=1）</strong>
          <pre className="share-box" style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>
            {[
              `has context token: ${String(session.contextDiag?.hasContextToken ?? false)}`,
              `context token length: ${session.contextDiag?.contextTokenLength ?? 0}`,
              `context source: ${session.contextDiag?.contextSource || '(none)'}`,
              `context format ok: ${String(session.contextDiag?.formatOk ?? false)}`,
              `GET /api/events status: ${listStatus ?? '(pending)'}`,
              `GET /api/events count: ${loading ? '(loading)' : sorted.length}`,
              `page loadedAt: ${session.contextDiag?.loadedAt ?? '(n/a)'}`,
            ].join('\n')}
          </pre>
        </section>
      ) : null}
      <div className="row">
        <button className="btn" type="button" onClick={() => navigate('/events/new')}>
          新增活動
        </button>
      </div>
      {loading ? <StateBlock kind="loading" title="活動載入中…" /> : null}
      {error ? <StateBlock kind="error" title={errorTitle}>{error}</StateBlock> : null}
      {!loading && !error && sorted.length === 0 ? (
        <StateBlock kind="empty" title="目前沒有尚未結束的活動">
          任何群組成員都可以建立第一場活動。
          <div className="row empty-actions">
            <button className="btn" type="button" onClick={() => navigate('/events/new')}>
              新增活動
            </button>
            <button className="btn secondary" type="button" onClick={() => navigate('/help')}>
              查看操作說明
            </button>
          </div>
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
