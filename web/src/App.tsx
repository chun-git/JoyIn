import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api';
import { StateBlock } from './components/StateBlock';
import { initSession, type LiffSession } from './liff';
import { EventCreatePage } from './pages/EventCreatePage';
import { EventDetailPage } from './pages/EventDetailPage';
import { EventEditPage } from './pages/EventEditPage';
import { EventListPage } from './pages/EventListPage';
import type { EventSummary } from '../../shared/types';

export default function App() {
  const [session, setSession] = useState<LiffSession | null>(null);
  const [bootError, setBootError] = useState('');
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');

  const refresh = useCallback(async (current: LiffSession) => {
    setLoading(true);
    setListError('');
    try {
      const result = await api.listEvents(current);
      setEvents(result.events);
    } catch (err) {
      setListError(err instanceof Error ? err.message : '無法載入活動');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    initSession()
      .then(async (current) => {
        setSession(current);
        await refresh(current);
      })
      .catch((err: Error) => {
        if (err.message !== 'REDIRECTING') {
          setBootError(err.message);
          setLoading(false);
        }
      });
  }, [refresh]);

  if (bootError) {
    return (
      <div className="app-shell">
        <StateBlock kind="error" title="無法開啟 JoyIn">
          {bootError}
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

  if (!session.groupId) {
    return (
      <div className="app-shell">
        <StateBlock kind="error" title="請從 LINE 群組開啟 JoyIn">
          活動屬於群組，請在群組中輸入 /list 後再開啟。
        </StateBlock>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Routes>
        <Route
          path="/"
          element={
            <EventListPage session={session} events={events} loading={loading} error={listError} />
          }
        />
        <Route
          path="/events/new"
          element={<EventCreatePage session={session} onCreated={() => refresh(session)} />}
        />
        <Route path="/events/:eventId" element={<EventDetailPage session={session} />} />
        <Route path="/events/:eventId/edit" element={<EventEditPage session={session} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
