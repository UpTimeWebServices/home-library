/**
 * PATCH  /api/wishlist/:id { title?, author?, notes?, priority? } — edit
 * POST   /api/wishlist/:id { action: 'got' }                       — got it (removes from the list, keeps history)
 * DELETE /api/wishlist/:id                                         — remove
 */
import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { json, num, str } from '@/lib/http';

const idOf = (p: string | undefined) => (Number.isInteger(Number(p)) ? Number(p) : null);

export const PATCH: APIRoute = async ({ params, request }) => {
  const id = idOf(params.id);
  if (!id) return json({ error: 'Bad id' }, 400);
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const sets: string[] = [];
  const vals: unknown[] = [];
  if ('title' in b) {
    const t = str(b.title, 300);
    if (!t) return json({ error: 'Title can’t be empty.' }, 400);
    sets.push('title = ?');
    vals.push(t);
  }
  if ('author' in b) { sets.push('author = ?'); vals.push(str(b.author, 300)); }
  if ('notes' in b) { sets.push('notes = ?'); vals.push(str(b.notes, 2000)); }
  if ('priority' in b) { sets.push('priority = ?'); vals.push(num(b.priority) === 1 ? 1 : 2); }
  if (!sets.length) return json({ ok: true });
  await db().prepare(`UPDATE wishlist SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
  return json({ ok: true });
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  const id = idOf(params.id);
  const b = (await request.json().catch(() => ({}))) as { action?: string };
  if (!id || b.action !== 'got') return json({ error: 'Bad request' }, 400);
  await db().batch([
    db().prepare(`UPDATE wishlist SET fulfilled_at = datetime('now') WHERE id = ?`).bind(id),
    db().prepare('INSERT INTO activity (user, action, target) VALUES (?, ?, ?)').bind(locals.user?.name ?? null, 'wish_got', `wish:${id}`),
  ]);
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const id = idOf(params.id);
  if (!id) return json({ error: 'Bad id' }, 400);
  await db().batch([
    db().prepare('DELETE FROM wishlist WHERE id = ?').bind(id),
    db().prepare('INSERT INTO activity (user, action, target) VALUES (?, ?, ?)').bind(locals.user?.name ?? null, 'wish_remove', `wish:${id}`),
  ]);
  return json({ ok: true });
};
