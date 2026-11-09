/**
 * POST /api/works/:id/hardcover
 *   { action: 'confirm' }               yes, the Hardcover match is right
 *   { action: 'reject' }                no, this book isn't on Hardcover (drops its Hardcover tags, stops retrying)
 *   { action: 'link', url }             use this Hardcover book instead (hardcover.app/books/<slug>)
 *   { action: 'retry' }                 forget the match and look again on the next background run
 */
import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { json, str } from '@/lib/http';
import { HardcoverError, bookBySlug, hardcoverConfigured } from '@/lib/hardcover';
import { syncRowStatement, tagStatements } from '@/lib/tagSync';

export const POST: APIRoute = async ({ params, request, locals }) => {
  const id = Number(params.id);
  const d = db();
  const work = Number.isInteger(id) ? await d.prepare('SELECT id, hardcover_id FROM works WHERE id = ?').bind(id).first<{ id: number; hardcover_id: number | null }>() : null;
  if (!work) return json({ error: 'Book not found' }, 404);
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const log = (what: string) => d.prepare('INSERT INTO activity (user, action, target) VALUES (?, ?, ?)').bind(locals.user?.name ?? null, `hardcover_${what}`, `work:${id}`);
  const row = await d.prepare('SELECT hc_book_id FROM tag_sync WHERE work_id = ?').bind(id).first<{ hc_book_id: number | null }>();

  switch (b.action) {
    case 'confirm': {
      if (!row?.hc_book_id) return json({ error: 'Nothing to confirm yet.' }, 400);
      await d.batch([
        d.prepare(`UPDATE tag_sync SET status = 'confirmed', note = NULL WHERE work_id = ?`).bind(id),
        d.prepare('UPDATE works SET hardcover_id = ? WHERE id = ? AND hardcover_id IS NULL').bind(row.hc_book_id, id),
        log('confirm'),
      ]);
      return json({ ok: true });
    }
    case 'reject': {
      await d.batch([
        d.prepare(`DELETE FROM work_tags WHERE work_id = ? AND category <> 'ours'`).bind(id),
        syncRowStatement(id, { status: 'rejected', hcId: null, slug: null, title: null, author: null, note: 'Marked not on Hardcover' }),
        // Undo a link this match made (the series sync's own links are left alone).
        d.prepare('UPDATE works SET hardcover_id = NULL WHERE id = ? AND hardcover_id = ?').bind(id, row?.hc_book_id ?? -1),
        log('reject'),
      ]);
      return json({ ok: true });
    }
    case 'retry': {
      await d.batch([d.prepare('DELETE FROM tag_sync WHERE work_id = ?').bind(id), log('retry')]);
      return json({ ok: true });
    }
    case 'link': {
      if (!hardcoverConfigured()) return json({ error: 'Hardcover token is not set.' }, 503);
      const url = str(b.url, 300) ?? '';
      const slug = url.match(/hardcover\.app\/books\/([a-z0-9-]+)/i)?.[1] ?? (/^[a-z0-9-]+$/i.test(url) ? url : null);
      if (!slug) return json({ error: 'Paste a Hardcover book link, like hardcover.app/books/the-leopard.' }, 400);
      let book;
      try {
        book = await bookBySlug(slug.toLowerCase());
      } catch (e) {
        return json({ error: e instanceof HardcoverError ? e.message : 'Hardcover didn’t answer. Try again.' }, 502);
      }
      if (!book) return json({ error: 'Hardcover has no book at that link.' }, 404);
      await d.batch([
        ...tagStatements(id, book.tags),
        syncRowStatement(id, { status: 'confirmed', hcId: book.id, slug: book.slug, title: book.title, author: null, note: book.tags.length ? null : 'No tags on Hardcover yet' }),
        d.prepare('UPDATE works SET hardcover_id = ? WHERE id = ?').bind(book.id, id),
        log('link'),
      ]);
      return json({ ok: true, title: book.title, tags: book.tags.length });
    }
    default:
      return json({ error: 'Unknown action' }, 400);
  }
};
