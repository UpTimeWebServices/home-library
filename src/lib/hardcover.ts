/**
 * Hardcover GraphQL client (server-side only — the token must never reach a browser).
 * Docs: https://docs.hardcover.app/api/getting-started/
 * Limits: 60 requests/minute, query depth 3, 30 s timeout; tokens expire every Jan 1.
 */
import { env } from 'cloudflare:workers';
import { titleKey } from './books';

const ENDPOINT = 'https://api.hardcover.app/v1/graphql';
const UA = 'DreamHouseLibrary/0.3 (private home catalog; series lookups)';

export class HardcoverError extends Error {}

export const hardcoverConfigured = (): boolean => !!(env as { HARDCOVER_TOKEN?: string }).HARDCOVER_TOKEN?.trim();

function authHeader(): string {
  // Tolerate copy/paste debris: surrounding quotes, line breaks, a doubled "Bearer".
  const t = ((env as { HARDCOVER_TOKEN?: string }).HARDCOVER_TOKEN ?? '')
    .replace(/["'\s]/g, '')        // tokens never contain quotes or whitespace
    .replace(/^(bearer)+/i, '');   // "Bearer" is added back below, once
  if (!t) throw new HardcoverError('HARDCOVER_TOKEN is not set. Run: npx wrangler secret put HARDCOVER_TOKEN');
  return `Bearer ${t}`;
}

export async function hc<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { authorization: authHeader(), 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  if (!res.ok) throw new HardcoverError(`Hardcover HTTP ${res.status}: ${text.slice(0, 200)}`);
  const body = JSON.parse(text) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new HardcoverError(`Hardcover: ${body.errors.map((e) => e.message).join('; ').slice(0, 300)}`);
  return body.data as T;
}

/** Stay under 60 requests/minute when making several calls in a row. */
export const pause = (ms = 1100) => new Promise((r) => setTimeout(r, ms));

export async function me(): Promise<string | null> {
  const d = await hc<{ me: { username: string }[] | { username: string } }>('query { me { username } }');
  const m = Array.isArray(d.me) ? d.me[0] : d.me;
  return m?.username ?? null;
}

export interface HcSeriesRef { id: number; name: string; position: number | null }

/** Series a specific edition belongs to (featured series first). Two small queries to stay within depth 3. */
export async function seriesForIsbn(isbn13: string): Promise<{ bookId: number; series: HcSeriesRef[] } | null> {
  const e = await hc<{ editions: { book_id: number }[] }>(
    'query ($i: String!) { editions(where: {isbn_13: {_eq: $i}}, limit: 1) { book_id } }',
    { i: isbn13 },
  );
  const bookId = e.editions[0]?.book_id;
  if (!bookId) return null;
  const s = await hc<{ book_series: { position: number | null; featured: boolean; series: { id: number; name: string } | null }[] }>(
    `query ($id: Int!) { book_series(where: {book_id: {_eq: $id}}, order_by: {featured: desc}) { position featured series { id name } } }`,
    { id: bookId },
  );
  return {
    bookId,
    series: s.book_series.filter((b) => b.series).map((b) => ({ id: b.series!.id, name: b.series!.name, position: b.position })),
  };
}

interface SearchDoc { id: string | number; name?: string; author_name?: string; books_count?: number }

/** Find a series by name, preferring the one whose author shares the given last name. */
export async function findSeries(name: string, authorLast: string | null): Promise<{ id: number; name: string } | null> {
  const d = await hc<{ search: { results: { hits?: { document: SearchDoc }[] } | null } }>(
    'query ($q: String!) { search(query: $q, query_type: "Series", per_page: 8, page: 1) { results } }',
    { q: name },
  );
  const docs = (d.search.results?.hits ?? []).map((h) => h.document).filter((x) => x?.name && (x.books_count ?? 1) > 0);
  if (!docs.length) return null;
  const want = titleKey(name);
  const authorOk = (doc: SearchDoc) => !authorLast || titleKey(doc.author_name ?? '').split(' ').includes(authorLast);
  const pick =
    docs.find((doc) => titleKey(doc.name!) === want && authorOk(doc)) ??
    docs.find((doc) => titleKey(doc.name!) === want) ??
    docs.find((doc) => authorOk(doc) && (titleKey(doc.name!).includes(want) || want.includes(titleKey(doc.name!))));
  return pick ? { id: Number(pick.id), name: pick.name! } : null;
}

export interface HcEntry { position: number | null; bookId: number; title: string; originalTitle?: string; releaseDate: string | null }

/** Every book in a series: one per position, most-read edition, no merged/partial books or compilations (Hardcover's recipe). */
export async function seriesBooks(seriesId: number): Promise<{ name: string; entries: HcEntry[] } | null> {
  const d = await hc<{ series: { name: string; book_series: { position: number | null; book: { id: number; title: string; release_date: string | null } }[] }[] }>(
    `query ($id: Int!) {
      series(where: {id: {_eq: $id}}) {
        name
        book_series(
          distinct_on: position
          order_by: [{position: asc}, {book: {users_count: desc}}]
          where: {book: {canonical_id: {_is_null: true}, is_partial_book: {_eq: false}}, compilation: {_eq: false}}
        ) { position book { id title release_date } }
      }
    }`,
    { id: seriesId },
  );
  const s = d.series[0];
  if (!s) return null;
  return {
    name: s.name,
    entries: s.book_series.filter((b) => b.book).map((b) => ({ position: b.position, bookId: b.book.id, title: b.book.title, releaseDate: b.book.release_date })),
  };
}

/* ───────────── English titles ─────────────
 * A Hardcover book's own title is often the original-language one ("Panserhjerte").
 * The most-read English edition gives the title you'd see in a US bookstore ("The Leopard").
 */
let englishId: number | null | undefined;

async function englishLanguageId(): Promise<number | null> {
  if (englishId !== undefined) return englishId;
  const tries: [string, (d: unknown) => number | undefined][] = [
    ['query { languages(where: {code2: {_eq: "en"}}, limit: 1) { id } }', (d) => (d as { languages: { id: number }[] }).languages[0]?.id],
    ['query { languages(where: {language: {_eq: "English"}}, limit: 1) { id } }', (d) => (d as { languages: { id: number }[] }).languages[0]?.id],
  ];
  for (const [q, pick] of tries) {
    try {
      const id = pick(await hc(q));
      if (id) return (englishId = id);
    } catch {
      /* try the next shape */
    }
  }
  return (englishId = 1); // Hardcover's English has been id 1
}

/** Tidy edition titles: "The Leopard (Harry Hole, #8)" / "The Leopard: A Harry Hole Novel" -> "The Leopard". */
export function cleanEditionTitle(t: string): string {
  return t
    .replace(/\s*\([^)]*#\s*\d[^)]*\)\s*$/, '')
    .replace(/\s*[:\-–]\s*(an?|the)\s+(new\s+)?[^:]*?\b(novel|thriller|mystery)\b.*$/i, '')
    .replace(/,?\s*book\s+\d+$/i, '')
    .trim();
}

/** English title per Hardcover book id (only books that have an English edition). */
export async function englishTitles(bookIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!bookIds.length) return out;
  const lang = await englishLanguageId();
  if (!lang) return out;
  const d = await hc<{ editions: { book_id: number; title: string | null }[] }>(
    `query ($ids: [Int!], $lang: Int!) {
      editions(
        distinct_on: book_id
        order_by: [{book_id: asc}, {users_count: desc}]
        where: {book_id: {_in: $ids}, language_id: {_eq: $lang}, title: {_is_null: false}}
      ) { book_id title }
    }`,
    { ids: bookIds, lang },
  );
  for (const e of d.editions) if (e.title) out.set(e.book_id, cleanEditionTitle(e.title));
  return out;
}
