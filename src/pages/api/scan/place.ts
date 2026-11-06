/** GET /api/scan/place?section=&author=&title=&series=&pos=&pages=&workId= → Placement */
import type { APIRoute } from 'astro';
import { json, num } from '@/lib/http';
import { placeBook } from '@/lib/filing';
import { db } from '@/lib/db';

export const GET: APIRoute = async ({ url }) => {
  const p = url.searchParams;
  const workId = num(p.get('workId'));
  if (workId) {
    // Another copy of a title you own: use that book's own details.
    const w = await db()
      .prepare('SELECT w.title, w.author_sort, w.section, s.name AS series, w.series_pos FROM works w LEFT JOIN series s ON s.id = w.series_id WHERE w.id = ?')
      .bind(workId)
      .first<{ title: string; author_sort: string | null; section: string | null; series: string | null; series_pos: number | null }>();
    if (!w) return json({ error: 'Book not found.' }, 404);
    return json(await placeBook({ section: w.section ?? 'Nonfiction', title: w.title, authorSort: w.author_sort, series: w.series, seriesPos: w.series_pos, pages: num(p.get('pages')), workId }));
  }
  const section = p.get('section');
  const title = p.get('title');
  if (!section || !title) return json({ error: 'Section and title are required.' }, 400);
  return json(
    await placeBook({
      section,
      title,
      authorSort: p.get('author') || null,
      series: p.get('series') || null,
      seriesPos: num(p.get('pos')),
      pages: num(p.get('pages')),
    }),
  );
};
