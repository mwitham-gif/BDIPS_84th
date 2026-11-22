// Google Analytics 4 bootstrap.
//
// ─────────────────────────────────────────────────────────────────────────────
// CONFIG: the one value that turns analytics on.
//
// This is BDIPS's own GA4 measurement ID. It is public (it is visible in the
// page source of any site that uses Google Analytics), so it is safe in code.
// Blank it out and the site sends NO analytics at all: no Google script loads
// and no event is recorded. Never use an ID that belongs to another
// organization's site.
var GA_MEASUREMENT_ID = 'G-95HD1P3GLD';
// ─────────────────────────────────────────────────────────────────────────────
//
// This lives in its own file rather than inline in index.html because the page
// ships a Content-Security-Policy with `script-src 'self'`. An inline block
// would need 'unsafe-inline' or a hash that has to be recomputed on every edit;
// a same-origin file needs neither, and keeps the CSP strict for everything else.
// index.html loads this file once, in the <head>.
//
// When an ID is set, this file adds the gtag.js loader itself
// (googletagmanager.com is allowlisted in script-src for that). Both this file
// and the loader push to the same window.dataLayer, and gtag.js drains whatever
// is queued when it arrives.
//
// Three events are sent, and nothing else:
//   resource_click  resource_name, resource_category, click_type, link_url
//   filter_select   filter_name
//   resource_search search_term (always "(withheld)"), result_count
//
// Privacy rules (this site is for adults in transitional housing):
//   - What a person types into the search box is never sent anywhere. The
//     search_term is the fixed text "(withheld)"; only the number of results
//     is reported.
//   - link_url never carries a query string or hash. Phone and email links are
//     reduced to "tel:" and "mailto:", with no number or address.
//   - No names, emails, phone numbers or anything about the visitor.
//   - Google signals and ad personalization are off.

// One title for every view of the site, so reports show a single page title.
// Filters, search, the language toggle and shared links never change it, and
// a browser's own page translation (which rewrites document.title) cannot split
// the reports either.
var SITE_TITLE = 'Resource Guide · Better Days Integrated Programs';
document.title = SITE_TITLE;

if (/^G-[A-Z0-9]{6,12}$/.test(GA_MEASUREMENT_ID)) startAnalytics();

function startAnalytics() {
  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  gtag('js', new Date());

  var loader = document.createElement('script');
  loader.async = true;
  loader.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_MEASUREMENT_ID);
  document.head.appendChild(loader);

  // One title for every view of the site, so GA4 reports a single page title.
  // page_title is set explicitly for every event, so a browser's own page
  // translation (which rewrites document.title) cannot split the reports.
  gtag('set', { page_title: SITE_TITLE });

  // A shared link (?share=Name) names one resource, possibly a domestic violence
  // shelter, and an old ?q= link carries whatever was typed. Neither goes to
  // Google: the page view is reported with those values withheld. The debug
  // switch itself is also left out of the reported address.
  var pageParams = new URLSearchParams(window.location.search);
  var debugOn = pageParams.get('ga_debug') === '1';
  if (pageParams.has('share')) pageParams.set('share', '(withheld)');
  pageParams.delete('q');
  pageParams.delete('ga_debug');
  var pageQuery = pageParams.toString();

  var config = {
    page_location: window.location.origin + window.location.pathname + (pageQuery ? '?' + pageQuery : ''),
    page_title: SITE_TITLE,
    // Visits are counted, never joined to Google accounts or used for ads.
    allow_google_signals: false,
    allow_ad_personalization_signals: false
  };
  // Debug switch: add ?ga_debug=1 to the address to see this visit in GA4
  // DebugView. Without it, debug mode stays off.
  if (debugOn) config.debug_mode = true;
  gtag('config', GA_MEASUREMENT_ID, config);

  // Custom GA4 events, sent with gtag() so they reach GA4 with their
  // parameters. Everything below uses document-level delegation because
  // app.js renders cards and filter buttons from the sheet after load, and
  // re-renders them on search, filter, and language changes. Listeners use the
  // capture phase so they read the clicked element before app.js replaces it
  // (a filter click rebuilds #filters).
  (function () {
    function cleanText(el) {
      return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
    }

    // The three buttons on a listing that are counted: Call, website and the
    // address (which opens directions). Every other link is not tracked.
    function getClickType(link) {
      if (link.classList.contains('btn-call')) return 'call';
      if (link.classList.contains('btn-web')) return 'website';
      if (link.classList.contains('addr-link')) return 'directions';
      return null;
    }

    // The address of the link, with nothing personal or searchable in it:
    // web links lose their query string and hash; phone and email links are
    // reduced to their scheme.
    function cleanLinkUrl(href) {
      if (/^tel:/i.test(href)) return 'tel:';
      if (/^mailto:/i.test(href)) return 'mailto:';
      try {
        var url = new URL(href, window.location.href);
        if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin + url.pathname;
        return url.protocol;
      } catch (error) {
        return '';
      }
    }

    // app.js puts the listing's sheet name and category key on each card as
    // data-track-name and data-track-category. Those stay in English whichever
    // language is on screen, and a browser's own page translation never
    // touches them, so one listing is one row in GA4. The visible text is only
    // a fallback.
    function getResourceParams(link) {
      var clickType = getClickType(link);
      if (!clickType) return null;
      var source = link.closest('[data-track-name]');
      var card = link.closest('.card');
      var name = (source && source.getAttribute('data-track-name')) || cleanText(card && card.querySelector('.card-name'));
      var category = (source && source.getAttribute('data-track-category')) || cleanText(card && card.querySelector('.card-category'));
      var linkUrl = cleanLinkUrl(link.getAttribute('href') || '');
      // No name or no usable address, no event: every resource_click in GA4
      // points at a named listing.
      if (!name || !linkUrl) return null;
      return {
        resource_name: name,
        resource_category: category || 'unknown',
        click_type: clickType,
        link_url: linkUrl
      };
    }

    // A resource link is any link on a listing card (directory, shared page or
    // pinned listing alike) or any link marked with data-track-name.
    function findResourceLink(target) {
      var link = target.closest('a[href]');
      if (!link || !(link.closest('.card') || link.closest('[data-track-name]'))) return null;
      return link;
    }

    function trackResourceClick(link) {
      var params = getResourceParams(link);
      if (!params) return;
      gtag('event', 'resource_click', params);
    }

    // A middle-click (open in a new tab) fires auxclick, not click.
    document.addEventListener('auxclick', function (event) {
      if (event.button !== 1 || !(event.target instanceof Element)) return;
      var link = findResourceLink(event.target);
      if (link) trackResourceClick(link);
    }, true);

    document.addEventListener('click', function (event) {
      var target = event.target;
      if (!(target instanceof Element)) return;

      var link = findResourceLink(target);
      if (link) {
        trackResourceClick(link);
        return;
      }

      var filterButton = target.closest('#filters .filter-btn[data-category]');
      if (filterButton) {
        // app.js stamps the English label on each tile so the same filter is
        // one row in reports in both languages; the visible label is the fallback.
        var filterName = filterButton.getAttribute('data-filter-label') || cleanText(filterButton.querySelector('.tile-label'));
        if (filterName) gtag('event', 'filter_select', { filter_name: filterName });
      }
    }, true);

    var SEARCH_DEBOUNCE_MS = 1500;
    var searchTimer = null;
    var lastSearchTerm = '';

    // Only the fact that a search happened, and how many listings it matched,
    // are reported. The words typed are read just to avoid counting the same
    // search twice; they are never sent anywhere.
    document.addEventListener('input', function (event) {
      var input = event.target;
      if (!(input instanceof Element) || input.id !== 'search') return;

      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        var term = input.value.trim();
        if (!term || term === lastSearchTerm) return;
        lastSearchTerm = term;
        // app.js records how many listings matched on #grid.
        var grid = document.getElementById('grid');
        var count = grid ? Number(grid.getAttribute('data-result-count')) : NaN;
        var params = { search_term: '(withheld)' };
        if (!isNaN(count)) params.result_count = count;
        gtag('event', 'resource_search', params);
      }, SEARCH_DEBOUNCE_MS);
    });
  })();
}
