/** Wishlist: your own list, plus books missing from series you own (from Hardcover data). */
import { db } from './db';
import { sameTitle, titleKey } from './books';

export interface WishItem {
  id: number;
  title: string;
  author: string | null;
  isbn: string | null;
  notes: string | null;
  priority: number;
  added_by: string | null;
  added_at: string;
  cover_id: number | null;
  series_entry_id: number | null;
}

export async function wishList(): Promise<WishItem[]> {
  const { results } = await db()
    .prepare(
      `SELECT id, title, author, isbn, notes, priority, added_by, added_at, cover_id, series_entry_id
         FROM wishlist WHERE fulfilled_copy_id IS NULL AND fulfilled_at IS NULL
        ORDER BY priority, added_at DESC`,
    )
    .all<WishItem>();
  return results;
}

export interface Gap { id: number; position: number | null; title: string; year: number | null; main: boolean; onList: boolean }
export interface SeriesGaps {
  id: number;
  name: string;
  author: string | null;
  owned: number;      // main books you own
  total: number;      // main published books
  missing: Gap[];
}

const today = () => new Date().toISOString().slice(0, 10);
/** Main entries: whole-number positions (0 = prequel counts). Novellas, part-volumes and unnumbered extras are not. */
const isMain = (p: number | null) => p !== null && Number.isInteger(p) && p >= 0;

export async function recommendations(): Promise<{ groups: SeriesGaps[]; complete: number; hidden: { id: number; name: string; hidden_by: string | null; hidden_at: string | null }[]; dismissed: { id: number; title: string; series: string; position: number | null; dismissed_by: string | null }[] }> {
  const d = db();
  const [seriesRes, entriesRes, worksRes, wishRes, hiddenRes, dismissedRes] = await d.batch([
    d.prepare(
      `SELECT s.id, s.name,
              (SELECT w.author FROM works w WHERE w.series_id = s.id AND w.author IS NOT NULL LIMIT 1) AS author
         FROM series s
        WHERE s.status = 'tracking' AND s.hardcover_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM works w JOIN sections sec ON sec.name = w.section WHERE w.series_id = s.id AND sec.recommend = 1)`,
    ),
    d.prepare(`SELECT id, series_id, position, title, release_date, hardcover_book_id, dismissed FROM series_entries`),
    d.prepare(`SELECT id, title, series_id, series_pos, hardcover_id FROM works WHERE series_id IS NOT NULL OR hardcover_id IS NOT NULL`),
    d.prepare(`SELECT title, series_entry_id FROM wishlist WHERE fulfilled_copy_id IS NULL AND fulfilled_at IS NULL`),
    d.prepare(`SELECT id, name, hidden_by, hidden_at FROM series WHERE status = 'hidden' ORDER BY name COLLATE NOCASE`),
    d.prepare(
      `SELECT e.id, e.title, s.name AS series, e.position, e.dismissed_by FROM series_entries e JOIN series s ON s.id = e.series_id
        WHERE e.dismissed = 1 ORDER BY s.name COLLATE NOCASE, e.position`,
    ),
  ]);
  type E = { id: number; series_id: number; position: number | null; title: string; release_date: string | null; hardcover_book_id: number | null; dismissed: number };
  type W = { id: number; title: string; series_id: number | null; series_pos: number | null; hardcover_id: number | null };
  const entries = (entriesRes?.results ?? []) as E[];
  const works = (worksRes?.results ?? []) as W[];
  const wish = (wishRes?.results ?? []) as { title: string; series_entry_id: number | null }[];

  const ownedHc = new Set(works.map((w) => w.hardcover_id).filter(Boolean));
  const wishEntry = new Set(wish.map((w) => w.series_entry_id).filter(Boolean));
  const wishTitles = new Set(wish.map((w) => titleKey(w.title)));
  const t = today();

  const groups: SeriesGaps[] = [];
  let complete = 0;
  for (const s of (seriesRes?.results ?? []) as { id: number; name: string; author: string | null }[]) {
    const mine = works.filter((w) => w.series_id === s.id);

    const own = (e: E) => (e.hardcover_book_id !== null && ownedHc.has(e.hardcover_book_id)) || mine.some((w) => sameTitle(w.title, e.title));
    const published = entries.filter((e) => e.series_id === s.id && (!e.release_date || e.release_date <= t));
    const main = published.filter((e) => isMain(e.position));
    // Owned = linked by Hardcover id (set during sync) or same title. Series numbers alone aren't trusted:
    // catalogs and Hardcover number prequels differently.
    const ownedMain = main.filter(own).length;
    const missing = published
      .filter((e) => !e.dismissed && !own(e))
      .map((e) => ({
        id: e.id,
        position: e.position,
        title: e.title,
        year: e.release_date ? Number(e.release_date.slice(0, 4)) : null,
        main: isMain(e.position),
        onList: wishEntry.has(e.id) || wishTitles.has(titleKey(e.title)),
      }))
      .sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999));
    if (!missing.some((m) => m.main)) {
      complete++;
      if (!missing.length) continue;
    }
    groups.push({ id: s.id, name: s.name, author: s.author, owned: ownedMain, total: main.length, missing });
  }
  // Closest to complete first, then the series you own most of.
  groups.sort((a, b) => b.owned / Math.max(1, b.total) - a.owned / Math.max(1, a.total) || b.owned - a.owned || a.name.localeCompare(b.name));
  return {
    groups,
    complete,
    hidden: (hiddenRes?.results ?? []) as { id: number; name: string; hidden_by: string | null; hidden_at: string | null }[],
    dismissed: (dismissedRes?.results ?? []) as { id: number; title: string; series: string; position: number | null; dismissed_by: string | null }[],
  };
}

/** After a book is added, tick off matching wishlist items (same ISBN, or same title). */
export async function fulfil(copyId: number, isbn: string | null, title: string): Promise<number> {
  const d = db();
  const { results } = await d.prepare('SELECT id, title, isbn FROM wishlist WHERE fulfilled_copy_id IS NULL AND fulfilled_at IS NULL').all<{ id: number; title: string; isbn: string | null }>();
  const tk = titleKey(title);
  const hits = results.filter((w) => (isbn && w.isbn === isbn) || titleKey(w.title) === tk);
  if (hits.length) {
    await d.batch(hits.map((h) => d.prepare(`UPDATE wishlist SET fulfilled_copy_id = ?, fulfilled_at = datetime('now') WHERE id = ?`).bind(copyId, h.id)));
  }
  return hits.length;
}
