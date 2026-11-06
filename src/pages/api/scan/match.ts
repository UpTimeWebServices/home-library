/** GET /api/scan/match?title=&author=  → { owned: [], candidates } — for title-search results. */
import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { json } from '@/lib/http';
import { lastNameKey, sectionFromSubjects } from '@/lib/books';
import { matchBook } from '@/lib/match';

export const GET: APIRoute = async ({ url }) => {
  const title = url.searchParams.get('title') ?? '';
  const authorSort = url.searchParams.get('author') || null;
  const isbn = url.searchParams.get('isbn') || null;
  const subjects = url.searchParams.getAll('subject');
  const match = await matchBook({ isbn, title, authorSort });
  let suggestedSection: string | null = null;
  if (authorSort && lastNameKey(authorSort)) {
    const first = authorSort.split(';')[0]!.trim();
    const row = await db()
      .prepare(`SELECT section, COUNT(*) AS n FROM works WHERE author_sort LIKE ? GROUP BY section ORDER BY n DESC LIMIT 1`)
      .bind(`${first}%`)
      .first<{ section: string }>();
    suggestedSection = row?.section ?? null;
  }
  return json({ ...match, suggestedSection: suggestedSection ?? sectionFromSubjects(subjects) });
};
