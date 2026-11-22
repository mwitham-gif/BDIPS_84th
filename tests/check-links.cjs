// Link and phone report for the BDIPS Resource Guide.
//
// Reads the published Google Sheet (or a CSV file) and checks:
//   1. FORMAT  every phone number looks like (323) 555-1212 and every website
//              is a full http(s) address. Works offline.
//   2. LIVE    every external website answers. Broken links and redirects are
//              listed; nothing is changed. Skipped with --offline.
// It also checks the fixed links written in index.html and app.js.
//
// This only REPORTS. It never edits the sheet or any file. Fix the sheet by hand.
//
// Usage:
//   node tests/check-links.cjs                  check the live published sheet
//   node tests/check-links.cjs --csv file.csv   check a CSV file (or a URL)
//   node tests/check-links.cjs --offline        format checks only, no requests
//   node tests/check-links.cjs --self-test      test this script against a local server
//   options: --timeout 10000 (ms)   --concurrency 6
//
// Exit code: 1 if any format problem or broken link is found, otherwise 0.
// Redirects and sites that refuse automatic checks are listed but do not fail.
// Not part of tests/check.cjs, because it needs the internet (the --self-test
// part of it does run there, against localhost only).

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };

// ── CSV ──────────────────────────────────────────────────────────────────
function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(c => c !== '')) rows.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell); if (row.some(c => c !== '')) rows.push(row);
  return rows;
}

const ALIASES = {
  name: ['name', 'resource name', 'resource'],
  phone: ['phone', 'phone number', 'telephone', 'tel'],
  website: ['website', 'url', 'link', 'web'],
};
function readListings(csvText) {
  const rows = parseCsv(csvText);
  const header = rows.shift().map(h => h.trim().toLowerCase());
  const col = key => header.findIndex(h => ALIASES[key].includes(h));
  const [iName, iPhone, iWeb] = [col('name'), col('phone'), col('website')];
  if (iName < 0 || (iPhone < 0 && iWeb < 0)) throw new Error('The CSV needs a "name" column and a "phone" or "website" column.');
  const listings = [];
  rows.forEach((r, n) => {
    // The sheet can repeat the header row when tabs are pasted together.
    if ((r[iName] || '').trim().toLowerCase() === 'name') return;
    listings.push({ row: n + 2, name: (r[iName] || '').trim(), phone: iPhone >= 0 ? (r[iPhone] || '') : '', website: iWeb >= 0 ? (r[iWeb] || '') : '' });
  });
  return listings;
}

// ── Format checks (offline) ───────────────────────────────────────────────
// Expected phone format: (323) 555-1212, optionally followed by " x123".
const PHONE_FORMAT = /^\(\d{3}\) \d{3}-\d{4}( (x|ext\.?) ?\d{1,6})?$/;
// Three-digit services that are real numbers on their own: 211 (community help),
// 311, 411, 511, 611, 711, 811, 911 and 988 (suicide and crisis lifeline).
const SHORT_CODES = ['211', '311', '411', '511', '611', '711', '811', '911', '988'];
function checkPhone(value) {
  const v = value.trim();
  if (!v) return null;
  if (value !== v) return 'has spaces before or after the number';
  if (/^\d{3}$/.test(v)) return SHORT_CODES.includes(v) ? null : `"${v}" is not a three-digit service number (allowed: ${SHORT_CODES.join(', ')})`;
  if (!PHONE_FORMAT.test(v)) return `"${v}" is not in the format (323) 555-1212`;
  const area = v[1], exchange = v[6];
  if ('01'.includes(area)) return `"${v}" has an area code starting with ${area}, which is not a real US area code`;
  if ('01'.includes(exchange)) return `"${v}" has a number starting with ${exchange} after the area code, which is not valid`;
  return null;
}

function isPrivateHost(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h.endsWith('.local') || h === '::1' || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^0\./.test(h);
}

// Returns { error } when the website cell is unusable, { warn } when it works but
// should be improved, or { url } for a clean address.
function checkWebsite(value, allowLocal) {
  const v = value.trim();
  if (!v) return {};
  if (/\s/.test(v)) return { error: `"${v}" contains a space` };
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) return { error: `"${v}" is missing http:// or https://` };
  let url;
  try { url = new URL(v); } catch (e) { return { error: `"${v}" is not a valid web address` }; }
  if (!/^https?:$/.test(url.protocol)) return { error: `"${v}" is not an http or https link` };
  if (!url.hostname.includes('.') && !isPrivateHost(url.hostname)) return { error: `"${v}" has no site name with a dot, like example.org` };
  if (!allowLocal && isPrivateHost(url.hostname)) return { error: `"${v}" points at a private or local address` };
  const out = { url: url.href };
  if (url.protocol === 'http:') out.warn = `"${v}" uses http, not https`;
  return out;
}

// ── Live checks ───────────────────────────────────────────────────────────
const UA = 'Mozilla/5.0 (compatible; BDIPS-link-report/1.0)';
async function request(url, method, timeout) {
  return fetch(url, { method, redirect: 'manual', headers: { 'user-agent': UA, accept: '*/*' }, signal: AbortSignal.timeout(timeout) });
}
async function probe(url, timeout) {
  let res;
  try {
    res = await request(url, 'HEAD', timeout);
    // Many sites refuse HEAD; ask again with GET before calling the link broken.
    if ([400, 403, 405, 501].includes(res.status)) res = await request(url, 'GET', timeout);
  } catch (e) {
    try { res = await request(url, 'GET', timeout); } catch (e2) { return { status: 0, note: (e2.cause && e2.cause.code) || e2.name || 'no answer' }; }
  }
  return { status: res.status, location: res.headers.get('location') || '' };
}
// Follows redirects (up to 5) so the report can show where the link finally lands.
async function check(url, timeout) {
  const hops = []; let current = url;
  for (let i = 0; i < 6; i++) {
    const r = await probe(current, timeout);
    if (r.status >= 300 && r.status < 400 && r.location) {
      const next = new URL(r.location, current).href;
      hops.push({ from: current, status: r.status, to: next });
      current = next; continue;
    }
    return { final: current, status: r.status, note: r.note || '', hops };
  }
  return { final: current, status: 0, note: 'too many redirects', hops };
}
function classify(r) {
  if (r.hops.length && r.status >= 200 && r.status < 300) return 'redirect';
  if (r.status >= 200 && r.status < 300) return 'ok';
  if (r.hops.length && r.status >= 300 && r.status < 400) return 'redirect';
  if ([401, 403, 429, 999].includes(r.status)) return 'blocked';
  return 'broken';
}
async function pool(items, size, worker) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await worker(items[i]); }
  }));
  return out;
}

// ── Fixed links in the site's own files ───────────────────────────────────
function staticLinks() {
  const skip = [/mwitham-gif\.github\.io\/BDIPS_84th/, /googletagmanager\.com/, /google-analytics\.com/, /analytics\.google\.com/, /googleusercontent\.com/, /docs\.google\.com/, /google\.com\/maps\/search/, /w3\.org/, /\$\{/, /\*/];
  const found = new Map(); const tels = [];
  for (const file of ['index.html', 'app.js']) {
    let text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    text = text.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '').replace(/<!--[\s\S]*?-->/g, '');
    // Links in code comments are notes, not links on the site.
    if (file.endsWith('.js')) text = text.split('\n').filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
    for (const m of text.matchAll(/https?:\/\/[^\s'"`<>)\\]+/g)) {
      const url = m[0].replace(/[.,;]+$/, '');
      // An address that ends in ? & or = is the start of a template, not a link.
      if (/[?&=]$/.test(url)) continue;
      if (skip.some(re => re.test(url))) continue;
      if (!found.has(url)) found.set(url, file);
    }
    for (const m of text.matchAll(/\btel:([^\s'"`<>$]+)/g)) tels.push({ file, value: m[1] });
  }
  return { links: [...found].map(([url, file]) => ({ url, file })), tels };
}

// ── Report ────────────────────────────────────────────────────────────────
async function run({ csvText, offline, timeout, concurrency, allowLocal, includeStatic }) {
  const listings = readListings(csvText);
  const formatProblems = [], warnings = [];
  const urlOwners = new Map();

  for (const l of listings) {
    const p = checkPhone(l.phone);
    if (p) formatProblems.push({ where: `row ${l.row} "${l.name}"`, kind: 'phone', text: p });
    const w = checkWebsite(l.website, allowLocal);
    if (w.error) formatProblems.push({ where: `row ${l.row} "${l.name}"`, kind: 'website', text: w.error });
    if (w.warn) warnings.push({ where: `row ${l.row} "${l.name}"`, text: w.warn });
    if (w.url) { if (!urlOwners.has(w.url)) urlOwners.set(w.url, []); urlOwners.get(w.url).push(`row ${l.row} "${l.name}"`); }
  }
  let statics = { links: [], tels: [] };
  if (includeStatic) {
    statics = staticLinks();
    for (const t of statics.tels) {
      const compact = decodeURIComponent(t.value).replace(/[^\d+]/g, '');
      if (!/^\+?1?\d{10}$/.test(compact)) formatProblems.push({ where: t.file, kind: 'tel: link', text: `"tel:${t.value}" is not a 10-digit number` });
    }
    for (const s of statics.links) { if (!urlOwners.has(s.url)) urlOwners.set(s.url, []); urlOwners.get(s.url).push(s.file + ' (fixed link)'); }
  }

  const results = { ok: [], redirect: [], blocked: [], broken: [] };
  if (!offline) {
    const urls = [...urlOwners.keys()];
    const checked = await pool(urls, concurrency, async url => ({ url, r: await check(url, timeout) }));
    for (const { url, r } of checked) results[classify(r)].push({ url, r, owners: urlOwners.get(url) });
  }
  return { listings, formatProblems, warnings, results, urlCount: urlOwners.size, offline };
}

function printReport(rep) {
  const line = (s = '') => console.log(s);
  line(`Link report: ${rep.listings.length} listings, ${rep.urlCount} distinct external links${rep.offline ? ' (offline: no requests made)' : ''}`);
  line('Nothing is changed by this report. Fix problems in the Google Sheet by hand.\n');

  line(`FORMAT PROBLEMS (${rep.formatProblems.length})`);
  rep.formatProblems.forEach(p => line(`  - ${p.where}: ${p.kind}: ${p.text}`));
  if (!rep.formatProblems.length) line('  none');
  line(`\nWARNINGS (${rep.warnings.length})`);
  rep.warnings.forEach(w => line(`  - ${w.where}: ${w.text}`));
  if (!rep.warnings.length) line('  none');

  if (!rep.offline) {
    const { ok, redirect, blocked, broken } = rep.results;
    line(`\nBROKEN (${broken.length})`);
    broken.forEach(b => line(`  - ${b.url}\n      ${b.r.status ? 'HTTP ' + b.r.status : b.r.note || 'no answer'}${b.r.hops.length ? ' after redirect to ' + b.r.final : ''}\n      used by: ${b.owners.join('; ')}`));
    if (!broken.length) line('  none');
    line(`\nREDIRECTING (${redirect.length})  [the link still works; consider updating it]`);
    redirect.forEach(b => line(`  - ${b.url}\n      -> ${b.r.final}  (${b.r.hops.map(h => h.status).join(', ')}${b.r.status ? ', then HTTP ' + b.r.status : ''})\n      used by: ${b.owners.join('; ')}`));
    if (!redirect.length) line('  none');
    line(`\nREFUSED THE AUTOMATIC CHECK (${blocked.length})  [open these by hand]`);
    blocked.forEach(b => line(`  - ${b.url}  (HTTP ${b.r.status})\n      used by: ${b.owners.join('; ')}`));
    if (!blocked.length) line('  none');
    line(`\nOK: ${ok.length}`);
  }
  const failed = rep.formatProblems.length > 0 || (!rep.offline && rep.results.broken.length > 0);
  line(`\nResult: ${failed ? 'PROBLEMS FOUND (see above)' : 'no problems found'}`);
  return failed;
}

// ── Self-test against a local server (no internet) ────────────────────────
async function selfTest() {
  const server = http.createServer((req, res) => {
    const routes = {
      '/ok': () => res.writeHead(200).end('ok'),
      '/moved': () => res.writeHead(301, { location: '/ok' }).end(),
      '/temp': () => res.writeHead(302, { location: '/ok' }).end(),
      '/gone': () => res.writeHead(404).end('gone'),
      '/boom': () => res.writeHead(500).end('boom'),
      '/refuse': () => res.writeHead(403).end('no'),
      '/nohead': () => (req.method === 'HEAD' ? res.writeHead(405).end() : res.writeHead(200).end('get ok')),
      '/loop': () => res.writeHead(302, { location: '/loop' }).end(),
    };
    (routes[req.url] || (() => res.writeHead(404).end()))();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const csv = ['name,phone,website',
    `Fine,(323) 555-1212,${base}/ok`, `Moved,(323) 555-1212,${base}/moved`, `Temp,(323) 555-1212,${base}/temp`,
    `Gone,(323) 555-1212,${base}/gone`, `Boom,(323) 555-1212,${base}/boom`, `Refuses,(323) 555-1212,${base}/refuse`,
    `NoHead,(323) 555-1212,${base}/nohead`, `Loop,(323) 555-1212,${base}/loop`,
    'Dashes,323-555-1212,', 'Short,555-1212,', 'Info,211,', 'Lifeline,988,', 'Emergency,911,', 'NotAService,999,', 'TooShort,21,', 'TooLong,2111,', 'Parens,(211),', 'BadArea,(055) 555-1212,', 'BadExchange,(323) 155-1212,', 'Two,(323) 555-1212 or (323) 555-0000,',
    'Ext,(323) 555-1212 x45,', 'NoScheme,,www.example.org', 'Space,,https://exa mple.org', 'Js,,javascript:alert(1)', 'Plain,,http://example.org', 'Dotless,,https://intranet'].join('\n');
  const rep = await run({ csvText: csv, offline: false, timeout: 3000, concurrency: 4, allowLocal: true, includeStatic: false });
  server.close();
  const kinds = name => ['ok', 'redirect', 'blocked', 'broken'].find(k => rep.results[k].some(x => x.owners.some(o => o.includes(`"${name}"`))));
  const bad = rep.formatProblems.map(p => p.where.match(/"([^"]*)"/)[1]);
  const expect = [
    ['200 is ok', kinds('Fine') === 'ok'], ['301 is a redirect', kinds('Moved') === 'redirect'], ['302 is a redirect', kinds('Temp') === 'redirect'],
    ['404 is broken', kinds('Gone') === 'broken'], ['500 is broken', kinds('Boom') === 'broken'], ['403 is refused, not broken', kinds('Refuses') === 'blocked'],
    ['a site that refuses HEAD is retried with GET and is ok', kinds('NoHead') === 'ok'], ['a redirect loop is broken', kinds('Loop') === 'broken'],
    ['323-555-1212 is a format problem', bad.includes('Dashes')], ['555-1212 is a format problem', bad.includes('Short')],
    ['an area code starting with 0 is a format problem', bad.includes('BadArea')], ['a number starting with 1 after the area code is a format problem', bad.includes('BadExchange')],
    ['two numbers in one cell is a format problem', bad.includes('Two')], ['an extension is accepted', !bad.includes('Ext')],
    ['three-digit service numbers 211, 988 and 911 are accepted', !bad.includes('Info') && !bad.includes('Lifeline') && !bad.includes('Emergency')],
    ['a three-digit number that is not a service (999) is a format problem', bad.includes('NotAService')],
    ['two- and four-digit numbers are format problems', bad.includes('TooShort') && bad.includes('TooLong')],
    ['(211) in parentheses is a format problem', bad.includes('Parens')],
    ['a website without http(s) is a format problem', bad.includes('NoScheme')], ['a website with a space is a format problem', bad.includes('Space')],
    ['a javascript: link is a format problem', bad.includes('Js')], ['a dotless host is a format problem', bad.includes('Dotless')],
    ['http (not https) is only a warning', rep.warnings.some(w => /Plain/.test(w.where)) && !bad.includes('Plain')],
    ['a fine row has no problem', !bad.includes('Fine')],
    ['a private address is refused unless allowed', Boolean(checkWebsite('http://127.0.0.1/x', false).error) && !checkWebsite('http://127.0.0.1/x', true).error],
  ];
  let failed = 0;
  for (const [name, ok] of expect) { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++; }
  console.log(`\n${expect.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

// ── Main ──────────────────────────────────────────────────────────────────
(async () => {
  if (flag('--self-test')) return selfTest();
  const timeout = Number(option('--timeout', 10000)), concurrency = Number(option('--concurrency', 6));
  let csvText;
  const source = option('--csv', '');
  try {
    if (source && !/^https?:\/\//.test(source)) csvText = fs.readFileSync(path.resolve(source), 'utf8');
    else {
      const url = source || ((fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8').match(/^const SHEET_URL = '([^']*)';/m) || [])[1]);
      if (!url) throw new Error('SHEET_URL in app.js is blank. Pass --csv <file>.');
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`The sheet answered HTTP ${res.status}.`);
      csvText = await res.text();
    }
  } catch (e) {
    console.error(`Could not read the listings: ${e.message}\nIf this computer cannot reach Google, download the sheet as CSV and run:  node tests/check-links.cjs --csv sheet.csv`);
    process.exit(2);
  }
  const rep = await run({ csvText, offline: flag('--offline'), timeout, concurrency, allowLocal: false, includeStatic: true });
  process.exit(printReport(rep) ? 1 : 0);
})();
