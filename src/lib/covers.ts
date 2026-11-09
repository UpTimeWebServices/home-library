/**
 * Find a cover for a book, best source first:
 *   1. its scanned/typed ISBNs: Open Library, then Google Books, then Hardcover (status "verified")
 *   2. the Hardcover book the genre sync matched (status "found")
 *   3. an Open Library title + author search (status "found")
 * Your own uploaded photo is never replaced.
 */
import { db } from './db';
import { lookupIsbn } from './lookup';
import { hardcoverConfigured, hcCoverForBook, hcCoverForIsbn } from './hardcover';

const UA = 'HomeLibrary/0.3 (private home catalog)';

export interface CoverResult { coverId: number | null; coverUrl: string | null; status: string; source: string | null }

const authorName = (authorSort: string | null): string | null => {
  const first = authorSort?.split(';')[0]?.replace(/\(ed\.\)/, '').trim() ?? '';
  const m = first.match(/^([^,]+),\s*(.+)$/);
  return m ? `${m[2]} ${m[1]}` : first || null;
};

async function olTitleSearch(title: string, authorSort: string | null): Promise<number | null> {
  const url = new URL('https://openlibrary.org/search.json');
  url.searchParams.set('title', title.replace(/\s*\(.*?\)\s*/g, ' ').trim());
  const a = authorName(authorSort);
  if (a) url.searchParams.set('author', a);
  url.searchParams.set('fields', 'cover_i');
  url.searchParams.set('limit', '5');
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    if (!res.ok) return null;
    const docs = ((await res.json()) as { docs?: { cover_i?: number }[] }).docs ?? [];
    return docs.find((d) => d.cover_i)?.cover_i ?? null;
  } catch {
    return null;
  }
}

export async function refreshCover(workId: number): Promise<CoverResult | null> {
  const d = db();
  const work = await d
    .prepare(
      `SELECT w.title, w.author_sort, w.cover_id, w.cover_url, w.cover_status, ts.hc_book_id
         FROM works w LEFT JOIN tag_sync ts ON ts.work_id = w.id AND ts.status IN ('matched','confirmed')
        WHERE w.id = ?`,
    )
    .bind(workId)
    .first<{ title: string; author_sort: string | null; cover_id: number | null; cover_url: string | null; cover_status: string; hc_book_id: number | null }>();
  if (!work) return null;
  if (work.cover_url?.startsWith('/api/cover-image/')) {
    return { coverId: null, coverUrl: work.cover_url, status: work.cover_status, source: 'your photo' };
  }
  const { results: isbns } = await d
    .prepare('SELECT DISTINCT isbn FROM copies WHERE work_id = ? AND isbn IS NOT NULL')
    .bind(workId)
    .all<{ isbn: string }>();

  let r: CoverResult | null = null;
  for (const { isbn } of isbns) {
    const f = await lookupIsbn(isbn);
    if (f?.coverId || f?.coverUrl) {
      r = { coverId: f.coverId, coverUrl: f.coverId ? null : f.coverUrl, status: 'verified', source: f.coverId ? 'Open Library' : 'Google Books' };
      break;
    }
    if (hardcoverConfigured()) {
      const url = await hcCoverForIsbn(isbn).catch(() => null);
      if (url) { r = { coverId: null, coverUrl: url, status: 'verified', source: 'Hardcover' }; break; }
    }
  }
  if (!r && work.hc_book_id && hardcoverConfigured()) {
    const url = await hcCoverForBook(work.hc_book_id).catch(() => null);
    if (url) r = { coverId: null, coverUrl: url, status: 'found', source: 'Hardcover' };
  }
  if (!r) {
    const id = await olTitleSearch(work.title, work.author_sort);
    if (id) r = { coverId: id, coverUrl: null, status: 'found', source: 'Open Library' };
  }
  if (!r) return { coverId: work.cover_id, coverUrl: work.cover_url, status: work.cover_status, source: null };

  await d.prepare('UPDATE works SET cover_id = ?, cover_url = ?, cover_status = ? WHERE id = ?').bind(r.coverId, r.coverUrl, r.status, workId).run();
  return r;
}
