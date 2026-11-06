/** POST /api/series/sync — sync the next few due series from Hardcover. Call repeatedly until status.due is 0. */
import type { APIRoute } from 'astro';
import { json } from '@/lib/http';
import { hardcoverConfigured } from '@/lib/hardcover';
import { syncBatch } from '@/lib/seriesSync';

export const POST: APIRoute = async () => {
  if (!hardcoverConfigured()) return json({ error: 'Hardcover token is not set.' }, 503);
  return json(await syncBatch(6));
};
