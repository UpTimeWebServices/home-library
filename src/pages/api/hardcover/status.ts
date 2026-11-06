/** GET /api/hardcover/status — is the token set and working, and how far the series sync has got. */
import type { APIRoute } from 'astro';
import { json } from '@/lib/http';
import { hardcoverConfigured, me } from '@/lib/hardcover';
import { syncStatus } from '@/lib/seriesSync';

export const GET: APIRoute = async () => {
  const sync = await syncStatus();
  if (!hardcoverConfigured()) return json({ configured: false, user: null, error: 'Token not set', sync });
  try {
    return json({ configured: true, user: await me(), error: null, sync });
  } catch (e) {
    return json({ configured: true, user: null, error: e instanceof Error ? e.message : String(e), sync });
  }
};
