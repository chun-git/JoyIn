import type { EventSummary } from '../../../shared/types';
import { formatFeeLabel } from '@shared/event-fields';
import { eventStatusLabel, eventStatusTone, formatEventRange, waitlistLabel } from '../format';

export function EventCard({
  event,
  onClick,
}: {
  event: EventSummary;
  onClick?: () => void;
}) {
  const tone = eventStatusTone(event);
  const mapsUrl = event.googleMapsUrl?.trim() || null;
  const feeText = formatFeeLabel(event.feeAmount ?? 0);

  const meta = (
    <div className="meta">
      <div>📅 {formatEventRange(event)}</div>
      <div className="event-location-row">
        <span className="event-location-text">📍 {event.address}</span>
        {mapsUrl ? (
          <a
            className="event-nav-link"
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            導航
          </a>
        ) : null}
      </div>
      <div>💰 {feeText}</div>
      <div>
        👥 {event.confirmedCount}／{event.capacity}
      </div>
    </div>
  );

  const badges = (
    <div className="badge-row">
      <span className={`badge ${tone}`}>{waitlistLabel(event)}</span>
      <span className={`badge ${tone}`}>{eventStatusLabel(event)}</span>
    </div>
  );

  if (!onClick) {
    return (
      <article className="event-card">
        <h3>{event.name}</h3>
        {meta}
        {badges}
      </article>
    );
  }

  // Keep card navigation on the main button; maps「導航」is a sibling link so it
  // never replaces the detail route and stays valid HTML (no <a> inside <button>).
  return (
    <article className="event-card event-card-interactive">
      <button type="button" className="event-card-main" onClick={onClick}>
        <h3>{event.name}</h3>
        <div className="meta">
          <div>📅 {formatEventRange(event)}</div>
          <div className="event-location-row">
            <span className="event-location-text">📍 {event.address}</span>
          </div>
          <div>💰 {feeText}</div>
          <div>
            👥 {event.confirmedCount}／{event.capacity}
          </div>
        </div>
        {badges}
      </button>
      {mapsUrl ? (
        <a
          className="event-nav-link event-nav-link-footer"
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          導航
        </a>
      ) : null}
    </article>
  );
}
