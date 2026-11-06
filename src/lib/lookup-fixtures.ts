/** Canned lookups for `astro dev` only (the dev container has no internet). Never bundled in production. */
import type { Found } from './lookup';

const base = { subtitle: null, publisher: 'Test Press', pages: 320, coverId: null, coverUrl: null, source: 'openlibrary' as const };

export const FIXTURES: Record<string, Found> = {
  '9780765346513': { ...base, isbn: '9780765346513', title: 'New Spring', authors: ['Robert Jordan'], authorSort: 'Jordan, Robert', year: 2004, subjects: ['Fantasy fiction'] },
  '9780062255655': { ...base, isbn: '9780062255655', title: 'The Ocean at the End of the Lane', authors: ['Neil Gaiman'], authorSort: 'Gaiman, Neil', year: 2013, subjects: ['Fantasy fiction', 'Fiction'] },
  '9780000000019': { ...base, isbn: '9780000000019', title: 'A Field Guide to Tarot', authors: ['Ada Example'], authorSort: 'Example, Ada', year: 2020, subjects: ['Tarot', 'Divination'] },
};
