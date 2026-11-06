-- Hardcover series sync
CREATE UNIQUE INDEX IF NOT EXISTS series_entries_book ON series_entries(series_id, hardcover_book_id);
ALTER TABLE series ADD COLUMN sync_note TEXT;   -- why a series couldn't be matched, shown on the More page
