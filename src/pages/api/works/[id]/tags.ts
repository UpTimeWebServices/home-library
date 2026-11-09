/**
 * POST   /api/works/:id/tags { tag }            add one of our own tags
 * DELETE /api/works/:id/tags { tag, category }  remove a tag (Hardcover ones stay hidden so a re-sync won't bring them back)
 */
import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { json, str } from '@/lib/http';

async function workId(raw: string | undefined): Promise<number | null> {
  const id = Number(raw);
  if (!Number.isInteger(id)) return null;
  return (await db().prepare('SELECT id FROM works WHERE id = ?').bind(id).first()) ? id : null;
}

export const POST: APIRoute = async ({ params, request, locals }) => {
  const id = await workId(params.id);
  if (!id) return json({ error: 'Book not found' }, 404);
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const tag = str(b.tag, 60)?.replace(/\s+/g, ' ');
  if (!tag) return json({ error: 'Type a tag.' }, 400);
  const d = db();
  const who = locals.user?.name ?? null;
  await d.batch([
    // If Hardcover had it and we'd removed it, bring that back too.
    d.prepare('UPDATE work_tags SET hidden = 0 WHERE work_id = ? AND tag = ? AND category <> ?').bind(id, tag, 'ours'),
    d.prepare(`INSERT INTO work_tags (work_id, category, tag, added_by) VALUES (?, 'ours', ?, ?) ON CONFLICT DO NOTHING`).bind(id, tag, who),
    d.prepare('INSERT INTO activity (user, action, target) VALUES (?, ?, ?)').bind(who, 'tag_add', `work:${id}:${tag}`),
  ]);
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ params, request, locals }) => {
  const id = await workId(params.id);
  if (!id) return json({ error: 'Book not found' }, 404);
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const tag = str(b.tag, 60);
  if (!tag) return json({ error: 'Which tag?' }, 400);
  const d = db();
  const who = locals.user?.name ?? null;
  await d.batch([
    d.prepare(`DELETE FROM work_tags WHERE work_id = ? AND tag = ? AND category = 'ours'`).bind(id, tag),
    d.prepare(`UPDATE work_tags SET hidden = 1 WHERE work_id = ? AND tag = ? AND category <> 'ours'`).bind(id, tag),
    d.prepare('INSERT INTO activity (user, action, target) VALUES (?, ?, ?)').bind(who, 'tag_remove', `work:${id}:${tag}`),
  ]);
  return json({ ok: true });
};
