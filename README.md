# BDIPS Resource Guide

A free, bilingual (English and Spanish) resource directory for adults living in Better Days Integrated Programs (BDIPS) housing around 84th Street, Los Angeles, CA 90003. Residents search or pick a support area (food, health care, legal help, work, housing, benefits and more), then call or visit a provider directly.

It is built for phones and weak signal: it is one small static site, it opens offline with the last copy it saved, and it has a larger-text button, a Quick exit button and a "Browsing safely" note on sensitive views.

- **Live site (once Pages is on):** https://mwitham-gif.github.io/BDIPS_84th/
- **Status:** see [TODO.md](TODO.md) for what is still missing, and [TRANSFER.md](TRANSFER.md) for moving everything to the BDIPS organization.

## How it works

There is no backend, no build step and no framework. The site is static files.

1. Staff edit a Google Sheet (one listing per row).
2. The sheet is published to the web as CSV.
3. When the page loads, `app.js` fetches that CSV, cleans it and draws the resource cards.
4. If the sheet cannot load, the page says so and asks the visitor to try again later. It never shows demo data.

Nothing a visitor types is stored by the site. Sheet text is treated as data, never as code.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page shell, metadata, Content Security Policy |
| `styles.css` | Design, responsive layout, accessibility states |
| `app.js` | Sheet loading, search, filters, sharing, printing, English and Spanish text. The **CONFIG block at the top** holds the sheet link and the report email |
| `analytics.js` | Optional Google Analytics 4. The **CONFIG block at the top** holds the measurement ID; blank means no analytics at all |
| `sw.js` | Service worker: saves the page and the last good copy of the sheet for offline use |
| `manifest.webmanifest`, `icon-*.png`, `apple-touch-icon.png`, `favicon-32.png` | Install-to-home-screen support |
| `bdips_logo_web.png` | Logo (from bdips.org) |
| `flyer/bdips-qr.svg`, `flyer/bdips-qr.png` | QR code that points at the live site (SVG for print, PNG for documents) |
| `tools/link-checker.gs` | Google Apps Script that checks every website in the sheet monthly and emails a report |
| `tests/check.cjs` | Safety checks, with fixtures in `tests/fixtures/` |
| `.github/workflows/checks.yml` | Runs the checks on every push and pull request |

## The Google Sheet

Row 1 holds these headers. Only `name` is required. Spanish columns fall back to the English text when blank.

`name`, `name_es`, `category`, `description`, `description_es`, `address`, `address_es`, `phone`, `website`, `hours`, `hours_es`, `notes`, `notes_es`, `tags`, `tags_es`

Valid `category` values: Food, Mental, Legal, Benefits, Transportation, Education, Employment, Childcare, Youth, Seniors, Housing, Disability, Medical, Domestic Violence, Veterans, Sobriety, Other.

Rental help and Housing help are one category, `Housing`. A row that still says `Rental` (or `rental assistance`, `eviction`) is shown under Housing help.

Only list services within reach of the 84th Street area (ZIP 90003 and nearby). Do not add listings that identify or single out BDIPS residents.

### Publishing the sheet

1. In the sheet: **File > Share > Publish to web**.
2. Choose the first tab and **Comma-separated values (.csv)**, then **Publish**.
3. Copy the link and paste it into `SHEET_URL` in the CONFIG block at the top of `app.js`.
4. Open a pull request. After it merges, the site shows the sheet.

Edits to the sheet appear on the site within a few minutes without touching the code.

## Deploying

The site is served by GitHub Pages from the `main` branch (Settings > Pages > Deploy from a branch > `main` / root). The repository owner turns this on; it is not done by code. Every change reaches `main` through a pull request.

When a change edits `index.html` together with `app.js` or `styles.css`, raise the `?v=` numbers in `index.html` in the same commit so phones do not keep old copies.

## Analytics (off by default)

The site sends no analytics until `GA_MEASUREMENT_ID` in `analytics.js` is set to BDIPS's own GA4 measurement ID. With it blank, no Google script is loaded and no event is recorded. Sensitive searches (abuse, immigration status, self-harm, sexual or reproductive health, substance use, criminal-justice history, emails and phone numbers) are always reported as `(withheld)`, and shared-link resource names never reach analytics. Never reuse another organization's ID.

## Monthly link check

`tools/link-checker.gs` runs inside the sheet and emails a broken-link report to the address in `REPORT_TO`.

1. Open the sheet, then **Extensions > Apps Script**.
2. Paste in the contents of `tools/link-checker.gs` and save.
3. Select `scheduleMonthlyCheck` and click **Run** once. Approve the permission prompts.
4. To test it, run `checkLinks` by hand.

## Running the checks

```
npm install --no-save playwright@1.56.1
npx playwright install chromium
node tests/check.cjs
```

The test server serves the site under `/BDIPS_84th/`, so keep that path in sync with `tests/check.cjs` if the repository is ever renamed.

## QA checklist before publishing a change

- [ ] `node --check app.js analytics.js sw.js` and `node tests/check.cjs` pass
- [ ] The page opens on a phone-width screen with no sideways scrolling
- [ ] Search finds a listing by name, by need (for example "food") and by address
- [ ] Every support-area tile filters and clears
- [ ] The EN / ES toggle changes all visible text, including the footer and notices
- [ ] Call, website, Share and Report buttons work on a card
- [ ] Domestic Violence view shows Quick exit and the "Browsing safely" note, and Quick exit leaves the site
- [ ] Larger-text (A+) button works and nothing overflows
- [ ] Turn off the network after one visit: the guide still opens and says it is offline
- [ ] With the sheet unavailable, the page shows the "try again later" message and no demo data
- [ ] Print / save as PDF produces a clean sheet with the QR code
- [ ] The QR code on the flyer scans to the live site

## Changing the site address

If the site moves (new organization, custom domain), follow [TRANSFER.md](TRANSFER.md). The QR code must be regenerated and re-scanned whenever the address changes.
