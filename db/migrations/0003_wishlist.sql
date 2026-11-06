-- Wishlist links and dismissal bookkeeping
ALTER TABLE wishlist ADD COLUMN series_entry_id INTEGER REFERENCES series_entries(id) ON DELETE SET NULL;
ALTER TABLE wishlist ADD COLUMN cover_id INTEGER;
ALTER TABLE wishlist ADD COLUMN fulfilled_at TEXT;
ALTER TABLE series_entries ADD COLUMN dismissed_by TEXT;
ALTER TABLE series_entries ADD COLUMN dismissed_at TEXT;
