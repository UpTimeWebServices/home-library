-- Original publication year (from Hardcover), for sorting by publication date.
-- pub_year_hc = the Hardcover book id the year was taken from, so a fixed match gets re-checked.
ALTER TABLE works ADD COLUMN pub_year INTEGER;
ALTER TABLE works ADD COLUMN pub_year_hc INTEGER;
