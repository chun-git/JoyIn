-- Cache LINE group members for organizer preselect (never expose groupId to clients).
CREATE TABLE group_members (
  group_id TEXT NOT NULL,
  line_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  picture_url TEXT,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (group_id, line_user_id)
);

CREATE INDEX idx_group_members_synced ON group_members (group_id, synced_at);
CREATE INDEX idx_group_members_name ON group_members (group_id, display_name);

-- Track how a registration was created; preselect keeps the participant LINE user id.
ALTER TABLE registrations ADD COLUMN registration_source TEXT NOT NULL DEFAULT 'SELF_JOIN';
ALTER TABLE registrations ADD COLUMN participant_line_user_id TEXT;

UPDATE registrations
SET registration_source = 'SELF_JOIN',
    participant_line_user_id = line_user_id
WHERE type = 'SELF';

UPDATE registrations
SET registration_source = 'PROXY',
    participant_line_user_id = NULL
WHERE type = 'PROXY';

CREATE INDEX idx_registrations_participant_line
  ON registrations (event_id, participant_line_user_id);
