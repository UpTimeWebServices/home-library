/** Shared formatting — imported by server pages and the browser library script. */

export interface Place {
  room: string | null;
  case_label: string | null;
  shelf_label: string | null;
}

const isNum = (s: string | null): boolean => !!s && /^\d+$/.test(s);

/** "Basement, case 6, shelf 2" / "Basement, Overflow 2, left pile" / "Guest Room, dresser stack". */
export function placeText(p: Place | null | undefined): string {
  if (!p || !p.room) return 'Location unknown';
  const parts = [p.room];
  if (p.case_label) parts.push(isNum(p.case_label) ? `case ${p.case_label}` : p.case_label);
  if (p.shelf_label) parts.push(isNum(p.shelf_label) ? `shelf ${p.shelf_label}` : p.shelf_label.toLowerCase());
  return parts.join(', ');
}

export function samePlace(a: Place | null | undefined, b: Place | null | undefined): boolean {
  return !!a && !!b && a.room === b.room && a.case_label === b.case_label && a.shelf_label === b.shelf_label;
}

/** Cloth colour per section, for placeholder covers and section chips. */
export const sectionCloth: Record<string, string> = {
  Fiction: '#3d5a6c',
  'Mystery/Thriller': '#5a2e2e',
  'Sci-fi/Fantasy': '#2f3f66',
  Romance: '#8a3f55',
  YA: '#2f6b62',
  "Children's": '#b06a2c',
  Poetry: '#6b4f7a',
  'Graphic Novels/Manga': '#a23b2a',
  Art: '#7a6a2a',
  'Language Learning': '#2d6a8a',
  'Hobbies/Collecting': '#5f6b2e',
  'Religious Studies': '#4a3f2e',
  Cooking: '#8a5a2a',
  Nonfiction: '#3f4f46',
  'Witchy (Parlor)': '#3b2d4f',
  Bedroom: '#6e2f3a',
};

export const clothFor = (section: string | null): string => (section && sectionCloth[section]) || '#4b5d54';

/** Your own uploaded photo wins; otherwise the Open Library cover, if one was found. */
export const coverUrl = (coverId: number | null, size: 'S' | 'M' | 'L' = 'M', custom: string | null = null): string | null =>
  custom ?? (coverId ? `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg` : null);

export function seriesPos(n: number | null): string {
  if (n === null || n === undefined) return '';
  return `#${n}`;
}
