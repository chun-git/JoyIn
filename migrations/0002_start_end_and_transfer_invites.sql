ALTER TABLE events ADD COLUMN start_at TEXT;
ALTER TABLE events ADD COLUMN end_at TEXT;

UPDATE events
SET start_at = event_at,
    end_at = event_at
WHERE start_at IS NULL OR end_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_group_status_end ON events (group_id, status, end_at);
CREATE INDEX IF NOT EXISTS idx_events_start_at ON events (start_at);

CREATE TABLE organizer_transfer_invites (
  invite_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  from_line_user_id TEXT NOT NULL,
  from_display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'CANCELLED')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  accepted_at TEXT,
  accepted_by_line_user_id TEXT,
  accepted_by_display_name TEXT,
  FOREIGN KEY (event_id) REFERENCES events (event_id)
);

CREATE INDEX idx_transfer_invites_event_status ON organizer_transfer_invites (event_id, status);
CREATE INDEX idx_transfer_invites_token_hash ON organizer_transfer_invites (token_hash);
