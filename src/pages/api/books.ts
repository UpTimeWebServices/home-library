/**
 * POST /api/books — add a book you own (new title, or another copy of one you have).
 * Body: { workId?, title, authorSort, section, series?, seriesPos?, isbn?, publisher?, year?, pages?,
 *         coverId?, coverUrl?, firstEdition?, signed?, notes?, location: 'shelf' | 'stack' }
 */
import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { displayAuthor, sortTitle, toIsbn13 } from '@/lib/books';
import { json, num, str } from '@/lib/http';
import { placeBook } from '@/lib/filing';

export const POST: APIRoute = async ({ request, locals }) => {
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const d = db();
  const user = locals.user?.name ?? null;
  const isbn = b.isbn ? toIsbn13(String(b.isbn)) : null;

  let workId = num(b.workId);
  let section: string | null;
  let title: string;
  let authorSort: string | null;
  let series: string | null = null;
  let seriesPos: number | null = null;

  if (workId) {
    const w = await d
      .prepare('SELECT w.title, w.author_sort, w.section, s.name AS series, w.series_pos FROM works w LEFT JOIN series s ON s.id = w.series_id WHERE w.id = ?')
      .bind(workId)
      .first<{ title: string; author_sort: string | null; section: string | null; series: string | null; series_pos: number | null }>();
    if (!w) return json({ error: 'That book is no longer in the catalog.' }, 404);
    ({ title, section } = w);
    authorSort = w.author_sort;
    series = w.series;
    seriesPos = w.series_pos;
  } else {
    title = str(b.title, 300) ?? '';
    section = str(b.section, 60);
    authorSort = str(b.authorSort, 300);
    series = str(b.series, 200);
    seriesPos = num(b.seriesPos);
    if (!title) return json({ error: 'Add a title.' }, 400);
    const sec = section ? await d.prepare('SELECT name FROM sections WHERE name = ?').bind(section).first() : null;
    if (!sec) return json({ error: 'Pick a section.' }, 400);

    let seriesId: number | null = null;
    if (series) {
      const row = await d.prepare('INSERT INTO series (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET name = excluded.name RETURNING id').bind(series).first<{ id: number }>();
      seriesId = row?.id ?? null;
    }
    const coverId = num(b.coverId);
    const coverUrl = coverId ? null : str(b.coverUrl, 1000);
    const created = await d
      .prepare(
        `INSERT INTO works (title, sort_title, author, author_sort, series_id, series_pos, section, cover_id, cover_url, cover_status, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?) RETURNING id`,
      )
      .bind(title, sortTitle(title), displayAuthor(authorSort), authorSort, seriesId, seriesPos, section, coverId, coverUrl,
        coverId || coverUrl ? 'verified' : 'pending', user)
      .first<{ id: number }>();
    workId = created!.id;
  }

  const placement = await placeBook({ section: section ?? 'Nonfiction', title, authorSort, series, seriesPos, pages: num(b.pages), workId: num(b.workId) });
  const plannedShelf = placement.shelfId;
  const shelfId = b.location === 'stack' ? placement.stackShelfId : plannedShelf;

  const copy = await d
    .prepare(
      `INSERT INTO copies (work_id, isbn, publisher, year, shelf_id, planned_shelf_id, first_edition, signed, notes, verified, source, added_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(workId, isbn, str(b.publisher, 200), num(b.year), shelfId, plannedShelf, b.firstEdition ? 1 : 0, b.signed ? 1 : 0,
      str(b.notes, 2000), isbn ? 1 : 0, isbn ? 'scan' : 'manual', user)
    .first<{ id: number }>();
  await d.prepare('INSERT INTO activity (user, action, target) VALUES (?, ?, ?)').bind(user, 'add', `copy:${copy!.id}`).run();

  return json({ workId, copyId: copy!.id, placement, onStack: b.location === 'stack' });
};
