import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, Link } from 'react-router-dom';
import { StateBlock } from './components/StateBlock';
import { SiteNav } from './components/SiteNav';
import { AppShell } from './components/AppShell';
import { AuthExpiredPanel, LoginFailedPanel } from './components/AuthExpiredPanel';
import {
  AUTH_EXPIRED_BODY,
  AUTH_LOGIN_FAILED_BODY,
  AUTH_REDIRECTING_LOGIN,
  CONTEXT_MISSING_BODY,
  CONTEXT_MISSING_TITLE,
} from './auth-recovery-keys';
import { closeLiffWindowIfInClient } from './auth-recovery';
import {
  getCachedLiff,
  initSession,
  retryInitSession,
  startManualLineLogin,
  type JoyInFlowPhase,
  type LiffBootResult,
  type LiffSession,
} from './liff';
import { JOYIN_PENDING_ROUTE_KEY, sanitizeJoyInRoute } from './liff-deep-link';
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
      return AUTH_REDIRECTING_LOGIN;
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

function isLoginFailedError(code?: string, message?: string): boolean {
  if (code === 'login_required' || code === 'login_redirect_failed') return true;
  const text = message || '';
  return text.includes(AUTH_LOGIN_FAILED_BODY);
}

function GroupGate({
  session,
  children,
  allowMissingContext = false,
}: {
  session: LiffSession;
  children: ReactNode;
  /** Event detail may recover via eventId when context is absent. */
  allowMissingContext?: boolean;
}) {
  if (!session.contextToken && !allowMissingContext) {
    return (
      <div className="stack">
        <SiteNav current="events" />
        <StateBlock kind="error" title={CONTEXT_MISSING_TITLE}>
          {CONTEXT_MISSING_BODY}
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
          if (pending !== location.pathname) {
            navigate(pending, { replace: true });
          }
        }
        return;
      }
      if (result.status === 'redirecting') {
        setSession(null);
        setBootError('');
        setBootErrorCode('');
        setCanRetry(false);
        setCanCloseWindow(false);
        setBooting(true);
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
    [location.pathname, navigate],
  );

  const boot = useCallback(
    (mode: 'auto' | 'retry' | 'manual-login' = 'auto') => {
      const gen = ++bootGenRef.current;
      setBooting(true);
      setBootError('');
      setBootErrorCode('');
      setCanRetry(false);
      setCanCloseWindow(false);
      setPhase(mode === 'manual-login' ? 'redirecting_login' : 'preserving_context');

      const onPhase = (next: JoyInFlowPhase) => {
        if (gen !== bootGenRef.current) return;
        setPhase(next);
      };
      const run =
        mode === 'manual-login'
          ? startManualLineLogin({ onPhase })
          : mode === 'retry'
            ? retryInitSession({ onPhase })
            : initSession({ onPhase });

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
        <AppShell>
          <AuthExpiredPanel
            inClient={canCloseWindow}
            onRelogin={() => boot('manual-login')}
          />
        </AppShell>
      );
    }
    if (isLoginFailedError(bootErrorCode, bootError)) {
      return (
        <AppShell>
          <LoginFailedPanel onRetryLogin={() => boot('manual-login')} />
        </AppShell>
      );
    }
    return (
      <AppShell>
        <div className="auth-panel">
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
      </AppShell>
    );
  }

  if (booting || !session) {
    return (
      <AppShell>
        <div className="auth-panel">
          <StateBlock
            kind="loading"
            title={phaseLabel(
              phase === 'idle'
                ? 'initializing_liff'
                : phase === 'redirecting_login'
                  ? 'redirecting_login'
                  : phase,
            )}
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Routes>
        <Route path="/transfer/:token" element={<TransferInvitePage session={session} />} />
        <Route path="/" element={<Navigate to="/events" replace />} />
        <Route
          path="/events"
          element={
            <GroupGate session={session}>
              <EventListPage
                session={session}
                onFlowPhase={setPhase}
                onRelogin={() => {
                  try {
                    window.sessionStorage.setItem(JOYIN_PENDING_ROUTE_KEY, '/events');
                  } catch {
                    // ignore
                  }
                  boot('manual-login');
                }}
              />
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
            <GroupGate session={session} allowMissingContext>
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
    </AppShell>
  );
}

export default function App() {
  const { pathname } = useLocation();

  if (isHelpPath(pathname)) {
    return (
      <AppShell className="help-shell">
        <Routes>
          <Route path="/help" element={<Navigate to="/help/start" replace />} />
          <Route path="/help/:section" element={<HelpPage />} />
        </Routes>
      </AppShell>
    );
  }

  return <LiffApp />;
}
