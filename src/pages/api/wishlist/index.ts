/** POST /api/wishlist { title, author?, isbn?, notes?, priority?, seriesEntryId?, coverId? } — add to your list. */
import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { toIsbn13 } from '@/lib/books';
import { json, num, str } from '@/lib/http';

export const POST: APIRoute = async ({ request, locals }) => {
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const title = str(b.title, 300);
  if (!title) return json({ error: 'Add a title.' }, 400);
  const user = locals.user?.name ?? null;
  const row = await db()
    .prepare(
      `INSERT INTO wishlist (title, author, isbn, notes, priority, added_by, series_entry_id, cover_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(title, str(b.author, 300), b.isbn ? toIsbn13(String(b.isbn)) : null, str(b.notes, 2000), num(b.priority) === 1 ? 1 : 2, user, num(b.seriesEntryId), num(b.coverId))
    .first<{ id: number }>();
  await db().prepare('INSERT INTO activity (user, action, target) VALUES (?, ?, ?)').bind(user, 'wish_add', `wish:${row!.id}`).run();
  return json({ id: row!.id });
};
