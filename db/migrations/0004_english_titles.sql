-- Keep Hardcover's own title when we show the English edition's title instead
ALTER TABLE series_entries ADD COLUMN original_title TEXT;
-- Re-sync every series so entries pick up English titles
UPDATE series SET last_checked = NULL WHERE hardcover_id IS NOT NULL;
