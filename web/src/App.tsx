import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, Link } from 'react-router-dom';
import { StateBlock } from './components/StateBlock';
import { SiteNav } from './components/SiteNav';
import { setAuthTokenExpiredHandler } from './api';
import {
  AUTH_EXPIRED_USER_MESSAGE,
  AUTH_RECOVERY_FAILED_MESSAGE,
  recoverFromExpiredIdToken,
} from './auth-recovery';
import {
  CONTEXT_MISSING_MESSAGE,
  getCachedLiff,
  initSession,
  retryInitSession,
  startManualLineLogin,
  type JoyInFlowPhase,
  type LiffBootResult,
  type LiffSession,
} from './liff';
import { EventCreatePage } from './pages/EventCreatePage';
import { EventDetailPage } from './pages/EventDetailPage';
import { EventEditPage } from './pages/EventEditPage';
import { EventListPage } from './pages/EventListPage';
import { HelpPage } from './pages/HelpPage';
import { TransferInvitePage } from './pages/TransferInvitePage';

/** If login redirect does not navigate away, leave redirecting UI after this delay. */
export const LIFF_REDIRECT_STUCK_MS = 8_000;

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
  const [canRetryLogin, setCanRetryLogin] = useState(false);
  const [booting, setBooting] = useState(true);
  const bootGenRef = useRef(0);
  const sessionRef = useRef<LiffSession | null>(null);
  const recoveringRef = useRef(false);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const applyResult = useCallback((result: LiffBootResult, gen: number) => {
    if (gen !== bootGenRef.current) return;
    setPhase(result.phase);
    if (result.status === 'ready' && result.session) {
      setSession(result.session);
      setBootError('');
      setCanRetryLogin(false);
      setBooting(false);
      return;
    }
    if (result.status === 'redirecting') {
      setSession(null);
      setBootError('');
      setCanRetryLogin(false);
      setBooting(false);
      setPhase('redirecting_login');
      return;
    }
    setSession(null);
    setBootError(result.error?.message || '無法開啟 JoyIn');
    setCanRetryLogin(Boolean(result.canRetryLogin));
    setBooting(false);
  }, []);

  const boot = useCallback(
    (mode: 'auto' | 'retry' | 'manualLogin' = 'auto') => {
      const gen = ++bootGenRef.current;
      setBooting(true);
      setBootError('');
      setCanRetryLogin(false);
      setPhase(mode === 'manualLogin' ? 'login_required' : 'preserving_context');

      const onPhase = (next: JoyInFlowPhase) => {
        if (gen !== bootGenRef.current) return;
        setPhase(next);
      };
      const run =
        mode === 'manualLogin'
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
          setCanRetryLogin(true);
        });
    },
    [applyResult],
  );

  const runExpiredRecovery = useCallback(
    async (force = false) => {
      if (recoveringRef.current && !force) return;
      recoveringRef.current = true;
      setPhase('redirecting_login');
      setBootError('');
      setCanRetryLogin(false);
      setBooting(false);
      // Soft notice while redirecting — not a hard error yet.
      if (!force) {
        setPhase('redirecting_login');
      }

      const status = await recoverFromExpiredIdToken({
        contextToken: sessionRef.current?.contextToken,
        liff: getCachedLiff(),
        force,
      });

      if (status === 'redirecting') {
        setPhase('redirecting_login');
        setBootError('');
        recoveringRef.current = false;
        return;
      }

      recoveringRef.current = false;
      setPhase('login_required');
      setBootError(AUTH_RECOVERY_FAILED_MESSAGE);
      setCanRetryLogin(true);
      setBooting(false);
      setSession(null);
    },
    [],
  );

  useEffect(() => {
    boot('auto');
  }, [boot]);

  useEffect(() => {
    setAuthTokenExpiredHandler(() => {
      void runExpiredRecovery(false);
    });
    return () => setAuthTokenExpiredHandler(null);
  }, [runExpiredRecovery]);

  // If login redirect never navigates away, leave redirecting UI after 8s.
  useEffect(() => {
    if (phase !== 'redirecting_login' || bootError) return;
    const timer = window.setTimeout(() => {
      setPhase('login_required');
      setBootError(AUTH_RECOVERY_FAILED_MESSAGE);
      setCanRetryLogin(true);
      setBooting(false);
    }, LIFF_REDIRECT_STUCK_MS);
    return () => window.clearTimeout(timer);
  }, [phase, bootError]);

  if (bootError) {
    return (
      <div className="app-shell">
        <StateBlock
          kind="error"
          title={
            bootError.includes('過期') || bootError.includes('重新登入 LINE')
              ? 'LINE 登入已過期'
              : phaseLabel(phase === 'login_required' ? 'login_required' : 'failed')
          }
        >
          {bootError}
          <div className="row" style={{ marginTop: 12, justifyContent: 'center' }}>
            {canRetryLogin ? (
              <button className="btn" type="button" onClick={() => void runExpiredRecovery(true)}>
                重新登入 LINE
              </button>
            ) : null}
            <button className="btn secondary" type="button" onClick={() => boot('retry')}>
              重試
            </button>
            <Link to="/help" className="btn secondary">
              查看使用手冊
            </Link>
          </div>
        </StateBlock>
      </div>
    );
  }

  if (phase === 'redirecting_login') {
    return (
      <div className="app-shell">
        <StateBlock kind="loading" title="正在前往 LINE 登入…">
          {AUTH_EXPIRED_USER_MESSAGE}
          <div className="row" style={{ marginTop: 12, justifyContent: 'center' }}>
            <button className="btn" type="button" onClick={() => void runExpiredRecovery(true)}>
              重新登入 LINE
            </button>
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
        <Route path="*" element={<Navigate to="/" replace />} />
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
