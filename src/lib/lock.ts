/**
 * One Hardcover job at a time. The background cron and the More page's "Sync series now"
 * both take this lock, so together they stay under Hardcover's 60 requests a minute.
 * The lock expires on its own if a run dies part way.
 */
import { db } from './db';

export async function withHardcoverLock<T>(fn: () => Promise<T>, minutes = 3): Promise<{ busy: true } | { busy: false; value: T }> {
  const d = db();
  const got = await d
    .prepare(
      `INSERT INTO app_state (key, value) VALUES ('hc_lock', datetime('now', ?))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE app_state.value < datetime('now')`,
    )
    .bind(`+${minutes} minutes`)
    .run();
  if (!got.meta.changes) return { busy: true };
  try {
    return { busy: false, value: await fn() };
  } finally {
    await d.prepare(`UPDATE app_state SET value = '' WHERE key = 'hc_lock'`).run();
  }
}
