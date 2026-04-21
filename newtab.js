// ── Performant state ──────────────────────────────────────────────────
let searchTimer = null;
let pendingRaf = null;
let _feedReadyBatchTimer = null;
const feedItems = document.getElementById('feed-items');

feedItems.addEventListener('mouseenter', e => {
  const item = e.target.closest('.item[data-url]');
  if (item && !item._prefetched) { item._prefetched = true; preloadArticle(item.dataset.url); }
}, true);

function scheduleRender(forceNav = false) {
  if (!pendingRaf) {
    pendingRaf = requestAnimationFrame(() => {
      pendingRaf = null;
      renderNav(allFeeds, forceNav);
      renderItems(allFeeds);
    });
  }
}

// ── Fetching state ────────────────────────────────────────────────────
const fetchingUrls = new Set();
const navBtnCache = new Map();

function setFetching(url, on) {
  if (on) fetchingUrls.add(url); else fetchingUrls.delete(url);
  const btn = navBtnCache.get(url) || document.querySelector(`#feed-nav button[data-url="${CSS.escape(url)}"]`);
  if (!btn) return;
  navBtnCache.set(url, btn);
  let dot = btn.querySelector('.fetch-dot');
  if (on && !dot) {
    dot = document.createElement('span');
    dot.className = 'fetch-dot';
    btn.appendChild(dot);
  } else if (!on && dot) {
    dot.remove();
  }
}

// ── Skeleton ──────────────────────────────────────────────────────────
function makeSkeleton() {
  const el = document.createElement('div');
  el.className = 'skeleton-item';
  el.innerHTML = `
    <div class="skeleton skeleton-thumb"></div>
    <div class="skeleton-body">
      <div class="skeleton skeleton-title"></div>
      <div class="skeleton skeleton-meta"></div>
    </div>`;
  return el;
}

function showSkeletons(count = 5) {
  feedItems.innerHTML = '';
  for (let i = 0; i < count; i++) feedItems.appendChild(makeSkeleton());
}

// ── Content fade ──────────────────────────────────────────────────────
const _contentEl = document.querySelector('.content');
function fadeContent(fn) {
  _contentEl.classList.add('fading');
  _contentEl.classList.remove('fading-in');
  setTimeout(() => {
    fn();
    _contentEl.classList.remove('fading');
    _contentEl.classList.add('fading-in');
  }, 150);
}

function observeItems() {
  const items = document.querySelectorAll('.item:not(.visible)');
  items.forEach((el, i) => {
    el.style.animationDelay = Math.min(i, 7) * 55 + 'ms';
    el.classList.add('visible');
  });
}

function closeOverlay(overlayEl) {
  overlayEl.classList.add('closing');
  overlayEl.addEventListener('animationend', () => {
    overlayEl.style.display = 'none';
    overlayEl.classList.remove('closing');
  }, { once: true });
}

// ── Keys modal ────────────────────────────────────────────────────────
// ── Focus trap ────────────────────────────────────────────────────────
function trapFocus(el) {
  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
  function handler(e) {
    if (e.key !== 'Tab') return;
    const els = [...el.querySelectorAll(FOCUSABLE)].filter(n => n.offsetParent !== null);
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  document.addEventListener('keydown', handler);
  const firstEl = el.querySelector(FOCUSABLE);
  if (firstEl) firstEl.focus();
  return () => document.removeEventListener('keydown', handler);
}

// ── Online / offline ──────────────────────────────────────────────────
function updateOnlineStatus() {
  const btn = document.getElementById('refresh-btn');
  const online = navigator.onLine;
  btn.disabled = !online;
  btn.title = online ? 'Refresh feeds' : 'Offline — no connection';
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

// Auto-refresh when coming back to a stale tab
const FOCUS_REFRESH_TTL = 15 * 60 * 1000;
let _lastFocusRefresh = Date.now();
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !allFeeds.length || !navigator.onLine) return;
  const age = Date.now() - Math.max(_lastFocusRefresh, lastUpdatedTs || 0);
  if (age < FOCUS_REFRESH_TTL) return;
  _lastFocusRefresh = Date.now();
  loadFeeds(false).then(feeds => { allFeeds = feeds; rebuildFeedUrlMap(); });
});

// ── Keys modal ────────────────────────────────────────────────────────
const keysOverlay = document.getElementById('keys-overlay');
let _removeKeysTrap = null;
function openKeysOverlay() {
  keysOverlay.style.display = 'flex';
  if (_removeKeysTrap) _removeKeysTrap();
  _removeKeysTrap = trapFocus(keysOverlay);
}
function closeKeysOverlay() {
  closeOverlay(keysOverlay);
  if (_removeKeysTrap) { _removeKeysTrap(); _removeKeysTrap = null; }
}
document.getElementById('keys-btn').addEventListener('click', openKeysOverlay);
document.getElementById('keys-close').addEventListener('click', closeKeysOverlay);
keysOverlay.addEventListener('click', e => { if (e.target === keysOverlay) closeKeysOverlay(); });

const PAGE_SIZE = 10;

let allFeeds = [];
let allFeedsMap = new Map();
let feedUrlSet = new Set();

function rebuildFeedUrlMap() {
  allFeedsMap = new Map(allFeeds.map((f, i) => [f.url, i]));
  feedUrlSet = new Set(allFeeds.map(f => f.url));
}
let activeUrl = null;
let activeView = 'feeds';
let activeTag = null;
let feedPages = {};
let starredUrls = new Set();
let starredEntries = [];
let historyEntries = [];
let readUrls = new Set();
let categories = {}; // { "url": ["tag1", "tag2"] }
let categoriesVersion = 0;
let collapsedGroups = new Set();
let collapsedVersion = 0;
let searchQuery = '';
const feedErrors = new Map(); // url -> error message

const STARRED_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
const UNSTARRED_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
const CHEVRON_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>';
const EP_PLAY_SVG  = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
const EP_PAUSE_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
const EXT_LINK_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
const REFRESH_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';

const resolvedOgImages = new Map();
let searchIndex = [];
let searchIndexUrls = new Set();
let _chronoItems = [];

function buildSearchIndex(feeds, incremental = false) {
  if (!incremental) {
    searchIndex = [];
    searchIndexUrls = new Set();
  }
  feeds.forEach(feed => {
    (feed.items || []).forEach(item => {
      const key = (item.link || '') + '|' + (item.title || '');
      if (searchIndexUrls.has(key)) return;
      searchIndexUrls.add(key);
      searchIndex.push({
        titleLower: (item.title || '').toLowerCase(),
        summaryLower: (item.summary || '').toLowerCase(),
        item,
        feedTitle: feed.title || feed.url
      });
    });
  });
}

const READER_BASE_URL = browser.runtime.getURL('reader.html');

async function toggleStar(url, title, btn, image) {
  const { isStarred } = await browser.runtime.sendMessage({
    type: 'TOGGLE_STAR',
    entry: { url, title: title || url, image: image || '', starredAt: new Date().toISOString() }
  });
  if (isStarred) {
    starredUrls.add(url);
    starredEntries.unshift({ url, title: title || url, image: image || '', starredAt: new Date().toISOString() });
    btn.classList.add('starred');
    setSVG(btn, STARRED_SVG);
  } else {
    starredUrls.delete(url);
    starredEntries = starredEntries.filter(e => e.url !== url);
    btn.classList.remove('starred');
    setSVG(btn, UNSTARRED_SVG);
  }
}

feedItems.addEventListener('click', (e) => {
  const starBtn = e.target.closest('[data-action="star"]');
  if (starBtn) {
    e.stopPropagation();
    const item = starBtn.closest('.item');
    const url = item?.dataset.url;
    const title = item?.dataset.title;
    const image = item?.dataset.image || undefined;
    if (url) toggleStar(url, title, starBtn, image);
    return;
  }
  if (e.target.closest('.ext-link-btn')) return;
  const itemBody = e.target.closest('.item-body');
  if (itemBody) {
    const item = itemBody.closest('.item');
    const url = item?.dataset.url;
    const title = item?.dataset.title;
    const summary = item?.dataset.summary;
    if (url) openReader(url, title, summary);
  }
});

feedItems.addEventListener('mousemove', () => {
  if (selectedIdx >= 0) {
    const items = getItems();
    if (items[selectedIdx]) items[selectedIdx].classList.remove('keyboard-selected');
    selectedIdx = -1;
  }
}, { passive: true });


const _dateCache = new Map();
function formatDate(str) {
  if (!str) return '';
  if (_dateCache.has(str)) return _dateCache.get(str);
  try {
    const d = new Date(str);
    const result = isNaN(d) ? '' : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
    _dateCache.set(str, result);
    return result;
  } catch { return ''; }
}

function openReader(url, title, summary) {
  const queue = getItems().map(el => ({
    url: el.dataset.url || '',
    title: el.dataset.title || '',
    summary: el.dataset.summary || '',
  })).filter(i => i.url);
  if (queue.length) sessionStorage.setItem('readerQueue', JSON.stringify(queue));

  let readerUrl = READER_BASE_URL + '?url=' + encodeURIComponent(url);
  if (title) readerUrl += '&title=' + encodeURIComponent(title);
  if (summary) readerUrl += '&summary=' + encodeURIComponent(summary);
  window.location.href = readerUrl;
}

function preloadArticle(url) {
  browser.runtime.sendMessage({ type: 'FETCH_ARTICLE', url }).catch(() => {});
}

function renderSearchResults(container, feeds) {
  const q = searchQuery.toLowerCase();
  if (!searchIndex.length && feeds.length) buildSearchIndex(feeds);
  const matches = searchIndex.filter(e =>
    e.titleLower.includes(q) || e.summaryLower.includes(q)
  );
  if (!matches.length) {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'empty-state';
    const emptyP = document.createElement('p');
    emptyP.textContent = `No results for "${searchQuery}"`;
    emptyDiv.appendChild(emptyP);
    container.replaceChildren(emptyDiv);
    return;
  }
  const section = document.createElement('div');
  section.className = 'feed-section';
  matches.forEach(({ item, feedTitle }) => section.appendChild(makeItem(item, feedTitle)));
  container.appendChild(section);
  invalidateItemsCache();
  requestAnimationFrame(observeItems);
}

function renderChronologicalView(container, feeds) {
  _chronoItems = [];
  feeds.forEach(feed => {
    (feed.items || [])
      .filter(i => !i.link || !readUrls.has(i.link))
      .forEach(item => _chronoItems.push({ item, feedTitle: feed.title || feed.url }));
  });
  _chronoItems.sort((a, b) =>
    (b.item.date ? new Date(b.item.date).getTime() : 0) -
    (a.item.date ? new Date(a.item.date).getTime() : 0)
  );

  if (!_chronoItems.length) {
    const state = document.createElement('div');
    state.className = 'all-read-state';
    state.innerHTML = `
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      <strong>You're all caught up</strong>
      <span>No unread articles — check back later</span>`;
    container.appendChild(state);
    return;
  }

  const section = document.createElement('div');
  section.className = 'feed-section';
  const page = feedPages['__all__'] || 0;
  const visible = _chronoItems.slice(0, (page + 1) * PAGE_SIZE);
  const frag = document.createDocumentFragment();
  visible.forEach(({ item, feedTitle }) => frag.appendChild(makeItem(item, feedTitle)));
  section.appendChild(frag);

  const remaining = _chronoItems.length - visible.length;
  if (remaining > 0) {
    const more = document.createElement('button');
    more.className = 'show-more-btn';
    more.textContent = `Show more (${remaining})`;
    more.addEventListener('click', () => {
      feedPages['__all__'] = (feedPages['__all__'] || 0) + 1;
      appendChronoPage(section);
    });
    section.appendChild(more);
  }

  container.appendChild(section);
  invalidateItemsCache();
  requestAnimationFrame(observeItems);
}

function appendChronoPage(section) {
  section.querySelector('.show-more-btn')?.remove();
  const page = feedPages['__all__'] || 0;
  const newItems = _chronoItems.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const frag = document.createDocumentFragment();
  newItems.forEach(({ item, feedTitle }) => frag.appendChild(makeItem(item, feedTitle)));
  section.appendChild(frag);

  const remaining = _chronoItems.length - (page + 1) * PAGE_SIZE;
  if (remaining > 0) {
    const more = document.createElement('button');
    more.className = 'show-more-btn';
    more.textContent = `Show more (${remaining})`;
    more.addEventListener('click', () => {
      feedPages['__all__'] = (feedPages['__all__'] || 0) + 1;
      appendChronoPage(section);
    });
    section.appendChild(more);
  }

  invalidateItemsCache();
  requestAnimationFrame(observeItems);
}

function renderItems(feeds) {
  const container = feedItems;
  container.innerHTML = '';

  if (searchQuery) {
    renderSearchResults(container, feeds);
    return;
  }

  if (activeView === 'starred') {
    renderStarredView(container);
    return;
  }

  if (activeView === 'history') {
    renderHistoryView(container);
    return;
  }

  if (!activeUrl && !activeTag && activeView === 'feeds') {
    renderChronologicalView(container, feeds);
    return;
  }

  const toRender = activeUrl
    ? feeds.filter(f => f.url === activeUrl)
    : activeTag
      ? feeds.filter(f => categories[f.url]?.includes(activeTag))
      : feeds;

  if (!toRender.length) return;

  const frag = document.createDocumentFragment();
  let renderedItemCount = 0;

  if (activeTag && !activeUrl) {
    const header = document.createElement('div');
    header.className = 'feed-page-header';
    const pill = document.createElement('span');
    pill.style.cssText = 'background:var(--accent-muted);color:var(--accent);border-radius:20px;padding:2px 10px;font-size:12px;font-weight:500';
    pill.textContent = activeTag;
    header.appendChild(pill);
    frag.appendChild(header);
  }

  if (activeUrl && toRender.length === 1) {
    const feed = toRender[0];
    const header = document.createElement('div');
    header.className = 'feed-page-header';
    if (feed.icon) {
      const ico = document.createElement('img');
      ico.className = 'section-icon';
      ico.src = feed.icon;
      ico.alt = '';
      ico.onerror = () => ico.remove();
      header.appendChild(ico);
    }
    const name = document.createElement('span');
    name.textContent = feed.title || feed.url;
    header.appendChild(name);
    frag.appendChild(header);
  }

  if (!activeUrl && toRender.length > 1) {
    const recentItems = [];
    for (let fi = 0; fi < toRender.length; fi++) {
      const f = toRender[fi];
      const items = f.items;
      if (!items?.length) continue;
      const firstUnread = items.find(i => !i.link || !readUrls.has(i.link));
      if (!firstUnread) continue;
      recentItems.push({ item: firstUnread, feedTitle: f.title || f.url });
    }

    if (recentItems.length) {
      const section = document.createElement('div');
      section.className = 'feed-section';
      const title = document.createElement('div');
      title.className = 'feed-section-title';
      title.textContent = 'Recent';

      const chevron = document.createElement('span');
      chevron.className = 'section-chevron';
      setSVG(chevron, CHEVRON_SVG);
      title.appendChild(chevron);

      const itemsWrap = document.createElement('div');
      itemsWrap.className = 'section-items';

      title.style.cursor = 'pointer';
      let collapsed = false;
      title.addEventListener('click', () => {
        collapsed = !collapsed;
        itemsWrap.style.display = collapsed ? 'none' : '';
        chevron.classList.toggle('collapsed', collapsed);
      });

      section.appendChild(title);
      section.appendChild(itemsWrap);

      const RECENT_PAGE = 10;
      let recentShown = RECENT_PAGE;

      const renderRecentItems = () => {
        const recentFrag = document.createDocumentFragment();
        recentItems.slice(0, recentShown).forEach(({ item, feedTitle }) => {
          recentFrag.appendChild(makeItem(item, feedTitle));
        });
        itemsWrap.innerHTML = '';
        itemsWrap.appendChild(recentFrag);
        if (recentShown < recentItems.length) {
          const more = document.createElement('button');
          more.className = 'show-more-btn';
          more.textContent = `Show more (${recentItems.length - recentShown})`;
          more.addEventListener('click', () => {
            recentShown += RECENT_PAGE;
            renderRecentItems();
          });
          itemsWrap.appendChild(more);
        }
        requestAnimationFrame(observeItems);
      };

      renderRecentItems();
      frag.appendChild(section);
    }
  }

  toRender.forEach(feed => {
    const allItems = feed.items || [];
    const items = activeUrl ? allItems : allItems.filter(item => !item.link || !readUrls.has(item.link));

    if (!items.length && !feedErrors.has(feed.url)) return;
    renderedItemCount += items.length;

    const section = document.createElement('div');
    section.className = 'feed-section';
    section.dataset.feedUrl = feed.url;

    let itemsContainer = section;
    if (!activeUrl || toRender.length > 1) {
      const title = document.createElement('div');
      title.className = 'feed-section-title';
      if (feed.icon) {
        const ico = document.createElement('img');
        ico.className = 'section-icon';
        ico.src = feed.icon;
        ico.alt = '';
        ico.onerror = () => ico.remove();
        title.appendChild(ico);
      }
      const titleText = document.createElement('span');
      titleText.textContent = feed.title || feed.url;
      title.appendChild(titleText);

      const chevron = document.createElement('span');
      chevron.className = 'section-chevron';
      setSVG(chevron, CHEVRON_SVG);
      title.appendChild(chevron);

      const itemsWrap = document.createElement('div');
      itemsWrap.className = 'section-items';
      itemsContainer = itemsWrap;

      title.style.cursor = 'pointer';
      let collapsed = false;
      title.addEventListener('click', () => {
        collapsed = !collapsed;
        itemsWrap.style.display = collapsed ? 'none' : '';
        chevron.classList.toggle('collapsed', collapsed);
      });

      section.appendChild(title);
      section.appendChild(itemsWrap);
    }
    if (feedErrors.has(feed.url)) {
      const banner = document.createElement('div');
      banner.className = 'feed-error-banner';
      const errMsg = document.createElement('span');
      errMsg.textContent = feedErrors.get(feed.url);
      const retryBtn = document.createElement('button');
      retryBtn.className = 'feed-error-retry';
      retryBtn.textContent = 'Retry';
      retryBtn.addEventListener('click', () => {
        feedErrors.delete(feed.url);
        navBtnCache.get(feed.url)?.querySelector('.feed-error-dot')?.remove();
        setFetching(feed.url, true);
        browser.runtime.sendMessage({ type: 'RETRY_FEED', url: feed.url });
        scheduleRender();
      });
      banner.appendChild(errMsg);
      banner.appendChild(retryBtn);
      itemsContainer.appendChild(banner);
    }

    const page = feedPages[feed.url] || 0;
    const visible = items.slice(0, (page + 1) * PAGE_SIZE);

    const itemFrag = document.createDocumentFragment();
    visible.forEach(item => itemFrag.appendChild(
      feed.isPodcast ? makeEpisodeItem(item, feed) : makeItem(item)
    ));
    itemsContainer.appendChild(itemFrag);

    const remaining = items.length - visible.length;
    if (remaining > 0) {
      if (activeUrl) {
        const sentinel = document.createElement('div');
        sentinel.className = 'scroll-sentinel';
        sentinel.dataset.feedUrl = feed.url;
        itemsContainer.appendChild(sentinel);
        scrollObserver.observe(sentinel);
      } else {
        const more = document.createElement('button');
        more.className = 'show-more-btn';
        more.textContent = `Show more (${remaining})`;
        more.addEventListener('click', () => {
          feedPages[feed.url] = (feedPages[feed.url] || 0) + 1;
          appendMoreItems(itemsContainer, feed, items, feeds);
        });
        itemsContainer.appendChild(more);
      }
    }

    frag.appendChild(section);
  });

  // All-read empty state
  if (!activeUrl && activeView === 'feeds' && renderedItemCount === 0) {
    {
      const state = document.createElement('div');
      state.className = 'all-read-state';
      state.innerHTML = `
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <strong>You're all caught up</strong>
        <span>No unread articles — check back later</span>`;
      frag.appendChild(state);
    }
  }

  container.appendChild(frag);
  invalidateItemsCache();
  requestAnimationFrame(observeItems);
}

function renderStarredView(container) {
  if (!starredEntries.length) {
    container.innerHTML = '<div class="empty-state"><p>No starred articles.</p></div>';
    return;
  }
  const section = document.createElement('div');
  section.className = 'feed-section';
  const frag = document.createDocumentFragment();
  starredEntries.forEach(entry => {
    frag.appendChild(makeItem({ title: entry.title, link: entry.url, date: entry.starredAt, image: entry.image }));
  });
  section.appendChild(frag);
  container.appendChild(section);
  invalidateItemsCache();
  requestAnimationFrame(observeItems);
}

function renderHistoryView(container) {
  if (!historyEntries.length) {
    container.innerHTML = '<div class="empty-state"><p>No reading history yet.</p></div>';
    return;
  }
  const section = document.createElement('div');
  section.className = 'feed-section';
  const title = document.createElement('div');
  title.className = 'feed-section-title';
  title.textContent = 'Recently Read';
  section.appendChild(title);
  const frag = document.createDocumentFragment();
  historyEntries.forEach(entry => {
    frag.appendChild(makeItem({ title: entry.title, link: entry.url, date: entry.readAt }));
  });
  section.appendChild(frag);
  container.appendChild(section);
  invalidateItemsCache();
  requestAnimationFrame(observeItems);
}

function appendMoreItems(section, feed, filteredItems, feeds) {
  section.querySelector('.show-more-btn, .scroll-sentinel')?.remove();

  const page = feedPages[feed.url] || 0;
  const prevCount = page * PAGE_SIZE;
  const visible = filteredItems.slice(0, (page + 1) * PAGE_SIZE);
  const newItems = visible.slice(prevCount);

  const frag = document.createDocumentFragment();
  newItems.forEach(item => frag.appendChild(
    feed.isPodcast ? makeEpisodeItem(item, feed) : makeItem(item)
  ));
  section.appendChild(frag);

  const remaining = filteredItems.length - visible.length;
  if (remaining > 0) {
    if (activeUrl) {
      const sentinel = document.createElement('div');
      sentinel.className = 'scroll-sentinel';
      sentinel.dataset.feedUrl = feed.url;
      section.appendChild(sentinel);
      scrollObserver.observe(sentinel);
    } else {
      const more = document.createElement('button');
      more.className = 'show-more-btn';
      more.textContent = `Show more (${remaining})`;
      more.addEventListener('click', () => {
        feedPages[feed.url] = (feedPages[feed.url] || 0) + 1;
        appendMoreItems(section, feed, filteredItems, feeds);
      });
      section.appendChild(more);
    }
  }

  invalidateItemsCache();
  requestAnimationFrame(observeItems);
}

function makeItem(item, sourceMeta) {
  const el = document.createElement('div');
  el.className = 'item' + (item.link && readUrls.has(item.link) ? ' read' : '');
  if (item.link) {
    el.dataset.url = item.link;
    el.dataset.title = item.title || '';
    if (item.image) el.dataset.image = item.image;
    if (item.summary) el.dataset.summary = item.summary.slice(0, 500);
  }

  if (item.image) {
    const img = document.createElement('img');
    img.className = 'item-thumb';
    img.src = item.image;
    img.alt = '';
    img.loading = 'lazy';
    img.onerror = () => img.replaceWith(makePlaceholder());
    el.appendChild(img);
  } else if (item.link && resolvedOgImages.has(item.link)) {
    const img = document.createElement('img');
    img.className = 'item-thumb';
    img.src = resolvedOgImages.get(item.link);
    img.alt = '';
    img.loading = 'lazy';
    img.onerror = () => img.replaceWith(makePlaceholder());
    el.appendChild(img);
  } else if (item.link) {
    const placeholder = makePlaceholder();
    placeholder.dataset.ogUrl = item.link;
    ogObserver.observe(placeholder);
    el.appendChild(placeholder);
  } else {
    el.appendChild(makePlaceholder());
  }

  const body = document.createElement('div');
  body.className = 'item-body';
  body.style.cursor = item.link ? 'pointer' : 'default';

  const titleEl = document.createElement('div');
  titleEl.className = 'item-title';
  titleEl.textContent = item.title;
  body.appendChild(titleEl);

  const metaParts = [formatDate(item.date), sourceMeta].filter(Boolean);
  const meta = document.createElement('div');
  meta.className = 'item-meta';
  const metaText = document.createElement('span');
  metaText.textContent = metaParts.join(' · ');
  meta.appendChild(metaText);
  body.appendChild(meta);

  el.appendChild(body);

  if (item.link) {
    const isStarred = starredUrls.has(item.link);
    const starBtn = document.createElement('button');
    starBtn.className = 'star-btn' + (isStarred ? ' starred' : '');
    starBtn.dataset.action = 'star';
    setSVG(starBtn, isStarred ? STARRED_SVG : UNSTARRED_SVG);
    el.appendChild(starBtn);

    const extLink = document.createElement('a');
    extLink.className = 'ext-link-btn';
    extLink.href = item.link;
    extLink.target = '_blank';
    extLink.rel = 'noopener noreferrer';
    extLink.title = 'Open original';
    setSVG(extLink, EXT_LINK_SVG);
    el.appendChild(extLink);
  }

  return el;
}

function makePlaceholder() {
  const d = document.createElement('div');
  d.className = 'item-thumb-placeholder';
  return d;
}

// ── Podcast player ────────────────────────────────────────────────────
const podcastAudio   = document.getElementById('podcast-audio');
const playerEl       = document.getElementById('podcast-player');
const playerPlay     = document.getElementById('player-play');
const playerSeek     = document.getElementById('player-seek');
const playerCurrent  = document.getElementById('player-current');
const playerDuration = document.getElementById('player-duration');
const playerSpeed    = document.getElementById('player-speed');
const playerTitle    = document.getElementById('player-title');
const playerFeed     = document.getElementById('player-feed');
const playerThumb    = document.getElementById('player-thumb');

const SPEEDS = [1, 1.5, 2, 0.75];
let speedIdx = 0;
let currentEpisodeUrl = null;


const PLAYER_STATE_KEY = 'podcastPlayerState';

function savePlayerState() {
  if (!currentEpisodeUrl) return;
  localStorage.setItem(PLAYER_STATE_KEY, JSON.stringify({
    audioUrl: currentEpisodeUrl,
    currentTime: podcastAudio.currentTime,
    title: playerTitle.textContent,
    feedTitle: playerFeed.textContent,
    thumb: playerThumb.src,
    speedIdx,
  }));
}

function clearPlayerState() {
  localStorage.removeItem(PLAYER_STATE_KEY);
}

function fmtTime(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function playEpisode(item, feed) {
  if (!item.audioUrl) return;
  const isSame = currentEpisodeUrl === item.audioUrl;

  if (!isSame) {
    currentEpisodeUrl = item.audioUrl;
    podcastAudio.src = item.audioUrl;
    podcastAudio.playbackRate = SPEEDS[speedIdx];
    playerTitle.textContent = item.title;
    playerFeed.textContent = feed?.title || '';
    const thumb = feed?.podcastImage || feed?.icon || '';
    playerThumb.src = thumb;
    playerThumb.style.display = thumb ? '' : 'none';
    playerEl.style.display = 'flex';
    document.querySelector('.layout').classList.add('has-player');
    document.querySelectorAll('.episode-item.playing').forEach(e => e.classList.remove('playing'));
  }

  if (podcastAudio.paused) {
    podcastAudio.play();
  } else {
    podcastAudio.pause();
  }

  updatePlayingItem(item.audioUrl);
}

function updatePlayingItem(audioUrl) {
  // Clear the previously active item (if any)
  const prev = feedItems.querySelector('.episode-item.playing');
  if (prev) {
    prev.classList.remove('playing');
    const btn = prev.querySelector('.episode-play-btn');
    if (btn) btn.innerHTML = EP_PLAY_SVG;
  }
  if (!audioUrl) return;
  const el = feedItems.querySelector(`.episode-item[data-audio-url="${CSS.escape(audioUrl)}"]`);
  if (!el) return;
  const isPlaying = !podcastAudio.paused;
  el.classList.toggle('playing', isPlaying);
  const btn = el.querySelector('.episode-play-btn');
  if (btn) btn.innerHTML = isPlaying ? EP_PAUSE_SVG : EP_PLAY_SVG;
}

podcastAudio.addEventListener('play',  () => updatePlayingItem(currentEpisodeUrl));
podcastAudio.addEventListener('pause', () => updatePlayingItem(currentEpisodeUrl));

let _lastTimeSec = -1;
podcastAudio.addEventListener('timeupdate', () => {
  if (!isFinite(podcastAudio.duration)) return;
  const sec = Math.floor(podcastAudio.currentTime);
  if (sec === _lastTimeSec) return;
  _lastTimeSec = sec;
  playerCurrent.textContent = fmtTime(podcastAudio.currentTime);
  playerSeek.value = (podcastAudio.currentTime / podcastAudio.duration) * 100;
});

podcastAudio.addEventListener('pause', savePlayerState);
document.addEventListener('visibilitychange', () => { if (document.hidden) savePlayerState(); });
window.addEventListener('beforeunload', savePlayerState);

podcastAudio.addEventListener('loadedmetadata', () => {
  _lastTimeSec = -1;
  playerDuration.textContent = fmtTime(podcastAudio.duration);
  const saved = podcastAudio._seekOnLoad;
  if (saved) {
    podcastAudio.currentTime = saved;
    podcastAudio._seekOnLoad = null;
    playerSeek.value = (saved / podcastAudio.duration) * 100;
    playerCurrent.textContent = fmtTime(saved);
  }
});

playerPlay.addEventListener('click', () => {
  if (podcastAudio.paused) podcastAudio.play(); else podcastAudio.pause();
});

podcastAudio.addEventListener('play',  () => {
  playerPlay.querySelector('.play-icon').style.display = 'none';
  playerPlay.querySelector('.pause-icon').style.display = '';
});
podcastAudio.addEventListener('pause', () => {
  playerPlay.querySelector('.play-icon').style.display = '';
  playerPlay.querySelector('.pause-icon').style.display = 'none';
});

playerSeek.addEventListener('input', () => {
  if (!isFinite(podcastAudio.duration)) return;
  podcastAudio.currentTime = (playerSeek.value / 100) * podcastAudio.duration;
});

document.getElementById('player-skip-back').addEventListener('click', () => {
  podcastAudio.currentTime = Math.max(0, podcastAudio.currentTime - 15);
});
document.getElementById('player-skip-fwd').addEventListener('click', () => {
  podcastAudio.currentTime = Math.min(podcastAudio.duration || 0, podcastAudio.currentTime + 30);
});

playerSpeed.addEventListener('click', () => {
  speedIdx = (speedIdx + 1) % SPEEDS.length;
  const s = SPEEDS[speedIdx];
  podcastAudio.playbackRate = s;
  playerSpeed.textContent = s + '×';
});

document.getElementById('player-close').addEventListener('click', () => {
  podcastAudio.pause();
  podcastAudio.src = '';
  currentEpisodeUrl = null;
  playerEl.style.display = 'none';
  document.querySelector('.layout').classList.remove('has-player');
  document.querySelectorAll('.episode-item.playing').forEach(e => e.classList.remove('playing'));
  clearPlayerState();
});

function restorePlayerState() {
  const raw = localStorage.getItem(PLAYER_STATE_KEY);
  if (!raw) return;
  try {
    const s = JSON.parse(raw);
    if (!s.audioUrl) return;
    currentEpisodeUrl = s.audioUrl;
    podcastAudio.src = s.audioUrl;
    podcastAudio._seekOnLoad = s.currentTime || 0;
    speedIdx = s.speedIdx || 0;
    podcastAudio.playbackRate = SPEEDS[speedIdx];
    playerSpeed.textContent = SPEEDS[speedIdx] + '×';
    playerTitle.textContent = s.title || '';
    playerFeed.textContent = s.feedTitle || '';
    playerThumb.src = s.thumb || '';
    playerThumb.style.display = s.thumb ? '' : 'none';
    playerCurrent.textContent = fmtTime(s.currentTime || 0);
    playerEl.style.display = 'flex';
    document.querySelector('.layout').classList.add('has-player');
  } catch {}
}

function makeEpisodeItem(item, feed) {
  const el = document.createElement('div');
  el.className = 'episode-item';
  if (item.audioUrl) el.dataset.audioUrl = item.audioUrl;

  const playBtn = document.createElement('button');
  playBtn.className = 'episode-play-btn';
  playBtn.innerHTML = EP_PLAY_SVG;
  playBtn.addEventListener('click', e => { e.stopPropagation(); playEpisode(item, feed); });
  el.appendChild(playBtn);

  const body = document.createElement('div');
  body.className = 'episode-body';

  const titleEl = document.createElement('div');
  titleEl.className = 'episode-title';
  titleEl.textContent = item.episode ? `${item.episode}. ${item.title}` : item.title;
  body.appendChild(titleEl);

  const meta = document.createElement('div');
  meta.className = 'episode-meta';
  meta.textContent = formatDate(item.date);
  body.appendChild(meta);

  el.appendChild(body);

  if (item.duration) {
    const dur = document.createElement('span');
    dur.className = 'episode-duration';
    dur.textContent = fmtTime(item.duration);
    el.appendChild(dur);
  }

  const isStarred = starredUrls.has(item.link);
  const starBtn = document.createElement('button');
  starBtn.className = 'star-btn' + (isStarred ? ' starred' : '');
  starBtn.dataset.action = 'star';
  setSVG(starBtn, isStarred ? STARRED_SVG : UNSTARRED_SVG);
  starBtn.addEventListener('click', e => { e.stopPropagation(); toggleStar(item.link, item.title, starBtn, item.image || feed.podcastImage || ''); });
  el.appendChild(starBtn);

  el.addEventListener('click', () => playEpisode(item, feed));
  return el;
}

const scrollObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    scrollObserver.unobserve(entry.target);
    const feedUrl = entry.target.dataset.feedUrl;
    const idx = allFeedsMap.get(feedUrl);
    if (idx === undefined) return;
    const feed = allFeeds[idx];
    const section = entry.target.parentElement;
    feedPages[feedUrl] = (feedPages[feedUrl] || 0) + 1;
    appendMoreItems(section, feed, feed.items || [], allFeeds);
  });
}, { rootMargin: '300px' });

const ogObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    ogObserver.unobserve(entry.target);
    const el = entry.target;
    const articleUrl = el.dataset.ogUrl;
    if (!articleUrl) return;
    browser.runtime.sendMessage({ type: 'FETCH_OG_IMAGE', url: articleUrl, cacheKey: articleUrl })
      .then(({ image }) => {
        if (!image) return;
        if (resolvedOgImages.size >= 500) resolvedOgImages.delete(resolvedOgImages.keys().next().value);
        resolvedOgImages.set(articleUrl, image);
        const img = document.createElement('img');
        img.className = 'item-thumb';
        img.src = image;
        img.alt = '';
        img.onerror = () => img.remove();
        el.replaceWith(img);
      });
  });
}, { rootMargin: '200px' });

let staticNavBtns = [];
function clearActiveNav() {
  staticNavBtns.forEach(el => el.classList.remove('active'));
  navBtnCache.forEach(btn => btn.classList.remove('active'));
}

function setActiveNav(id) {
  clearActiveNav();
  if (id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  }
}

function showFeeds() {
  activeView = 'feeds'; activeUrl = null; activeTag = null; feedPages = {};
  setActiveNav('nav-all');
  fadeContent(() => renderItems(allFeeds));
}

function showStarred() {
  activeView = 'starred'; activeUrl = null; feedPages = {};
  setActiveNav('nav-starred');
  fadeContent(() => renderItems(allFeeds));
}

function showHistory() {
  activeView = 'history'; activeUrl = null; feedPages = {};
  setActiveNav('nav-history');
  fadeContent(() => renderItems(allFeeds));
}

let cachedTagList = null;
let cachedTagVersion = 0;
let tagVersion = 0;

function getUniqueTags() {
  tagVersion++;
  if (cachedTagList && cachedTagVersion === tagVersion - 1) return cachedTagList;
  const tags = Object.keys(categories).flatMap(url => categories[url] || []);
  cachedTagList = [...new Set(tags)].sort();
  cachedTagVersion = tagVersion;
  return cachedTagList;
}

function cycleTag() {
  const uniqueTags = getUniqueTags();
  if (!uniqueTags.length) return;
  if (!activeTag) {
    activeTag = uniqueTags[0];
  } else {
    const idx = uniqueTags.indexOf(activeTag);
    activeTag = uniqueTags[(idx + 1) % uniqueTags.length];
  }
  activeUrl = null;
  activeView = 'feeds';
  feedPages = {};
  renderNav(allFeeds);
  fadeContent(() => renderItems(allFeeds));
}

function renderNav(feeds, force = false) {
  const staticNav = document.getElementById('feed-nav-static');

  const all = staticNav.querySelector('#nav-all') || (() => {
    const btn = document.createElement('button');
    btn.id = 'nav-all';
    btn.className = 'nav-item';
    btn.textContent = 'All';
    btn.style.animationDelay = '0ms';
    btn.addEventListener('click', showFeeds);
    staticNav.appendChild(btn);
    return btn;
  })();

  const starBtn = staticNav.querySelector('#nav-starred') || (() => {
    const btn = document.createElement('button');
    btn.id = 'nav-starred';
    btn.className = 'nav-item';
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> Starred';
    btn.style.animationDelay = '40ms';
    btn.addEventListener('click', showStarred);
    staticNav.appendChild(btn);
    return btn;
  })();

  const histBtn = staticNav.querySelector('#nav-history') || (() => {
    const btn = document.createElement('button');
    btn.id = 'nav-history';
    btn.className = 'nav-item';
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> History';
    btn.style.animationDelay = '80ms';
    btn.addEventListener('click', showHistory);
    staticNav.appendChild(btn);
    return btn;
  })();

  staticNavBtns = [all, starBtn, histBtn];
  all.className = 'nav-item' + (!activeUrl && !activeTag && activeView === 'feeds' ? ' active' : '');
  starBtn.className = 'nav-item' + (activeView === 'starred' ? ' active' : '');
  histBtn.className = 'nav-item' + (activeView === 'history' ? ' active' : '');

  const nav = document.getElementById('feed-nav');
  const feedsKey = feeds.map(f => f.url).join(',');

  if (!force && nav._lastKey === feedsKey && nav._lastCatsV === categoriesVersion && nav._lastCollapsedV === collapsedVersion) {
    clearActiveNav();
    if (activeView === 'feeds' && activeUrl) {
      const btn = navBtnCache.get(activeUrl) || nav.querySelector(`button[data-url="${CSS.escape(activeUrl)}"]`);
      btn?.classList.add('active');
    } else if (activeView === 'feeds' && activeTag) {
      nav.querySelector('.nav-group-header.active-tag')?.classList.remove('active-tag');
      const headers = nav.querySelectorAll('.nav-group-header');
      headers.forEach(h => { if (h.dataset.tag === activeTag) h.classList.add('active-tag'); });
    }
    return;
  }
  nav._lastKey = feedsKey;
  nav._lastCatsV = categoriesVersion;
  nav._lastCollapsedV = collapsedVersion;

  nav.innerHTML = '';
  navBtnCache.clear();

  const grouped = {};
  const ungrouped = [];

  feeds.forEach(feed => {
    const tags = categories[feed.url];
    if (tags?.length) {
      tags.forEach(tag => {
        if (!grouped[tag]) grouped[tag] = [];
        grouped[tag].push(feed);
      });
    } else {
      ungrouped.push(feed);
    }
  });

  function makeFeedBtn(feed) {
    const btn = document.createElement('button');
    btn.className = 'nav-item' + (activeUrl === feed.url ? ' active' : '');
    btn.dataset.url = feed.url;
    navBtnCache.set(feed.url, btn);
    if (fetchingUrls.has(feed.url)) {
      const dot = document.createElement('span');
      dot.className = 'fetch-dot';
      btn.appendChild(dot);
    }
    if (feed.icon) {
      const img = document.createElement('img');
      img.className = 'nav-icon';
      img.src = feed.icon; img.alt = '';
      img.onerror = () => img.remove();
      btn.appendChild(img);
    }
    const label = document.createElement('span');
    label.textContent = feed.title || feed.url;
    btn.appendChild(label);
    btn.title = feed.title || feed.url;
    btn.addEventListener('click', () => {
      activeView = 'feeds'; activeUrl = feed.url; feedPages = {};
      clearActiveNav();
      btn.classList.add('active');
      fadeContent(() => renderItems(allFeeds));
    });
    return btn;
  }

  const frag = document.createDocumentFragment();

  Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).forEach(([tag, tagFeeds]) => {
    const collapsed = collapsedGroups.has(tag);

    const header = document.createElement('div');
    header.className = 'nav-group-header' + (activeTag === tag ? ' active active-tag' : '');
    header.dataset.tag = tag;

    const headerLabel = document.createElement('span');
    headerLabel.textContent = tag;
    headerLabel.style.flex = '1';

    const chevron = document.createElement('span');
    chevron.className = 'nav-group-chevron' + (collapsed ? ' collapsed' : '');
    chevron.innerHTML = CHEVRON_SVG;

    header.appendChild(headerLabel);
    header.appendChild(chevron);

    headerLabel.addEventListener('click', (e) => {
      e.stopPropagation();
      activeTag = activeTag === tag ? null : tag;
      if (activeTag) activeUrl = null;
      activeView = 'feeds'; feedPages = {};
      renderNav(allFeeds);
      fadeContent(() => renderItems(allFeeds));
    });

    chevron.addEventListener('click', (e) => {
      e.stopPropagation();
      if (collapsed) collapsedGroups.delete(tag);
      else collapsedGroups.add(tag);
      collapsedVersion++;
      browser.storage.local.set({ collapsedGroups: [...collapsedGroups] });
      renderNav(allFeeds);
    });

    frag.appendChild(header);

    if (!collapsed) {
      tagFeeds.forEach(feed => frag.appendChild(makeFeedBtn(feed)));
    }
  });

  const ungroupedFeeds    = ungrouped.filter(f => !f.isPodcast);
  const ungroupedPodcasts = ungrouped.filter(f => f.isPodcast);

  if (Object.keys(grouped).length && ungroupedFeeds.length) {
    const sep = document.createElement('div');
    sep.className = 'nav-sep';
    frag.appendChild(sep);
  }

  ungroupedFeeds.forEach(feed => frag.appendChild(makeFeedBtn(feed)));

  if (ungroupedPodcasts.length) {
    const sep = document.createElement('div');
    sep.className = 'nav-sep';
    frag.appendChild(sep);

    const podHeader = document.createElement('div');
    podHeader.className = 'nav-group-header';
    podHeader.style.cursor = 'default';
    podHeader.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="11" r="3"/><path d="M12 2a7 7 0 0 1 7 7v1a7 7 0 0 1-14 0v-1a7 7 0 0 1 7-7z"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg><span style="margin-left:5px">Podcasts</span>';
    frag.appendChild(podHeader);

    ungroupedPodcasts.forEach(feed => frag.appendChild(makeFeedBtn(feed)));
  }

  // Stagger animation delays across all newly-built nav rows
  const navRows = frag.querySelectorAll('.nav-item, .nav-group-header');
  navRows.forEach((el, i) => { el.style.animationDelay = `${i * 28}ms`; });

  nav.appendChild(frag);
}

async function loadFeeds(force = false) {
  const type = force ? 'FORCE_REFRESH' : 'FETCH_FEEDS';
  const response = await browser.runtime.sendMessage({ type });
  const feeds = response?.feeds || [];
  // Mark stale/empty feeds as fetching
  feeds.forEach(f => { if (!f.items?.length || f.cached === undefined) setFetching(f.url, true); });
  return feeds;
}

async function init() {
  initTheme('theme-btn');
  updateOnlineStatus();
  restorePlayerState();

  const [data, feedsList] = await Promise.all([
    browser.storage.local.get(['starred', 'history', 'categories', 'collapsedGroups']),
    loadFeeds(),
  ]);

  starredEntries = (data.starred || []).slice().reverse();
  starredUrls = new Set(starredEntries.map(s => s.url));
  historyEntries = (data.history || []).slice().reverse();
  readUrls = new Set(historyEntries.map(h => h.url));
  categories = data.categories || {};
  categoriesVersion++;
  cachedTagList = null;
  if (data.collapsedGroups?.length) {
    collapsedGroups = new Set(data.collapsedGroups);
    collapsedVersion++;
  }

  allFeeds = feedsList;
  rebuildFeedUrlMap();

  if (!allFeeds.length) {
    document.getElementById('empty-state').style.display = 'flex';
    return;
  }

  buildSearchIndex(allFeeds);
  renderNav(allFeeds, true);

  if (allFeeds.some(f => f.items?.length > 0)) {
    renderItems(allFeeds);
  } else {
    showSkeletons(6);
  }
}

// ── Refresh progress ──────────────────────────────────────────────────
let _refreshing = false;
let _refreshLoaded = 0;
let _refreshTotal = 0;
let _refreshOriginalHTML = '';

function startRefreshProgress(total) {
  _refreshing = true;
  _refreshLoaded = 0;
  _refreshTotal = total;
  const btn = document.getElementById('refresh-btn');
  _refreshOriginalHTML = btn.innerHTML;
  _updateRefreshBtn();
}

function _updateRefreshBtn() {
  const btn = document.getElementById('refresh-btn');
  if (!btn || !_refreshing) return;
  btn.innerHTML = `<span style="font-size:11px;line-height:1;font-family:inherit">${_refreshLoaded}/${_refreshTotal}</span>`;
}

function endRefreshProgress() {
  _refreshing = false;
  const btn = document.getElementById('refresh-btn');
  if (btn && _refreshOriginalHTML) btn.innerHTML = _refreshOriginalHTML;
}

document.getElementById('refresh-btn').addEventListener('click', async () => {
  if (!navigator.onLine) return;
  feedPages = {};
  startRefreshProgress(allFeeds.length);
  allFeeds = await loadFeeds(true);
  rebuildFeedUrlMap();
  renderNav(allFeeds, true);
  renderItems(allFeeds);
});

const overlay = document.getElementById('modal-overlay');
const modal = document.getElementById('options-modal');

let _removeModalTrap = null;
function openModal() {
  overlay.style.display = 'flex';
  renderFeedManage();
  if (_removeModalTrap) _removeModalTrap();
  _removeModalTrap = trapFocus(modal);
}
function closeModal() {
  closeOverlay(overlay);
  if (_removeModalTrap) { _removeModalTrap(); _removeModalTrap = null; }
}

document.getElementById('options-btn').addEventListener('click', () => {
  openModal();
  initNativeSettings();
  initRefreshInterval();
});

document.getElementById('modal-close').addEventListener('click', closeModal);
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

document.getElementById('add-first-btn')?.addEventListener('click', () => {
  openModal();
  initNativeSettings();
  initRefreshInterval();
});

async function applyFeeds(updatedUrls) {
  await browser.runtime.sendMessage({ type: 'SET_FEEDS', feeds: updatedUrls });
  allFeeds = updatedUrls.map(u => allFeeds.find(f => f.url === u) || { url: u, title: u, items: [] });
  rebuildFeedUrlMap();
  renderNav(allFeeds, true);
  renderItems(allFeeds);
  renderFeedManage();
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const ts = new Date(dateStr).getTime();
  if (isNaN(ts)) return '';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

async function renderFeedManage() {
  const { feeds = [] } = await browser.storage.local.get('feeds');
  const list = document.getElementById('feed-list-manage');
  list.innerHTML = '';

  const frag = document.createDocumentFragment();
  let dragSrcIdx = null;

  feeds.forEach((url, idx) => {
    const cached = allFeeds.find(f => f.url === url);
    const row = document.createElement('div');
    row.className = 'feed-manage-item';
    row.tabIndex = 0;
    row.draggable = true;
    row.dataset.idx = idx;

    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>';

    const main = document.createElement('div');
    main.className = 'feed-manage-main';

    if (cached?.icon) {
      const ico = document.createElement('img');
      ico.src = cached.icon; ico.width = 14; ico.height = 14;
      ico.style.cssText = 'border-radius:2px;flex-shrink:0;object-fit:contain';
      ico.onerror = () => ico.remove();
      main.appendChild(ico);
    }

    const titleEl = document.createElement('span');
    titleEl.className = 'feed-manage-title';
    titleEl.textContent = cached?.title && cached.title !== url ? cached.title : url;
    titleEl.title = url;
    main.appendChild(titleEl);

    // Tags as pills
    const tagsEl = document.createElement('div');
    tagsEl.className = 'feed-manage-tags';

    function renderTags() {
      tagsEl.innerHTML = '';
      const tags = categories[url] || [];
      tags.forEach(tag => {
        const pill = document.createElement('span');
        pill.className = 'feed-tag-pill';
        pill.textContent = tag;
        pill.addEventListener('click', (e) => { e.stopPropagation(); openTagInput(); });
        tagsEl.appendChild(pill);
      });
      const addBtn = document.createElement('span');
      addBtn.className = 'feed-tag-add';
      addBtn.textContent = tags.length ? '+ tag' : '+ add tag';
      addBtn.addEventListener('click', (e) => { e.stopPropagation(); openTagInput(); });
      tagsEl.appendChild(addBtn);
    }

    function openTagInput() {
      tagsEl.innerHTML = '';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'tag-input';
      input.placeholder = 'tag1, tag2…';
      input.value = (categories[url] || []).join(', ');
      tagsEl.appendChild(input);
      input.focus();
      async function save() {
        const tags = input.value.split(',').map(t => t.trim()).filter(Boolean);
        if (tags.length) categories[url] = tags; else delete categories[url];
        categoriesVersion++;
        await browser.runtime.sendMessage({ type: 'SET_CATEGORIES', categories });
        renderNav(allFeeds, true);
        renderTags();
      }
      input.addEventListener('blur', save);
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { renderTags(); }
      });
    }

    renderTags();
    main.appendChild(tagsEl);

    const age = document.createElement('span');
    age.className = 'feed-manage-age';
    age.textContent = timeAgo(cached?.items?.[0]?.date);

    const rm = document.createElement('button');
    rm.className = 'remove-btn';
    rm.textContent = 'Remove';
    rm.style.opacity = '0';
    rm.style.transition = 'opacity 120ms ease';
    row.addEventListener('mouseenter', () => rm.style.opacity = '1');
    row.addEventListener('mouseleave', () => rm.style.opacity = '0');
    rm.addEventListener('click', async (e) => {
      e.stopPropagation();
      const { feeds: current = [] } = await browser.storage.local.get('feeds');
      await applyFeeds(current.filter(f => f !== url));
    });

    row.addEventListener('dragstart', (e) => {
      dragSrcIdx = idx;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => row.classList.add('dragging'), 0);
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      list.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      list.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      if (idx !== dragSrcIdx) row.classList.add('drag-over');
    });
    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (dragSrcIdx === null || dragSrcIdx === idx) return;
      const { feeds: current = [] } = await browser.storage.local.get('feeds');
      const reordered = [...current];
      const [moved] = reordered.splice(dragSrcIdx, 1);
      reordered.splice(idx, 0, moved);
      await applyFeeds(reordered);
    });

    row.appendChild(handle);
    row.appendChild(main);
    row.appendChild(age);
    row.appendChild(rm);
    frag.appendChild(row);
  });

  list.appendChild(frag);
}

document.getElementById('add-feed-btn').addEventListener('click', async () => {
  const input = document.getElementById('feed-url-input');
  const msgEl = document.getElementById('modal-msg');
  const raw = input.value.trim();
  if (!raw) return;

  msgEl.textContent = 'Discovering…';
  try {
    const { url: feedUrl } = await browser.runtime.sendMessage({ type: 'DISCOVER_FEED', url: raw });
    const { feeds = [] } = await browser.storage.local.get('feeds');
    if (feedUrlSet.has(feedUrl)) { msgEl.textContent = 'Feed already added.'; return; }
    const updated = [...feeds, feedUrl];
    await browser.runtime.sendMessage({ type: 'SET_FEEDS', feeds: updated });
    input.value = '';
    msgEl.textContent = feedUrl !== raw ? `Found: ${feedUrl}` : 'Feed added.';
    renderFeedManage();
    setTimeout(() => { msgEl.textContent = ''; }, 3000);
    document.getElementById('empty-state').style.display = 'none';
    feedPages = {};
    allFeeds = await loadFeeds(true);
    rebuildFeedUrlMap();
    renderNav(allFeeds, true);
    renderItems(allFeeds);
  } catch (e) {
    msgEl.textContent = 'Error: ' + e.message;
  }
});

const purgeBtn = document.getElementById('purge-btn');
purgeBtn.addEventListener('click', () => {
  if (purgeBtn.dataset.confirm) {
    browser.storage.local.clear().then(() => window.location.reload());
  } else {
    purgeBtn.dataset.confirm = '1';
    purgeBtn.textContent = 'Confirm — click again to delete';
    setTimeout(() => {
      purgeBtn.textContent = 'Delete all data';
      delete purgeBtn.dataset.confirm;
    }, 3000);
  }
});

document.getElementById('feed-url-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('add-feed-btn').click();
});

// ── OPML export ───────────────────────────────────────────────────────
document.getElementById('opml-export-btn').addEventListener('click', async () => {
  const { feeds = [] } = await browser.storage.local.get('feeds');
  const lines = feeds.map(url => {
    const cached = allFeeds.find(f => f.url === url);
    const title = (cached?.title || url).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const xmlUrl = url.replace(/&/g, '&amp;');
    const htmlUrl = (cached?.link || url).replace(/&/g, '&amp;');
    return `    <outline type="rss" text="${title}" title="${title}" xmlUrl="${xmlUrl}" htmlUrl="${htmlUrl}"/>`;
  });
  const opml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head><title>paperboy feeds</title></head>',
    '  <body>',
    ...lines,
    '  </body>',
    '</opml>',
  ].join('\n');

  const blob = new Blob([opml], { type: 'text/xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'paperboy-feeds.opml';
  a.click();
  URL.revokeObjectURL(a.href);
});

// ── OPML import ───────────────────────────────────────────────────────
document.getElementById('opml-import-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const msgEl = document.getElementById('opml-msg');
  msgEl.textContent = 'Importing…';

  try {
    const text = await file.text();
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    const outlines = Array.from(doc.querySelectorAll('outline[xmlUrl]'));
    if (!outlines.length) { msgEl.textContent = 'No feeds found in file.'; return; }

    const { feeds: existing = [] } = await browser.storage.local.get('feeds');
    const existingSet = new Set(existing);
    const toAdd = outlines.map(o => o.getAttribute('xmlUrl')).filter(u => u && !existingSet.has(u));

    if (!toAdd.length) { msgEl.textContent = 'All feeds already added.'; return; }

    const updated = [...existing, ...toAdd];
    await browser.runtime.sendMessage({ type: 'SET_FEEDS', feeds: updated });
    renderFeedManage();
    document.getElementById('empty-state').style.display = 'none';
    feedPages = {};
    allFeeds = await loadFeeds(true);
    rebuildFeedUrlMap();
    renderNav(allFeeds, true);
    renderItems(allFeeds);
    msgEl.textContent = `Added ${toAdd.length} feed${toAdd.length !== 1 ? 's' : ''}.`;
  } catch (err) {
    msgEl.textContent = 'Error reading file.';
  }

  e.target.value = '';
  setTimeout(() => { msgEl.textContent = ''; }, 4000);
});

browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'FEED_READY') {
    feedErrors.delete(msg.feed.url);
    setFetching(msg.feed.url, false);
    const idx = allFeedsMap.get(msg.feed.url);
    if (idx >= 0) allFeeds[idx] = msg.feed;
    else allFeeds.push(msg.feed);
    rebuildFeedUrlMap();

    if (_refreshing) { _refreshLoaded++; _updateRefreshBtn(); }

    const btn = navBtnCache.get(msg.feed.url) || document.querySelector(`#feed-nav button[data-url="${CSS.escape(msg.feed.url)}"]`);
    if (btn) {
      const dot = btn.querySelector('.fetch-dot');
      if (dot) dot.remove();
    }

    if (activeUrl === msg.feed.url) {
      scheduleRender();
    } else if (!activeUrl) {
      // Batch multiple arriving feeds: render immediately on first content,
      // then debounce so subsequent feeds within 350ms coalesce into one render.
      const hasSomething = feedItems.querySelector('.item, .episode-item');
      if (!hasSomething && msg.feed.items?.length) {
        scheduleRender();
      } else {
        clearTimeout(_feedReadyBatchTimer);
        _feedReadyBatchTimer = setTimeout(() => scheduleRender(), 350);
      }
    }
  }

  if (msg.type === 'FEEDS_UPDATED') {
    allFeeds = msg.feeds;
    allFeeds.forEach(f => { setFetching(f.url, false); feedErrors.delete(f.url); });
    fetchingUrls.clear();
    rebuildFeedUrlMap();
    buildSearchIndex(allFeeds, true);
    endRefreshProgress();
    scheduleRender(true);
    setLastUpdated(Date.now());
  }

  if (msg.type === 'FEED_ERROR') {
    setFetching(msg.url, false);
    feedErrors.set(msg.url, msg.error || 'Failed to fetch');
    const btn = navBtnCache.get(msg.url) || document.querySelector(`#feed-nav button[data-url="${CSS.escape(msg.url)}"]`);
    if (btn) {
      navBtnCache.set(msg.url, btn);
      if (!btn.querySelector('.feed-error-dot')) {
        const dot = document.createElement('span');
        dot.className = 'feed-error-dot';
        dot.title = `${msg.error || 'Failed to fetch'} — click to retry`;
        dot.addEventListener('click', (e) => {
          e.stopPropagation();
          dot.remove();
          feedErrors.delete(msg.url);
          setFetching(msg.url, true);
          browser.runtime.sendMessage({ type: 'RETRY_FEED', url: msg.url });
          scheduleRender();
        });
        btn.appendChild(dot);
      }
    }
  }
});

async function checkNativeConnection() {
  const statusEl = document.getElementById('native-status');
  const setupEl  = document.getElementById('native-setup');
  statusEl.innerHTML = '<span class="status-dot pending"></span> Checking...';
  statusEl.className = 'native-status pending';
  setupEl.style.display = 'none';

  try {
    const response = await browser.runtime.sendMessage({ type: 'NATIVE_PING' });
    if (response?.ok) {
      const dot = document.createElement('span');
      dot.className = 'status-dot connected';
      statusEl.replaceChildren(dot, ' Connected');
      statusEl.className = 'native-status connected';
    } else {
      const err = response?.error || 'unknown error';
      const dot = document.createElement('span');
      dot.className = 'status-dot disconnected';
      statusEl.replaceChildren(dot, ` Not connected: ${err}`);
      statusEl.className = 'native-status disconnected';
      setupEl.style.display = 'flex';
      setupEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  } catch (e) {
    const dot = document.createElement('span');
    dot.className = 'status-dot disconnected';
    statusEl.replaceChildren(dot, ` Error: ${e.message}`);
    statusEl.className = 'native-status disconnected';
    setupEl.style.display = 'flex';
    setupEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

document.getElementById('native-connect-btn').addEventListener('click', async () => {
  const dir = document.getElementById('native-dir-input').value.trim();
  if (dir) {
    await browser.storage.local.set({ nativeDir: dir });
  }
  await browser.runtime.sendMessage({ type: 'SET_NATIVE_DIR', dir: dir || null });
  checkNativeConnection();
});

async function initNativeSettings() {
  const { nativeDir = '' } = await browser.storage.local.get('nativeDir');
  document.getElementById('native-dir-input').value = nativeDir || '~/paperboy';
  checkNativeConnection();
}

async function initRefreshInterval() {
  const { refreshInterval = 15 } = await browser.storage.local.get('refreshInterval');
  document.querySelectorAll('.refresh-interval-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.interval) === refreshInterval);
  });
}

document.querySelectorAll('.refresh-interval-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const interval = parseInt(btn.dataset.interval);
    await browser.runtime.sendMessage({ type: 'SET_REFRESH_INTERVAL', interval });
    document.querySelectorAll('.refresh-interval-btn').forEach(b => {
      b.classList.toggle('active', b === btn);
    });
  });
});

document.getElementById('options-modal').addEventListener('click', e => {
  const btn = e.target.closest('.copy-btn');
  if (!btn) return;
  const text = btn.dataset.copy;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.innerHTML;
    btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
    setTimeout(() => { btn.innerHTML = orig; }, 1200);
  }).catch(() => {});
});

// ── Keyboard navigation ───────────────────────────────────────────────
let selectedIdx = -1;
let lastKey = null;
let lastKeyTime = 0;
let cachedItems = null;

function invalidateItemsCache() {
  cachedItems = null;
}

function getItems() {
  if (cachedItems) return cachedItems;
  cachedItems = Array.from(feedItems.querySelectorAll('.item, .episode-item'));
  return cachedItems;
}

function selectItem(idx, items) {
  items = items || getItems();
  if (!items.length) return;
  const prevIdx = selectedIdx;
  selectedIdx = Math.max(0, Math.min(idx, items.length - 1));
  if (prevIdx >= 0 && prevIdx < items.length && prevIdx !== selectedIdx) {
    items[prevIdx].classList.remove('keyboard-selected');
  }
  items[selectedIdx].classList.add('keyboard-selected');
  const url = items[selectedIdx].dataset.url;
  if (url && !items[selectedIdx]._prefetched) { items[selectedIdx]._prefetched = true; preloadArticle(url); }
  items[selectedIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function openSelected() {
  const items = getItems();
  if (selectedIdx < 0 || !items[selectedIdx]) return;
  items[selectedIdx].querySelector('.item-body').click();
}

function getFeedUrls() {
  return allFeeds.map(f => f.url);
}

function getContextFeedUrls() {
  if (activeTag) return allFeeds.filter(f => categories[f.url]?.includes(activeTag)).map(f => f.url);
  return allFeeds.filter(f => !categories[f.url]?.length).map(f => f.url);
}

document.addEventListener('keydown', e => {
  if (e.target.closest('input, textarea, [contenteditable]')) {
    if (e.key === 'Escape') e.target.blur();
    return;
  }

  if (e.key === 'Escape') {
    const settingsOverlay = document.getElementById('modal-overlay');
    const shortcutsOverlay = document.getElementById('keys-overlay');
    if (settingsOverlay.style.display !== 'none') { closeModal(); return; }
    if (shortcutsOverlay.style.display !== 'none') { closeOverlay(shortcutsOverlay); return; }
  }

  const now = Date.now();
  const isDouble = lastKey === e.key && now - lastKeyTime < 500;
  lastKey = e.key;
  lastKeyTime = now;

  const settingsOpen = document.getElementById('modal-overlay').style.display !== 'none';

  if (settingsOpen) {
    const rows = document.querySelectorAll('#feed-list-manage .feed-manage-item');
    const modalIdx = [...rows].findIndex(r => r === document.activeElement?.closest('.feed-manage-item'));
    switch (e.key) {
      case 'j':
      case 'ArrowDown':
        e.preventDefault();
        (rows[modalIdx < 0 ? 0 : Math.min(modalIdx + 1, rows.length - 1)]).focus();
        break;
      case 'k':
      case 'ArrowUp':
        e.preventDefault();
        (rows[modalIdx < 0 ? rows.length - 1 : Math.max(modalIdx - 1, 0)]).focus();
        break;
      case 'G':
        e.preventDefault();
        rows[rows.length - 1]?.focus();
        break;
      case 'g':
        if (isDouble) { e.preventDefault(); rows[0]?.focus(); }
        break;
      case 'Delete':
      case 'Backspace':
        if (modalIdx >= 0) {
          e.preventDefault();
          rows[modalIdx].querySelector('.remove-btn')?.click();
        }
        break;
      case 't':
        e.preventDefault();
        if (modalIdx >= 0) {
          rows[modalIdx].querySelector('.feed-tag-add')?.click();
        } else {
          rows[0]?.querySelector('.feed-tag-add')?.click();
        }
        break;
      case 'a':
        e.preventDefault();
        document.getElementById('feed-url-input').focus();
        break;
      case 'c':
        e.preventDefault();
        document.getElementById('native-dir-input').focus();
        break;
    }
    return;
  }

  const items = getItems();

  switch (e.key) {
    case 'j':
      e.preventDefault();
      selectItem(selectedIdx < 0 ? 0 : selectedIdx + 1, items);
      break;
    case 'k':
      e.preventDefault();
      selectItem(selectedIdx <= 0 ? 0 : selectedIdx - 1, items);
      break;
    case 'g':
      if (isDouble) { e.preventDefault(); selectItem(0, items); }
      break;
    case 'G':
      e.preventDefault();
      selectItem(items.length - 1, items);
      break;
    case 'o':
    case 'Enter':
      e.preventDefault();
      openSelected();
      break;
    case 's': {
      e.preventDefault();
      const el = items[selectedIdx];
      if (!el) break;
      el.querySelector('.star-btn')?.click();
      break;
    }
    case '[':
    case 'h': {
      e.preventDefault();
      const urls = getContextFeedUrls();
      if (!urls.length) break;
      const cur = urls.indexOf(activeUrl);
      const prev = cur <= 0 ? urls[urls.length - 1] : urls[cur - 1];
      activeView = 'feeds';
      activeUrl = prev;
      feedPages = {};
      renderNav(allFeeds);
      renderItems(allFeeds);
      selectedIdx = -1;
      break;
    }
    case ']':
    case 'l': {
      e.preventDefault();
      const urls = getContextFeedUrls();
      if (!urls.length) break;
      const cur = urls.indexOf(activeUrl);
      const next = cur < 0 || cur >= urls.length - 1 ? urls[0] : urls[cur + 1];
      activeView = 'feeds';
      activeUrl = next;
      feedPages = {};
      renderNav(allFeeds);
      renderItems(allFeeds);
      selectedIdx = -1;
      break;
    }
    case 'Escape':
      if (activeUrl) { showFeeds(); selectedIdx = -1; }
      else if (selectedIdx >= 0) {
        items[selectedIdx]?.classList.remove('keyboard-selected');
        selectedIdx = -1;
      }
      break;
    case 'x': {
      e.preventDefault();
      const el = items[selectedIdx];
      if (!el) break;
      const extUrl = el.dataset.url;
      if (extUrl) window.open(extUrl, '_blank', 'noopener,noreferrer');
      break;
    }
    case ' ':
      e.preventDefault();
      window.scrollBy({ top: e.shiftKey ? -window.innerHeight * 0.9 : window.innerHeight * 0.9, behavior: 'smooth' });
      break;
    case 'A':
      e.preventDefault();
      showFeeds(); selectedIdx = -1;
      break;
    case 'S':
      e.preventDefault();
      showStarred(); selectedIdx = -1;
      break;
    case 'H':
      e.preventDefault();
      showHistory(); selectedIdx = -1;
      break;
    case 'r':
      e.preventDefault();
      document.getElementById('refresh-btn').click();
      break;
    case 't':
      e.preventDefault();
      document.getElementById('theme-btn').click();
      break;
    case 'T':
      e.preventDefault();
      cycleTag();
      break;
    case ',':
      e.preventDefault();
      document.getElementById('options-btn').click();
      break;
    case '/':
      e.preventDefault();
      openSearch();
      break;
    case '?':
      if (keysOverlay.style.display === 'none') openKeysOverlay(); else closeKeysOverlay();
      break;
    case 'p':
      if (playerEl.style.display !== 'none') {
        e.preventDefault();
        if (podcastAudio.paused) podcastAudio.play(); else podcastAudio.pause();
      }
      break;
    case '<':
      if (playerEl.style.display !== 'none') {
        e.preventDefault();
        podcastAudio.currentTime = Math.max(0, podcastAudio.currentTime - 15);
      }
      break;
    case '>':
      if (playerEl.style.display !== 'none') {
        e.preventDefault();
        podcastAudio.currentTime = Math.min(podcastAudio.duration || 0, podcastAudio.currentTime + 30);
      }
      break;
    default:
      break;
  }
});

function openSearch() {
  const bar = document.getElementById('search-bar');
  bar.classList.remove('hiding');
  bar.style.display = 'flex';
  document.getElementById('search-input').focus();
}

function closeSearch() {
  const bar = document.getElementById('search-bar');
  bar.classList.add('hiding');
  bar.addEventListener('animationend', () => {
    bar.style.display = 'none';
    bar.classList.remove('hiding');
  }, { once: true });
  searchQuery = '';
  document.getElementById('search-input').value = '';
  renderItems(allFeeds);
}

const searchInput = document.getElementById('search-input');
searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value.trim().toLowerCase();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => renderItems(allFeeds), 200);
});
searchInput.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeSearch();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden || !allFeeds.length) return;
  browser.runtime.sendMessage({ type: 'FETCH_FEEDS' }).then(r => {
    if (!r?.feeds?.length) return;
    allFeeds = r.feeds;
    rebuildFeedUrlMap();
    buildSearchIndex(allFeeds, true);
    scheduleRender(true);
  }).catch(() => {});
});

// Keep MV3 service worker alive while the newtab page is open
function connectKeepalive() {
  const port = browser.runtime.connect({ name: 'keepalive' });
  port.onDisconnect.addListener(() => setTimeout(connectKeepalive, 1_000));
}
connectKeepalive();

// ── Last updated ──────────────────────────────────────────────────────
let lastUpdatedTs = null;
let lastUpdatedTimer = null;

function setLastUpdated(ts) {
  lastUpdatedTs = ts;
  renderLastUpdated();
  clearInterval(lastUpdatedTimer);
  lastUpdatedTimer = setInterval(renderLastUpdated, 60_000);
}

function renderLastUpdated() {
  const el = document.getElementById('last-updated');
  if (!el || !lastUpdatedTs) return;
  const diff = Math.floor((Date.now() - lastUpdatedTs) / 1000);
  if (diff < 60) el.textContent = 'Updated just now';
  else if (diff < 3600) el.textContent = `Updated ${Math.floor(diff / 60)}m ago`;
  else el.textContent = `Updated ${Math.floor(diff / 3600)}h ago`;
}

// ── Sidebar toggle ────────────────────────────────────────────────────
(function () {
  const sidebar = document.getElementById('sidebar');
  const collapseBtn = document.getElementById('sidebar-collapse-btn');
  const openBtn = document.getElementById('sidebar-open-btn');

  function setSidebarCollapsed(collapsed) {
    sidebar.classList.toggle('collapsed', collapsed);
    openBtn.style.display = collapsed ? 'flex' : 'none';
    localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
  }

  collapseBtn.addEventListener('click', () => setSidebarCollapsed(true));
  openBtn.addEventListener('click', () => setSidebarCollapsed(false));

  if (localStorage.getItem('sidebarCollapsed') === '1') setSidebarCollapsed(true);
})();

init();