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
  check('analytics reports to the BDIPS GA4 property only', SHIPPED_GA_ID === 'G-95HD1P3GLD', JSON.stringify(SHIPPED_GA_ID));
  check('index.html has no static analytics tag or ID', !/gtag|googletagmanager\.com\/gtag|G-[A-Z0-9]{8,}/.test(html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')));
  check('report emails go to b.overton@bdips.org', /const REPORT_EMAIL = 'b\.overton@bdips\.org';/.test(app));
  check('the link checker reports to b.overton@bdips.org and names this site', /const REPORT_TO = 'b\.overton@bdips\.org';/.test(read('tools/link-checker.gs')) && /const GUIDE_URL = 'https:\/\/mwitham-gif\.github\.io\/BDIPS_84th\/';/.test(read('tools/link-checker.gs')));
  check('the page names this site in its canonical, og:url and og:image', ['rel="canonical" href', 'property="og:url" content', 'property="og:image" content'].every(key => new RegExp(key + '="https://mwitham-gif\\.github\\.io/BDIPS_84th/').test(html)));
  // Social card: a 1200x630 image with its size and description declared.
  const cardPath = path.join(ROOT, 'social_card.png');
  const cardBytes = fs.existsSync(cardPath) ? fs.readFileSync(cardPath) : Buffer.alloc(0);
  check('social_card.png is a 1200x630 PNG', cardBytes.length > 24 && cardBytes.toString('latin1', 1, 4) === 'PNG' && cardBytes.readUInt32BE(16) === 1200 && cardBytes.readUInt32BE(20) === 630);
  check('og:image and twitter:image point at social_card.png, with width, height and alt',
    /property="og:image" content="https:\/\/mwitham-gif\.github\.io\/BDIPS_84th\/social_card\.png"/.test(html) && /name="twitter:image" content="https:\/\/mwitham-gif\.github\.io\/BDIPS_84th\/social_card\.png"/.test(html)
      && /property="og:image:width" content="1200"/.test(html) && /property="og:image:height" content="630"/.test(html)
      && /property="og:image:alt" content="[^"]{20,}"/.test(html) && /name="twitter:image:alt" content="[^"]{20,}"/.test(html));
  const imgTags = [...(html + app).matchAll(/<img\b[^>]*>/g)].map(m => m[0]);
  check('every <img> has an alt attribute', imgTags.length > 0 && imgTags.every(tag => /\balt=/.test(tag)), imgTags.filter(tag => !/\balt=/.test(tag)).join(' | '));
  check('the header logo has a meaningful alt', /<img id="header-logo"[^>]*alt="[^"]{10,}"/.test(html));
  check('the footer note exists in the page, and there is no Last verified line', ['footer-privacy'].every(id => html.includes(`id="${id}"`)) &&!/last verified|footer-verified|LAST_VERIFIED/i.test(html + app));
  {
    // The link checker's own tests (against a local server, no internet).
    const { spawnSync } = require('child_process');
    const run = spawnSync(process.execPath, [path.join(ROOT, 'tests', 'check-links.cjs'), '--self-test'], { encoding: 'utf8', timeout: 60000 });
    check('the link checker passes its own self-test', run.status === 0, (run.stdout || '').split('\n').filter(line => /FAIL/.test(line)).join(' | ') + (run.stderr || ''));
  }
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
// by the browser test only. The shipped file keeps BDIPS's real ID.
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

  // csvFile null = the sheet is down. analytics false = analytics.js with a
  // blank ID (analytics off); 'shipped' = the real file untouched; otherwise
  // (the default) it runs with the test-only stub ID.
  // The SHEET_URL in app.js may be blank, so the sheet is served to whatever
  // address the page asks for, and a blank SHEET_URL is pointed at a test URL.
  async function openWith(csvFile, query = '', { analytics = true, contextOptions = {} } = {}) {
    const context = await browser.newContext({ serviceWorkers: 'block', ...contextOptions });
    const csv = csvFile ? fs.readFileSync(path.join(ROOT, csvFile), 'utf8') : '';
    await context.route(/docs\.google\.com/, route => csvFile
      ? route.fulfill({ body: csv, contentType: 'text/csv', headers: { 'access-control-allow-origin': '*' } })
      : route.fulfill({ status: 500, body: 'down', headers: { 'access-control-allow-origin': '*' } }));
    await context.route(/\/app\.js(\?|$)/, route => {
      let source = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
      if (csvFile && /const SHEET_URL = '';/.test(source)) source = source.replace("const SHEET_URL = '';", "const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/TEST/pub?output=csv';");
      route.fulfill({ body: source, contentType: 'text/javascript' });
    });
    if (analytics !== 'shipped') {
      await context.route(/\/analytics\.js(\?|$)/, route => route.fulfill({
        body: fs.readFileSync(path.join(ROOT, 'analytics.js'), 'utf8').replace(/var GA_MEASUREMENT_ID = '[^']*';/, `var GA_MEASUREMENT_ID = '${analytics ? TEST_GA_ID : ''}';`),
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
    for (const term of ['domestic violence', 'deportation', 'my number is 310 555 1212', 'me@example.com', 'parole officer', 'rehab near me', 'groceries', 'zzqxv nothing']) {
      const sent = await searches(term);
      check(`a search for "${term}" is reported as (withheld)`, sent[sent.length - 1] === '(withheld)', `sent: ${sent[sent.length - 1]}`);
    }
    const everything = await second.page.evaluate(() => JSON.stringify((window.dataLayer || []).map(entry => Array.from(entry))));
    check('no word a person typed appears anywhere in what analytics receives',
      !/parole|rehab|groceries|zzqxv|deportation|310 555|me@example/i.test(everything), everything.slice(0, 300));
    check('no search_no_results event is sent', !/search_no_results/.test(everything));
    const lastSearch = await second.page.evaluate(() => (window.dataLayer || []).map(entry => Array.from(entry))
      .filter(entry => entry[0] === 'event' && entry[1] === 'resource_search').map(entry => entry[2]).pop());
    check('a search sends only search_term and a numeric result_count',
      Boolean(lastSearch) && Object.keys(lastSearch).sort().join() === 'result_count,search_term' && typeof lastSearch.result_count === 'number', JSON.stringify(lastSearch));

    await second.page.fill('#search', '');
    await second.page.click('[data-category="Domestic Violence"]');
    await second.page.waitForTimeout(200);
    await second.page.evaluate(() => document.querySelector('.card .btn-web')?.addEventListener('click', event => event.preventDefault()));
    await second.page.click('.card .btn-web');
    const click = await second.page.evaluate(() => (window.dataLayer || []).map(entry => Array.from(entry)).filter(entry => entry[1] === 'resource_click').pop());
    check('a click on a domestic violence listing is counted with its name and link',
      Boolean(click) && click[2].resource_name !== '(withheld)' && /^https:\/\/[^?#]*$/.test(click[2].link_url), JSON.stringify(click && click[2]));
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

  // The language sticks: tapping ES or EN is remembered across reloads, and a
  // first visit follows the phone's language.
  console.log('Browser checks: language is remembered');
  {
    const first = await openWith('tests/fixtures/sample.csv', '', { analytics: false });
    check('a first visit on an English phone opens in English', (await first.page.locator('html').getAttribute('lang')) === 'en');
    await first.page.click('#btn-es');
    await first.page.reload();
    await first.page.waitForSelector('.card');
    check('Spanish is still on after a reload', (await first.page.locator('html').getAttribute('lang')) === 'es' && (await first.page.locator('#btn-top').getAttribute('aria-label')) === 'Volver arriba');
    check('the skip link and language label are in Spanish', (await first.page.locator('#skip-link').innerText()) === 'Saltar a la búsqueda' && (await first.page.locator('#lang-toggle').getAttribute('aria-label')) === 'Idioma');
    await first.page.click('#btn-en');
    await first.page.reload();
    await first.page.waitForSelector('.card');
    check('English is still on after choosing EN and reloading', (await first.page.locator('html').getAttribute('lang')) === 'en');
    check('no errors (language memory)', first.problems.length === 0, first.problems.join(' | '));
    await first.context.close();

    const spanishPhone = await openWith('tests/fixtures/sample.csv', '', { analytics: false, contextOptions: { locale: 'es-US' } });
    check('a first visit on a Spanish phone opens in Spanish', (await spanishPhone.page.locator('html').getAttribute('lang')) === 'es');
    await spanishPhone.page.click('#btn-en');
    await spanishPhone.page.reload();
    await spanishPhone.page.waitForSelector('.card');
    check('choosing EN on a Spanish phone beats the phone language', (await spanishPhone.page.locator('html').getAttribute('lang')) === 'en');
    await spanishPhone.context.close();

    const linked = await openWith('tests/fixtures/sample.csv', '?lang=en', { analytics: false, contextOptions: { locale: 'es-US' } });
    check('a ?lang=en link beats the phone language', (await linked.page.locator('html').getAttribute('lang')) === 'en');
    await linked.context.close();
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

  // Footer privacy note and image alts, in both languages.
  console.log('Browser checks: footer');
  {
    const { context, page, problems } = await openWith('tests/fixtures/sample.csv', '', { analytics: false });
    const expected = {
      en: { privacy:'We do not collect names or what you type into search. We count overall visits and clicks to improve this guide.', logo: 'Better Days Integrated Programs logo' },
      es: { privacy:'No recopilamos nombres ni lo que usted escribe en la búsqueda. Contamos las visitas y los clics en general para mejorar esta guía.', logo: 'Logotipo de Better Days Integrated Programs' },
    };
    for (const l of ['en', 'es']) {
      await page.click(`#btn-${l}`);
      await page.waitForTimeout(150);
      const e = expected[l];
      check(`the footer privacy note shows (${l})`, (await page.locator('#footer-privacy').innerText()).trim() === e.privacy);
      check(`there is no Last verified line (${l})`, (await page.locator('#footer-verified').count()) === 0 && !/verified|verificaci/i.test(await page.locator('footer').innerText()));
      check(`the header logo alt is in the language shown (${l})`, (await page.locator('#header-logo').getAttribute('alt')) === e.logo);
    }
    await page.click('#btn-en');
    await page.fill('#search', 'groceries');
    await page.waitForTimeout(300);
    await page.evaluate(() => { window.print = () => {}; });
    await page.locator('.card .btn-share').first().click();
    await page.locator('.card [data-print-index]').first().click();
    await page.waitForTimeout(300);
    const qrAlt = await page.locator('.ps-qr').first().getAttribute('alt');
    check('the printed QR code has a description', qrAlt === 'QR code that opens this guide', String(qrAlt));
    check('no errors (footer)',problems.length === 0, problems.join(' | '));
    await context.close();
  }

  // Rental help and Housing help are one category (Housing help).
  console.log('Browser checks: housing help');
  {
    const { context, page, problems } = await openWith('tests/fixtures/sample.csv', '', { analytics: false });
    check('there is no separate Rental tile', (await page.locator('#filters [data-category="Rental"]').count()) === 0);
    check('there is a Housing help tile', (await page.locator('#filters [data-category="Housing"]').count()) === 1);
    await page.click('#filters [data-category="Housing"]');
    await page.waitForTimeout(200);
    check('a sheet row that still says Rental shows under Housing help', (await page.locator('.card', { hasText: /Example Tenant Help/ }).count()) === 1);
    await page.goto(page.url().split('?')[0] + '?q=eviction');
    await page.waitForTimeout(400);
    check('searching "eviction" finds the housing listing', (await page.locator('.card', { hasText: /Example Tenant Help/ }).count()) === 1);
    check('no errors (housing help)', problems.length === 0, problems.join(' | '));
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

  // Analytics off: with a blank ID nothing is loaded or sent.
  console.log('Browser checks: analytics off');
  {
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
  }

  // The shipped analytics.js, untouched: the Google tag, the debug switch and the three events.
  console.log('Browser checks: Google tag (shipped file)');
  {
    const entries = page => page.evaluate(() => (window.dataLayer || []).map(entry => Array.from(entry)));
    const plain = await openWith('tests/fixtures/sample.csv', '', { analytics: 'shipped' });
    const tagScripts = await plain.page.evaluate(() => Array.from(document.scripts).map(s => s.src).filter(src => /googletagmanager/.test(src)));
    check('the Google tag loads once, with the BDIPS ID', tagScripts.length === 1 && tagScripts[0] === 'https://www.googletagmanager.com/gtag/js?id=G-95HD1P3GLD', tagScripts.join(' | '));
    const headScripts = await plain.page.evaluate(() => document.head.querySelectorAll('script[src*="analytics.js"]').length);
    check('analytics.js is included once, in the head', headScripts === 1);
    const config = (await entries(plain.page)).find(entry => entry[0] === 'config');
    check('the tag is configured for the BDIPS ID with signals and ad personalization off',
      Boolean(config) && config[1] === 'G-95HD1P3GLD' && config[2].allow_google_signals === false && config[2].allow_ad_personalization_signals === false, JSON.stringify(config));
    check('debug mode is off without the switch', Boolean(config) && !('debug_mode' in config[2]), JSON.stringify(config && config[2]));
    check('the page title is the fixed site title', (await plain.page.title()) === 'Resource Guide · Better Days Integrated Programs');

    // Events, with the real file.
    await plain.page.click('#filters [data-category="Food"]');
    await plain.page.click('#btn-es');
    await plain.page.click('#filters [data-category="Medical"]');
    const filters = (await entries(plain.page)).filter(entry => entry[0] === 'event' && entry[1] === 'filter_select').map(entry => entry[2]);
    check('a category tap sends only filter_name, in English in both languages',
      filters.length === 2 && filters.every(f => Object.keys(f).join() === 'filter_name') && filters[0].filter_name === 'Food support' && filters[1].filter_name === 'Medical care', JSON.stringify(filters));
    await plain.page.click('#btn-en');
    await plain.page.fill('#search', 'parole');
    await plain.page.waitForTimeout(1800);
    const dump = JSON.stringify(await entries(plain.page));
    const search = (await entries(plain.page)).filter(entry => entry[0] === 'event' && entry[1] === 'resource_search').map(entry => entry[2]).pop();
    check('a search for "parole" sends search_term as (withheld) and a numeric result_count',
      Boolean(search) && search.search_term === '(withheld)' && typeof search.result_count === 'number', JSON.stringify(search));
    check('the word "parole" appears nowhere in what analytics receives', !/parole/i.test(dump));
    check('the word "parole" appears in no request address', !plain.context.requestsSeen.some(url => /parole/i.test(decodeURIComponent(url))), plain.context.requestsSeen.filter(url => /parole/i.test(url)).join(' | '));
    const sentEvents = [...new Set((await entries(plain.page)).filter(entry => entry[0] === 'event').map(entry => entry[1]))];
    check('only the three agreed events are ever sent', sentEvents.length > 0 && sentEvents.every(name => ['resource_click', 'filter_select', 'resource_search'].includes(name)), sentEvents.join());
    check('no errors (Google tag)', plain.problems.length === 0, plain.problems.join(' | '));
    await plain.context.close();

    check('hits sent as a visitor leaves the page use the beacon transport', Boolean(config) && config[2].transport_type === 'beacon', JSON.stringify(config && config[2]));

    // A search must be reported even when the visitor does not pause for a full 1.5 seconds.
    const searchesOf = async page => (await entries(page)).filter(entry => entry[0] === 'event' && entry[1] === 'resource_search').map(entry => entry[2]);
    const quick = {
      'presses Enter (the phone Search key)': async page => { await page.keyboard.type('groceries'); await page.keyboard.press('Enter'); },
      'taps a Call button right after typing': async page => {
        await page.keyboard.type('groceries');
        await page.evaluate(() => document.addEventListener('click', event => event.preventDefault(), true));
        await page.locator('.card .btn-call').first().click();
      },
      'taps outside the search box': async page => { await page.keyboard.type('groceries'); await page.locator('h1').first().click(); },
      'switches away from the page': async page => {
        await page.keyboard.type('groceries');
        await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
      },
    };
    for (const [what, run] of Object.entries(quick)) {
      const quickPage = await openWith('tests/fixtures/sample.csv', '', { analytics: 'shipped' });
      await quickPage.page.click('#search');
      await run(quickPage.page);
      await quickPage.page.waitForTimeout(2000);
      const sent = await searchesOf(quickPage.page);
      check(`a search is reported once when the visitor ${what}`,
        sent.length === 1 && sent[0].search_term === '(withheld)' && typeof sent[0].result_count === 'number', JSON.stringify(sent));
      check(`nothing typed is sent when the visitor ${what}`, !/groceries/i.test(JSON.stringify(await entries(quickPage.page))));
      await quickPage.context.close();
    }

    const debug = await openWith('tests/fixtures/sample.csv', '?ga_debug=1', { analytics: 'shipped' });
    const debugConfig = (await entries(debug.page)).find(entry => entry[0] === 'config');
    check('?ga_debug=1 turns debug mode on', Boolean(debugConfig) && debugConfig[2].debug_mode === true, JSON.stringify(debugConfig && debugConfig[2]));
    check('the debug switch is not reported as part of the page address', Boolean(debugConfig) && !/ga_debug/.test(debugConfig[2].page_location), debugConfig && debugConfig[2].page_location);
    const consoleLines = [];
    debug.page.on('console', message => { if (/\[analytics\]/.test(message.text())) consoleLines.push(message.text()); });
    await debug.page.click('#filters [data-category="Food"]');
    await debug.page.click('#search');
    await debug.page.keyboard.type('parole');
    await debug.page.keyboard.press('Enter');
    await debug.page.waitForTimeout(300);
    const debugEvents = (await entries(debug.page)).filter(entry => entry[0] === 'event');
    check('in debug mode every event also carries debug_mode', debugEvents.length >= 2 && debugEvents.every(entry => entry[2].debug_mode === true), JSON.stringify(debugEvents));
    check('in debug mode events are echoed to the console without the typed word', consoleLines.some(line => /resource_search/.test(line)) && !consoleLines.some(line => /parole/i.test(line)), consoleLines.join(' | '));
    check('no errors (Google tag, debug)', debug.problems.length === 0, debug.problems.join(' | '));
    await debug.context.close();
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
    await page.waitForTimeout(200);
    await page.click('[data-category="Benefits"]');
    await page.waitForTimeout(200);
    check('the Benefits support area starts with the CalFresh, Medi-Cal and CalWORKs listing', /CalFresh, Medi-Cal and CalWORKs/.test(await page.locator('.card-name').first().innerText()), await page.locator('.card-name').allInnerTexts().then(names => names.join(' | ')));
    await page.click('[data-category="Benefits"]');
    await page.waitForTimeout(200);
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
      for (const [selector, type] of [['.btn-call', 'call'], ['.btn-web', 'website']]) {
        await card.locator(selector).click();
        const params = await lastClick();
        check(`a ${type} click sends every parameter (${l})`, complete(params) && params.click_type === type && params.resource_name === expected, JSON.stringify(params));
        const urlOk = type === 'call' ? params.link_url === 'tel:' : /^https?:\/\/[^?#]+$/.test(params.link_url);
        check(`a ${type} click sends a link_url with no number, query or hash (${l})`, urlOk, JSON.stringify(params));
      }
      const mapCard = page.locator('.card:has(.addr-link)').first();
      const mapName = await mapCard.getAttribute('data-track-name');
      await mapCard.locator('.addr-link').click();
      const directions = await lastClick();
      check(`a directions click is counted with no address in the link (${l})`,
        complete(directions) && directions.click_type === 'directions' && directions.resource_name === mapName && /^https:\/\/www\.google\.com\/maps\/[^?#]*$/.test(directions.link_url), JSON.stringify(directions));
      const countClicks = () => page.evaluate(() => (window.dataLayer || []).filter(entry => entry[0] === 'event' && entry[1] === 'resource_click').length);
      const beforeUncounted = await countClicks();
      await card.locator('.btn-report').click();
      await card.locator('.btn-share').click();
      await card.locator('a.share-option').click();
      check(`report and share-by-email links are not counted (${l})`, (await countClicks()) === beforeUncounted);
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
