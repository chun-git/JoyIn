import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, Link } from 'react-router-dom';
import { StateBlock } from './components/StateBlock';
import { SiteNav } from './components/SiteNav';
import { AuthExpiredPanel } from './components/AuthExpiredPanel';
import { AUTH_EXPIRED_BODY, AUTH_EXTERNAL_BROWSER_MESSAGE } from './auth-recovery-keys';
import { closeLiffWindowIfInClient } from './auth-recovery';
import {
  CONTEXT_MISSING_MESSAGE,
  getCachedLiff,
  initSession,
  retryInitSession,
  type JoyInFlowPhase,
  type LiffBootResult,
  type LiffSession,
} from './liff';
import { sanitizeJoyInRoute } from './liff-deep-link';
import { EventCreatePage } from './pages/EventCreatePage';
import { EventDetailPage } from './pages/EventDetailPage';
import { EventEditPage } from './pages/EventEditPage';
import { EventListPage } from './pages/EventListPage';
import { HelpPage } from './pages/HelpPage';
import { TransferInvitePage } from './pages/TransferInvitePage';

function isHelpPath(pathname: string): boolean {
  return pathname === '/help' || pathname.startsWith('/help/');
}

function phaseLabel(phase: JoyInFlowPhase): string {
  switch (phase) {
    case 'preserving_context':
      return '正在保存群組連結…';
    case 'initializing_liff':
      return '正在連接 LINE…';
    case 'login_required':
      return '需要登入 LINE';
    case 'redirecting_login':
      return '正在前往 LINE 登入…';
    case 'retrieving_id_token':
      return '正在確認登入身分…';
    case 'loading_events':
      return '正在載入活動…';
    case 'ready':
      return '就緒';
    case 'failed':
      return '無法開啟 JoyIn';
    default:
      return '正在連接 LINE…';
  }
}

function isExpiredAuthError(code?: string, message?: string): boolean {
  if (code === 'auth_token_expired' || code === 'login_required_in_client') return true;
  const text = message || '';
  return text.includes(AUTH_EXPIRED_BODY) || text.includes('登入狀態已失效');
}

function isExternalBrowserError(code?: string, message?: string): boolean {
  if (code === 'external_browser_required') return true;
  return (message || '').includes(AUTH_EXTERNAL_BROWSER_MESSAGE);
}

function GroupGate({
  session,
  children,
}: {
  session: LiffSession;
  children: ReactNode;
}) {
  if (!session.contextToken) {
    return (
      <div className="stack">
        <SiteNav current="events" />
        <StateBlock kind="error" title={CONTEXT_MISSING_MESSAGE}>
          活動屬於群組。請在群組輸入 /list，再從活動卡片開啟 JoyIn。
          <div className="row" style={{ marginTop: 12, justifyContent: 'center' }}>
            <Link to="/help" className="btn secondary">
              查看使用手冊
            </Link>
          </div>
        </StateBlock>
      </div>
    );
  }
  return children;
}

function LiffApp() {
  const [session, setSession] = useState<LiffSession | null>(null);
  const [phase, setPhase] = useState<JoyInFlowPhase>('idle');
  const [bootError, setBootError] = useState('');
  const [bootErrorCode, setBootErrorCode] = useState('');
  const [canRetry, setCanRetry] = useState(false);
  const [canCloseWindow, setCanCloseWindow] = useState(false);
  const [booting, setBooting] = useState(true);
  const bootGenRef = useRef(0);
  const navigate = useNavigate();
  const location = useLocation();
  const restoredRouteRef = useRef(false);

  const applyResult = useCallback(
    (result: LiffBootResult, gen: number) => {
      if (gen !== bootGenRef.current) return;
      setPhase(result.phase);
      if (result.status === 'ready' && result.session) {
        setSession(result.session);
        setBootError('');
        setBootErrorCode('');
        setCanRetry(false);
        setCanCloseWindow(false);
        setBooting(false);

        const pending = sanitizeJoyInRoute(result.pendingRoute || '');
        if (pending && !restoredRouteRef.current) {
          restoredRouteRef.current = true;
          const current = `${location.pathname}${location.search}`.split('?')[0];
          if (pending !== current && pending !== location.pathname) {
            navigate(pending, { replace: true });
          }
        }
        return;
      }
      if (result.status === 'redirecting') {
        // Legacy path — should not occur without manual liff.login().
        setSession(null);
        setBootError('');
        setBootErrorCode('');
        setCanRetry(false);
        setCanCloseWindow(false);
        setBooting(false);
        setPhase('redirecting_login');
        return;
      }
      setSession(null);
      setBootError(result.error?.message || '無法開啟 JoyIn');
      setBootErrorCode(result.error?.code || '');
      setCanRetry(Boolean(result.canRetryLogin));
      setCanCloseWindow(Boolean(result.canCloseWindow));
      setBooting(false);
    },
    [location.pathname, location.search, navigate],
  );

  const boot = useCallback(
    (mode: 'auto' | 'retry' = 'auto') => {
      const gen = ++bootGenRef.current;
      setBooting(true);
      setBootError('');
      setBootErrorCode('');
      setCanRetry(false);
      setCanCloseWindow(false);
      setPhase('preserving_context');

      const onPhase = (next: JoyInFlowPhase) => {
        if (gen !== bootGenRef.current) return;
        setPhase(next);
      };
      const run = mode === 'retry' ? retryInitSession({ onPhase }) : initSession({ onPhase });

      run
        .then((result) => applyResult(result, gen))
        .catch((err: Error) => {
          if (gen !== bootGenRef.current) return;
          setBooting(false);
          setPhase('failed');
          setBootError(err.message || '無法開啟 JoyIn');
          setBootErrorCode('');
          setCanRetry(true);
          setCanCloseWindow(false);
        });
    },
    [applyResult],
  );

  useEffect(() => {
    boot('auto');
  }, [boot]);

  if (bootError) {
    if (isExpiredAuthError(bootErrorCode, bootError)) {
      return (
        <div className="app-shell">
          <AuthExpiredPanel inClient={canCloseWindow} kind="expired" />
        </div>
      );
    }
    if (isExternalBrowserError(bootErrorCode, bootError)) {
      return (
        <div className="app-shell">
          <AuthExpiredPanel inClient={false} kind="external" />
        </div>
      );
    }
    return (
      <div className="app-shell">
        <StateBlock kind="error" title={phaseLabel(phase === 'login_required' ? 'login_required' : 'failed')}>
          {bootError}
          <div className="row" style={{ marginTop: 12, justifyContent: 'center' }}>
            {canCloseWindow ? (
              <button
                className="btn"
                type="button"
                onClick={() => {
                  closeLiffWindowIfInClient(getCachedLiff());
                }}
              >
                關閉頁面
              </button>
            ) : null}
            {canRetry ? (
              <button className="btn secondary" type="button" onClick={() => boot('retry')}>
                重試
              </button>
            ) : null}
            <Link to="/help" className="btn secondary">
              查看使用手冊
            </Link>
          </div>
        </StateBlock>
      </div>
    );
  }

  if (booting || !session) {
    return (
      <div className="app-shell">
        <StateBlock kind="loading" title={phaseLabel(phase === 'idle' ? 'initializing_liff' : phase)} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Routes>
        <Route path="/transfer/:token" element={<TransferInvitePage session={session} />} />
        <Route
          path="/"
          element={<Navigate to="/events" replace />}
        />
        <Route
          path="/events"
          element={
            <GroupGate session={session}>
              <EventListPage session={session} onFlowPhase={setPhase} />
            </GroupGate>
          }
        />
        <Route
          path="/events/new"
          element={
            <GroupGate session={session}>
              <EventCreatePage session={session} />
            </GroupGate>
          }
        />
        <Route
          path="/events/:eventId"
          element={
            <GroupGate session={session}>
              <EventDetailPage session={session} />
            </GroupGate>
          }
        />
        <Route
          path="/events/:eventId/edit"
          element={
            <GroupGate session={session}>
              <EventEditPage session={session} />
            </GroupGate>
          }
        />
        <Route path="*" element={<Navigate to="/events" replace />} />
      </Routes>
    </div>
  );
}

export default function App() {
  const { pathname } = useLocation();

  if (isHelpPath(pathname)) {
    return (
      <div className="app-shell help-shell">
        <Routes>
          <Route path="/help" element={<Navigate to="/help/start" replace />} />
          <Route path="/help/:section" element={<HelpPage />} />
        </Routes>
      </div>
    );
  }

  return <LiffApp />;
}
