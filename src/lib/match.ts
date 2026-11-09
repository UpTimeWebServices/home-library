/** Match a scanned/looked-up book against the library: exact ISBN copies, then same title by any edition. */
import { db } from './db';
import { lastNameKey, titleKey } from './books';
import type { Place } from './format';

export interface CopyHit extends Place {
  copyId: number;
  workId: number;
  title: string;
  author: string | null;
  verified: number;
  borrower: string | null;
}

export interface WorkHit extends Place {
  workId: number;
  title: string;
  author: string | null;
  section: string | null;
  series: string | null;
  seriesPos: number | null;
  coverId: number | null;
  coverUrl: string | null;
  copies: number;
  unverifiedCopyId: number | null;   // first copy not yet scanned, for Verify
  p_room: string | null;
  p_case_label: string | null;
  p_shelf_label: string | null;
  score: number;                     // 3 title+author, 2 title only, 1 partial title + author
}

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'on', 'to', 'for', 'with', 'by', 'vol', 'book', 'edition', 'collection', 'novel']);

/** Significant words of a whole title (subtitle included): "The Amazing Spider-Man Omnibus, Vol. 5" -> amazing spider man omnibus 5 */
export function titleWords(t: string): string[] {
  return t
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[’']/g, '').replace(/&/g, ' and ')
    .replace(/\bvolume\b/g, 'vol').replace(/\b(\d+)(st|nd|rd|th)\b/g, '$1')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w));
}

/**
 * Loose title overlap for catalog entries that were typed from shelf photos ("Player's Handbook" vs
 * "Dungeons & Dragons Player's Handbook"): at least 2 shared words making up 60%+ of the shorter title,
 * and if both titles carry numbers (volume 1 vs 5) they must share one.
 */
export function looseTitleMatch(a: string, b: string): number {
  const wa = new Set(titleWords(a));
  const wb = new Set(titleWords(b));
  if (!wa.size || !wb.size) return 0;
  const shared = [...wa].filter((w) => wb.has(w));
  const numsA = [...wa].filter((w) => /^\d+$/.test(w));
  const numsB = [...wb].filter((w) => /^\d+$/.test(w));
  if (numsA.length && numsB.length && !numsA.some((n) => wb.has(n))) return 0;
  const words = shared.filter((w) => !/^\d+$/.test(w));
  const ratio = shared.length / Math.min(wa.size, wb.size);
  return words.length >= 2 && ratio >= 0.6 ? ratio : 0;
}

export async function matchBook(input: { isbn: string | null; title: string; authorSort: string | null }) {
  const d = db();
  const owned = input.isbn
    ? ((
        await d
          .prepare(
            `SELECT c.id AS copyId, w.id AS workId, w.title, w.author, c.verified, sh.room, sh.case_label, sh.shelf_label, l.borrower
               FROM copies c JOIN works w ON w.id = c.work_id
               LEFT JOIN shelves sh ON sh.id = c.shelf_id
               LEFT JOIN loans l ON l.copy_id = c.id AND l.returned_on IS NULL
              WHERE c.isbn = ?`,
          )
          .bind(input.isbn)
          .all<CopyHit>()
      ).results ?? [])
    : [];

  const { results: works } = await d
    .prepare(
      `SELECT w.id AS workId, w.title, w.author, w.author_sort, w.section, s.name AS series, w.series_pos AS seriesPos,
              w.cover_id AS coverId, w.cover_url AS coverUrl,
              (SELECT COUNT(*) FROM copies c WHERE c.work_id = w.id) AS copies,
              (SELECT MIN(c.id) FROM copies c WHERE c.work_id = w.id AND c.verified = 0) AS unverifiedCopyId,
              sh.room, sh.case_label, sh.shelf_label, ps.room AS p_room, ps.case_label AS p_case_label, ps.shelf_label AS p_shelf_label
         FROM works w
         LEFT JOIN series s ON s.id = w.series_id
         LEFT JOIN copies c1 ON c1.id = (SELECT MIN(id) FROM copies WHERE work_id = w.id)
         LEFT JOIN shelves sh ON sh.id = c1.shelf_id
         LEFT JOIN shelves ps ON ps.id = c1.planned_shelf_id`,
    )
    .all<WorkHit & { author_sort: string | null }>();

  const tk = titleKey(input.title);
  const ln = lastNameKey(input.authorSort);
  const candidates: (WorkHit & { near: number })[] = [];
  for (const w of works) {
    const wt = titleKey(w.title);
    const sameAuthor = !!ln && lastNameKey(w.author_sort) === ln;
    let score = 0;
    let near = 0;
    if (wt === tk) score = sameAuthor || !ln ? 3 : 2;
    else if (sameAuthor && tk.length >= 4 && wt.length >= 4 && (wt.includes(tk) || tk.includes(wt))) score = 1;
    else if (input.title && (near = looseTitleMatch(input.title, w.title))) score = 1; // possible: shown so it can be picked
    if (score) {
      const { author_sort: _, ...hit } = w;
      candidates.push({ ...hit, score, near: near + (sameAuthor ? 1 : 0) });
    }
  }
  candidates.sort((a, b) => b.score - a.score || b.near - a.near || a.title.localeCompare(b.title));
  return { owned, candidates: candidates.slice(0, 6).map(({ near: _, ...c }) => c) };
}

/** Library search for picking a catalog entry by hand: every word must appear in the title, author or series. */
export async function searchWorks(q: string): Promise<WorkHit[]> {
  const words = titleWords(q).concat(q.match(/\b\d+\b/g) ?? []);
  if (!words.length) return [];
  const { results } = await db()
    .prepare(
      `SELECT w.id AS workId, w.title, w.author, w.author_sort, w.section, s.name AS series, w.series_pos AS seriesPos,
              w.cover_id AS coverId, w.cover_url AS coverUrl,
              (SELECT COUNT(*) FROM copies c WHERE c.work_id = w.id) AS copies,
              (SELECT MIN(c.id) FROM copies c WHERE c.work_id = w.id AND c.verified = 0) AS unverifiedCopyId,
              sh.room, sh.case_label, sh.shelf_label, ps.room AS p_room, ps.case_label AS p_case_label, ps.shelf_label AS p_shelf_label
         FROM works w
         LEFT JOIN series s ON s.id = w.series_id
         LEFT JOIN copies c1 ON c1.id = (SELECT MIN(id) FROM copies WHERE work_id = w.id)
         LEFT JOIN shelves sh ON sh.id = c1.shelf_id
         LEFT JOIN shelves ps ON ps.id = c1.planned_shelf_id`,
    )
    .all<WorkHit & { author_sort: string | null }>();
  const hay = (w: { title: string; author_sort: string | null; series: string | null }) =>
    ` ${titleWords(`${w.title} ${w.author_sort ?? ''} ${w.series ?? ''}`).join(' ')} `;
  return results
    .filter((w) => { const h = hay(w); return words.every((x) => h.includes(` ${x}`)); })
    .slice(0, 12)
    .map(({ author_sort: _, ...w }) => ({ ...w, score: 0 }));
}
