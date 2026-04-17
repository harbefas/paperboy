const CACHE_TTL = 15 * 60 * 1000;
const REFRESH_ALARM = 'paperboy-refresh';
const REFRESH_INTERVAL = 15; // minutes
const OG_CACHE_TTL = 24 * 60 * 60 * 1000;
const OG_CACHE_MAX = 200;
const ARTICLE_CACHE_TTL = 60 * 60 * 1000;
const ARTICLE_CACHE_MAX = 20;
const HISTORY_MAX = 1000;
const STARRED_MAX = 500;
const STORAGE_QUOTA_MB = 8;
const STORAGE_QUOTA_WARN = Math.floor(STORAGE_QUOTA_MB * 1024 * 1024 * 0.85);
const MAX_FETCH_CONCURRENCY = 5;
const ARTICLE_MAX_BYTES = 2 * 1024 * 1024; // Abort articles larger than 2MB

const _parser = new DOMParser();

// ── Concurrency-limited fetch queue ─────────────────────────────────────
class FetchQueue {
  constructor(concurrency) {
    this._concurrency = concurrency;
    this._running = 0;
    this._queue = [];
  }
  push(fn) {
    return new Promise((resolve, reject) => {
      this._queue.push({ fn, resolve, reject });
      this._drain();
    });
  }
  _drain() {
    while (this._running < this._concurrency && this._queue.length) {
      const { fn, resolve, reject } = this._queue.shift();
      this._running++;
      fn().then(resolve, reject).finally(() => { this._running--; this._drain(); });
    }
  }
}
const fetchQueue = new FetchQueue(MAX_FETCH_CONCURRENCY);

// ── Dedup in-flight fetches ──────────────────────────────────────────────
const inflightFeeds = new Map(); // url -> Promise

function dedupFetchFeed(url) {
  if (inflightFeeds.has(url)) return inflightFeeds.get(url);
  const p = fetchQueue.push(() => fetchFeed(url).finally(() => inflightFeeds.delete(url)));
  inflightFeeds.set(url, p);
  return p;
}

// ── Running cache size estimate ─────────────────────────────────────────
let cacheSizeEstimate = 0;

function recalcCacheSize() {
  cacheSizeEstimate = 0;
  for (const [url, val] of feedCache.entries()) {
    cacheSizeEstimate += url.length * 2 + JSON.stringify(val).length * 2;
  }
  for (const [url] of feedCacheTime.entries()) {
    cacheSizeEstimate += url.length * 2 + 16;
  }
}

function addCacheSizeEntry(url, data) {
  cacheSizeEstimate += url.length * 2 + JSON.stringify(data).length * 2 + url.length * 2 + 16;
}

// ── In-memory state (loaded once on startup, kept in sync) ─────────────
let feeds = [];
const feedCache = new Map();       // url -> { title, icon, items }
const feedCacheTime = new Map();   // url -> timestamp (ms)
const ogCacheMap = new Map();      // cacheKey -> { image, ts }
const articleCacheMap = new Map(); // url -> { html, ts }
const starredSet = new Set();      // URLs that are starred
let starredList = [];              // Ordered array of starred entries
const historySet = new Set();      // URLs that are in history
let historyList = [];              // Ordered array of history entries
let stateLoaded = false;
let stateLoadPromise = null;

async function loadState() {
  if (stateLoaded) return;
  if (stateLoadPromise) return stateLoadPromise;
  stateLoadPromise = (async () => {
    try {
      const data = await browser.storage.local.get([
        'feeds', 'cache', 'cacheTime', 'ogCache', 'articleCache', 'starred', 'history'
      ]);
      feeds = data.feeds || [];
      if (data.cache) {
        for (const [url, val] of Object.entries(data.cache)) {
          feedCache.set(url, val);
        }
      }
      if (data.cacheTime) {
        for (const [url, val] of Object.entries(data.cacheTime)) {
          feedCacheTime.set(url, val);
        }
      }
      if (data.ogCache) {
        for (const [key, val] of Object.entries(data.ogCache)) {
          ogCacheMap.set(key, val);
        }
      }
      if (data.articleCache) {
        for (const [key, val] of Object.entries(data.articleCache)) {
          articleCacheMap.set(key, val);
        }
      }
      if (data.starred) {
        starredList = data.starred;
        for (const s of data.starred) starredSet.add(s.url);
      }
      if (data.history) {
        historyList = data.history;
        for (const h of data.history) historySet.add(h.url);
      }
      recalcCacheSize();
      stateLoaded = true;
    } catch (e) {
      console.error('[paperboy] loadState failed:', e);
      stateLoadPromise = null;
    }
  })();
  return stateLoadPromise;
}

// ── Persist helpers ───────────────────────────────────────────────────
function debounce(fn, ms) {
  let timer = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(); }, ms);
  };
}

async function evictCacheToFit() {
  const stalest = [...feedCacheTime.entries()].sort((a, b) => a[1] - b[1]);
  while (cacheSizeEstimate > STORAGE_QUOTA_WARN && stalest.length > 1) {
    const [url] = stalest.shift();
    const data = feedCache.get(url);
    if (data) cacheSizeEstimate -= url.length * 2 + JSON.stringify(data).length * 2;
    cacheSizeEstimate -= url.length * 2 + 16;
    feedCache.delete(url);
    feedCacheTime.delete(url);
  }
}

async function persistCache() {
  if (cacheSizeEstimate > STORAGE_QUOTA_WARN) {
    await evictCacheToFit();
  }
  const cache = Object.fromEntries(feedCache.entries());
  const cacheTime = Object.fromEntries(feedCacheTime.entries());
  await browser.storage.local.set({ cache, cacheTime, feeds });
}

async function _persistOgCache() {
  await browser.storage.local.set({ ogCache: Object.fromEntries(ogCacheMap.entries()) });
}

async function _persistArticleCache() {
  await browser.storage.local.set({ articleCache: Object.fromEntries(articleCacheMap.entries()) });
}

const persistOgCache = debounce(_persistOgCache, 500);
const persistArticleCache = debounce(_persistArticleCache, 500);

async function _persistStarred() {
  await browser.storage.local.set({ starred: starredList });
  await LibrssDir.setStarred(starredList);
}

async function _persistHistory() {
  await browser.storage.local.set({ history: historyList });
  await LibrssDir.appendHistory(historyList[historyList.length - 1]);
}

const persistStarred = debounce(_persistStarred, 300);
const persistHistory = debounce(_persistHistory, 300);

// ── LRU eviction ──────────────────────────────────────────────────────
function evictMap(m, maxSize) {
  if (m.size <= maxSize) return;
  const entries = [];
  for (const [key, val] of m.entries()) {
    entries.push({ key, ts: val.ts || 0 });
  }
  entries.sort((a, b) => a.ts - b.ts);
  const toRemove = m.size - maxSize;
  for (let i = 0; i < toRemove; i++) {
    m.delete(entries[i].key);
  }
}

// ── Background refresh ────────────────────────────────────────────────
async function backgroundRefresh() {
  await loadState();
  if (!feeds.length) return;
  const now = Date.now();
  const stale = feeds.filter(url => {
    const ct = feedCacheTime.get(url) || 0;
    return !feedCache.has(url) || now - ct >= CACHE_TTL;
  });
  if (!stale.length) return;
  await Promise.all(stale.map(url => dedupFetchFeed(url).then(data => {
    feedCache.set(url, data);
    feedCacheTime.set(url, Date.now());
    addCacheSizeEntry(url, data);
  }).catch(e => {
    browser.runtime.sendMessage({ type: 'FEED_ERROR', url, error: e.message }).catch(() => {});
  })));
  await persistCache();
  const updated = feeds.map(url => feedCache.has(url) ? { url, ...feedCache.get(url) } : { url, title: url, items: [] });
  browser.runtime.sendMessage({ type: 'FEEDS_UPDATED', feeds: updated }).catch(() => {});
}

browser.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_INTERVAL });
browser.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === REFRESH_ALARM) backgroundRefresh();
});

const MEDIA_NS = 'http://search.yahoo.com/mrss/';

function extractImage(el) {
  const mediaThumbnail = el.getElementsByTagNameNS(MEDIA_NS, 'thumbnail')[0]?.getAttribute('url') || '';
  const mediaContent = el.getElementsByTagNameNS(MEDIA_NS, 'content')[0]?.getAttribute('url') || '';
  const enclosure = el.querySelector('enclosure[type^="image"]')?.getAttribute('url') || '';

  if (enclosure) return enclosure;
  if (mediaThumbnail) return mediaThumbnail;
  if (mediaContent) return mediaContent;

  const rawDesc = el.querySelector('description, content, summary')?.textContent || '';
  if (rawDesc.includes('<img')) {
    const match = rawDesc.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (match) return match[1];
    const tmp = _parser.parseFromString(rawDesc, 'text/html');
    const src = tmp.querySelector('img')?.getAttribute('src') || '';
    if (src) return src;
  }
  return '';
}

function getDomain(feedUrl) {
  try { return new URL(feedUrl).origin; } catch { return ''; }
}

function extractIcon(doc, fallbackDomain) {
  const atomIcon = doc.querySelector('feed > icon')?.textContent?.trim();
  if (atomIcon) {
    try { return new URL(atomIcon, fallbackDomain).href; } catch {}
  }
  const rssIcon = doc.querySelector('channel > image > url')?.textContent?.trim();
  if (rssIcon) return rssIcon;
  try {
    const host = new URL(fallbackDomain).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
  } catch {}
  return '';
}

function sanitizeXML(xml) {
  return xml.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/g, '&amp;');
}

function parseRSS(xml, url) {
  let doc = _parser.parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) {
    doc = _parser.parseFromString(sanitizeXML(xml), 'text/xml');
  }
  const isAtom = !!doc.querySelector('feed');
  const domain = getDomain(url);
  const icon = extractIcon(doc, domain);
  const items = [];

  if (isAtom) {
    const entries = doc.querySelectorAll('entry');
    entries.forEach(e => {
      const link = e.querySelector('link[rel="alternate"]')?.getAttribute('href')
        || e.querySelector('link')?.getAttribute('href') || '';
      items.push({
        title: e.querySelector('title')?.textContent?.trim() || '',
        link,
        date: e.querySelector('updated, published')?.textContent || '',
        summary: e.querySelector('summary, content')?.textContent?.trim().slice(0, 200) || '',
        image: extractImage(e),
      });
    });
    return {
      title: doc.querySelector('feed > title')?.textContent?.trim() || url,
      icon,
      items: items.slice(0, 50),
    };
  }

  const channel = doc.querySelector('channel');
  const nodes = doc.querySelectorAll('item');
  nodes.forEach(item => {
    const descHtml = item.querySelector('description')?.textContent || '';
    items.push({
      title: item.querySelector('title')?.textContent?.trim() || '',
      link: item.querySelector('link')?.textContent?.trim() || '',
      date: item.querySelector('pubDate')?.textContent || '',
      summary: descHtml.replace(/<[^>]+>/g, '').slice(0, 200).trim(),
      image: extractImage(item),
    });
  });

  return {
    title: channel?.querySelector('title')?.textContent?.trim() || url,
    icon,
    items: items.slice(0, 50),
  };
}

async function fetchFeed(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  return parseRSS(text, url);
}

// ── Message handlers ─────────────────────────────────────────────────
browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'FETCH_FEEDS') {
    (async () => {
      try {
        await loadState();
        if (!feeds.length) {
          feeds = await LibrssDir.getFeeds();
        }

        const now = Date.now();
        const stale = feeds.filter(url => {
          const ct = feedCacheTime.get(url) || 0;
          return !feedCache.has(url) || now - ct >= CACHE_TTL;
        });

        const snapshot = feeds.map(url => feedCache.has(url)
          ? { url, ...feedCache.get(url), cached: true }
          : { url, title: url, items: [] }
        );
        sendResponse({ feeds: snapshot });

        if (!stale.length) return;

        const allFeeds = [...snapshot];
        const feedMap = new Map(allFeeds.map((f, i) => [f.url, i]));
        await Promise.all(stale.map(url => dedupFetchFeed(url).then(data => {
          feedCache.set(url, data);
          feedCacheTime.set(url, Date.now());
          addCacheSizeEntry(url, data);
          const idx = feedMap.get(url);
          if (idx >= 0) allFeeds[idx] = { url, ...data };
          browser.runtime.sendMessage({ type: 'FEED_READY', feed: { url, ...data } }).catch(() => {});
        }).catch(e => {
          browser.runtime.sendMessage({ type: 'FEED_ERROR', url, error: e.message }).catch(() => {});
        })));
        await persistCache();
        browser.runtime.sendMessage({ type: 'FEEDS_UPDATED', feeds: allFeeds }).catch(() => {});
      } catch (e) {
        console.error('[paperboy] FETCH_FEEDS error:', e);
        sendResponse({ feeds: [] });
      }
    })();
    return true;
  }

  if (msg.type === 'FORCE_REFRESH') {
    (async () => {
      try {
        await loadState();
        feedCache.clear();
        feedCacheTime.clear();
        cacheSizeEstimate = 0;
        sendResponse({ feeds: feeds.map(url => ({ url, title: url, items: [] })) });
        await Promise.all(feeds.map(url => dedupFetchFeed(url).then(data => {
          feedCache.set(url, data);
          feedCacheTime.set(url, Date.now());
          addCacheSizeEntry(url, data);
          browser.runtime.sendMessage({ type: 'FEED_READY', feed: { url, ...data } }).catch(() => {});
        }).catch(e => {
          browser.runtime.sendMessage({ type: 'FEED_ERROR', url, error: e.message }).catch(() => {});
        })));
        await persistCache();
        const results = feeds.map(url => feedCache.has(url) ? { url, ...feedCache.get(url) } : { url, title: url, items: [] });
        browser.runtime.sendMessage({ type: 'FEEDS_UPDATED', feeds: results }).catch(() => {});
      } catch (e) {
        console.error('[paperboy] FORCE_REFRESH error:', e);
        sendResponse({ feeds: [] });
      }
    })();
    return true;
  }

  if (msg.type === 'FETCH_ARTICLE') {
    (async () => {
      try {
        await loadState();
        const cached = articleCacheMap.get(msg.url);
        if (cached && Date.now() - cached.ts < ARTICLE_CACHE_TTL) {
          sendResponse({ html: cached.html, url: msg.url });
          return;
        }
        const r = await fetch(msg.url);
        if (r.headers.has('Content-Length')) {
          const size = parseInt(r.headers.get('Content-Length'), 10);
          if (size > ARTICLE_MAX_BYTES) {
            sendResponse({ error: 'Article too large', url: msg.url });
            return;
          }
        }
        const reader = r.body.getReader();
        const chunks = [];
        let totalBytes = 0;
        let exceeded = false;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.length;
          if (totalBytes > ARTICLE_MAX_BYTES) { exceeded = true; break; }
          chunks.push(value);
        }
        if (exceeded) {
          sendResponse({ error: 'Article too large', url: msg.url });
          return;
        }
        const html = chunks.map(c => new TextDecoder().decode(c)).join('');
        articleCacheMap.set(msg.url, { html, ts: Date.now() });
        evictMap(articleCacheMap, ARTICLE_CACHE_MAX);
        await persistArticleCache();
        sendResponse({ html, url: msg.url });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }

  if (msg.type === 'FETCH_OG_IMAGE') {
    const { url, cacheKey } = msg;
    (async () => {
      try {
        await loadState();
        const entry = ogCacheMap.get(cacheKey);
        if (entry !== undefined) {
          const image = typeof entry === 'object' ? entry.image : entry;
          const ts = typeof entry === 'object' ? entry.ts : 0;
          if (Date.now() - ts < OG_CACHE_TTL) {
            sendResponse({ image });
            return;
          }
        }
        const res = await fetch(url, { method: 'GET', headers: { 'Accept': 'text/html' } });
        const text = await res.text();
        const doc = _parser.parseFromString(text, 'text/html');
        const og = doc.querySelector('meta[property="og:image"]')?.getAttribute('content')
          || doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content')
          || '';
        ogCacheMap.set(cacheKey, { image: og, ts: Date.now() });
        evictMap(ogCacheMap, OG_CACHE_MAX);
        await persistOgCache();
        sendResponse({ image: og });
      } catch {
        sendResponse({ image: '' });
      }
    })();
    return true;
  }

  if (msg.type === 'RECORD_HISTORY') {
    (async () => {
      try {
        await loadState();
        const entry = msg.entry;
        if (historySet.has(entry.url)) {
          const idx = historyList.findLastIndex(h => h.url === entry.url);
          if (idx >= 0) historyList[idx] = entry;
        } else {
          historyList.push(entry);
          historySet.add(entry.url);
        }
        if (historyList.length > HISTORY_MAX) {
          const removed = historyList.splice(0, historyList.length - HISTORY_MAX);
          removed.forEach(h => historySet.delete(h.url));
        }
        await persistHistory();
        sendResponse({ ok: true });
      } catch (e) {
        console.error('[paperboy] RECORD_HISTORY error:', e);
        sendResponse({ ok: false });
      }
    })();
    return true;
  }

  if (msg.type === 'GET_HISTORY') {
    (async () => {
      try {
        await loadState();
        sendResponse({ history: historyList });
      } catch (e) {
        console.error('[paperboy] GET_HISTORY error:', e);
        sendResponse({ history: [] });
      }
    })();
    return true;
  }

  if (msg.type === 'TOGGLE_STAR') {
    (async () => {
      try {
        await loadState();
        const entry = msg.entry;
        const isStarred = starredSet.has(entry.url);
        if (isStarred) {
          starredList = starredList.filter(s => s.url !== entry.url);
          starredSet.delete(entry.url);
        } else {
          starredList.push(entry);
          starredSet.add(entry.url);
        }
        if (starredList.length > STARRED_MAX) {
          const removed = starredList.splice(0, starredList.length - STARRED_MAX);
          removed.forEach(s => starredSet.delete(s.url));
        }
        await persistStarred();
        sendResponse({ isStarred: !isStarred, starred: starredList });
      } catch (e) {
        console.error('[paperboy] TOGGLE_STAR error:', e);
        sendResponse({ isStarred: false, starred: [] });
      }
    })();
    return true;
  }

  if (msg.type === 'GET_STARRED') {
    (async () => {
      try {
        await loadState();
        sendResponse({ starred: starredList });
      } catch (e) {
        console.error('[paperboy] GET_STARRED error:', e);
        sendResponse({ starred: [] });
      }
    })();
    return true;
  }

  if (msg.type === 'IS_STARRED') {
    (async () => {
      try {
        await loadState();
        sendResponse({ isStarred: starredSet.has(msg.url) });
      } catch (e) {
        console.error('[paperboy] IS_STARRED error:', e);
        sendResponse({ isStarred: false });
      }
    })();
    return true;
  }

  if (msg.type === 'NATIVE_PING') {
    LibrssDir.nativeAvailable().then(ok => {
      sendResponse({ ok });
    }).catch(e => {
      sendResponse({ ok: false, error: e.message });
    });
    return true;
  }

  if (msg.type === 'SET_NATIVE_DIR') {
    browser.storage.local.set({ nativeDir: msg.dir || null }).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === 'SET_FEEDS') {
    LibrssDir.setFeeds(msg.feeds).then(() => {
      feeds = msg.feeds;
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === 'SET_CATEGORIES') {
    LibrssDir.setCategories(msg.categories).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'GET_CATEGORIES') {
    LibrssDir.getCategories().then(categories => sendResponse({ categories }));
    return true;
  }
});