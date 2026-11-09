/**
 * Worker entry: Astro serves every request; the cron trigger (wrangler.jsonc "triggers")
 * runs the background Hardcover sync.
 */
import astro from '@astrojs/cloudflare/entrypoints/server';
import { backgroundSync } from './lib/background';

export default {
  fetch: astro.fetch,
  async scheduled(_controller: unknown, _env: unknown, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(backgroundSync());
  },
};
