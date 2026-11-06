# Dream House Library

Private catalog app for Aron and Darlene's home library. Astro 7 (SSR) on a Cloudflare Worker, D1 for data, Cloudflare Access for sign-in.

Live at **https://home-library.aron-da0.workers.dev** (Access sign-in required).

## Phase 1 (this release)

- Library: search by title, author or series; filter by section, special editions, duplicates, series, re-file moves; sort by author, title or shelf; cover grid or list.
- Book page: every copy's current location and where it moves in the re-file, flags, notes, other books from the series you own.
- Covers: looked up from Open Library by title + author the first time a book scrolls into view. On any book page you can replace it with your own photo (stored in the `home-library-covers` R2 bucket).

## Phase 2: Scan

`/scan` has three modes, all using the phone's rear camera (zxing-wasm, works on iPhone and Android) with typed-ISBN and title-search fallbacks:

- **Do we own it?** For bookstores. Owned edition, owned title in another edition, or not in the library. Saves nothing.
- **Add a book.** Looks up the ISBN (Open Library, then Google Books), suggests a section from the author's other books or the subjects, and shows the shelf it belongs on with its neighbours and a space check. Choose "on that shelf now" or "guest room stack for now". Offers "add another copy" when you already own the title.
- **Verify.** Matches a scanned book to its catalog row, attaches the ISBN/edition and the edition's cover (unless you uploaded your own photo), and shows where it lives now and where it moves in the re-file.

Filing uses the planned layout (Destination Map): section shelves in order, author last name, series in reading order, then title.

## Wishlist

`/wishlist` has two tabs:

- **Our list:** books you want, with notes for the edition/printing/condition, top-priority star, and who added it. "We got it" or adding the book with Scan takes it off the list.
- **Missing from series:** published books from series you own (not Children's or Manga), grouped by series and collapsible, most-complete first. **Want** copies a book to Our list; **Skip** drops one book; **Stop recommending** hides a whole series. Everything hidden can be restored from the Hidden section. Novellas, part-volumes and extras (non-whole series numbers) are behind a toggle.

Scan's "Do we own it?" also says when a book is on the wishlist or fills a gap in a series you own, and can add it to the wishlist.

## Hardcover (series data)

Series lists come from the Hardcover GraphQL API (server-side only; 60 requests/minute; tokens expire every January 1).

```bash
npx wrangler secret put HARDCOVER_TOKEN   # paste the token from hardcover.app/account/api
npm run db:migrate                        # adds 0002_hardcover.sql
npm run deploy
```

Then open **More → Sync series now**. Each owned series (except Children's and Graphic Novels/Manga) is matched on Hardcover and its book list stored in `series_entries`; series are re-checked weekly. Scanning a book in Add mode also pre-fills its series and number from Hardcover.

## First deploy (one time)

```bash
npm install
npx wrangler login
npm run db:migrate          # create tables in the remote D1 database
npm run db:seed             # load the catalog (1,380 titles / 1,488 copies)
npm run deploy
```

Then turn on sign-in:

1. Cloudflare dashboard → **Zero Trust** → enable it (free plan) and pick a team name.
2. **Workers & Pages → home-library → Settings → Domains & Routes** → **Enable Cloudflare Access** on workers.dev.
3. **Manage Cloudflare Access** → set the policy to allow `aron@uptimewebservices.com` and `darlenedifrischia@yahoo.com`.
4. Copy the team domain (`<team>.cloudflareaccess.com`) and the application's **AUD tag** into `wrangler.jsonc` → `vars.ACCESS_TEAM_DOMAIN` / `vars.ACCESS_AUD`, then `npm run deploy` again.

Until step 4 is done the app answers 503 on purpose: it never serves the catalog without a verified sign-in.

## Re-importing the catalog

```bash
python3 scripts/import_catalog.py path/to/Home_Library_Catalog.xlsx > db/seed.sql
```

The seed inserts with fixed ids, so re-seeding needs an empty database (drop and re-create, then migrate). Once you start adding books in the app, the app is the source of truth, not the spreadsheet.

## Local development

```bash
npm run db:local   # migrate + seed the local D1
npm run dev        # http://localhost:4321 (sign-in skipped in dev only)
```

## Layout

| Path | What |
| --- | --- |
| `db/migrations/` | D1 schema |
| `scripts/import_catalog.py` | Spreadsheet → `db/seed.sql` |
| `src/middleware.ts`, `src/lib/auth.ts` | Access JWT verification |
| `src/lib/db.ts` | Queries |
| `src/pages/index.astro` | Library (search, filters, grid/list) |
| `src/pages/book/[id].astro` | Book page |
| `src/pages/api/cover/[id].ts` | Cover lookup |
