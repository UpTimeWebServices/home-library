/** POST /api/series/:id { action: 'hide' | 'restore' } — stop (or resume) recommending a series. */
import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { json } from '@/lib/http';

export const POST: APIRoute = async ({ params, request, locals }) => {
  const id = Number(params.id);
  const { action } = (await request.json().catch(() => ({}))) as { action?: string };
  if (!Number.isInteger(id) || (action !== 'hide' && action !== 'restore')) return json({ error: 'Bad request' }, 400);
  const user = locals.user?.name ?? null;
  await db().batch([
    action === 'hide'
      ? db().prepare(`UPDATE series SET status = 'hidden', hidden_by = ?, hidden_at = datetime('now') WHERE id = ?`).bind(user, id)
      : db().prepare(`UPDATE series SET status = 'tracking', hidden_by = NULL, hidden_at = NULL WHERE id = ?`).bind(id),
    db().prepare('INSERT INTO activity (user, action, target) VALUES (?, ?, ?)').bind(user, `series_${action}`, `series:${id}`),
  ]);
  return json({ ok: true });
};
