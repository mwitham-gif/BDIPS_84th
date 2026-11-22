# TODO: what is still missing

Open items before the BDIPS Resource Guide is ready for residents. Owner decisions are marked **(owner)**.

## Blocking

- [x] **Published sheet link.** Done: the published CSV link is in `SHEET_URL` in the CONFIG block at the top of `app.js`. Until the sheet has at least one listing, the site shows its "could not load" message.
- [ ] **Area-specific listings.** The sheet has no listings yet. Decide who gathers them and how (for example: BDIPS staff nominate services, a volunteer calls each provider to confirm hours and eligibility, and each row is checked against the provider's own website). Listings must be specific to the 84th Street area (ZIP 90003 and nearby). Nothing is copied from other sites' directories.
- [ ] **Enable GitHub Pages (owner).** Settings > Pages > Deploy from a branch > `main` / root. Not done by code. After it is on, open the live address and confirm it loads.
- [ ] **Scan the QR code (owner).** After Pages is on, scan `flyer/bdips-qr.png` with a phone and confirm it opens the live site.

## Needs confirmation

- [ ] **Analytics review (owner).** The site reports to a GA4 property (`G-95HD1P3GLD`) created by the owner. Before launch, BDIPS should see what it collects (see the README, Analytics) and approve it. At handoff, add a BDIPS Google account as Administrator on the GA4 account. The ID does not change.
- [ ] **Emails (owner).** Confirm `b.overton@bdips.org` as the address for "Report outdated info" emails (`REPORT_EMAIL` in `app.js`) and for the monthly link-check report (`REPORT_TO` in `tools/link-checker.gs`). No contact email is shown to visitors.
- [ ] **Link checker.** Install `tools/link-checker.gs` in the sheet once it has listings (README, "Monthly link check"). It only sends mail when someone runs it.
- [ ] **Logo and colors.** The logo comes from bdips.org. Confirm the colors are right: the guide uses a darker version of the logo blue so text stays readable.

## Whenever the address changes

- [ ] Update every file that names the site address (list in [TRANSFER.md](TRANSFER.md)), regenerate the QR code, and scan it again.
