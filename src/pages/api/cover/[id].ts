/**
 * /api/cover/:workId
 *   GET    — find a cover for a catalog row that doesn't have one yet (below)
 *   POST   — upload your own cover photo; DELETE — remove it
 *
 * GET:
 *
 * Imported rows have no ISBN, so this searches Open Library by title + first author and stores
 * the first result's cover id (status "found"; unverified until the book is scanned).
 * No result → status "none" so we never look it up again. Network errors leave it "pending".
 * The browser then loads covers.openlibrary.org/b/id/<id>-M.jpg directly (ID lookups aren't rate limited).
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { db } from '@/lib/db';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, max-age=86400' },
  });

const UA = 'HomeLibrary/0.1 (private home catalog)';

function firstAuthor(authorSort: string | null): string | null {
  if (!authorSort) return null;
  const first = authorSort.split(';')[0]?.replace(/\(ed\.\)/, '').trim() ?? '';
  const m = first.match(/^([^,]+),\s*(.+)$/);
  return m ? `${m[2]} ${m[1]}` : first || null;
}

export const GET: APIRoute = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return json({ error: 'Bad id' }, 400);

  const work = await db()
    .prepare('SELECT title, author_sort, cover_id, cover_status FROM works WHERE id = ?')
    .bind(id)
    .first<{ title: string; author_sort: string | null; cover_id: number | null; cover_status: string }>();
  if (!work) return json({ error: 'Not found' }, 404);
  if (work.cover_status !== 'pending') return json({ coverId: work.cover_id, status: work.cover_status });

  const url = new URL('https://openlibrary.org/search.json');
  url.searchParams.set('title', work.title.replace(/\s*\(.*?\)\s*/g, ' ').trim());
  const author = firstAuthor(work.author_sort);
  if (author) url.searchParams.set('author', author);
  url.searchParams.set('fields', 'key,cover_i');
  url.searchParams.set('limit', '5');

  let docs: { key?: string; cover_i?: number }[];
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    if (!res.ok) return json({ coverId: null, status: 'pending' }, 503);
    docs = ((await res.json()) as { docs?: typeof docs }).docs ?? [];
  } catch {
    return json({ coverId: null, status: 'pending' }, 503);
  }

  const hit = docs.find((d) => d.cover_i) ?? null;
  const coverId = hit?.cover_i ?? null;
  const status = coverId ? 'found' : 'none';
  await db()
    .prepare("UPDATE works SET cover_id = ?, cover_status = ?, ol_work_id = COALESCE(ol_work_id, ?) WHERE id = ? AND cover_status = 'pending'")
    .bind(coverId, status, docs[0]?.key ?? null, id)
    .run();
  return json({ coverId, status });
};

/* ───────────── your own cover photos (R2) ───────────── */

const MAX_BYTES = 4 * 1024 * 1024;
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Key of an uploaded photo from its stored URL, or null for Open Library covers. */
const ownKey = (url: string | null): string | null => (url?.startsWith('/api/cover-image/') ? url.slice('/api/cover-image/'.length) : null);

/** POST /api/cover/:workId  (multipart: file) — replace the cover with your own photo. */
export const POST: APIRoute = async ({ params, request, locals }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return json({ error: 'Bad id' }, 400);
  const work = await db().prepare('SELECT title, cover_url FROM works WHERE id = ?').bind(id).first<{ title: string; cover_url: string | null }>();
  if (!work) return json({ error: 'Book not found' }, 404);

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return json({ error: 'Choose a photo to upload.' }, 400);
  const ext = TYPES[file.type];
  if (!ext) return json({ error: 'Use a JPEG, PNG or WebP photo.' }, 415);
  if (file.size > MAX_BYTES) return json({ error: 'That photo is over 4 MB. Try a smaller one.' }, 413);

  const key = `covers/${id}-${Date.now()}.${ext}`;
  await env.COVERS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  const url = `/api/cover-image/${key}`;
  await db().batch([
    db().prepare("UPDATE works SET cover_url = ?, cover_status = 'verified' WHERE id = ?").bind(url, id),
    db().prepare('INSERT INTO activity (user, action, target) VALUES (?, ?, ?)').bind(locals.user?.name ?? null, 'cover_upload', `work:${id}`),
  ]);
  const old = ownKey(work.cover_url);
  if (old) await env.COVERS.delete(old).catch(() => {});
  return json({ coverUrl: url });
};

/** DELETE /api/cover/:workId — remove your photo and go back to the Open Library cover (if any). */
export const DELETE: APIRoute = async ({ params, locals }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return json({ error: 'Bad id' }, 400);
  const work = await db().prepare('SELECT cover_id, cover_url FROM works WHERE id = ?').bind(id).first<{ cover_id: number | null; cover_url: string | null }>();
  if (!work) return json({ error: 'Book not found' }, 404);
  const old = ownKey(work.cover_url);
  if (old) await env.COVERS.delete(old).catch(() => {});
  const status = work.cover_id ? 'found' : 'pending';
  await db().batch([
    db().prepare('UPDATE works SET cover_url = NULL, cover_status = ? WHERE id = ?').bind(status, id),
    db().prepare('INSERT INTO activity (user, action, target) VALUES (?, ?, ?)').bind(locals.user?.name ?? null, 'cover_remove', `work:${id}`),
  ]);
  return json({ coverId: work.cover_id, status });
};
