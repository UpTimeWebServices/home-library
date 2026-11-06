/**
 * PATCH /api/works/:id { title?, authorSort?, section?, series?, seriesPos?, notes? }
 * Edit a book's details (e.g. fill in a missing author). Shelf locations are left alone.
 */
import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { displayAuthor, sortTitle, toAuthorSort } from '@/lib/books';
import { json, num, str } from '@/lib/http';

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return json({ error: 'Bad id' }, 400);
  const d = db();
  const exists = await d.prepare('SELECT id FROM works WHERE id = ?').bind(id).first();
  if (!exists) return json({ error: 'Book not found' }, 404);
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const sets: string[] = [];
  const vals: unknown[] = [];
  const set = (col: string, v: unknown) => {
    sets.push(`${col} = ?`);
    vals.push(v);
  };

  if ('title' in b) {
    const t = str(b.title, 300);
    if (!t) return json({ error: 'Title can’t be empty.' }, 400);
    set('title', t);
    set('sort_title', sortTitle(t));
  }
  if ('authorSort' in b) {
    // Accept "First Last" too, and tidy separators: "Gaiman, Neil; Pratchett, Terry"
    const a = str(b.authorSort, 300)
      ?.split(';')
      .map((x) => toAuthorSort(x.trim()))   // "Neil Gaiman" -> "Gaiman, Neil"
      .filter(Boolean)
      .join('; ') ?? null;
    set('author_sort', a);
    set('author', displayAuthor(a));
  }
  if ('section' in b) {
    const sec = str(b.section, 60);
    const ok = sec ? await d.prepare('SELECT name FROM sections WHERE name = ?').bind(sec).first() : null;
    if (!ok) return json({ error: 'Pick a section.' }, 400);
    set('section', sec);
  }
  if ('series' in b) {
    const name = str(b.series, 200);
    let seriesId: number | null = null;
    if (name) {
      const row = await d.prepare('INSERT INTO series (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET name = excluded.name RETURNING id').bind(name).first<{ id: number }>();
      seriesId = row?.id ?? null;
    }
    set('series_id', seriesId);
    set('series_pos', seriesId ? num(b.seriesPos) : null);
  } else if ('seriesPos' in b) {
    set('series_pos', num(b.seriesPos));
  }
  if ('notes' in b) set('notes', str(b.notes, 2000));
  if (!sets.length) return json({ ok: true });

  await d.batch([
    d.prepare(`UPDATE works SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id),
    d.prepare('INSERT INTO activity (user, action, target) VALUES (?, ?, ?)').bind(locals.user?.name ?? null, 'edit', `work:${id}`),
  ]);
  return json({ ok: true });
};
