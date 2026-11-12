/**
 * Original publication year for each book, from Hardcover (for "sort by publication date").
 *
 * Only books already linked to a Hardcover book (by the series or genre sync) are looked up,
 * 100 per request. A book is due when it has a Hardcover id that its year wasn't taken from yet,
 * so a corrected match is picked up on its own. Books Hardcover doesn't have fall back to a
 * scanned copy's edition year when sorting.
 */
import { db } from './db';
import { hc } from './hardcover';

const HC_ID = `COALESCE(CASE WHEN ts.status IN ('matched','uncertain','confirmed') THEN ts.hc_book_id END, w.hardcover_id)`;
const DUE = `${HC_ID} IS NOT NULL AND COALESCE(w.pub_year_hc, 0) <> ${HC_ID}`;

export async function pubYearDue(): Promise<number> {
  const r = await db()
    .prepare(`SELECT COUNT(*) AS n FROM works w LEFT JOIN tag_sync ts ON ts.work_id = w.id WHERE ${DUE}`)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

const yearOf = (d: string | null | undefined): number | null => {
  const y = Number((d ?? '').slice(0, 4));
  return Number.isInteger(y) && y > 0 && y <= new Date().getFullYear() + 2 ? y : null;
};

export async function pubYearBatch(limit = 100): Promise<number> {
  const d = db();
  const { results: due } = await d
    .prepare(`SELECT w.id, ${HC_ID} AS hc FROM works w LEFT JOIN tag_sync ts ON ts.work_id = w.id WHERE ${DUE} LIMIT ?`)
    .bind(limit)
    .all<{ id: number; hc: number }>();
  if (!due.length) return 0;
  const ids = [...new Set(due.map((x) => x.hc))];
  const r = await hc<{ books: { id: number; release_date: string | null }[] }>(
    'query ($ids: [Int!]) { books(where: {id: {_in: $ids}}) { id release_date } }',
    { ids },
  );
  const years = new Map(r.books.map((b) => [b.id, yearOf(b.release_date)]));
  await d.batch(
    due.map((w) => d.prepare('UPDATE works SET pub_year = ?, pub_year_hc = ? WHERE id = ?').bind(years.get(w.hc) ?? null, w.hc, w.id)),
  );
  return due.length;
}
