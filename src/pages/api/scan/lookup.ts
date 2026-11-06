/**
 * GET /api/scan/lookup?isbn=9780...   → { found, suggestedSection, seriesSuggestion, wishlist, owned, candidates }
 * GET /api/scan/lookup?q=title words   → { results: Found[] }   (books without a barcode)
 */
import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { lastNameKey, sectionFromSubjects, titleKey, toIsbn13 } from '@/lib/books';
import { hardcoverConfigured, seriesForIsbn } from '@/lib/hardcover';
import { json } from '@/lib/http';
import { lookupIsbn, searchTitle } from '@/lib/lookup';
import { matchBook } from '@/lib/match';

/** The section this author's other books are in, if any (most common wins). */
async function authorSection(authorSort: string | null): Promise<string | null> {
  const ln = lastNameKey(authorSort);
  if (!ln || !authorSort) return null;
  const first = authorSort.split(';')[0]!.trim();
  const { results } = await db()
    .prepare(`SELECT section, COUNT(*) AS n FROM works WHERE author_sort LIKE ? GROUP BY section ORDER BY n DESC LIMIT 1`)
    .bind(`${first}%`)
    .all<{ section: string; n: number }>();
  return results[0]?.section ?? null;
}

interface SeriesInfo {
  name: string;
  position: number | null;
  /** Set when you own other books in this series but not this one. */
  gap: boolean;
}

/** Series + number from Hardcover, using your existing series name when it's the same series. */
async function seriesInfo(isbn: string): Promise<SeriesInfo | null> {
  if (!hardcoverConfigured()) return null;
  try {
    const hit = await seriesForIsbn(isbn);
    const first = hit?.series[0];
    if (!hit || !first) return null;
    const { results } = await db().prepare('SELECT id, name, hardcover_id FROM series').all<{ id: number; name: string; hardcover_id: number | null }>();
    const mine = results.find((r) => r.hardcover_id === first.id) ?? results.find((r) => titleKey(r.name) === titleKey(first.name));
    let gap = false;
    if (mine) {
      const ownsIt = await db().prepare('SELECT 1 FROM works WHERE hardcover_id = ? LIMIT 1').bind(hit.bookId).first();
      gap = !ownsIt;
    }
    return { name: mine?.name ?? first.name, position: first.position, gap };
  } catch {
    return null; // Hardcover being down never blocks a scan
  }
}

/** Wishlist items for this book (same ISBN or same title). */
async function onWishlist(isbn: string, title: string | null): Promise<{ id: number; notes: string | null; added_by: string | null }[]> {
  const { results } = await db()
    .prepare('SELECT id, title, isbn, notes, added_by FROM wishlist WHERE fulfilled_copy_id IS NULL AND fulfilled_at IS NULL')
    .all<{ id: number; title: string; isbn: string | null; notes: string | null; added_by: string | null }>();
  const tk = title ? titleKey(title) : null;
  return results.filter((w) => w.isbn === isbn || (tk && titleKey(w.title) === tk)).map(({ id, notes, added_by }) => ({ id, notes, added_by }));
}

export const GET: APIRoute = async ({ url }) => {
  const q = url.searchParams.get('q')?.trim();
  if (q) return json({ results: q.length < 2 ? [] : await searchTitle(q) });

  const raw = url.searchParams.get('isbn') ?? '';
  const isbn = toIsbn13(raw);
  if (!isbn) return json({ error: `${raw || 'That'} isn't a book barcode (ISBN). Try the number above the barcode, or search by title.` }, 400);

  const found = await lookupIsbn(isbn);
  const match = await matchBook({ isbn, title: found?.title ?? '', authorSort: found?.authorSort ?? null });
  const suggestedSection = found ? (await authorSection(found.authorSort)) ?? sectionFromSubjects(found.subjects) : null;
  const [series, wishlist] = await Promise.all([seriesInfo(isbn), onWishlist(isbn, found?.title ?? null)]);
  return json({ isbn, found, suggestedSection, seriesSuggestion: series, wishlist, ...match });
};
