# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A community resource directory for **Better Days Integrated Programs (BDIPS)**, serving residents and neighbors around **238 84th St, Los Angeles, CA 90003**.

It is a copy of the Community Corporation of Santa Monica (CCSM) resource guide (`mwitham-gif/CCSM`) and works the same way. A sister copy, `mwitham-gif/CCSM-RedTail`, shows what changes between sites: the site name, the Google Sheet, the analytics ID, and the place names and URLs. The code, design and behavior stay the same. Where BDIPS and CCSM differ, BDIPS wins.

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

Everything shown to residents comes from the published Google Sheet. The link is the `SHEET_URL` constant near the top of `app.js`. Change it only when moving to a different sheet or republishing.

Sheet columns (row 1 headers): `name`, `name_es`, `category`, `description`, `description_es`, `address`, `address_es`, `phone`, `website`, `hours`, `hours_es`, `notes`, `notes_es`, `tags`, `tags_es`. Only `name` is required. Spanish columns fall back to English when blank.

Valid `category` values: Food, Mental, Rental, Legal, Benefits, Transportation, Education, Employment, Childcare, Youth, Seniors, Housing, Disability, Medical, Domestic Violence, Other.

The BDIPS values (sheet link, contact email, analytics ID, logo) are swapped in by the next pull request, with a `TODO.md` listing whatever is still missing. Until then the code still contains CCSM's values, and afterwards some will be clearly marked placeholders. Do not assume a CCSM value is correct for BDIPS.

## Rules to keep when changing the code

- **Analytics must stay separate.** BDIPS reports to its own Google Analytics 4 property. Never reuse the CCSM or Red Tail IDs (`G-FT2K5G6SYR`, `G-S3BPY8ZED8`). Mixing them corrupts traffic data. Do not create an analytics property without asking first.
- **Keep the Content Security Policy strict.** No inline scripts, inline styles or event handlers in `index.html`. Sheet text is data, never code. Website links are limited to http and https.
- **Privacy.** Sensitive searches (abuse, immigration status, self-harm, sexual or reproductive health, emails, phone numbers) are sent to analytics as `(withheld)`. Shared-link resource names never reach analytics. The Quick exit button and "Browsing safely" note on domestic violence views must keep working.
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
- The scratch copies of CCSM and CCSM-RedTail are read-only references. Nothing is committed from them.
