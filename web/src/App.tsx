import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, Link } from 'react-router-dom';
import { StateBlock } from './components/StateBlock';
import { SiteNav } from './components/SiteNav';
import { initSession, type LiffSession } from './liff';
import { EventCreatePage } from './pages/EventCreatePage';
import { EventDetailPage } from './pages/EventDetailPage';
import { EventEditPage } from './pages/EventEditPage';
import { EventListPage } from './pages/EventListPage';
import { HelpPage } from './pages/HelpPage';
import { TransferInvitePage } from './pages/TransferInvitePage';

function isHelpPath(pathname: string): boolean {
  return pathname === '/help' || pathname.startsWith('/help/');
}

function GroupGate({
  session,
  children,
}: {
  session: LiffSession;
  children: ReactNode;
}) {
  if (!session.groupId) {
    return (
      <div className="stack">
        <SiteNav current="events" />
        <StateBlock kind="error" title="請從 LINE 群組開啟 JoyIn">
          活動屬於群組，請在群組中輸入 /list 後再開啟。
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
  const [bootError, setBootError] = useState('');

  const boot = useCallback(() => {
    initSession()
      .then((current) => setSession(current))
      .catch((err: Error) => {
        if (err.message !== 'REDIRECTING') {
          setBootError(err.message);
        }
      });
  }, []);

  useEffect(() => {
    boot();
  }, [boot]);

  if (bootError) {
    return (
      <div className="app-shell">
        <StateBlock kind="error" title="無法開啟 JoyIn">
          {bootError}
          <div className="row" style={{ marginTop: 12, justifyContent: 'center' }}>
            <Link to="/help" className="btn secondary">
              查看使用手冊
            </Link>
          </div>
        </StateBlock>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="app-shell">
        <StateBlock kind="loading" title="正在連接 LINE…" />
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
              <EventListPage session={session} />
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
