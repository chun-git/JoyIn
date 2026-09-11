import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { EventForm } from '../components/EventForm';
import type { LiffSession } from '../liff';
import type { CreateEventInput } from '../../../shared/types';

export function EventCreatePage({
  session,
  onCreated,
}: {
  session: LiffSession;
  onCreated: () => Promise<void>;
}) {
  const navigate = useNavigate();

  async function handleSubmit(input: CreateEventInput) {
    const result = await api.createEvent(session, input);
    await onCreated();
    navigate(`/events/${result.event.eventId}`);
  }

  return (
    <div className="stack">
      <div className="topbar">
        <div className="brand">
          <strong>新增活動</strong>
          <span>建立後你會成為主揪</span>
        </div>
        <button className="btn ghost" type="button" onClick={() => navigate('/')}>
          返回列表
        </button>
      </div>
      <EventForm submitLabel="建立活動" onSubmit={handleSubmit} />
    </div>
  );
}
