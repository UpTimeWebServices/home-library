/**
 * GET   /api/copies/:id   this copy's edition details
 * PATCH /api/copies/:id { isbn?, special?: 'none'|'suspected'|'confirmed', firstEdition?: bool, signed?: bool, notes?: string }
 *   Typing an ISBN marks the copy verified, so scanning it later finds it straight away.
 * Edition details for one physical copy (two copies of a title can differ). Shelving is unaffected.
 */
import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { json, str } from '@/lib/http';
import { toIsbn13 } from '@/lib/books';

const COLS = 'id, isbn, verified, special, first_edition, signed, notes';

export const GET: APIRoute = async ({ params }) => {
  const row = await db().prepare(`SELECT ${COLS} FROM copies WHERE id = ?`).bind(Number(params.id)).first();
  return row ? json(row) : json({ error: 'Copy not found' }, 404);
};

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const id = Number(params.id);
  const d = db();
  if (!Number.isInteger(id) || !(await d.prepare('SELECT id FROM copies WHERE id = ?').bind(id).first())) return json({ error: 'Copy not found' }, 404);
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const sets: string[] = [];
  const vals: unknown[] = [];
  if ('special' in b) {
    if (!['none', 'suspected', 'confirmed'].includes(String(b.special))) return json({ error: 'Bad special value' }, 400);
    sets.push('special = ?');
    vals.push(b.special);
  }
  if ('firstEdition' in b) { sets.push('first_edition = ?'); vals.push(b.firstEdition ? 1 : 0); }
  if ('signed' in b) { sets.push('signed = ?'); vals.push(b.signed ? 1 : 0); }
  if ('isbn' in b) {
    const raw = str(b.isbn, 40);
    const isbn = raw ? toIsbn13(raw) : null;
    if (raw && !isbn) return json({ error: 'That isn’t a valid ISBN. Check the 10 or 13 digits.' }, 400);
    sets.push('isbn = ?', 'verified = ?');
    vals.push(isbn, isbn ? 1 : 0);
  }
  if ('notes' in b) { sets.push('notes = ?'); vals.push(str(b.notes, 1000)); }
  if (!sets.length) return json({ ok: true });
  const [, , row] = await d.batch([
    d.prepare(`UPDATE copies SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id),
    d.prepare('INSERT INTO activity (user, action, target) VALUES (?, ?, ?)').bind(locals.user?.name ?? null, 'copy_edit', `copy:${id}`),
    d.prepare(`SELECT ${COLS} FROM copies WHERE id = ?`).bind(id),
  ]);
  return json(row?.results?.[0] ?? { ok: true });
};
