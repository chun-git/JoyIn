import type { EventSummary } from '../../../shared/types';
import { eventStatusLabel, eventStatusTone, formatEventDateTime, waitlistLabel } from '../format';

export function EventCard({
  event,
  onClick,
}: {
  event: EventSummary;
  onClick?: () => void;
}) {
  const tone = eventStatusTone(event);
  const body = (
    <>
      <h3>{event.name}</h3>
      <div className="meta">
        <div>📅 {formatEventDateTime(event.eventDate, event.eventTime)}</div>
        <div>📍 {event.address}</div>
        <div>
          👥 {event.confirmedCount}／{event.capacity}
        </div>
      </div>
      <div className="badge-row">
        <span className={`badge ${tone}`}>{waitlistLabel(event)}</span>
        <span className={`badge ${tone}`}>{eventStatusLabel(event)}</span>
      </div>
    </>
  );

  if (!onClick) {
    return <article className="event-card">{body}</article>;
  }

  return (
    <button type="button" className="event-card" onClick={onClick}>
      {body}
    </button>
  );
}
