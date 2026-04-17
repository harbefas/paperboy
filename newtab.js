initTheme('theme-btn');

// ── Performant state ──────────────────────────────────────────────────
let searchTimer = null;
let pendingRaf = null;
const feedItems = document.getElementById('feed-items');

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
function fadeContent(fn) {
  const content = document.querySelector('.content');
  content.classList.add('fading');
  content.classList.remove('fading-in');
  setTimeout(() => {
    fn();
    content.classList.remove('fading');
    content.classList.add('fading-in');
  }, 150);
}

// ── Scroll reveal ─────────────────────────────────────────────────────
let revealBatch = 0;

const revealObserver = new IntersectionObserver((entries) => {
  let batchIdx = 0;
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    revealObserver.unobserve(entry.target);
    const el = entry.target;
    const delay = entry.target.dataset.stagger
      ? parseInt(entry.target.dataset.stagger)
      : batchIdx++ * 50;
    el.style.animationDelay = delay + 'ms';
    el.classList.add('visible');
  });
}, { threshold: 0.05, rootMargin: '0px 0px -10px 0px' });

function observeItems() {
  const items = document.querySelectorAll('.item:not(.visible)');
  items.forEach((el, i) => {
    el.dataset.stagger = Math.min(i, 7) * 55;
    revealObserver.observe(el);
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
const keysOverlay = document.getElementById('keys-overlay');
document.getElementById('keys-btn').addEventListener('click', () => keysOverlay.style.display = 'flex');
document.getElementById('keys-close').addEventListener('click', () => closeOverlay(keysOverlay));
keysOverlay.addEventListener('click', e => { if (e.target === keysOverlay) closeOverlay(keysOverlay); });

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
let readUrls = new Set();
let categories = {}; // { "url": ["tag1", "tag2"] }
let collapsedGroups = new Set();
let searchQuery = '';

const STARRED_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
const UNSTARRED_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
const CHEVRON_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>';
const EXT_LINK_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
const REFRESH_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';

const resolvedOgImages = new Map();
let searchIndex = [];
let searchIndexUrls = new Set();

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

let preloadTimer = null;
function preloadArticleDebounced(url) {
  clearTimeout(preloadTimer);
  preloadTimer = setTimeout(() => {
    browser.runtime.sendMessage({ type: 'FETCH_ARTICLE', url }).catch(() => {});
  }, 300);
}

async function toggleStar(url, title, btn, image) {
  const { isStarred } = await browser.runtime.sendMessage({
    type: 'TOGGLE_STAR',
    entry: { url, title: title || url, image: image || '', starredAt: new Date().toISOString() }
  });
  if (isStarred) {
    starredUrls.add(url);
    btn.classList.add('starred');
    btn.innerHTML = STARRED_SVG;
  } else {
    starredUrls.delete(url);
    btn.classList.remove('starred');
    btn.innerHTML = UNSTARRED_SVG;
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
    if (url) openReader(url, title);
  }
});

feedItems.addEventListener('mouseover', (e) => {
  const itemBody = e.target.closest('.item-body');
  if (itemBody && !itemBody.dataset.preloaded) {
    const url = itemBody.closest('.item')?.dataset.url;
    if (url) {
      itemBody.dataset.preloaded = '1';
      preloadArticleDebounced(url);
    }
  }
});

function formatDate(str) {
  if (!str) return '';
  try {
    const d = new Date(str);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
  } catch { return ''; }
}

function openReader(url, title) {
  let readerUrl = browser.runtime.getURL('reader.html') + '?url=' + encodeURIComponent(url);
  if (title) readerUrl += '&title=' + encodeURIComponent(title);
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
    container.innerHTML = `<div class="empty-state"><p>No results for "${searchQuery}"</p></div>`;
    return;
  }
  const section = document.createElement('div');
  section.className = 'feed-section';
  matches.forEach(({ item, feedTitle }) => section.appendChild(makeItem(item, feedTitle)));
  container.appendChild(section);
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

  const toRender = activeUrl
    ? feeds.filter(f => f.url === activeUrl)
    : activeTag
      ? feeds.filter(f => categories[f.url]?.includes(activeTag))
      : feeds;

  if (!toRender.length) return;

  const frag = document.createDocumentFragment();

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
      chevron.innerHTML = CHEVRON_SVG;
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

    if (!items.length) return;

    const section = document.createElement('div');
    section.className = 'feed-section';
    section.dataset.feedUrl = feed.url;

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
      chevron.innerHTML = CHEVRON_SVG;
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
    }

    const itemsContainer = section.querySelector('.section-items') || section;
    const page = feedPages[feed.url] || 0;
    const visible = items.slice(0, (page + 1) * PAGE_SIZE);

    const itemFrag = document.createDocumentFragment();
    visible.forEach(item => itemFrag.appendChild(makeItem(item)));
    itemsContainer.appendChild(itemFrag);

    const remaining = items.length - visible.length;
    if (remaining > 0) {
      const more = document.createElement('button');
      more.className = 'show-more-btn';
      more.textContent = `Show more (${remaining})`;
      more.addEventListener('click', () => {
        feedPages[feed.url] = (feedPages[feed.url] || 0) + 1;
        appendMoreItems(itemsContainer, feed, items, feeds);
      });
      itemsContainer.appendChild(more);
    }

    frag.appendChild(section);
  });

  // All-read empty state
  if (!activeUrl && activeView === 'feeds') {
    let hasItems = false;
    for (const child of frag.children) {
      if (child.querySelectorAll('.item').length) { hasItems = true; break; }
    }
    if (!hasItems) {
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
  browser.runtime.sendMessage({ type: 'GET_STARRED' }).then(({ starred = [] }) => {
    if (!starred.length) {
      container.innerHTML = '<div class="empty-state"><p>No starred articles.</p></div>';
      return;
    }
    const section = document.createElement('div');
    section.className = 'feed-section';
    const frag = document.createDocumentFragment();
    starred.reverse().forEach(entry => {
      const item = { title: entry.title, link: entry.url, date: entry.starredAt, image: entry.image };
      frag.appendChild(makeItem(item));
    });
    section.appendChild(frag);
    container.appendChild(section);
    invalidateItemsCache();
    requestAnimationFrame(observeItems);
  });
}

function renderHistoryView(container) {
  browser.runtime.sendMessage({ type: 'GET_HISTORY' }).then(({ history = [] }) => {
    if (!history.length) {
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
    history.reverse().forEach(entry => {
      const item = { title: entry.title, link: entry.url, date: entry.readAt };
      frag.appendChild(makeItem(item));
    });
    section.appendChild(frag);
    container.appendChild(section);
    invalidateItemsCache();
    requestAnimationFrame(observeItems);
  });
}

function appendMoreItems(section, feed, filteredItems, feeds) {
  const existingBtn = section.querySelector('.show-more-btn');
  if (existingBtn) existingBtn.remove();

  const page = feedPages[feed.url] || 0;
  const prevCount = page * PAGE_SIZE;
  const visible = filteredItems.slice(0, (page + 1) * PAGE_SIZE);
  const newItems = visible.slice(prevCount);

  const frag = document.createDocumentFragment();
  newItems.forEach(item => frag.appendChild(makeItem(item)));
  section.appendChild(frag);

  const remaining = filteredItems.length - visible.length;
  if (remaining > 0) {
    const more = document.createElement('button');
    more.className = 'show-more-btn';
    more.textContent = `Show more (${remaining})`;
    more.addEventListener('click', () => {
      feedPages[feed.url] = (feedPages[feed.url] || 0) + 1;
      appendMoreItems(section, feed, filteredItems, feeds);
    });
    section.appendChild(more);
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
    const starBtn = document.createElement('button');
    starBtn.className = 'star-btn' + (starredUrls.has(item.link) ? ' starred' : '');
    starBtn.dataset.action = 'star';
    starBtn.innerHTML = starredUrls.has(item.link) ? STARRED_SVG : UNSTARRED_SVG;
    el.appendChild(starBtn);

    const extLink = document.createElement('a');
    extLink.className = 'ext-link-btn';
    extLink.href = item.link;
    extLink.target = '_blank';
    extLink.rel = 'noopener noreferrer';
    extLink.title = 'Open original';
    extLink.innerHTML = EXT_LINK_SVG;
    el.appendChild(extLink);
  }

  return el;
}

function makePlaceholder() {
  const d = document.createElement('div');
  d.className = 'item-thumb-placeholder';
  return d;
}

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

function clearActiveNav() {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
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
    btn.addEventListener('click', showFeeds);
    staticNav.appendChild(btn);
    return btn;
  })();

  const starBtn = staticNav.querySelector('#nav-starred') || (() => {
    const btn = document.createElement('button');
    btn.id = 'nav-starred';
    btn.className = 'nav-item';
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> Starred';
    btn.addEventListener('click', showStarred);
    staticNav.appendChild(btn);
    return btn;
  })();

  const histBtn = staticNav.querySelector('#nav-history') || (() => {
    const btn = document.createElement('button');
    btn.id = 'nav-history';
    btn.className = 'nav-item';
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> History';
    btn.addEventListener('click', showHistory);
    staticNav.appendChild(btn);
    return btn;
  })();

  all.className = 'nav-item' + (!activeUrl && !activeTag && activeView === 'feeds' ? ' active' : '');
  starBtn.className = 'nav-item' + (activeView === 'starred' ? ' active' : '');
  histBtn.className = 'nav-item' + (activeView === 'history' ? ' active' : '');

  const nav = document.getElementById('feed-nav');
  const feedsKey = feeds.map(f => f.url).join(',');

  if (!force && nav._lastKey === feedsKey && nav._lastCats === JSON.stringify(categories) && nav._lastCollapsed === JSON.stringify([...collapsedGroups])) {
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
  nav._lastCats = JSON.stringify(categories);
  nav._lastCollapsed = JSON.stringify([...collapsedGroups]);

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
      renderNav(allFeeds);
    });

    frag.appendChild(header);

    if (!collapsed) {
      tagFeeds.forEach(feed => frag.appendChild(makeFeedBtn(feed)));
    }
  });

  if (Object.keys(grouped).length && ungrouped.length) {
    const sep = document.createElement('div');
    sep.className = 'nav-sep';
    frag.appendChild(sep);
  }

  ungrouped.forEach(feed => frag.appendChild(makeFeedBtn(feed)));
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
  showSkeletons(6);

  const [{ starred = [] }, { history = [] }, cats] = await Promise.all([
    browser.runtime.sendMessage({ type: 'GET_STARRED' }).catch(() => ({ starred: [] })),
    browser.runtime.sendMessage({ type: 'GET_HISTORY' }).catch(() => ({ history: [] })),
    browser.runtime.sendMessage({ type: 'GET_CATEGORIES' }).catch(() => ({ categories: {} })),
  ]);
  starredUrls = new Set(starred.map(s => s.url));
  readUrls = new Set(history.map(h => h.url));
  categories = cats?.categories || {};
  cachedTagList = null;

  allFeeds = await loadFeeds();
  rebuildFeedUrlMap();

  if (!allFeeds.length) {
    document.getElementById('empty-state').style.display = 'flex';
    return;
  }

  buildSearchIndex(allFeeds);
  renderNav(allFeeds, true);
  renderItems(allFeeds);
}

document.getElementById('refresh-btn').addEventListener('click', async () => {
  const btn = document.getElementById('refresh-btn');
  btn.innerHTML = '<span class="spinner"></span>';
  feedPages = {};
  allFeeds = await loadFeeds(true);
  rebuildFeedUrlMap();
  renderNav(allFeeds, true);
  renderItems(allFeeds);
  btn.innerHTML = REFRESH_SVG;
});

const overlay = document.getElementById('modal-overlay');
const modal = document.getElementById('options-modal');

function openModal() {
  overlay.style.display = 'flex';
  renderFeedManage();
}
function closeModal() { closeOverlay(overlay); }

document.getElementById('options-btn').addEventListener('click', () => {
  openModal();
  initNativeSettings();
});

document.getElementById('modal-close').addEventListener('click', closeModal);
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

document.getElementById('add-first-btn')?.addEventListener('click', () => {
  openModal();
  initNativeSettings();
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
  return new Date(ts).toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
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
  const msg = document.getElementById('modal-msg');
  const url = input.value.trim();
  if (!url) return;

  msg.textContent = 'Checking...';
  try {
    const { feeds = [] } = await browser.storage.local.get('feeds');
    if (feedUrlSet.has(url)) { msg.textContent = 'Feed already added.'; return; }
    const updated = [...feeds, url];
    await browser.runtime.sendMessage({ type: 'SET_FEEDS', feeds: updated });
    input.value = '';
    msg.textContent = 'Feed added.';
    renderFeedManage();
    setTimeout(() => { msg.textContent = ''; }, 2000);
    document.getElementById('empty-state').style.display = 'none';
    feedPages = {};
    allFeeds = await loadFeeds(true);
    rebuildFeedUrlMap();
    renderNav(allFeeds, true);
    renderItems(allFeeds);
  } catch (e) {
    msg.textContent = 'Error: ' + e.message;
  }
});

document.getElementById('feed-url-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('add-feed-btn').click();
});

browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'FEED_READY') {
    setFetching(msg.feed.url, false);
    const idx = allFeedsMap.get(msg.feed.url);
    if (idx >= 0) allFeeds[idx] = msg.feed;
    else allFeeds.push(msg.feed);
    rebuildFeedUrlMap();

    const btn = navBtnCache.get(msg.feed.url) || document.querySelector(`#feed-nav button[data-url="${CSS.escape(msg.feed.url)}"]`);
    if (btn) {
      const dot = btn.querySelector('.fetch-dot');
      if (dot) dot.remove();
    }

    if (activeUrl === msg.feed.url || !activeUrl) {
      renderItems(allFeeds);
    }
  }

  if (msg.type === 'FEEDS_UPDATED') {
    allFeeds = msg.feeds;
    allFeeds.forEach(f => setFetching(f.url, false));
    fetchingUrls.clear();
    rebuildFeedUrlMap();
    buildSearchIndex(allFeeds, true);
    scheduleRender(true);
  }

  if (msg.type === 'FEED_ERROR') {
    setFetching(msg.url, false);
    const btn = navBtnCache.get(msg.url) || document.querySelector(`#feed-nav button[data-url="${CSS.escape(msg.url)}"]`);
    if (btn) {
      navBtnCache.set(msg.url, btn);
      if (!btn.querySelector('.feed-error-dot')) {
        const dot = document.createElement('span');
        dot.className = 'feed-error-dot';
        dot.title = msg.error || 'Failed to fetch';
        btn.appendChild(dot);
      }
    }
  }
});

async function checkNativeConnection() {
  const statusEl = document.getElementById('native-status');
  statusEl.innerHTML = '<span class="status-dot pending"></span> Checking...';
  statusEl.className = 'native-status pending';

  try {
    const response = await browser.runtime.sendMessage({ type: 'NATIVE_PING' });
    if (response?.ok) {
      statusEl.innerHTML = '<span class="status-dot connected"></span> Connected';
      statusEl.className = 'native-status connected';
    } else {
      const err = response?.error || 'unknown error';
      statusEl.innerHTML = `<span class="status-dot disconnected"></span> Not connected: ${err}`;
      statusEl.className = 'native-status disconnected';
    }
  } catch (e) {
    statusEl.innerHTML = `<span class="status-dot disconnected"></span> Error: ${e.message}`;
    statusEl.className = 'native-status disconnected';
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
  cachedItems = Array.from(feedItems.querySelectorAll('.item'));
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

  const now = Date.now();
  const isDouble = lastKey === e.key && now - lastKeyTime < 500;
  lastKey = e.key;
  lastKeyTime = now;

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
    case '[': {
      e.preventDefault();
      const urls = getFeedUrls();
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
    case ']': {
      e.preventDefault();
      const urls = getFeedUrls();
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
      document.getElementById('search-bar').style.display = 'flex';
      document.getElementById('search-input').focus();
      break;
    case '?':
      keysOverlay.style.display = keysOverlay.style.display === 'none' ? 'flex' : 'none';
      break;
    default: {
      const num = e.key === '0' ? 9 : parseInt(e.key) - 1;
      if (!isNaN(num) && num >= 0 && num <= 9) {
        const feeds = activeTag
          ? allFeeds.filter(f => categories[f.url]?.includes(activeTag))
          : allFeeds.filter(f => !categories[f.url]?.length);
        if (feeds[num]) {
          e.preventDefault();
          activeView = 'feeds';
          activeUrl = feeds[num].url;
          feedPages = {};
          selectedIdx = -1;
          renderNav(allFeeds);
          renderItems(allFeeds);
        }
      }
    }
  }
});

const searchInput = document.getElementById('search-input');
searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value.trim().toLowerCase();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => renderItems(allFeeds), 200);
});
searchInput.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    searchQuery = '';
    searchInput.value = '';
    document.getElementById('search-bar').style.display = 'none';
    renderItems(allFeeds);
  }
});

init();