/** POST /api/series/entry/:id { dismissed: boolean } — not interested in one book of a series (or undo). */
import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { json } from '@/lib/http';

export const POST: APIRoute = async ({ params, request, locals }) => {
  const id = Number(params.id);
  const { dismissed } = (await request.json().catch(() => ({}))) as { dismissed?: boolean };
  if (!Number.isInteger(id) || typeof dismissed !== 'boolean') return json({ error: 'Bad request' }, 400);
  const user = locals.user?.name ?? null;
  await db()
    .prepare(`UPDATE series_entries SET dismissed = ?, dismissed_by = ?, dismissed_at = CASE WHEN ? THEN datetime('now') END WHERE id = ?`)
    .bind(dismissed ? 1 : 0, dismissed ? user : null, dismissed ? 1 : 0, id)
    .run();
  return json({ ok: true });
};
