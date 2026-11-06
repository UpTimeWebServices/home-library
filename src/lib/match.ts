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
  const candidates: WorkHit[] = [];
  for (const w of works) {
    const wt = titleKey(w.title);
    const sameAuthor = !!ln && lastNameKey(w.author_sort) === ln;
    let score = 0;
    if (wt === tk) score = sameAuthor || !ln ? 3 : 2;
    else if (sameAuthor && tk.length >= 4 && wt.length >= 4 && (wt.includes(tk) || tk.includes(wt))) score = 1;
    if (score) {
      const { author_sort: _, ...hit } = w;
      candidates.push({ ...hit, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return { owned, candidates: candidates.slice(0, 6) };
}
