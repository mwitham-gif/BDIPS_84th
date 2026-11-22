# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A resource directory for **Better Days Integrated Programs (BDIPS)**, for adult men and women living in BDIPS transitional housing around 84th Street, Los Angeles, CA 90003. There are no children in the program. Residents include people leaving incarceration, people in recovery, people who were homeless and veterans.

The site must never identify residents, and it must never print labels for them. Do not write words like "inmate", "addict" or "felon" in any visible text. Keep wording respectful and plain.

**Privacy of the address.** The repository is public and some residents may be survivors of domestic violence. Never write a street number or exact street address in any file (README, docs, page text, metadata, tests, fixtures, comments, pull requests). Use only "84th Street, Los Angeles, CA 90003" or "the 84th Street area". The safety checks fail if the old street number appears.

Residents usually arrive by scanning a QR code on a flyer, search or pick a support area, then call or visit a provider directly. Most are on phones, many with weak signal, and many read Spanish.

## How the site works

There is no backend, no build step, no framework and no external fonts. It is static files served by GitHub Pages from `main`.

1. Staff edit a Google Sheet (one listing per row).
2. The sheet is published to the web as CSV.
3. `app.js` fetches that CSV when the page loads, cleans and normalizes the rows, and draws the resource cards.
4. If the sheet cannot load, the page shows an outage message with the contact email. It never falls back to demo data.

### Files

- `index.html` - page shell, metadata, Content Security Policy, static layout
- `styles.css` - design, responsive layout, accessibility states
- `app.js` - sheet loading, CSV parsing, search, filters, sharing, printing, English and Spanish text (`T.en`, `T.es`)
- `analytics.js` - Google Analytics 4 setup and custom events. It is a separate file because the Content Security Policy forbids inline scripts.
- `sw.js` - service worker: caches the page and the last good copy of the sheet so the guide opens offline
- `manifest.webmanifest` and the `icon-*.png` files - install-to-home-screen support
- `flyer/` - QR code (SVG for print, PNG for documents) that points at the live site
- `tools/link-checker.gs` - Google Apps Script that runs inside the sheet, checks every website monthly and emails a report
- `tests/check.cjs` - safety checks, with fixtures in `tests/fixtures/`
- `.github/workflows/checks.yml` - runs the checks on every push and pull request

## Where the data comes from

Everything shown to residents comes from the published Google Sheet. Its link is `SHEET_URL` in the **CONFIG block at the top of `app.js`**. The sheet is published to the web as CSV. With no listings the site shows the "could not load" message, and if `SHEET_URL` is ever blank it makes no request. Never put the sheet's edit link or file ID in the repository; only the published CSV link belongs here.

Sheet columns (row 1 headers): `name`, `name_es`, `category`, `description`, `description_es`, `address`, `address_es`, `phone`, `website`, `hours`, `hours_es`, `notes`, `notes_es`, `tags`, `tags_es`. Only `name` is required. Spanish columns fall back to English when blank.

Valid `category` values: Food, Mental, Legal, Benefits, Transportation, Education, Employment, Childcare, Youth, Seniors, Housing, Disability, Medical, Domestic Violence, Veterans, Sobriety, Other.

Rental help and Housing help are one category, `Housing`. A row that still says `Rental` (or `rental assistance`, `eviction`) is shown under Housing help.

Listings must be specific to the 84th Street area (ZIP 90003 and nearby). They are gathered by BDIPS, never copied from another organization's directory.

## Current state of the owner values

All owner-specific values are in labeled CONFIG blocks (see `TRANSFER.md`):

- `app.js`: `SHEET_URL` (the published CSV link) and `REPORT_EMAIL` (`b.overton@bdips.org`).
- `analytics.js`: `GA_MEASUREMENT_ID` (blank, so **no analytics is sent**).
- `tools/link-checker.gs`: `REPORT_TO` and `GUIDE_URL`.
- Site address: `https://mwitham-gif.github.io/BDIPS_84th/` (canonical, og tags, QR code, link checker).

No contact email is shown to visitors. `TODO.md` lists what is still missing.

## Rules to keep when changing the code

- **Analytics must stay separate and off until BDIPS has its own property.** `GA_MEASUREMENT_ID` in `analytics.js` stays blank until BDIPS creates its own GA4 property. Never reuse another site's ID (`G-FT2K5G6SYR`, `G-S3BPY8ZED8`): mixing them corrupts traffic data. Do not create an analytics property without asking first. With the ID blank, no Google script loads and no event is sent; the tests exercise the event and privacy rules against a made-up stub ID.
- **Keep the Content Security Policy strict.** No inline scripts, inline styles or event handlers in `index.html`. Sheet text is data, never code. Website links are limited to http and https.
- **Privacy.** Sensitive searches (abuse, immigration status, self-harm, sexual or reproductive health, substance use, criminal-justice history, emails, phone numbers) are sent to analytics as `(withheld)`. Shared-link resource names never reach analytics. The Quick exit button and "Browsing safely" note on domestic violence views must keep working.
- **Bump asset versions together.** If a change edits `index.html` and `app.js` (or `styles.css`) together, raise the `?v=` numbers in `index.html` in the same commit.
- **Both languages.** Any new visible text needs English and Spanish entries.
- **Run the checks** before opening a pull request: `npm install --no-save playwright@1.56.1`, `npx playwright install chromium`, then `node tests/check.cjs`. The Actions workflow runs the same file. The test server serves the site under the repository name, so keep that path in sync if the repository is ever renamed.

## Working rules (set by the owner)

- Never commit directly to `main`. The only exception was the single initial README commit.
- For each task, branch off a fresh `main` and open **one small pull request at a time**.
- Say the branch name first before each step of a task.
- Never print secrets or tokens.
- Do not stash or move the owner's untracked `.docx` files.
- Ask before changing any account setting, sending email, creating an analytics property, changing repository settings, or doing anything that costs money.
- After each step, give a short plain-language summary.
- Any scratch copies of other organizations' repositories are read-only references. Nothing is committed from them.
