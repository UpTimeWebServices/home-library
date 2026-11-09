-- Genres, moods and tags: Hardcover's reader tags plus our own. Search only; shelving never changes.
CREATE TABLE work_tags (
  work_id   INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  category  TEXT NOT NULL,              -- genre | mood | tag | warning (Hardcover) | ours
  tag       TEXT NOT NULL COLLATE NOCASE,
  weight    INTEGER,                    -- how many Hardcover readers applied it
  hidden    INTEGER NOT NULL DEFAULT 0, -- removed by us; kept so a re-sync doesn't bring it back
  added_by  TEXT,
  PRIMARY KEY (work_id, category, tag)
);
CREATE INDEX work_tags_tag ON work_tags(tag);

-- One row per book once the tag sync has looked at it.
CREATE TABLE tag_sync (
  work_id         INTEGER PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,
  hc_book_id      INTEGER,
  hc_slug         TEXT,
  matched_title   TEXT,
  matched_author  TEXT,
  status          TEXT NOT NULL,        -- matched | uncertain | confirmed | not_found | rejected
  checked_at      TEXT NOT NULL DEFAULT (datetime('now')),
  note            TEXT
);
CREATE INDEX tag_sync_status ON tag_sync(status);

-- Small key/value store (the Hardcover lock that keeps background and on-page syncs from overlapping).
CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT);
