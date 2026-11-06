# Dream House Library

Private catalog app for Aron and Darlene's home library. Astro 7 (SSR) on a Cloudflare Worker, D1 for data, Cloudflare Access for sign-in.

Live at **https://home-library.aron-da0.workers.dev** (Access sign-in required).

## Phase 1 (this release)

- Library: search by title, author or series; filter by section, special editions, duplicates, series, re-file moves; sort by author, title or shelf; cover grid or list.
- Book page: every copy's current location and where it moves in the re-file, flags, notes, other books from the series you own.
- Covers: looked up from Open Library by title + author the first time a book scrolls into view. On any book page you can replace it with your own photo (stored in the `home-library-covers` R2 bucket).

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
