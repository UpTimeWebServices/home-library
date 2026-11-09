/** POST /api/series/sync — sync the next few due series from Hardcover. Call repeatedly until status.due is 0. */
import type { APIRoute } from 'astro';
import { json } from '@/lib/http';
import { hardcoverConfigured } from '@/lib/hardcover';
import { withHardcoverLock } from '@/lib/lock';
import { syncBatch, syncStatus } from '@/lib/seriesSync';

export const POST: APIRoute = async () => {
  if (!hardcoverConfigured()) return json({ error: 'Hardcover token is not set.' }, 503);
  const run = await withHardcoverLock(() => syncBatch(6));
  // The background sync is mid-run: the page waits a moment and asks again.
  if (run.busy) return json({ busy: true, results: [], stopped: false, status: await syncStatus() });
  return json(run.value);
};
