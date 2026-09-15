import type { EventSummary, HistoryEventSummary, HistoryViewerRole } from '../../../shared/types';
import { formatFeeLabel } from '@shared/event-fields';
import { eventStatusLabel, eventStatusTone, formatEventRange, waitlistLabel } from '../format';

const ROLE_LABEL: Record<HistoryViewerRole, string> = {
  organizer: '主揪',
  attended: '已參加',
  waitlist: '候補',
  proxy: '曾代報',
};

export function EventCard({
  event,
  onClick,
  history,
}: {
  event: EventSummary | HistoryEventSummary;
  onClick?: () => void;
  history?: boolean;
}) {
  const isHistory = history || event.isEnded === true;
  const tone = isHistory ? 'closed' : eventStatusTone(event);
  const mapsUrl = event.googleMapsUrl?.trim() || null;
  const feeText = formatFeeLabel(event.feeAmount ?? 0);
  const roles =
    isHistory && 'viewerRoles' in event && Array.isArray(event.viewerRoles)
      ? event.viewerRoles
      : [];

  const metaBody = (
    <>
      <div>📅 {formatEventRange(event)}</div>
      <div className="event-location-row">
        <span className="event-location-text">📍 {event.address}</span>
      </div>
      <div>💰 {feeText}</div>
      <div>
        👥 {event.confirmedCount}／{event.capacity}
      </div>
    </>
  );

  const badges = (
    <div className="badge-row">
      {isHistory ? (
        <>
          <span className="badge closed">已結束</span>
          {roles.map((role) => (
            <span key={role} className="badge wait">
              {ROLE_LABEL[role]}
            </span>
          ))}
        </>
      ) : (
        <>
          <span className={`badge ${tone}`}>{waitlistLabel(event)}</span>
          <span className={`badge ${tone}`}>{eventStatusLabel(event)}</span>
        </>
      )}
    </div>
  );

  if (!onClick) {
    return (
      <article className="event-card">
        <h3>{event.name}</h3>
        <div className="meta">{metaBody}</div>
        {badges}
      </article>
    );
  }

  return (
    <article className="event-card event-card-interactive">
      <button type="button" className="event-card-main" onClick={onClick}>
        <h3>{event.name}</h3>
        <div className="meta">{metaBody}</div>
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
