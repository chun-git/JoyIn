import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { EventForm } from '../components/EventForm';
import { SiteNav } from '../components/SiteNav';
import { StateBlock } from '../components/StateBlock';
import type { LiffSession } from '../liff';
import type { CreateEventInput, EventDetail } from '../../../shared/types';

export function EventEditPage({ session }: { session: LiffSession }) {
  const { eventId = '' } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .getEvent(session, eventId)
      .then((result) => {
        if (!cancelled) setEvent(result.event);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, session]);

  if (error) return <StateBlock kind="error" title="無法編輯活動">{error}</StateBlock>;
  if (!event) return <StateBlock kind="loading" title="載入活動中…" />;
  if (!event.viewer.isOrganizer) {
    return <StateBlock kind="error" title="只有主揪可以編輯活動" />;
  }

  async function handleSubmit(input: CreateEventInput, confirmTimeLocationChange: boolean) {
    await api.updateEvent(session, eventId, { ...input, confirmTimeLocationChange });
    navigate(`/events/${eventId}`);
  }

  return (
    <div className="stack">
      <SiteNav current="events" />
      <div className="topbar">
        <div className="brand">
          <strong>編輯活動</strong>
          <span>{event.name}</span>
        </div>
        <button className="btn ghost" type="button" onClick={() => navigate(`/events/${eventId}`)}>
          返回活動
        </button>
      </div>
      <EventForm
        initial={{
          name: event.name,
          startDate: event.startDate,
          startTime: event.startTime,
          endDate: event.endDate,
          endTime: event.endTime,
          address: event.address,
          capacity: event.capacity,
          waitlistEnabled: event.waitlistEnabled,
        }}
        submitLabel="儲存變更"
        onSubmit={handleSubmit}
      />
    </div>
  );
}
