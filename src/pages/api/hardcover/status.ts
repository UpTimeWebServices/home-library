/** GET /api/hardcover/status — is the token set and working, and how far the series and tag syncs have got. */
import type { APIRoute } from 'astro';
import { json } from '@/lib/http';
import { hardcoverConfigured, me } from '@/lib/hardcover';
import { syncStatus } from '@/lib/seriesSync';
import { tagStatus } from '@/lib/tagSync';

export const GET: APIRoute = async () => {
  const [sync, tags] = await Promise.all([syncStatus(), tagStatus()]);
  if (!hardcoverConfigured()) return json({ configured: false, user: null, error: 'Token not set', sync, tags });
  try {
    return json({ configured: true, user: await me(), error: null, sync, tags });
  } catch (e) {
    return json({ configured: true, user: null, error: e instanceof Error ? e.message : String(e), sync, tags });
  }
};
