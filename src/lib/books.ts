/** Book helpers shared by the scan APIs: ISBNs, names, title matching, section suggestions. */

/** Normalise a scanned/typed code to ISBN-13, or null if it isn't a valid ISBN. */
export function toIsbn13(raw: string): string | null {
  const s = raw.replace(/[^0-9Xx]/g, '').toUpperCase();
  if (s.length === 13 && /^97[89]\d{10}$/.test(s)) {
    const sum = [...s.slice(0, 12)].reduce((a, d, i) => a + Number(d) * (i % 2 ? 3 : 1), 0);
    return (10 - (sum % 10)) % 10 === Number(s[12]) ? s : null;
  }
  if (s.length === 10 && /^\d{9}[\dX]$/.test(s)) {
    const sum10 = [...s].reduce((a, d, i) => a + (d === 'X' ? 10 : Number(d)) * (10 - i), 0);
    if (sum10 % 11 !== 0) return null;
    const core = `978${s.slice(0, 9)}`;
    const sum = [...core].reduce((a, d, i) => a + Number(d) * (i % 2 ? 3 : 1), 0);
    return core + ((10 - (sum % 10)) % 10);
  }
  return null;
}

const SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv|phd|md)$/i;

/** "Neil Gaiman" -> "Gaiman, Neil"; leaves "Gaiman, Neil" and single names alone. */
export function toAuthorSort(name: string): string {
  const n = name.trim().replace(/\s+/g, ' ');
  if (!n || n.includes(',')) return n;
  const parts = n.split(' ');
  if (parts.length === 1) return n;
  let suffix = '';
  if (parts.length > 2 && SUFFIX.test(parts.at(-1)!)) suffix = ` ${parts.pop()}`;
  const last = parts.pop()!;
  return `${last}, ${parts.join(' ')}${suffix}`;
}

/** "Gaiman, Neil; Pratchett, Terry" -> "Neil Gaiman & Terry Pratchett" (same rule as the importer). */
export function displayAuthor(authorSort: string | null): string | null {
  if (!authorSort) return null;
  return authorSort
    .split(';')
    .map((p) => {
      const m = p.trim().match(/^([^,]+),\s*(.+?)(\s*\(ed\.\))?$/);
      return m ? `${m[2]} ${m[1]}${m[3] ?? ''}` : p.trim();
    })
    .join(' & ');
}

export const sortTitle = (t: string): string => t.replace(/^(the|a|an)\s+/i, '');

/** Loose key for matching titles across editions: no subtitle, articles, punctuation or accents. */
export function titleKey(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*[:(\[].*$/, '')
    .replace(/^(the|a|an)\s+/, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** First author's last name, lowercased, for matching. */
export function lastNameKey(authorSort: string | null): string {
  const first = (authorSort ?? '').split(';')[0] ?? '';
  return titleKey(first.split(',')[0] ?? '');
}

/** Section guesses from subject headings, in the catalog's rule order (first match wins). */
const SUBJECT_RULES: [RegExp, string][] = [
  [/\b(tarot|witch|wicca|magic(k)?\b|spell|crystal|herbal|herbalism|astrolog|mytholog|folklore|occult|pagan)/, 'Witchy (Parlor)'],
  [/\b(comic|graphic novel|manga)/, 'Graphic Novels/Manga'],
  [/\b(young adult|teen|ya fiction)/, 'YA'],
  [/\b(picture book|juvenile|children)/, "Children's"],
  [/\bpoe(try|ms)\b/, 'Poetry'],
  [/\b(cook|recipe|baking|food)/, 'Cooking'],
  [/\b(art|painting|photograph|drawing|design)\b/, 'Art'],
  [/\b(romance|love stories)/, 'Romance'],
  [/\b(mystery|thriller|crime|detective|suspense)/, 'Mystery/Thriller'],
  [/\b(fantasy|science fiction|horror|dystopia)/, 'Sci-fi/Fantasy'],
  [/\b(bible|christian|judaism|jewish|church)/, 'Religious Studies'],
  [/\b(numismatic|coins?|collecting|role playing|dungeons)/, 'Hobbies/Collecting'],
  [/\bfiction\b/, 'Fiction'],
];

export function sectionFromSubjects(subjects: string[]): string | null {
  const text = subjects.join(' | ').toLowerCase();
  if (!text) return null;
  const fiction = /\bfiction\b/.test(text);
  for (const [re, section] of SUBJECT_RULES) {
    // Witch fiction stays in its genre; only witchy nonfiction goes to the Parlor.
    if (section === 'Witchy (Parlor)' && fiction) continue;
    if (re.test(text)) return section;
  }
  return 'Nonfiction';
}
