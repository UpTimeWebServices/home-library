/**
 * Background Hardcover work, run every minute by the Worker's cron trigger:
 * genres/moods for books that need them first, then any series due their weekly refresh.
 * Nobody needs to keep a page open. Each run is small (≤ ~20 Hardcover requests).
 */
import { hardcoverConfigured } from './hardcover';
import { withHardcoverLock } from './lock';
import { syncBatch, syncStatus } from './seriesSync';
import { tagBatch, tagStatus } from './tagSync';

export async function backgroundSync(): Promise<void> {
  if (!hardcoverConfigured()) return;
  const run = await withHardcoverLock(async () => {
    if ((await tagStatus()).due > 0) {
      const r = await tagBatch(8);
      return `tags: ${r.results.map((x) => `${x.title} [${x.status}, ${x.tags}]`).join('; ')}${r.error ? ` | stopped: ${r.error}` : ''}`;
    }
    if ((await syncStatus()).due > 0) {
      const r = await syncBatch(3);
      return `series: ${r.results.map((x) => `${x.series} [${x.note}]`).join('; ')}`;
    }
    return null;
  });
  if (!run.busy && run.value) console.log(run.value);
}
