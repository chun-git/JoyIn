import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { EventSummary } from '../../../shared/types';
import {
  CONTEXT_EXPIRED_BODY,
  CONTEXT_EXPIRED_TITLE,
  CONTEXT_MISSING_BODY,
  CONTEXT_MISSING_TITLE,
  SERVER_ERROR_TITLE,
} from '../auth-recovery-keys';
import { AuthExpiredPanel } from '../components/AuthExpiredPanel';
import { EventCard } from '../components/EventCard';
import { StateBlock } from '../components/StateBlock';
import { SiteNav } from '../components/SiteNav';
import { bootEventListPage } from '../event-list-boot';
import type { JoyInFlowPhase, LiffSession } from '../liff';

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
  const [searchParams] = useSearchParams();
  const showDiag = searchParams.get('diag') === '1';
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
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
      {!loading && !errorKind && sorted.length === 0 ? (
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
