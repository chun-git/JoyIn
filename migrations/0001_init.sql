CREATE TABLE events (
  event_id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  name TEXT NOT NULL,
  event_date TEXT NOT NULL,
  event_time TEXT NOT NULL,
  event_at TEXT NOT NULL,
  address TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity >= 1),
  waitlist_enabled INTEGER NOT NULL DEFAULT 1 CHECK (waitlist_enabled IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED', 'DELETED')),
  organizer_line_user_id TEXT NOT NULL,
  organizer_display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_events_group_status_at ON events (group_id, status, event_at);
CREATE INDEX idx_events_event_at ON events (event_at);

CREATE TABLE registrations (
  registration_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('SELF', 'PROXY')),
  status TEXT NOT NULL CHECK (status IN ('CONFIRMED', 'WAITLIST')),
  waitlist_position INTEGER,
  participant_name TEXT NOT NULL,
  line_user_id TEXT,
  created_by_line_user_id TEXT NOT NULL,
  created_by_display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events (event_id)
);

CREATE UNIQUE INDEX idx_registrations_self_unique
  ON registrations (event_id, line_user_id)
  WHERE type = 'SELF';

CREATE UNIQUE INDEX idx_registrations_proxy_unique
  ON registrations (event_id, created_by_line_user_id, participant_name)
  WHERE type = 'PROXY';

CREATE INDEX idx_registrations_event_status_created
  ON registrations (event_id, status, created_at);

CREATE TABLE webhook_events (
  webhook_event_id TEXT PRIMARY KEY,
  event_type TEXT,
  received_at TEXT NOT NULL
);

CREATE TABLE organizer_transfers (
  transfer_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  from_line_user_id TEXT NOT NULL,
  from_display_name TEXT NOT NULL,
  to_line_user_id TEXT NOT NULL,
  to_display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events (event_id)
);

CREATE INDEX idx_organizer_transfers_event ON organizer_transfers (event_id);
