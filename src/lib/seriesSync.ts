/**
 * Pull each owned series' full book list from Hardcover into series_entries.
 * Runs in small batches (Workers allow ~50 outbound requests per call; Hardcover allows 60/min),
 * so the More page calls it repeatedly until nothing is left. Series are re-checked weekly.
 * Only series with books in sections that allow recommendations (not Children's or Manga).
 */
import { db } from './db';
import { lastNameKey, sameTitle, titleKey } from './books';
import { HardcoverError, englishTitles, findSeries, pause, seriesBooks, seriesForIsbn } from './hardcover';

const DUE = `s.status = 'tracking'
  AND EXISTS (SELECT 1 FROM works w JOIN sections sec ON sec.name = w.section WHERE w.series_id = s.id AND sec.recommend = 1)`;
const STALE = `(s.last_checked IS NULL OR s.last_checked < datetime('now', '-7 days'))`;

export async function syncStatus() {
  const r = await db()
    .prepare(
      `SELECT COUNT(*) AS eligible,
              SUM(CASE WHEN s.hardcover_id IS NOT NULL THEN 1 ELSE 0 END) AS matched,
              SUM(CASE WHEN s.last_checked IS NOT NULL AND s.hardcover_id IS NULL THEN 1 ELSE 0 END) AS unmatched,
              SUM(CASE WHEN ${STALE} THEN 1 ELSE 0 END) AS due
         FROM series s WHERE ${DUE}`,
    )
    .first<{ eligible: number; matched: number; unmatched: number; due: number }>();
  return { eligible: r?.eligible ?? 0, matched: r?.matched ?? 0, unmatched: r?.unmatched ?? 0, due: r?.due ?? 0 };
}

export interface SyncResult { series: string; ok: boolean; note: string; entries?: number }

export async function syncBatch(limit = 6): Promise<{ results: SyncResult[]; stopped: boolean; status: Awaited<ReturnType<typeof syncStatus>> }> {
  const d = db();
  const { results: due } = await d
    .prepare(`SELECT s.id, s.name, s.hardcover_id FROM series s WHERE ${DUE} AND ${STALE} ORDER BY s.last_checked IS NOT NULL, s.last_checked, s.name LIMIT ?`)
    .bind(limit)
    .all<{ id: number; name: string; hardcover_id: number | null }>();

  const out: SyncResult[] = [];
  let stopped = false;
  for (const s of due) {
    try {
      out.push(await syncOne(s));
    } catch (e) {
      const note = e instanceof Error ? e.message : 'Unknown error';
      out.push({ series: s.name, ok: false, note });
      // Token, rate-limit, network or query-shape trouble affects every series: leave it due and stop.
      if (!(e instanceof HardcoverError) || /HTTP \d|not set|validation|field|not found in type|unexpected|internal error/i.test(note)) {
        stopped = true;
        break;
      }
      // A query problem specific to this series: note it and move on.
      await d.prepare(`UPDATE series SET last_checked = datetime('now'), sync_note = ? WHERE id = ?`).bind(note.slice(0, 300), s.id).run();
    }
  }
  return { results: out, stopped, status: await syncStatus() };
}

async function syncOne(s: { id: number; name: string; hardcover_id: number | null }): Promise<SyncResult> {
  const d = db();
  const { results: owned } = await d
    .prepare(
      `SELECT w.id, w.title, w.author_sort, w.series_pos, w.hardcover_id,
              (SELECT c.isbn FROM copies c WHERE c.work_id = w.id AND c.isbn IS NOT NULL LIMIT 1) AS isbn
         FROM works w WHERE w.series_id = ?`,
    )
    .bind(s.id)
    .all<{ id: number; title: string; author_sort: string | null; series_pos: number | null; hardcover_id: number | null; isbn: string | null }>();

  // 1. Which Hardcover series is this?
  let hcId = s.hardcover_id;
  if (!hcId) {
    const withIsbn = owned.find((w) => w.isbn);
    if (withIsbn) {
      const hit = await seriesForIsbn(withIsbn.isbn!);
      await pause();
      const want = titleKey(s.name);
      hcId = hit?.series.find((x) => titleKey(x.name) === want)?.id ?? hit?.series[0]?.id ?? null;
    }
    if (!hcId) {
      const found = await findSeries(s.name, lastNameKey(owned[0]?.author_sort ?? null) || null);
      await pause();
      hcId = found?.id ?? null;
    }
    if (!hcId) {
      await d.prepare(`UPDATE series SET last_checked = datetime('now'), sync_note = ? WHERE id = ?`).bind('Not found on Hardcover', s.id).run();
      return { series: s.name, ok: false, note: 'Not found on Hardcover' };
    }
  }

  // 2. Its books.
  const list = await seriesBooks(hcId);
  await pause();
  if (!list) {
    await d.prepare(`UPDATE series SET hardcover_id = NULL, last_checked = datetime('now'), sync_note = ? WHERE id = ?`).bind('Hardcover series disappeared', s.id).run();
    return { series: s.name, ok: false, note: 'Hardcover series disappeared' };
  }

  // English edition titles where Hardcover's own title is in another language. A failure here
  // only costs the nicer titles, never the sync.
  let english = new Map<number, string>();
  try {
    english = await englishTitles(list.entries.map((e) => e.bookId));
    await pause();
  } catch {
    /* keep Hardcover's titles */
  }
  for (const e of list.entries) {
    const en = english.get(e.bookId);
    if (en && en !== e.title) {
      e.originalTitle = e.title;
      e.title = en;
    }
  }

  const stmts = list.entries.map((e) =>
    d.prepare(
      `INSERT INTO series_entries (series_id, position, title, original_title, release_date, hardcover_book_id) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(series_id, hardcover_book_id) DO UPDATE SET position = excluded.position, title = excluded.title,
         original_title = excluded.original_title, release_date = excluded.release_date`,
    ).bind(s.id, e.position, e.title, e.originalTitle ?? null, e.releaseDate, e.bookId),
  );
  const keep = list.entries.map((e) => e.bookId);
  stmts.push(
    d.prepare(`DELETE FROM series_entries WHERE series_id = ? AND hardcover_book_id NOT IN (${keep.map(() => '?').join(',') || 'NULL'})`).bind(s.id, ...keep),
    d.prepare(`UPDATE series SET hardcover_id = ?, last_checked = datetime('now'), sync_note = NULL WHERE id = ?`).bind(hcId, s.id),
  );

  // 3. Link the books you own to their Hardcover entries by title. Series numbers alone aren't trusted:
  //    your catalog and Hardcover can number prequels and spin-offs differently, and a wrong link would
  //    hide a book you don't own. A book you own under another title shows as missing; Skip clears it.
  for (const w of owned.filter((x) => !x.hardcover_id)) {
    const m = list.entries.find((e) => sameTitle(e.title, w.title) || (!!e.originalTitle && sameTitle(e.originalTitle, w.title)));
    if (m) stmts.push(d.prepare('UPDATE works SET hardcover_id = ? WHERE id = ?').bind(m.bookId, w.id));
  }
  await d.batch(stmts);
  return { series: s.name, ok: true, note: list.name === s.name ? 'Synced' : `Synced as “${list.name}”`, entries: list.entries.length };
}
