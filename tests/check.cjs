// Safety checks for the BDIPS Resource Guide.
//
// Runs on every push and pull request (.github/workflows/checks.yml), and
// locally with:  npm install --no-save playwright@1.56.1 && node tests/check.cjs
//
// Part 1 reads the files and fails if a change weakens the browser security
// rules (Content Security Policy) or adds code patterns those rules forbid.
// Part 2 opens the site in a real browser, feeds it a deliberately hostile
// sheet (tests/fixtures/hostile.csv) and the real listings, and fails if any
// sheet text can run code, any link uses an unsafe kind of address, or the
// privacy rules stop holding.

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// The ID that ships in analytics.js ('' = analytics off).
const SHIPPED_GA_ID = (fs.readFileSync(path.join(ROOT, 'analytics.js'), 'utf8').match(/var GA_MEASUREMENT_ID = '([^']*)';/) || [, null])[1];
const failures = [];
let passes = 0;

function check(label, ok, detail = '') {
  if (ok) {
    passes += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
  }
}

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

// ── Part 1: static checks ──────────────────────────────────────────────────
function staticChecks() {
  console.log('Static checks');
  const html = read('index.html');
  const scripts = ['app.js', 'analytics.js', 'sw.js'].map(file => [file, read(file)]);

  const cspMatch = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
  check('index.html has a Content Security Policy', Boolean(cspMatch));
  const csp = cspMatch ? cspMatch[1] : '';
  const directives = Object.fromEntries(csp.split(';').map(part => part.trim().split(/\s+/)).filter(p => p[0]).map(([name, ...values]) => [name, values]));

  check("CSP default-src is 'none'", String(directives['default-src']) === "'none'", `default-src: ${directives['default-src']}`);
  check("CSP object-src is 'none'", String(directives['object-src']) === "'none'");
  check("CSP base-uri is 'none'", String(directives['base-uri']) === "'none'");
  check("CSP form-action is 'none'", String(directives['form-action']) === "'none'");
  check('CSP never allows unsafe-inline or unsafe-eval', !/unsafe-inline|unsafe-eval|unsafe-hashes|\*\s*;|'strict-dynamic'/.test(csp), csp);

  const allowedScriptSources = ["'self'", 'https://www.googletagmanager.com'];
  const scriptSources = directives['script-src'] || [];
  check('CSP script-src lists only this site and the analytics loader',
    scriptSources.length > 0 && scriptSources.every(source => allowedScriptSources.includes(source)),
    `script-src: ${scriptSources.join(' ')}`);
  check("CSP style-src is only 'self'", String(directives['style-src']) === "'self'");

  const allowedConnect = ["'self'", 'https://docs.google.com', 'https://*.googleusercontent.com', 'https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://*.googletagmanager.com'];
  const connect = directives['connect-src'] || [];
  check('CSP connect-src reaches only the sheet and analytics', connect.every(source => allowedConnect.includes(source)), `connect-src: ${connect.join(' ')}`);

  const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(([, attrs, body]) => !/\bsrc=/.test(attrs) || body.trim());
  check('index.html has no inline scripts', inlineScripts.length === 0);
  check('index.html has no inline event handlers (onclick= and similar)', !/\son[a-z]+\s*=/i.test(html.replace(/<!--[\s\S]*?-->/g, '')));
  check('index.html has no inline style attributes', !/\sstyle\s*=/i.test(html));
  check('index.html has no javascript: links', !/javascript:/i.test(html));

  const externalScripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)].map(m => m[1]).filter(src => /^(https?:)?\/\//i.test(src));
  check('index.html loads no script from another site (analytics adds its own loader only when an ID is set)', externalScripts.length === 0, externalScripts.join(', '));
  const analyticsSource = read('analytics.js');
  const loaderUrls = [...analyticsSource.matchAll(/https?:\/\/[^'"\s)]+/g)].map(m => m[0]).filter(url => /\.js\b|gtag/.test(url));
  check('analytics.js loads only the Google gtag.js loader', loaderUrls.length > 0 && loaderUrls.every(url => url.startsWith('https://www.googletagmanager.com/gtag/js')), loaderUrls.join(', '));

  const localRefs = [...html.matchAll(/(?:src|href)="([^"#:]+?)(?:\?v=\d+)?"/g)].map(m => m[1]).filter(ref => !ref.startsWith('/') && ref.includes('.'));
  const missing = localRefs.filter(ref => !fs.existsSync(path.join(ROOT, ref)));
  check('every file index.html refers to exists', missing.length === 0, missing.join(', '));

  scripts.forEach(([file, source]) => {
    check(`${file} has no eval, new Function, or document.write`, !/\beval\s*\(|new\s+Function\s*\(|document\.write\s*\(/.test(source));
    check(`${file} sets no timers from strings`, !/set(?:Timeout|Interval)\s*\(\s*['"`]/.test(source));
  });

  const app = read('app.js');
  check('website links are limited to http and https', /function normalizeWebsiteUrl[\s\S]*?\^https\?:\\\/\\\//.test(app));
  check('the GA4 ID is blank (analytics off) or a G- measurement ID', /^G-[A-Z0-9]{6,12}$|^$/.test(SHIPPED_GA_ID), JSON.stringify(SHIPPED_GA_ID));
  check('index.html has no static analytics tag or ID', !/gtag|googletagmanager\.com\/gtag|G-[A-Z0-9]{8,}/.test(html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')));
  check('report emails go to b.overton@bdips.org', /const REPORT_EMAIL = 'b\.overton@bdips\.org';/.test(app));
  check('the link checker reports to b.overton@bdips.org and names this site', /const REPORT_TO = 'b\.overton@bdips\.org';/.test(read('tools/link-checker.gs')) && /const GUIDE_URL = 'https:\/\/mwitham-gif\.github\.io\/BDIPS_84th\/';/.test(read('tools/link-checker.gs')));
  check('the page names this site in its canonical, og:url and og:image', ['rel="canonical" href', 'property="og:url" content', 'property="og:image" content'].every(key => new RegExp(key + '="https://mwitham-gif\\.github\\.io/BDIPS_84th/').test(html)));
  check('no email address is shown to visitors (no mailto: in the page or its scripts)', !/mailto:\s*[a-z]/i.test(html) && !/href="mailto:[^$]/.test(app) && !/footer-contact/.test(html + app));

  // No other site's analytics ID, and no leftover names from the site this was copied from.
  const FORBIDDEN_IDS = ['G-FT2K5G6SYR', 'G-S3BPY8ZED8'];
  const LEFTOVER = /ccsm|santa monica|santa m[oó]nica|communitycorp|community corp|\b238\b/i;
  const skipForIds = new Set(['tests/check.cjs', 'CLAUDE.md', 'TRANSFER.md']);
  const skipForNames = new Set(['tests/check.cjs']);
  const idHits = [];
  const nameHits = [];
  for (const file of listTextFiles(ROOT)) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const text = fs.readFileSync(file, 'utf8');
    if (!skipForIds.has(rel) && FORBIDDEN_IDS.some(id => text.includes(id))) idHits.push(rel);
    if (!skipForNames.has(rel) && LEFTOVER.test(text)) nameHits.push(rel);
  }
  check('no analytics ID from another site appears in the repository', idHits.length === 0, idHits.join(', '));
  check('no leftover copied-site names, addresses or street numbers', nameHits.length === 0, nameHits.join(', '));
}

function listTextFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTextFiles(full));
    else if (/\.(html|js|cjs|css|md|csv|svg|webmanifest|gs|yml|json|txt)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

// The one tab and GA4 page title, whatever the view.
const SITE_TITLE = 'Resource Guide · Better Days Integrated Programs';

// Analytics checks run against a made-up stub ID, injected into analytics.js
// by the browser test only. The shipped file keeps its own (blank) ID.
const TEST_GA_ID = 'G-TESTSTUB01';

// ── Part 2: browser checks ────────────────────────────────────────────────
const TYPES = { html: 'text/html', js: 'text/javascript', css: 'text/css', png: 'image/png', svg: 'image/svg+xml', webmanifest: 'application/manifest+json', csv: 'text/csv' };

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file = decodeURIComponent(url.pathname.replace(/^\/BDIPS_84th\/?/, ''));
    if (!file) file = 'index.html';
    const full = path.join(ROOT, file);
    if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(full).slice(1)] || 'application/octet-stream' });
    res.end(fs.readFileSync(full));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function browserChecks() {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (error) {
    check('Playwright is installed (npm install --no-save playwright@1.56.1)', false);
    return;
  }

  const server = await startServer();
  const base = `http://localhost:${server.address().port}/BDIPS_84th/`;
  const launchOptions = {};
  if (process.env.CHROMIUM_PATH) launchOptions.executablePath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch(launchOptions);

  // csvFile null = the sheet is down. analytics false = run the shipped
  // analytics.js untouched; otherwise it runs with the test-only stub ID.
  // The SHEET_URL in app.js may be blank, so the sheet is served to whatever
  // address the page asks for, and a blank SHEET_URL is pointed at a test URL.
  async function openWith(csvFile, query = '', { analytics = true } = {}) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const csv = csvFile ? fs.readFileSync(path.join(ROOT, csvFile), 'utf8') : '';
    await context.route(/docs\.google\.com/, route => csvFile
      ? route.fulfill({ body: csv, contentType: 'text/csv', headers: { 'access-control-allow-origin': '*' } })
      : route.fulfill({ status: 500, body: 'down', headers: { 'access-control-allow-origin': '*' } }));
    await context.route(/\/app\.js(\?|$)/, route => {
      let source = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
      if (csvFile && /const SHEET_URL = '';/.test(source)) source = source.replace("const SHEET_URL = '';", "const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/TEST/pub?output=csv';");
      route.fulfill({ body: source, contentType: 'text/javascript' });
    });
    if (analytics) {
      await context.route(/\/analytics\.js(\?|$)/, route => route.fulfill({
        body: fs.readFileSync(path.join(ROOT, 'analytics.js'), 'utf8').replace(/var GA_MEASUREMENT_ID = '[^']*';/, `var GA_MEASUREMENT_ID = '${TEST_GA_ID}';`),
        contentType: 'text/javascript',
      }));
    }
    context.requestsSeen = [];
    context.on('request', request => context.requestsSeen.push(request.url()));
    await context.route(/googletagmanager\.com|google-analytics\.com/, route => route.fulfill({ body: '', contentType: 'text/javascript' }));
    await context.route(/weather\.com/, route => route.fulfill({ body: '<title>weather</title>', contentType: 'text/html' }));
    const page = await context.newPage();
    const problems = [];
    page.on('pageerror', error => problems.push(`page error: ${error.message}`));
    page.on('console', message => {
      if (message.type() === 'error' || /Content Security Policy/i.test(message.text())) problems.push(message.text());
    });
    page.on('dialog', dialog => { problems.push(`dialog opened: ${dialog.message()}`); dialog.dismiss(); });
    await page.goto(base + query);
    await page.waitForSelector('.card, .empty', { timeout: 15000 });
    return { context, page, problems };
  }

  // Hostile sheet: every field tries to run code or smuggle in a bad link.
  console.log('Browser checks: hostile sheet');
  {
    const { context, page, problems } = await openWith('tests/fixtures/hostile.csv');
    const cards = await page.locator('.card').count();
    check('hostile rows still show as plain listings (repeated header row skipped)', cards === 6, `cards: ${cards}`);

    // Hover and click over every card to trigger any handler that slipped in.
    for (const card of await page.locator('.card').all()) {
      await card.hover().catch(() => {});
    }
    await page.fill('#search', '<script>window.__pwned="search"</script>');
    await page.waitForTimeout(200);
    await page.fill('#search', 'amp');
    await page.waitForTimeout(200);
    await page.fill('#search', '');
    await page.waitForTimeout(200);

    check('no sheet text ran as code', await page.evaluate(() => window.__pwned === undefined), String(await page.evaluate(() => window.__pwned)));
    const injected = await page.evaluate(() => Array.from(document.querySelectorAll('#grid *'))
      .filter(el => Array.from(el.attributes).some(attr => /^on/i.test(attr.name)) || ['SCRIPT', 'IMG', 'IFRAME', 'OBJECT', 'EMBED'].includes(el.tagName))
      .map(el => el.outerHTML.slice(0, 80)));
    check('no injected elements or event handlers in the listings', injected.length === 0, injected.join(' | '));

    const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll('#grid a[href]')).map(a => a.getAttribute('href')));
    const unsafe = hrefs.filter(href => !/^(https:\/\/|tel:\+?\d+$|mailto:)/i.test(href));
    check('every link is https, tel or mailto', unsafe.length === 0, unsafe.join(' | '));
    check('javascript:, data: and vbscript: websites are dropped', !hrefs.some(href => /javascript:|data:|vbscript:/i.test(href)));
    check('phone links contain only digits', hrefs.filter(href => href.startsWith('tel:')).every(href => /^tel:\+?\d+$/.test(href)));
    const openers = await page.evaluate(() => Array.from(document.querySelectorAll('a[target="_blank"]')).filter(a => !/noopener/.test(a.rel)).length);
    check('links that open a new tab use rel=noopener', openers === 0);

    // Quick exit and the safety note on the domestic violence view.
    await page.click('[data-category="Domestic Violence"]');
    await page.waitForTimeout(200);
    check('Quick exit shows on the domestic violence view', await page.locator('#quick-exit').isVisible());
    check('Browsing safely note shows on the domestic violence view', await page.locator('#safety-tip').isVisible());
    await page.click('[data-category="Food"]');
    await page.waitForTimeout(200);
    check('Quick exit and the note hide elsewhere',
      !(await page.locator('#quick-exit').isVisible()) && !(await page.locator('#safety-tip').isVisible()));
    await page.click('[data-category="Domestic Violence"]');
    await page.waitForTimeout(200);
    await Promise.all([page.waitForURL(/weather\.com/, { timeout: 5000 }).catch(() => {}), page.click('#quick-exit')]);
    check('Quick exit leaves for a neutral site', /weather\.com/.test(page.url()), page.url());

    check('no errors or security-policy violations (hostile sheet)', problems.length === 0, problems.join(' | '));
    await context.close();
  }

  // Privacy: what reaches Google Analytics.
  console.log('Browser checks: privacy');
  {
    const { context, page, problems } = await openWith('tests/fixtures/hostile.csv', '?share=Safe%20House&q=secret');
    const config = await page.evaluate(() => (window.dataLayer || []).map(entry => Array.from(entry)).find(entry => entry[0] === 'config'));
    const settings = (config && config[2]) || {};
    check('a shared link never sends the resource name', /share=%28withheld%29/.test(settings.page_location || '') && !/Safe/.test(JSON.stringify(settings)), JSON.stringify(settings));
    check('an old ?q= link never sends the search', !/secret/.test(JSON.stringify(settings)));
    check('Google signals and ad personalization stay off', settings.allow_google_signals === false && settings.allow_ad_personalization_signals === false);
    check('a shared link keeps the fixed page title', settings.page_title === SITE_TITLE && (await page.title()) === SITE_TITLE, `${settings.page_title} / ${await page.title()}`);
    await context.close();

    const second = await openWith('tests/fixtures/hostile.csv');
    const searches = async term => {
      await second.page.fill('#search', term);
      await second.page.waitForTimeout(1700);
      return second.page.evaluate(() => (window.dataLayer || []).map(entry => Array.from(entry))
        .filter(entry => entry[0] === 'event' && entry[1] === 'resource_search').map(entry => entry[2].search_term));
    };
    for (const term of ['domestic violence', 'deportation', 'my number is 310 555 1212', 'me@example.com', 'parole officer', 'rehab near me']) {
      const sent = await searches(term);
      check(`sensitive search is withheld: "${term}"`, sent[sent.length - 1] === '(withheld)', `sent: ${sent[sent.length - 1]}`);
    }
    const sent = await searches('groceries');
    check('an ordinary search is still counted', sent[sent.length - 1] === 'groceries');
    await searches('zzqxv nothing');
    const empty = await second.page.evaluate(() => (window.dataLayer || []).map(entry => Array.from(entry))
      .filter(entry => entry[0] === 'event' && entry[1] === 'search_no_results').map(entry => entry[2].search_term));
    check('a search that finds nothing is reported as such', empty[empty.length - 1] === 'zzqxv nothing', `sent: ${empty.join(', ')}`);
    await searches('asylum zzqxv');
    const emptySensitive = await second.page.evaluate(() => (window.dataLayer || []).map(entry => Array.from(entry))
      .filter(entry => entry[0] === 'event' && entry[1] === 'search_no_results').map(entry => entry[2].search_term));
    check('a sensitive search that finds nothing is still withheld', emptySensitive[emptySensitive.length - 1] === '(withheld)');

    await second.page.fill('#search', '');
    await second.page.click('[data-category="Domestic Violence"]');
    await second.page.waitForTimeout(200);
    await second.page.evaluate(() => document.querySelector('.card .btn-web')?.addEventListener('click', event => event.preventDefault()));
    await second.page.click('.card .btn-web');
    const click = await second.page.evaluate(() => (window.dataLayer || []).map(entry => Array.from(entry)).filter(entry => entry[1] === 'resource_click').pop());
    check('a click on a domestic violence listing is counted with its name and link',
      Boolean(click) && click[2].resource_name !== '(withheld)' && /^https:\/\//.test(click[2].link_url), JSON.stringify(click && click[2]));
    check('no errors (privacy checks)', problems.length === 0 && second.problems.length === 0, [...problems, ...second.problems].join(' | '));
    await second.context.close();
  }

  // The logo is a button that returns to the top of the page.
  console.log('Browser checks: logo button');
  {
    const { context, page, problems } = await openWith('tests/fixtures/sample.csv', '', { analytics: false });
    check('the logo is a button', (await page.locator('button#btn-top img.header-logo').count()) === 1);
    check('the logo button is named in English', (await page.locator('#btn-top').getAttribute('aria-label')) === 'Back to top');
    await page.click('#btn-es');
    check('the logo button is named in Spanish', (await page.locator('#btn-top').getAttribute('aria-label')) === 'Volver arriba');
    await page.evaluate(() => { document.body.style.minHeight = '3000px'; window.scrollTo(0, 1500); });
    await page.waitForFunction(() => window.scrollY > 1000);
    await page.click('#btn-top');
    const reachedTop = await page.waitForFunction(() => window.scrollY === 0, null, { timeout: 5000 }).then(() => true).catch(() => false);
    check('clicking the logo returns to the top of the page', reachedTop);
    check('no errors (logo button)', problems.length === 0, problems.join(' | '));
    await context.close();
  }

  // Detail lines: Who it serves, Cost, How to start and What to bring.
  console.log('Browser checks: detail lines');
  {
    const { context, page, problems } = await openWith('tests/fixtures/details.csv', '', { analytics: false });
    for (const [l, labels, values] of [
      ['en', ['Who it serves', 'Cost', 'How to start', 'What to bring'], ['Adults with low income', 'Free', 'Call for an appointment', 'Photo ID and proof of income']],
      ['es', ['A quién atiende', 'Costo', 'Cómo empezar', 'Qué llevar'], ['Adultos con bajos ingresos', 'Gratis', 'Llame para una cita', 'Identificación con foto y comprobante de ingresos']],
    ]) {
      await page.click(`#btn-${l}`);
      await page.waitForTimeout(200);
      const text = await page.locator('.card', { hasText: /Housing Help|Vivienda de Ejemplo/ }).first().innerText();
      check(`a card shows the four detail labels (${l})`, labels.every(label => text.toLowerCase().includes(label.toLowerCase())), text);
      check(`a card shows the four detail values (${l})`, values.every(value => text.includes(value)), text);
      const plain = await page.locator('.card', { hasText: /Plain Listing|Listado Simple/ }).first().innerText();
      check(`a listing without details shows no empty detail labels (${l})`, !labels.some(label => plain.toLowerCase().includes(label.toLowerCase())), plain);
    }
    await page.click('#btn-en');
    await page.fill('#search', 'proof of income');
    await page.waitForTimeout(400);
    check('search finds words that appear only in a detail line', (await page.locator('.card').count()) === 1);
    check('no errors (detail lines)', problems.length === 0, problems.join(' | '));
    await context.close();
  }

  // Veterans and Sobriety tiles.
  console.log('Browser checks: veterans and sobriety tiles');
  {
    const { context, page, problems } = await openWith('tests/fixtures/tiles.csv', '', { analytics: false });
    for (const [l, vet, sob] of [['en', 'Veterans support', 'Sobriety support'], ['es', 'Apoyo para veteranos', 'Apoyo para la sobriedad']]) {
      await page.click(`#btn-${l}`);
      await page.waitForTimeout(200);
      const tiles = (await page.locator('#filters .cat-tile').allInnerTexts()).join(' | ').toLowerCase();
      check(`the Veterans and Sobriety tiles are named (${l})`, tiles.includes(vet.toLowerCase()) && tiles.includes(sob.toLowerCase()), tiles);
    }
    check('both new tiles draw their own icon', (await page.locator('#filters [data-category="Veterans"] svg path').count()) > 0 && (await page.locator('#filters [data-category="Sobriety"] svg path').count()) > 0);
    await page.click('#btn-en');
    await page.click('[data-category="Veterans"]');
    await page.waitForTimeout(200);
    check('the Veterans tile shows only veteran listings', (await page.locator('.card').count()) === 1 && /Veterans Office/.test(await page.locator('.card').first().innerText()));
    await page.click('[data-category="Veterans"]');
    await page.fill('#search', 'sober');
    await page.waitForTimeout(400);
    check('a search for "sober" finds the Sobriety listing', /Recovery Meeting/.test(await page.locator('.card').first().innerText()));
    await page.fill('#search', 'veteran');
    await page.waitForTimeout(400);
    check('a search for "veteran" finds the Veterans listing', /Veterans Office/.test(await page.locator('.card').first().innerText()));
    check('no errors (veterans and sobriety tiles)', problems.length === 0, problems.join(' | '));
    await context.close();
  }

  // Analytics off: with the shipped (blank) ID nothing is loaded or sent.
  console.log('Browser checks: analytics off');
  if (SHIPPED_GA_ID === '') {
    const { context, page, problems } = await openWith('tests/fixtures/sample.csv', '', { analytics: false });
    await page.fill('#search', 'groceries');
    await page.waitForTimeout(1800);
    await page.locator('.card .btn-web').first().click({ button: 'middle' }).catch(() => {});
    const state = await page.evaluate(() => ({ dataLayer: typeof window.dataLayer, gtag: typeof window.gtag, scripts: Array.from(document.scripts).map(s => s.src).filter(src => /google/i.test(src)) }));
    check('with a blank ID no analytics code or script is present', state.dataLayer === 'undefined' && state.gtag === 'undefined' && state.scripts.length === 0, JSON.stringify(state));
    check('with a blank ID no request goes to Google analytics', !context.requestsSeen.some(url => /googletagmanager|google-analytics|analytics\.google/.test(url)), context.requestsSeen.join(' | '));
    check('with a blank ID the fixed page title still holds', (await page.title()) === SITE_TITLE);
    check('no errors (analytics off)', problems.length === 0, problems.join(' | '));
    await context.close();
  } else {
    console.log('  (skipped: analytics ID is set)');
  }

  // The sheet cannot load: a plain message, no email address, still safe.
  console.log('Browser checks: sheet unavailable');
  {
    const { context, page, problems } = await openWith(null);
    const outage = async () => ({ notice: await page.locator('#status-notice').innerText(), grid: await page.locator('#grid').innerText(), mailto: await page.locator('a[href^="mailto:"]').count() });
    let state = await outage();
    check('the load-failure message asks the visitor to try again later (English)', /try again later/i.test(state.notice) && /try again later/i.test(state.grid), JSON.stringify(state));
    check('the load-failure message shows no email address (English)', state.mailto === 0 && !/@/.test(state.notice + state.grid + await page.locator('footer').innerText()));
    await page.click('#btn-es');
    await page.waitForTimeout(200);
    state = await outage();
    check('the load-failure message asks the visitor to try again later (Spanish)', /más tarde/i.test(state.notice) && /más tarde/i.test(state.grid), JSON.stringify(state));
    check('the load-failure message shows no email address (Spanish)', state.mailto === 0 && !/@/.test(state.notice + state.grid));
    check('no demo data is shown when the sheet is down', (await page.locator('.card').count()) === 0);
    await context.close();
  }

  // Real listings: the everyday features still work.
  console.log('Browser checks: real listings');
  {
    const { context, page, problems } = await openWith('tests/fixtures/sample.csv');
    check('the directory loads', (await page.locator('.card').count()) > 0);
    await page.fill('#search', 'groceries');
    await page.waitForTimeout(200);
    check('food searches start with the Pantry Locator', /Pantry Locator/.test(await page.locator('.card-name').first().innerText()));
    await page.fill('#search', '');
    await page.click('#btn-es');
    await page.waitForTimeout(200);
    check('Spanish view shows Spanish hours', /lun–vie/.test(await page.locator('#grid').innerText()));
    await page.click('#btn-text-size');
    check('A+ makes the text larger', await page.evaluate(() => document.documentElement.classList.contains('text-large')));
    check('A+ never makes the page scroll sideways', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await page.click('#btn-text-size');
    // A Share menu near the top of the screen must open downward, fully visible.
    await page.click('[data-category="Food"]');
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const button = document.querySelector('[data-share-menu="category"]');
      const header = document.querySelector('header');
      window.scrollBy(0, button.getBoundingClientRect().top - Math.max(0, header.getBoundingClientRect().bottom) - 10);
    });
    await page.click('[data-share-menu="category"]');
    const menuBox = await page.evaluate(() => {
      const box = document.querySelector('.share-menu.show').getBoundingClientRect();
      const header = document.querySelector('header').getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, right: box.right, limit: Math.max(0, header.bottom), width: document.documentElement.clientWidth, height: innerHeight };
    });
    check('a Share menu near the top of the screen stays fully visible',
      menuBox.top >= menuBox.limit && menuBox.bottom <= menuBox.height && menuBox.right <= menuBox.width, JSON.stringify(menuBox));
    await page.keyboard.press('Escape');
    await page.click('[data-category="Food"]'); // tapping the selected tile clears the filter
    await page.waitForTimeout(200);
    await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
    await page.click('[data-category="Food"]');
    await page.click('[data-share-menu="category"]');
    await page.click('[data-action="print-category"]');
    await page.waitForFunction(() => window.__printed, null, { timeout: 5000 }).catch(() => {});
    // A street address opens in Google Maps; other "where" text stays plain.
    await page.fill('#search', '');
    await page.waitForTimeout(200);
    const where = await page.evaluate(() => Array.from(document.querySelectorAll('.card')).map(card => {
      const link = card.querySelector('.addr-link');
      const text = (card.querySelector('.card-detail-text') || {}).textContent || '';
      return { text: text.trim(), href: link && link.getAttribute('href'), rel: link && link.rel, target: link && link.target };
    }));
    const mapped = where.filter(w => w.href);
    check('street addresses are links to Google Maps', mapped.length > 0 && mapped.every(w => /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/.test(w.href) && /noopener/.test(w.rel) && /noreferrer/.test(w.rel) && w.target === '_blank'), JSON.stringify(mapped.slice(0, 2)));
    check('"Online" and phone-only places are not map links', where.filter(w => /^(Online|En línea|Los Angeles County – phone only|Condado de Los Ángeles)/.test(w.text)).every(w => !w.href));
    check('Print or save as PDF builds the printout', (await page.locator('#print-sheet .ps-item').count()) > 0);

    // Every resource link sends a name, category, click type and link, in
    // either language, and the page title never changes.
    await page.evaluate(() => {
      for (const type of ['click', 'auxclick']) {
        document.addEventListener(type, event => { if (event.target.closest('a[href]')) event.preventDefault(); });
      }
      window.print = () => {};
    });
    const lastClick = () => page.evaluate(() => (window.dataLayer || []).map(entry => Array.from(entry))
      .filter(entry => entry[0] === 'event' && entry[1] === 'resource_click').map(entry => entry[2]).pop());
    const complete = params => Boolean(params) && ['resource_name', 'resource_category', 'click_type', 'link_url']
      .every(key => typeof params[key] === 'string' && params[key] && params[key] !== 'unknown');
    const expectedNames = {};
    for (const l of ['en', 'es']) {
      await page.click(`#btn-${l}`);
      await page.fill('#search', 'groceries');
      await page.waitForTimeout(200);
      const card = page.locator('.card').first();
      const expected = await card.getAttribute('data-track-name');
      expectedNames[l] = expected;
      for (const [selector, type] of [['.btn-call', 'call'], ['.btn-web', 'website'], ['.btn-report', 'report']]) {
        await card.locator(selector).click();
        const params = await lastClick();
        check(`a ${type} click sends every parameter (${l})`, complete(params) && params.click_type === type && params.resource_name === expected, JSON.stringify(params));
      }
      await card.locator('.btn-share').click();
      await card.locator('a.share-option').click();
      const shared = await lastClick();
      check(`a share-by-email click is told apart from contacting the listing (${l})`, complete(shared) && shared.click_type === 'share_email', JSON.stringify(shared));
      check(`the footer shows the organization and no email address (${l})`,
        /Better Days Integrated Programs/.test(await page.locator('footer').innerText()) && (await page.locator('footer a, #footer-contact').count()) === 0);
      await page.locator('.card .btn-web').first().click({ button: 'middle' });
      const middle = await lastClick();
      check(`a middle-click (new tab) is counted (${l})`, complete(middle) && middle.click_type === 'website', JSON.stringify(middle));
      await page.click('[data-category="Food"]');
      await page.fill('#search', '');
      await page.waitForTimeout(200);
      check(`the page title stays fixed after filter, search and language changes (${l})`, (await page.title()) === SITE_TITLE, await page.title());
    }
    check('English and Spanish clicks on a listing report the same name',
      Boolean(expectedNames.en) && expectedNames.es === expectedNames.en, JSON.stringify(expectedNames));
    // A link added later with no name is not a named resource and should not
    // create a resource_click event.
    await page.evaluate(() => {
      const card = document.querySelector('.card');
      card.removeAttribute('data-track-name');
      card.querySelector('.card-name').textContent = '';
      const link = document.createElement('a');
      link.href = 'https://example.org/added-later';
      link.className = 'added-later';
      link.textContent = 'Added later';
      card.querySelector('.card-actions').appendChild(link);
    });
    const unnamedClicksBefore = await page.evaluate(() => (window.dataLayer || [])
      .map(entry => Array.from(entry))
      .filter(entry => entry[0] === 'event' && entry[1] === 'resource_click').length);
    await page.click('.added-later');
    const unnamedClicksAfter = await page.evaluate(() => (window.dataLayer || [])
      .map(entry => Array.from(entry))
      .filter(entry => entry[0] === 'event' && entry[1] === 'resource_click').length);
    check('a link with no name is not reported', unnamedClicksAfter === unnamedClicksBefore,
      JSON.stringify({ before: unnamedClicksBefore, after: unnamedClicksAfter }));
    check('no errors (real listings)', problems.length === 0, problems.join(' | '));
    await context.close();
  }

  await browser.close();
  server.close();
}

(async () => {
  staticChecks();
  await browserChecks();
  console.log(`\n${passes} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log(failures.map(label => `  - ${label}`).join('\n'));
    process.exit(1);
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
