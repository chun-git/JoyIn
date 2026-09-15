import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { EventSummary, HistoryEventSummary } from '../../../shared/types';
import {
  CONTEXT_EXPIRED_BODY,
  CONTEXT_EXPIRED_TITLE,
  CONTEXT_MISSING_BODY,
  CONTEXT_MISSING_TITLE,
  SERVER_ERROR_TITLE,
} from '../auth-recovery-keys';
import { api } from '../api';
import { AuthExpiredPanel } from '../components/AuthExpiredPanel';
import { EventCard } from '../components/EventCard';
import { StateBlock } from '../components/StateBlock';
import { SiteNav } from '../components/SiteNav';
import { bootEventListPage } from '../event-list-boot';
import type { JoyInFlowPhase, LiffSession } from '../liff';

type ListTab = 'upcoming' | 'history';

export function EventListPage({
  session,
  onFlowPhase,
  onRelogin,
}: {
  session: LiffSession;
  onFlowPhase?: (phase: JoyInFlowPhase) => void;
  /** Parent-wired one-shot LINE re-login (preserves context + /events). */
  onRelogin?: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const showDiag = searchParams.get('diag') === '1';
  const tab: ListTab = searchParams.get('tab') === 'history' ? 'history' : 'upcoming';
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [historyEvents, setHistoryEvents] = useState<HistoryEventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [errorKind, setErrorKind] = useState<
    '' | 'auth' | 'context_missing' | 'context_invalid' | 'server' | 'error'
  >('');
  const [errorTitle, setErrorTitle] = useState('');
  const [errorBody, setErrorBody] = useState('');
  const [listStatus, setListStatus] = useState<number | null>(null);
  const [toast] = useState(() => {
    const state = location.state as { listToast?: string } | null;
    return typeof state?.listToast === 'string' ? state.listToast : '';
  });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!toast) return;
    navigate('/events', { replace: true, state: null });
  }, [toast, navigate]);

  const setTab = useCallback(
    (next: ListTab) => {
      const params = new URLSearchParams(searchParams);
      if (next === 'history') params.set('tab', 'history');
      else params.delete('tab');
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setErrorKind('');
    setErrorTitle('');
    setErrorBody('');
    setListStatus(null);
    onFlowPhase?.('loading_events');
    void bootEventListPage(session).then((result) => {
      if (cancelled) return;
      if (result.kind === 'ready') {
        setEvents(result.events);
        setListStatus(200);
        onFlowPhase?.('ready');
        setLoading(false);
        return;
      }
      onFlowPhase?.('failed');
      setEvents([]);
      if (result.kind === 'auth') {
        setErrorKind('auth');
        setListStatus(401);
      } else if (result.kind === 'context_missing') {
        setErrorKind('context_missing');
        setErrorTitle(CONTEXT_MISSING_TITLE);
        setErrorBody(CONTEXT_MISSING_BODY);
        setListStatus(401);
      } else if (result.kind === 'context_invalid') {
        setErrorKind('context_invalid');
        setErrorTitle(result.title || CONTEXT_EXPIRED_TITLE);
        setErrorBody(result.body || CONTEXT_EXPIRED_BODY);
        setListStatus(401);
      } else if (result.kind === 'server') {
        setErrorKind('server');
        setErrorTitle(SERVER_ERROR_TITLE);
        setErrorBody(result.message);
        setListStatus(500);
      } else {
        setErrorKind('error');
        setErrorTitle(result.title);
        setErrorBody(result.message);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [session, onFlowPhase, reloadKey]);

  useEffect(() => {
    return load();
  }, [load]);

  useEffect(() => {
    if (tab !== 'history' || errorKind) return;
    let cancelled = false;
    setHistoryLoading(true);
    void api
      .listHistoryEvents(session)
      .then((result) => {
        if (cancelled) return;
        setHistoryEvents(Array.isArray(result.events) ? result.events : []);
      })
      .catch(() => {
        if (cancelled) return;
        setHistoryEvents([]);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, session, errorKind, reloadKey]);

  const sorted = useMemo(
    () => [...events].sort((a, b) => a.startAt.localeCompare(b.startAt)),
    [events],
  );

  return (
    <div className="stack">
      <SiteNav current="events" />
      <p className="list-greeting">嗨 {session.displayName}，來看看群組活動</p>
      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
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
      <div className="list-tabs" role="tablist" aria-label="活動列表切換">
        <button
          type="button"
          role="tab"
          className={`list-tab${tab === 'upcoming' ? ' is-active' : ''}`}
          aria-selected={tab === 'upcoming'}
          onClick={() => setTab('upcoming')}
        >
          即將舉行
        </button>
        <button
          type="button"
          role="tab"
          className={`list-tab${tab === 'history' ? ' is-active' : ''}`}
          aria-selected={tab === 'history'}
          onClick={() => setTab('history')}
        >
          歷史紀錄
        </button>
      </div>
      {tab === 'history' ? (
        <p className="hint list-tab-hint">歷史活動（近30天的活動紀錄）</p>
      ) : null}
      {loading ? <StateBlock kind="loading" title="活動載入中…" /> : null}
      {errorKind === 'auth' ? (
        <AuthExpiredPanel inClient={session.inClient} onRelogin={onRelogin} />
      ) : null}
      {errorKind === 'context_missing' || errorKind === 'context_invalid' || errorKind === 'error' ? (
        <StateBlock kind="error" title={errorTitle}>
          {errorBody}
        </StateBlock>
      ) : null}
      {errorKind === 'server' ? (
        <StateBlock kind="error" title={errorTitle}>
          {errorBody}
          <div className="row" style={{ marginTop: 12, justifyContent: 'center' }}>
            <button className="btn" type="button" onClick={() => setReloadKey((n) => n + 1)}>
              重試
            </button>
          </div>
        </StateBlock>
      ) : null}
      {!loading && !errorKind && tab === 'upcoming' && sorted.length === 0 ? (
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
      {!loading && !errorKind && tab === 'history' ? (
        historyLoading ? (
          <StateBlock kind="loading" title="歷史紀錄載入中…" />
        ) : historyEvents.length === 0 ? (
          <StateBlock kind="empty" title="最近 30 天沒有已結束的活動" />
        ) : (
          <div className="event-grid">
            {historyEvents.map((event) => (
              <EventCard
                key={event.eventId}
                event={event}
                history
                onClick={() => navigate(`/events/${event.eventId}?from=history`)}
              />
            ))}
          </div>
        )
      ) : null}
      {!loading && !errorKind && tab === 'upcoming' ? (
        <div className="event-grid">
          {sorted.map((event) => (
            <EventCard
              key={event.eventId}
              event={event}
              onClick={() => navigate(`/events/${event.eventId}`)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
