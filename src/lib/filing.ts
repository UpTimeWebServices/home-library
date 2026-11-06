/**
 * Where does a book go? Uses the PLANNED layout (the re-file plan from the Destination Map):
 * each section's shelves in order, books by author last name, then series in reading order, then title.
 *
 * 1. Find the slot between the two planned neighbours (or beside other copies of the same title).
 * 2. Check space: shelf width vs. inches already planned there (section's inches-per-book,
 *    or an estimate from page count for the new book).
 * 3. If that shelf is full, try the neighbouring shelf on the other side of the slot;
 *    if both are full, recommend the guest room stack.
 */
import { db } from './db';
import { placeText, type Place } from './format';
import { sortTitle as stripArticle } from './books';

export interface Neighbour { id: number; title: string; author: string | null }

export interface Placement {
  shelfId: number | null;
  place: Place | null;
  placeText: string;
  before: Neighbour | null;   // book just before the slot
  after: Neighbour | null;    // book just after the slot
  usedIn: number | null;
  widthIn: number | null;
  full: boolean;
  stackShelfId: number | null;
  note: string;
}

export interface PlaceInput {
  section: string;
  authorSort: string | null;
  title: string;
  series: string | null;
  seriesPos: number | null;
  pages?: number | null;
  workId?: number | null;
}

interface Row {
  work_id: number;
  title: string;
  sort_title: string;
  author: string | null;
  author_sort: string | null;
  series: string | null;
  series_pos: number | null;
  section: string | null;
  shelf_id: number;
  sort_order: number;
  room: string;
  case_label: string;
  shelf_label: string;
  width_in: number;
  ipb: number;
}

const fold = (s: string | null) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

type Key = [string, string, number, string];
const keyOf = (author: string | null, title: string, series: string | null, pos: number | null): Key => [
  fold(author) || fold(stripArticle(title)),
  fold(series),
  pos ?? 9999,
  fold(stripArticle(title)),
];
const cmp = (a: Key, b: Key): number =>
  a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]) || a[2] - b[2] || a[3].localeCompare(b[3]);

/** Rough spine width: ~0.0028" per page plus covers, clamped. */
export const estimateWidth = (pages: number | null | undefined, fallback: number): number =>
  pages && pages > 0 ? Math.min(3, Math.max(0.3, pages * 0.0028 + 0.2)) : fallback;

export async function placeBook(input: PlaceInput): Promise<Placement> {
  const d = db();
  const [rowsRes, stackRes, secRes] = await d.batch([
    d.prepare(
      `SELECT w.id AS work_id, w.title, w.sort_title, w.author, w.author_sort, s.name AS series, w.series_pos, w.section,
              sh.id AS shelf_id, sh.sort_order, sh.room, sh.case_label, sh.shelf_label, sh.width_in,
              COALESCE(sec.inches_per_book, 1.1) AS ipb
         FROM copies c
         JOIN works w ON w.id = c.work_id
         JOIN shelves sh ON sh.id = c.planned_shelf_id
         LEFT JOIN series s ON s.id = w.series_id
         LEFT JOIN sections sec ON sec.name = w.section
        WHERE sh.width_in IS NOT NULL`,
    ),
    d.prepare(`SELECT id FROM shelves WHERE is_overflow = 1 ORDER BY sort_order LIMIT 1`),
    d.prepare(`SELECT inches_per_book FROM sections WHERE name = ?`).bind(input.section),
  ]);
  const rows = (rowsRes?.results ?? []) as unknown as Row[];
  const stackShelfId = ((stackRes?.results ?? [])[0] as { id: number } | undefined)?.id ?? null;
  const ipb = ((secRes?.results ?? [])[0] as { inches_per_book: number } | undefined)?.inches_per_book ?? 1.1;
  const width = estimateWidth(input.pages, ipb);

  // inches already planned per shelf
  const used = new Map<number, number>();
  for (const r of rows) used.set(r.shelf_id, (used.get(r.shelf_id) ?? 0) + r.ipb);
  const shelfOf = new Map(rows.map((r) => [r.shelf_id, r]));

  const nb = (r: Row | undefined): Neighbour | null => (r ? { id: r.work_id, title: r.title, author: r.author } : null);
  const result = (shelf: Row | undefined, before: Row | undefined, after: Row | undefined, note = ''): Placement => {
    if (!shelf) {
      return { shelfId: stackShelfId, place: null, placeText: 'Guest Room, dresser stack', before: null, after: null, usedIn: null, widthIn: null, full: false, stackShelfId, note: note || `No shelves are planned for ${input.section} yet.` };
    }
    const u = used.get(shelf.shelf_id) ?? 0;
    const place = { room: shelf.room, case_label: shelf.case_label, shelf_label: shelf.shelf_label };
    const full = u + width > shelf.width_in;
    return {
      shelfId: shelf.shelf_id,
      place,
      placeText: placeText(place),
      before: nb(before),
      after: nb(after),
      usedIn: Math.round(u * 10) / 10,
      widthIn: shelf.width_in,
      full,
      stackShelfId,
      note,
    };
  };

  // Another copy of the same title: shelve it beside the existing one.
  if (input.workId) {
    const same = rows.filter((r) => r.work_id === input.workId).sort((a, b) => a.sort_order - b.sort_order);
    if (same.length) return result(same.at(-1), same.at(-1), undefined, 'Shelve it with your other copy.');
  }

  const inSection = rows
    .filter((r) => r.section === input.section)
    .sort((a, b) => a.sort_order - b.sort_order || cmp(keyOf(a.author_sort, a.title, a.series, a.series_pos), keyOf(b.author_sort, b.title, b.series, b.series_pos)));
  if (!inSection.length) return result(undefined, undefined, undefined);

  const k = keyOf(input.authorSort, input.title, input.series, input.seriesPos);
  const idx = inSection.findIndex((r) => cmp(k, keyOf(r.author_sort, r.title, r.series, r.series_pos)) < 0);
  const before = idx === -1 ? inSection.at(-1) : idx > 0 ? inSection[idx - 1] : undefined;
  const after = idx === -1 ? undefined : inSection[idx];

  const primary = before ?? after!;
  const alt = before && after && after.shelf_id !== before.shelf_id ? after : undefined;
  const first = result(shelfOf.get(primary.shelf_id), before, after);
  if (!first.full) return first;
  if (alt) {
    const second = result(shelfOf.get(alt.shelf_id), before, after, 'The first choice is full; this is the next shelf in order.');
    if (!second.full) return second;
  }
  return { ...first, note: 'This shelf is full. Put it on the guest room stack until books shift or a new case goes in.' };
}
