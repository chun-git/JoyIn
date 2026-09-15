-- Persist text-proxy names so preselect roster survives event history cleanup.
CREATE TABLE IF NOT EXISTS group_proxy_candidates (
  group_id TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  PRIMARY KEY (group_id, normalized_name)
);

CREATE INDEX IF NOT EXISTS idx_group_proxy_candidates_used
  ON group_proxy_candidates (group_id, last_used_at DESC);
