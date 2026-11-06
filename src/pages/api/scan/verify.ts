/**
 * POST /api/scan/verify  { copyId, isbn, publisher, year, pages, coverId, coverUrl }
 * Attaches the scanned edition to a catalog copy and marks it verified.
 * Replaces the guessed cover with this edition's, unless you uploaded your own photo.
 */
import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { toIsbn13 } from '@/lib/books';
import { json, num, str } from '@/lib/http';
import { placeText } from '@/lib/format';

export const POST: APIRoute = async ({ request, locals }) => {
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const copyId = num(b.copyId);
  const isbn = toIsbn13(String(b.isbn ?? ''));
  if (!copyId || !isbn) return json({ error: 'Missing copy or ISBN.' }, 400);

  const d = db();
  const copy = await d
    .prepare(
      `SELECT c.work_id, w.cover_url, sh.room, sh.case_label, sh.shelf_label, ps.room AS p_room, ps.case_label AS p_case_label, ps.shelf_label AS p_shelf_label
         FROM copies c JOIN works w ON w.id = c.work_id
         LEFT JOIN shelves sh ON sh.id = c.shelf_id LEFT JOIN shelves ps ON ps.id = c.planned_shelf_id
        WHERE c.id = ?`,
    )
    .bind(copyId)
    .first<{ work_id: number; cover_url: string | null; room: string | null; case_label: string | null; shelf_label: string | null; p_room: string | null; p_case_label: string | null; p_shelf_label: string | null }>();
  if (!copy) return json({ error: 'That copy is no longer in the catalog.' }, 404);

  const ownPhoto = copy.cover_url?.startsWith('/api/cover-image/') ?? false;
  const coverId = num(b.coverId);
  const coverUrl = str(b.coverUrl, 1000);
  const stmts = [
    d.prepare(`UPDATE copies SET isbn = ?, publisher = COALESCE(?, publisher), year = COALESCE(?, year), verified = 1 WHERE id = ?`)
      .bind(isbn, str(b.publisher, 200), num(b.year), copyId),
    d.prepare('INSERT INTO activity (user, action, target) VALUES (?, ?, ?)').bind(locals.user?.name ?? null, 'verify', `copy:${copyId}`),
  ];
  if (!ownPhoto && (coverId || coverUrl)) {
    stmts.push(
      d.prepare(`UPDATE works SET cover_id = ?, cover_url = ?, cover_status = 'verified' WHERE id = ?`).bind(coverId, coverId ? null : coverUrl, copy.work_id),
    );
  }
  await d.batch(stmts);
  return json({
    ok: true,
    workId: copy.work_id,
    now: placeText(copy),
    planned: copy.p_room ? placeText({ room: copy.p_room, case_label: copy.p_case_label, shelf_label: copy.p_shelf_label }) : null,
  });
};
