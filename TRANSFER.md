# Handoff checklist: moving the guide to the BDIPS organization

Use this when the guide moves from a personal account to accounts owned by Better Days Integrated Programs. Do the steps in order, and re-test at the end.

## 1. Gather the new owner values

All owner-specific values live in two labeled **CONFIG blocks**, so most moves are small edits:

| Value | Where | Today |
| --- | --- | --- |
| `SHEET_URL` (published sheet CSV link) | CONFIG block at the top of `app.js` | blank (not published yet) |
| `REPORT_EMAIL` ("Report outdated info" inbox) | CONFIG block at the top of `app.js` | `b.overton@bdips.org` |
| `GA_MEASUREMENT_ID` (GA4) | CONFIG block at the top of `analytics.js` | blank (analytics off) |
| `REPORT_TO` and `GUIDE_URL` | top of `tools/link-checker.gs` | `b.overton@bdips.org`, current site address |
| Site address | see step 5 | `https://mwitham-gif.github.io/BDIPS_84th/` |

## 2. GitHub repository

- [ ] In the BDIPS GitHub organization, make sure an owner account exists with 2-step sign-in.
- [ ] Transfer the repository (Settings > General > Danger Zone > Transfer), or create a new one and push this history.
- [ ] Re-enable GitHub Pages in the new repository (Settings > Pages > `main` / root).
- [ ] Confirm branch protection / "pull request required" is set the way the new owner wants.
- [ ] Confirm the **Safety checks** workflow runs on the new repository.
- [ ] Update `CLAUDE.md` working rules if the owner or process changes.

## 3. Google Sheet

- [ ] Transfer ownership of the sheet to a BDIPS-owned Google account (Share > the person's name > Owner), or make a copy owned by BDIPS.
- [ ] If you made a copy, publish it (File > Share > Publish to web > first tab > CSV) and paste the **new** link into `SHEET_URL`. The old link keeps working until the old sheet is unpublished or deleted, so switch the site first, then retire the old one.
- [ ] Share edit access only with the staff who maintain listings.
- [ ] Confirm the header row still matches the columns in the README.

## 4. Apps Script link checker

- [ ] Open the sheet (new owner), Extensions > Apps Script. If the sheet was copied, the script copies with it; otherwise paste in `tools/link-checker.gs`.
- [ ] Set `REPORT_TO` and `GUIDE_URL`, save, and run `scheduleMonthlyCheck` once under the new owner's account (approve permissions). Delete the old schedule under the previous account.
- [ ] Run `checkLinks` once by hand and confirm the report arrives.

## 5. Site address (Pages URL change)

When the address changes (new GitHub organization, new repository name, or a custom domain), update **every** place that names it, then regenerate the QR code:

- [ ] `index.html`: `rel="canonical"`, `og:url`, `og:image` and `twitter:image`
- [ ] `tools/link-checker.gs`: `GUIDE_URL`
- [ ] `tests/check.cjs`: the `/BDIPS_84th/` path in the test server, and the address checks in the static section
- [ ] `flyer/bdips-qr.svg` and `flyer/bdips-qr.png`: regenerate for the new address (any QR generator works; use medium error correction)
- [ ] `README.md`, `TODO.md` and this file: the address in the text
- [ ] Printed flyers and any posters that carry the old QR code
- [ ] Raise the `?v=` numbers in `index.html` so phones fetch the new files
- [ ] **Scan the new QR code with a phone and confirm it opens the live site.**
- [ ] If the repository name changes, the old address stops working (GitHub redirects code, not Pages). Keep the old address alive as long as printed flyers exist, or reprint them.

## 6. Google Analytics 4 (optional)

- [ ] BDIPS creates its own GA4 property (not shared with any other organization) and a Web data stream for the live site.
- [ ] Paste its measurement ID (`G-…`) into `GA_MEASUREMENT_ID` in `analytics.js`. Leaving it blank keeps analytics off.
- [ ] **Never reuse the measurement IDs of other organizations' sites** (`G-FT2K5G6SYR`, `G-S3BPY8ZED8`). Mixing them corrupts both sites' data. The safety checks fail if either appears in the repository.
- [ ] Check the Realtime report on a test visit, and confirm searches about sensitive topics show as `(withheld)`.

## 7. Final check

- [ ] Run the QA checklist in the README on a phone, in English and Spanish.
- [ ] Hand over: sheet owner, repository owner, GA4 property owner (if any), and who receives the report emails.
