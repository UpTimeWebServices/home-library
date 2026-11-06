import { env } from 'cloudflare:workers';

export const db = (): D1Database => env.DB;

/**
 * Compact row for the library grid, sent to the browser as JSON.
 * Tuple keeps ~1,400 rows small: [id, title, author, sortTitle, authorSort, section,
 * series, seriesPos, coverId, coverStatus, room, case, shelf, copies, special(0-2), moves(0/1), coverUrl]
 */
export type LibRow = [
  number, string, string | null, string, string | null, string | null,
  string | null, number | null, number | null, string,
  string | null, string | null, string | null, number, number, number,
  string | null,
];

export async function libraryRows(): Promise<LibRow[]> {
  return db()
    .prepare(
      `SELECT w.id, w.title, w.author, w.sort_title, w.author_sort, w.section,
              s.name AS series, w.series_pos, w.cover_id, w.cover_status,
              sh.room, sh.case_label, sh.shelf_label,
              (SELECT COUNT(*) FROM copies c WHERE c.work_id = w.id) AS n,
              (SELECT MAX(CASE c.special WHEN 'confirmed' THEN 2 WHEN 'suspected' THEN 1 ELSE 0 END)
                 FROM copies c WHERE c.work_id = w.id) AS sp,
              (c1.planned_shelf_id IS NOT NULL AND c1.planned_shelf_id <> c1.shelf_id) AS moves,
              w.cover_url
         FROM works w
         LEFT JOIN series s ON s.id = w.series_id
         LEFT JOIN copies c1 ON c1.id = (SELECT MIN(id) FROM copies WHERE work_id = w.id)
         LEFT JOIN shelves sh ON sh.id = c1.shelf_id
        ORDER BY w.author_sort COLLATE NOCASE, s.name, w.series_pos, w.sort_title COLLATE NOCASE`,
    )
    .raw<LibRow>();
}

export interface WorkDetail {
  id: number;
  title: string;
  author: string | null;
  author_sort: string | null;
  section: string | null;
  series_id: number | null;
  series: string | null;
  series_pos: number | null;
  cover_id: number | null;
  cover_status: string;
  cover_url: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface CopyDetail {
  id: number;
  isbn: string | null;
  format: string | null;
  publisher: string | null;
  year: number | null;
  first_edition: number;
  signed: number;
  condition: string | null;
  special: 'none' | 'suspected' | 'confirmed';
  bedroom_flag: number;
  verified: number;
  notes: string | null;
  source: string;
  added_by: string | null;
  room: string | null;
  case_label: string | null;
  shelf_label: string | null;
  p_room: string | null;
  p_case_label: string | null;
  p_shelf_label: string | null;
  borrower: string | null;
  loaned_on: string | null;
}

export async function workDetail(id: number) {
  const d = db();
  const work = await d
    .prepare(
      `SELECT w.*, s.name AS series FROM works w LEFT JOIN series s ON s.id = w.series_id WHERE w.id = ?`,
    )
    .bind(id)
    .first<WorkDetail>();
  if (!work) return null;
  const [copies, siblings] = await d.batch([
    d.prepare(
      `SELECT c.*, sh.room, sh.case_label, sh.shelf_label,
              ps.room AS p_room, ps.case_label AS p_case_label, ps.shelf_label AS p_shelf_label,
              l.borrower, l.loaned_on
         FROM copies c
         LEFT JOIN shelves sh ON sh.id = c.shelf_id
         LEFT JOIN shelves ps ON ps.id = c.planned_shelf_id
         LEFT JOIN loans l ON l.copy_id = c.id AND l.returned_on IS NULL
        WHERE c.work_id = ? ORDER BY c.id`,
    ).bind(id),
    d.prepare(
      `SELECT id, title, series_pos, cover_id, cover_url, section FROM works
        WHERE series_id = ? ORDER BY series_pos IS NULL, series_pos, sort_title`,
    ).bind(work.series_id ?? -1),
  ]);
  return {
    work,
    copies: (copies?.results ?? []) as unknown as CopyDetail[],
    siblings: (siblings?.results ?? []) as unknown as { id: number; title: string; series_pos: number | null; cover_id: number | null; cover_url: string | null; section: string | null }[],
  };
}
