/**
 * GET /api/scan/lookup?isbn=9780...   → { found, suggestedSection, owned, candidates }
 * GET /api/scan/lookup?q=title words   → { results: Found[] }   (books without a barcode)
 */
import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { lastNameKey, sectionFromSubjects, toIsbn13 } from '@/lib/books';
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

export const GET: APIRoute = async ({ url }) => {
  const q = url.searchParams.get('q')?.trim();
  if (q) return json({ results: q.length < 2 ? [] : await searchTitle(q) });

  const raw = url.searchParams.get('isbn') ?? '';
  const isbn = toIsbn13(raw);
  if (!isbn) return json({ error: `${raw || 'That'} isn't a book barcode (ISBN). Try the number above the barcode, or search by title.` }, 400);

  const found = await lookupIsbn(isbn);
  const match = await matchBook({ isbn, title: found?.title ?? '', authorSort: found?.authorSort ?? null });
  const suggestedSection = found ? (await authorSection(found.authorSort)) ?? sectionFromSubjects(found.subjects) : null;
  return json({ isbn, found, suggestedSection, ...match });
};
