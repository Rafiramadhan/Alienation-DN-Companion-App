# Alienation DN Card DB

A single-page web app for browsing and filtering **Dragon Nest** monster cards — the stats
each card grants across all five rarity tiers (Magic → Rare → Epic → Unique → Legend),
plus card-pack rarity odds and the card-mastery table.

The data is scraped from the community-maintained Dragon Nest Classic Google Sheet
(its `Card` tab) and **baked into
`index.html`**, so the app is fully self-contained: no server, no database, no internet
required at runtime. Just open the file.

## Features

- **All cards** view (default) — every card and stat line in one searchable table.
- **Stat filter** — pick any of the 20 stats to see which cards give it, ranked by value.
- **Nest filter** and **card-name search**.
- **Sortable columns** — click any header; click a rarity to sort by that tier.
- **Click a card** to expand all of its stats at once.
- **Optional Google Sheet sync** — roster, columns, card collections, guild storage and
  blocklist all round-trip through one sheet (tabs `Roster`, `Columns`, `Cards`, `Storage`,
  `Blocklist`). Needs the Apps Script in `google-apps-script.gs` at **v4** or newer.
- **Card collection modal** — open it from the card button on any Character Details row to
  track which monster cards that character owns and at which rarity (Magic / Rare / Epic /
  Unique / Legend) in the in-game slot order, plus a Power of Mastery tab where you record
  the level of each of the 12 masteries and see what your cards give for that stat before and
  after the bonus.
- **Odds & Mastery** tab — pack draw rates, the Lv.40 box table, and the mastery-level table.

## Project layout

| Path                | What it is                                                        |
|---------------------|------------------------------------------------------------------|
| `index.html`        | The built app (data embedded). **This is what gets deployed.**    |
| `database.csv`      | Flattened copy of the community sheet's `Card` tab (the data source).|
| `src/template.html` | The app markup/JS with a `__DATA__` placeholder for the card data.|
| `build.js`          | Parses `database.csv` and injects it into the template.           |
| `assets/cards/`     | Optional card art for the collection modal (see its README).      |

## Updating the data

```bash
# Re-scrape the latest community sheet and rebuild index.html:
node build.js --fetch

# Or rebuild from the local database.csv without downloading:
node build.js
```

Then commit the updated `index.html` (and `database.csv` if you fetched).

The sheet is shared read-only, so there is no CSV export and its nest headings sit in
merged cells that Google's CSV/gviz endpoints drop. `--fetch` therefore reads the sheet's
HTML grid view and flattens it (colspan/rowspan expanded) into `database.csv`.

A handful of cards are spelled differently in the sheet than in the game client. The app
uses the **in-game name everywhere**, so `build.js` renames them (`NAME_FIX`) right after
parsing; `database.csv` stays a faithful copy of the sheet. That map is also embedded in the
page, so a collection saved under an old name follows the rename.

The collection modal does not use the sheet's order — it lays out the 95 slots of the in-game
Card window from `CARD_ORDER` in `src/template.html`. The four slots nobody has identified
yet read “Monster Card” and can still be tracked.

## Deploying (GitHub Pages)

1. Push this repo to GitHub.
2. **Settings → Pages → Source: `main` / root → Save.**
3. The site goes live at `https://<username>.github.io/Alienation-DN-Card-DB/`.

Because everything lives in `index.html`, any static host works (Cloudflare Pages,
Netlify, etc.) — just serve that one file.
