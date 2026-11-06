/**
 * Book metadata lookups, run on the Worker (keys and rate limits stay off the phone).
 * Open Library first (no key, good covers), Google Books as the fallback.
 */
import { toAuthorSort, toIsbn13 } from './books';

const UA = 'HomeLibrary/0.2 (private home catalog)';

export interface Found {
  isbn: string | null;
  title: string;
  subtitle: string | null;
  authors: string[];          // display names, "Neil Gaiman"
  authorSort: string | null;  // "Gaiman, Neil; Pratchett, Terry"
  publisher: string | null;
  year: number | null;
  pages: number | null;
  coverId: number | null;     // Open Library cover id
  coverUrl: string | null;    // other source (Google)
  subjects: string[];
  source: 'openlibrary' | 'google';
}

const yearOf = (s: unknown): number | null => {
  const m = String(s ?? '').match(/\b(1[5-9]\d\d|20\d\d)\b/);
  return m ? Number(m[1]) : null;
};

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

interface OlBook {
  title?: string;
  subtitle?: string;
  authors?: { name: string }[];
  publishers?: { name: string }[];
  publish_date?: string;
  number_of_pages?: number;
  cover?: { large?: string; medium?: string };
  subjects?: { name: string }[];
}

async function openLibraryIsbn(isbn: string): Promise<Found | null> {
  const data = await getJson<Record<string, OlBook>>(
    `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&jscmd=data&format=json`,
  );
  const b = data?.[`ISBN:${isbn}`];
  if (!b?.title) return null;
  const authors = (b.authors ?? []).map((a) => a.name);
  const coverMatch = (b.cover?.large ?? b.cover?.medium ?? '').match(/\/b\/id\/(\d+)-/);
  return {
    isbn,
    title: b.title,
    subtitle: b.subtitle ?? null,
    authors,
    authorSort: authors.length ? authors.map(toAuthorSort).join('; ') : null,
    publisher: b.publishers?.[0]?.name ?? null,
    year: yearOf(b.publish_date),
    pages: b.number_of_pages ?? null,
    coverId: coverMatch ? Number(coverMatch[1]) : null,
    coverUrl: null,
    subjects: (b.subjects ?? []).map((s) => s.name).slice(0, 25),
    source: 'openlibrary',
  };
}

interface GVolume {
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    pageCount?: number;
    categories?: string[];
    imageLinks?: { thumbnail?: string };
  };
}

async function googleIsbn(isbn: string): Promise<Found | null> {
  const data = await getJson<{ items?: GVolume[] }>(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
  const v = data?.items?.[0]?.volumeInfo;
  if (!v?.title) return null;
  const authors = v.authors ?? [];
  return {
    isbn,
    title: v.title,
    subtitle: v.subtitle ?? null,
    authors,
    authorSort: authors.length ? authors.map(toAuthorSort).join('; ') : null,
    publisher: v.publisher ?? null,
    year: yearOf(v.publishedDate),
    pages: v.pageCount ?? null,
    coverId: null,
    coverUrl: v.imageLinks?.thumbnail?.replace(/^http:/, 'https:').replace('&edge=curl', '') ?? null,
    subjects: v.categories ?? [],
    source: 'google',
  };
}

/** Look up one ISBN (10 or 13). Fills gaps in the Open Library record from Google Books. */
export async function lookupIsbn(raw: string): Promise<Found | null> {
  const isbn = toIsbn13(raw);
  if (!isbn) return null;
  if (import.meta.env.DEV) {
    const { FIXTURES } = await import('./lookup-fixtures');
    if (FIXTURES[isbn]) return FIXTURES[isbn];
  }
  const [ol, g] = await Promise.all([openLibraryIsbn(isbn), googleIsbn(isbn)]);
  if (!ol) return g;
  if (!g) return ol;
  return {
    ...ol,
    authors: ol.authors.length ? ol.authors : g.authors,
    authorSort: ol.authorSort ?? g.authorSort,
    publisher: ol.publisher ?? g.publisher,
    year: ol.year ?? g.year,
    pages: ol.pages ?? g.pages,
    coverUrl: ol.coverId ? null : g.coverUrl,
    subjects: [...ol.subjects, ...g.subjects],
  };
}

interface OlDoc {
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
  isbn?: string[];
  subject?: string[];
}

/** Title (and optional author) search, for books with no barcode. */
export async function searchTitle(q: string): Promise<Found[]> {
  const url = new URL('https://openlibrary.org/search.json');
  url.searchParams.set('q', q);
  url.searchParams.set('fields', 'title,author_name,first_publish_year,cover_i,isbn,subject');
  url.searchParams.set('limit', '8');
  const data = await getJson<{ docs?: OlDoc[] }>(url.toString());
  return (data?.docs ?? [])
    .filter((d) => d.title)
    .map((d) => {
      const authors = d.author_name ?? [];
      return {
        isbn: (d.isbn ?? []).map((i) => toIsbn13(i)).find(Boolean) ?? null,
        title: d.title!,
        subtitle: null,
        authors,
        authorSort: authors.length ? authors.slice(0, 3).map(toAuthorSort).join('; ') : null,
        publisher: null,
        year: d.first_publish_year ?? null,
        pages: null,
        coverId: d.cover_i ?? null,
        coverUrl: null,
        subjects: (d.subject ?? []).slice(0, 25),
        source: 'openlibrary' as const,
      };
    });
}
