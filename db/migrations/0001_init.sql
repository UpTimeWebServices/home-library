-- Home Library schema v1

CREATE TABLE sections (
  name            TEXT PRIMARY KEY,
  rule_order      INTEGER NOT NULL,
  rule_note       TEXT,
  inches_per_book REAL NOT NULL DEFAULT 1.1,
  recommend       INTEGER NOT NULL DEFAULT 1   -- 0 = never recommend series gaps (Children's, Manga)
);

CREATE TABLE shelves (
  id           INTEGER PRIMARY KEY,
  room         TEXT NOT NULL,
  case_label   TEXT NOT NULL,          -- "1", "2", "Tree"
  shelf_label  TEXT NOT NULL,           -- "1", "2", "Left pile", "Stack"
  width_in     REAL,                   -- NULL = unlimited (guest room stack)
  section      TEXT REFERENCES sections(name),   -- planned section for this shelf
  first_author TEXT,
  last_author  TEXT,
  sort_order   INTEGER NOT NULL,
  is_overflow  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (room, case_label, shelf_label)
);

CREATE TABLE series (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  hardcover_id  INTEGER,
  status        TEXT NOT NULL DEFAULT 'tracking' CHECK (status IN ('tracking','hidden')),
  hidden_by     TEXT,
  hidden_at     TEXT,
  last_checked  TEXT
);

CREATE TABLE works (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL,
  sort_title    TEXT NOT NULL,
  author        TEXT,                  -- display: "Neil Gaiman; Terry Pratchett"
  author_sort   TEXT,                  -- "Gaiman, Neil; Pratchett, Terry"
  series_id     INTEGER REFERENCES series(id),
  series_pos    REAL,
  section       TEXT REFERENCES sections(name),
  cover_id      INTEGER,               -- Open Library cover id
  cover_url     TEXT,                  -- other cover source (Google Books), if any
  cover_status  TEXT NOT NULL DEFAULT 'pending' CHECK (cover_status IN ('pending','found','none','verified')),
  hardcover_id  INTEGER,
  ol_work_id    TEXT,
  notes         TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX works_author ON works(author_sort);
CREATE INDEX works_series ON works(series_id);

CREATE TABLE copies (
  id               INTEGER PRIMARY KEY,
  work_id          INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  isbn             TEXT,
  format           TEXT,
  publisher        TEXT,
  year             INTEGER,
  shelf_id         INTEGER REFERENCES shelves(id),   -- where it is now
  shelf_pos        INTEGER,
  planned_shelf_id INTEGER REFERENCES shelves(id),   -- where the re-file plan puts it
  first_edition    INTEGER NOT NULL DEFAULT 0,
  signed           INTEGER NOT NULL DEFAULT 0,
  condition        TEXT,
  special          TEXT NOT NULL DEFAULT 'none' CHECK (special IN ('none','suspected','confirmed')),
  bedroom_flag     INTEGER NOT NULL DEFAULT 0,
  confidence       TEXT,
  verified         INTEGER NOT NULL DEFAULT 0,       -- 1 once scanned/matched to an ISBN
  notes            TEXT,
  source           TEXT NOT NULL DEFAULT 'import' CHECK (source IN ('import','scan','manual')),
  added_by         TEXT,
  added_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX copies_work ON copies(work_id);
CREATE INDEX copies_isbn ON copies(isbn);
CREATE INDEX copies_shelf ON copies(shelf_id);

CREATE TABLE loans (
  id          INTEGER PRIMARY KEY,
  copy_id     INTEGER NOT NULL REFERENCES copies(id) ON DELETE CASCADE,
  borrower    TEXT NOT NULL,
  loaned_on   TEXT NOT NULL DEFAULT (date('now')),
  returned_on TEXT,
  logged_by   TEXT
);
CREATE INDEX loans_open ON loans(copy_id) WHERE returned_on IS NULL;

CREATE TABLE series_entries (
  id                INTEGER PRIMARY KEY,
  series_id         INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  position          REAL,
  title             TEXT NOT NULL,
  author            TEXT,
  isbn              TEXT,
  release_date      TEXT,
  hardcover_book_id INTEGER,
  dismissed         INTEGER NOT NULL DEFAULT 0,
  first_seen        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE wishlist (
  id                INTEGER PRIMARY KEY,
  title             TEXT NOT NULL,
  author            TEXT,
  isbn              TEXT,
  notes             TEXT,
  priority          INTEGER NOT NULL DEFAULT 2,
  added_by          TEXT,
  added_at          TEXT NOT NULL DEFAULT (datetime('now')),
  fulfilled_copy_id INTEGER REFERENCES copies(id)
);

CREATE TABLE activity (
  id      INTEGER PRIMARY KEY,
  user    TEXT,
  action  TEXT NOT NULL,
  target  TEXT,
  at      TEXT NOT NULL DEFAULT (datetime('now'))
);
