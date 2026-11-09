/**
 * Genres, moods and tags from Hardcover, for search only (shelving never changes).
 *
 * Each book is found on Hardcover by title + author (or by the Hardcover id the series sync
 * already linked), then its reader tags are copied into work_tags. Runs a few books at a time
 * from the background cron; every book is re-checked every 90 days so tags stay current, and
 * books Hardcover didn't have are retried every 60 days.
 *
 * Match confidence:
 *   matched    title and author both agree
 *   uncertain  title agrees but we have no author, or author agrees and the title only loosely
 *              (tags are applied, and the book is listed on the More page for a yes/no)
 *   confirmed  a person said yes, or linked the right Hardcover book by hand
 *   not_found  nothing close enough; rejected = a person said it's not on Hardcover
 */
import { db } from './db';
import { displayAuthor, lastNameKey, sameTitle, titleKey } from './books';
import { HardcoverError, bookTags, pause, searchBooks, type HcBookHit, type HcTag } from './hardcover';

const DUE = `(ts.work_id IS NULL
  OR (ts.status IN ('matched','uncertain','confirmed') AND ts.checked_at < datetime('now','-90 days'))
  OR (ts.status = 'not_found' AND ts.checked_at < datetime('now','-60 days')))`;

export async function tagStatus() {
  const r = await db()
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN ts.work_id IS NOT NULL THEN 1 ELSE 0 END) AS checked,
              SUM(CASE WHEN ts.status IN ('matched','confirmed') THEN 1 ELSE 0 END) AS matched,
              SUM(CASE WHEN ts.status = 'uncertain' THEN 1 ELSE 0 END) AS uncertain,
              SUM(CASE WHEN ts.status IN ('not_found','rejected') THEN 1 ELSE 0 END) AS missing,
              SUM(CASE WHEN ${DUE} THEN 1 ELSE 0 END) AS due,
              (SELECT COUNT(DISTINCT work_id) FROM work_tags WHERE hidden = 0 AND category <> 'warning') AS tagged
         FROM works w LEFT JOIN tag_sync ts ON ts.work_id = w.id`,
    )
    .first<{ total: number; checked: number; matched: number; uncertain: number; missing: number; due: number; tagged: number }>();
  return {
    total: r?.total ?? 0, checked: r?.checked ?? 0, matched: r?.matched ?? 0, uncertain: r?.uncertain ?? 0,
    missing: r?.missing ?? 0, due: r?.due ?? 0, tagged: r?.tagged ?? 0,
  };
}

interface DueWork { id: number; title: string; author_sort: string | null; hardcover_id: number | null; status: string | null; hc_book_id: number | null }
interface Outcome {
  work: DueWork;
  status: 'matched' | 'uncertain' | 'confirmed' | 'not_found';
  hit: HcBookHit | null;
  hcId: number | null;
  tags: HcTag[] | null; // null = leave the book's tags as they are
  note?: string;
}
export interface TagResult { title: string; status: string; tags: number; note?: string | undefined }

/* ───────────── matching ───────────── */

const searchTitle = (t: string) => t.replace(/\s*[([].*?[)\]]/g, '').trim() || t;

export function judge(w: DueWork, hits: HcBookHit[]): { hit: HcBookHit; status: 'matched' | 'uncertain' } | null {
  const last = lastNameKey(w.author_sort);
  const ours = titleKey(w.title);
  const titles = (h: HcBookHit) => [h.title, h.subtitle ? `${h.title}: ${h.subtitle}` : null, ...h.altTitles].filter((t): t is string => !!t);
  // Same title (subtitles aside), vs one title merely containing the other ("Doctor Sleep (The Shining #2)").
  const exact = (h: HcBookHit) => titles(h).some((t) => titleKey(t) === ours);
  const close = (h: HcBookHit) => titles(h).some((t) => sameTitle(t, w.title));
  const authorOk = (h: HcBookHit) => !!last && h.authors.some((a) => ` ${titleKey(a)} `.includes(` ${last} `));
  const exactFirst = (a: HcBookHit, b: HcBookHit) =>
    Number(titleKey(b.title) === ours) - Number(titleKey(a.title) === ours) || b.usersCount - a.usersCount;

  const sure = hits.filter((h) => exact(h) && authorOk(h)).sort(exactFirst);
  if (sure[0]) return { hit: sure[0], status: 'matched' };
  const nearly = hits.filter((h) => close(h) && (authorOk(h) || !last)).sort(exactFirst);
  if (nearly[0]) return { hit: nearly[0], status: 'uncertain' };
  // Right author, title only loosely the same ("Dune" vs "Dune Messiah" is excluded: one must start the other and share 3+ words or be 10+ chars)
  const loose = hits
    .filter((h) => authorOk(h))
    .filter((h) => {
      const k = titleKey(h.title);
      const shorter = k.length < ours.length ? k : ours;
      return (k.startsWith(ours) || ours.startsWith(k)) && (shorter.length >= 10 || shorter.split(' ').length >= 3);
    })
    .sort(exactFirst);
  if (loose[0]) return { hit: loose[0], status: 'uncertain' };
  return null;
}

async function findOnHardcover(w: DueWork): Promise<Outcome> {
  const first = (w.author_sort ?? '').split(';')[0]?.replace(/\s*\(ed\.\)\s*$/, '') ?? '';
  const name = displayAuthor(first) ?? '';
  const t = searchTitle(w.title);

  let best = judge(w, await searchBooks(name ? `${t} ${name}` : t));
  await pause();
  if (best?.status !== 'matched' && name) {
    // Some searches miss with the author in the query; try the title alone.
    const again = judge(w, await searchBooks(t, 12));
    await pause();
    if (again && (!best || again.status === 'matched')) best = again;
  }
  if (!best) return { work: w, status: 'not_found', hit: null, hcId: null, tags: [], note: 'Not found on Hardcover' };
  return { work: w, status: best.status, hit: best.hit, hcId: best.hit.id, tags: best.hit.tags };
}

/* ───────────── writing ───────────── */

/** Replace a book's Hardcover tags (keeping our own, and keeping the ones we removed hidden). */
export function tagStatements(workId: number, tags: HcTag[]): D1PreparedStatement[] {
  const d = db();
  const out = [d.prepare(`DELETE FROM work_tags WHERE work_id = ? AND category <> 'ours' AND hidden = 0`).bind(workId)];
  for (let i = 0; i < tags.length; i += 20) {
    const chunk = tags.slice(i, i + 20); // D1 allows 100 bound values per statement
    out.push(
      d.prepare(
        `INSERT INTO work_tags (work_id, category, tag, weight) VALUES ${chunk.map(() => '(?, ?, ?, ?)').join(', ')}
         ON CONFLICT(work_id, category, tag) DO UPDATE SET weight = excluded.weight`,
      ).bind(...chunk.flatMap((t) => [workId, t.category, t.tag, t.weight])),
    );
  }
  return out;
}

export function syncRowStatement(
  workId: number,
  s: { status: string; hcId: number | null; slug: string | null; title: string | null; author: string | null; note?: string | null },
): D1PreparedStatement {
  return db()
    .prepare(
      `INSERT INTO tag_sync (work_id, hc_book_id, hc_slug, matched_title, matched_author, status, checked_at, note)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
       ON CONFLICT(work_id) DO UPDATE SET hc_book_id = excluded.hc_book_id,
         hc_slug = COALESCE(excluded.hc_slug, tag_sync.hc_slug), matched_title = COALESCE(excluded.matched_title, tag_sync.matched_title),
         matched_author = COALESCE(excluded.matched_author, tag_sync.matched_author),
         status = excluded.status, checked_at = excluded.checked_at, note = excluded.note`,
    )
    .bind(workId, s.hcId, s.slug, s.title, s.author, s.status, s.note ?? null);
}

/* ───────────── the batch ───────────── */

export async function tagBatch(limit = 8): Promise<{ results: TagResult[]; stopped: boolean; error?: string | undefined }> {
  const d = db();
  const { results: due } = await d
    .prepare(
      `SELECT w.id, w.title, w.author_sort, w.hardcover_id, ts.status, ts.hc_book_id
         FROM works w LEFT JOIN tag_sync ts ON ts.work_id = w.id
        WHERE ${DUE}
        ORDER BY ts.work_id IS NOT NULL, ts.checked_at, w.id LIMIT ?`,
    )
    .bind(limit)
    .all<DueWork>();
  if (!due.length) return { results: [], stopped: false };

  const outcomes: Outcome[] = [];
  let stopped = false;
  let error: string | undefined;
  try {
    for (const w of due) {
      const known = w.hc_book_id && w.status !== 'not_found' ? w.hc_book_id : w.status ? null : w.hardcover_id;
      if (known) {
        // Already know which Hardcover book it is: just refresh its tags below.
        outcomes.push({ work: w, status: (w.status as Outcome['status']) ?? 'matched', hit: null, hcId: known, tags: null });
      } else {
        outcomes.push(await findOnHardcover(w));
      }
    }
    // Full tag lists (not just the search index's top 5) for everything found, in one request.
    const ids = [...new Set(outcomes.map((o) => o.hcId).filter((x): x is number => !!x))];
    const full = await bookTags(ids);
    await pause();
    for (const o of outcomes) {
      const all = o.hcId ? full?.get(o.hcId) : undefined;
      if (all && all.length) o.tags = all;
    }
    if (!full) {
      // Full lists unavailable: books we only knew by id get the search index's top 5s instead.
      for (const o of outcomes.filter((x) => !x.tags && x.hcId)) {
        const name = displayAuthor((o.work.author_sort ?? '').split(';')[0] ?? '') ?? '';
        const h = (await searchBooks(`${searchTitle(o.work.title)} ${name}`.trim(), 12)).find((x) => x.id === o.hcId);
        await pause();
        if (h) { o.hit = h; o.tags = h.tags; }
      }
    }
  } catch (e) {
    // Token, rate limit or network trouble: save what's done, leave the rest due, try next run.
    error = e instanceof Error ? e.message : String(e);
    stopped = true;
    if (!(e instanceof HardcoverError)) throw e;
  }

  const stmts: D1PreparedStatement[] = [];
  const results: TagResult[] = [];
  // After an error, only save books whose lookup actually finished.
  for (const o of stopped ? outcomes.filter((x) => x.tags !== null) : outcomes) {
    const w = o.work;
    if (o.tags) stmts.push(...tagStatements(w.id, o.tags));
    stmts.push(
      syncRowStatement(w.id, {
        status: o.status,
        hcId: o.hcId,
        slug: o.hit?.slug ?? null,
        title: o.hit ? (o.hit.subtitle ? `${o.hit.title}: ${o.hit.subtitle}` : o.hit.title) : null,
        author: o.hit ? o.hit.authors.slice(0, 2).join(', ') || null : null,
        note: o.note ?? (o.tags && !o.tags.length && o.status !== 'not_found' ? 'No tags on Hardcover yet' : null),
      }),
    );
    // A sure match also tells the wishlist we own this book.
    if (o.hcId && (o.status === 'matched' || o.status === 'confirmed') && !w.hardcover_id) {
      stmts.push(d.prepare('UPDATE works SET hardcover_id = ? WHERE id = ? AND hardcover_id IS NULL').bind(o.hcId, w.id));
    }
    results.push({ title: w.title, status: o.status, tags: o.tags?.filter((t) => t.category !== 'warning').length ?? 0, note: o.note });
  }
  if (stmts.length) await d.batch(stmts);
  return { results, stopped, error };
}
