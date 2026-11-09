/** GET /api/scan/search?q=  → catalog entries matching every word (title, author, series), for picking one by hand. */
import type { APIRoute } from 'astro';
import { json } from '@/lib/http';
import { searchWorks } from '@/lib/match';

export const GET: APIRoute = async ({ url }) => json({ results: await searchWorks(url.searchParams.get('q') ?? '') });
