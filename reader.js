initTheme('theme-btn');

const params = new URLSearchParams(window.location.search);
const articleUrl = params.get('url');
const hintTitle = params.get('title');
const hintSummary = params.get('summary');

// ── Reading queue (set by newtab when opening article) ────────────────
let readerQueue = [];
try { readerQueue = JSON.parse(sessionStorage.getItem('readerQueue') || '[]'); } catch {}

const _readerBase = browser.runtime.getURL('reader.html');

function getQueueIdx() {
  return articleUrl ? readerQueue.findIndex(i => i.url === articleUrl) : -1;
}

function openQueueItem(item) {
  if (!item?.url) return;
  let url = _readerBase + '?url=' + encodeURIComponent(item.url);
  if (item.title) url += '&title=' + encodeURIComponent(item.title);
  if (item.summary) url += '&summary=' + encodeURIComponent(item.summary);
  window.location.href = url;
}

// ── Font size ─────────────────────────────────────────────────────────
const FONT_SIZES = [14, 16, 18, 20, 22, 24];
let fontIdx = parseInt(localStorage.getItem('readerFontIdx') ?? '2');

function applyFontSize() {
  document.documentElement.style.setProperty('--prose-size', FONT_SIZES[fontIdx] + 'px');
}

function changeFontSize(delta) {
  fontIdx = Math.max(0, Math.min(FONT_SIZES.length - 1, fontIdx + delta));
  localStorage.setItem('readerFontIdx', fontIdx);
  applyFontSize();
}

applyFontSize();

document.getElementById('font-increase').addEventListener('click', () => changeFontSize(1));
document.getElementById('font-decrease').addEventListener('click', () => changeFontSize(-1));

// ── Font family ───────────────────────────────────────────────────────
const FONT_FAMILIES = [
  { label: 'Serif', value: "'EB Garamond', Georgia, serif" },
  { label: 'Sans',  value: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" },
];
let fontFamilyIdx = parseInt(localStorage.getItem('readerFontFamilyIdx') ?? '0');

function applyFontFamily() {
  document.documentElement.style.setProperty('--prose-font', FONT_FAMILIES[fontFamilyIdx].value);
  const btn = document.getElementById('font-family-btn');
  if (btn) btn.textContent = FONT_FAMILIES[fontFamilyIdx].label;
}

function cycleFontFamily() {
  fontFamilyIdx = (fontFamilyIdx + 1) % FONT_FAMILIES.length;
  localStorage.setItem('readerFontFamilyIdx', fontFamilyIdx);
  applyFontFamily();
}

applyFontFamily();
document.getElementById('font-family-btn').addEventListener('click', cycleFontFamily);

// ── Progress bar ──────────────────────────────────────────────────────
const progressBar = document.getElementById('progress-bar');

const topbar = document.querySelector('.topbar');

let _scrollRaf = false;
window.addEventListener('scroll', () => {
  if (_scrollRaf) return;
  _scrollRaf = true;
  requestAnimationFrame(() => {
    _scrollRaf = false;
    const scrolled = window.scrollY;
    const total = document.documentElement.scrollHeight - window.innerHeight;
    const pct = total > 0 ? Math.min(100, (scrolled / total) * 100) : 0;
    progressBar.style.width = pct + '%';
    topbar.classList.toggle('scrolled', scrolled > 20);
    if (articleUrl) sessionStorage.setItem('scroll:' + articleUrl, Math.round(scrolled));
  });
}, { passive: true });

document.getElementById('back-btn').addEventListener('click', () => {
  history.length > 1 ? history.back() : window.close();
});

const CONTENT_SELECTORS = [
  'article .entry-content', 'article .post-content', 'article .post-body',
  '.entry-content', '.post-content', '.article-body', '.article-content',
  '.article__body', '.story-body', '.story__body', '.post-text',
  '.content-body', '.body-content', '.main-content article',
  'article[class*="article"]', 'article[class*="post"]',
  'article', 'main article', '[role="main"] article',
  'main', '[role="main"]',
];

const REMOVE_SELECTORS = [
  'script', 'style', 'noscript', 'iframe',
  'nav', 'header', 'footer', 'aside',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', '[role="complementary"]',
  '.nav', '.menu', '.sidebar', '.widget', '.ad', '.ads', '.advertisement',
  '.social', '.share', '.sharing', '.related', '.recommended',
  '.comments', '.comment-section', '#comments',
  '.newsletter', '.subscribe', '.popup',
  'form',
  // cookie / consent / GDPR
  '[class*="cookie"]', '[id*="cookie"]', '[class*="consent"]', '[id*="consent"]',
  '[class*="gdpr"]', '[id*="gdpr"]', '[class*="privacy-banner"]',
  // paywalls / gates
  '[class*="paywall"]', '[class*="pay-wall"]', '[class*="subscription"]',
  '[class*="gate"]', '[id*="paywall"]',
  // related / recommended / author bio
  '[class*="related-article"]', '[class*="related-post"]', '[class*="more-stories"]',
  '[class*="author-bio"]', '[class*="author-box"]', '[class*="about-author"]',
  '[class*="article-footer"]', '[class*="post-footer"]',
  // notification / alert banners
  '[class*="notification-bar"]', '[class*="alert-bar"]', '[class*="breaking-bar"]',
  // site-specific noisy widgets
  '[class*="match-related"]', '[class*="match-preview"]',
];

function findMainContent(doc) {
  for (const sel of CONTENT_SELECTORS) {
    const el = doc.querySelector(sel);
    if (el && el.textContent.trim().length > 200) return el;
  }
  return doc.body;
}

function resolveUrls(el, base) {
  el.querySelectorAll('img, a, audio, video, audio > source, video > source').forEach(node => {
    const tag = node.tagName;
    if (tag === 'IMG') {
      const lazySrc = node.dataset.src || node.dataset.lazySrc || node.dataset.original
        || node.dataset.imgSrc || node.getAttribute('data-lazy') || node.getAttribute('data-url');
      const rawSrc = lazySrc || node.getAttribute('src') || '';
      if (!rawSrc || rawSrc.startsWith('data:')) { node.remove(); return; }
      try { node.src = new URL(rawSrc, base).href; } catch { node.remove(); return; }
      const w = parseInt(node.getAttribute('width') || '0');
      const h = parseInt(node.getAttribute('height') || '0');
      if ((w > 0 && w < 60) || (h > 0 && h < 60)) { node.remove(); return; }
      node.removeAttribute('srcset');
      node.removeAttribute('sizes');
      node.removeAttribute('width');
      node.removeAttribute('height');
      node.loading = 'lazy';
    } else if (tag === 'A') {
      try { node.href = new URL(node.getAttribute('href') || '', base).href; } catch {}
      node.target = '_blank';
      node.rel = 'noopener noreferrer';
    } else if (tag === 'SOURCE') {
      const rawSrc = node.getAttribute('src') || '';
      if (!rawSrc || rawSrc.startsWith('data:')) { node.remove(); return; }
      try { node.src = new URL(rawSrc, base).href; } catch { node.remove(); }
    } else {
      const rawSrc = node.getAttribute('src') || node.dataset.src || node.dataset.lazySrc || '';
      if (rawSrc && !rawSrc.startsWith('data:')) {
        try { node.src = new URL(rawSrc, base).href; } catch {}
      }
      node.setAttribute('controls', '');
      node.removeAttribute('autoplay');
      node.style.width = '100%';
    }
  });
}

const TOOLTIP_SELECTORS = [
  '[class*="tooltip"]', '[class*="popover"]', '[class*="popup"]',
  '[class*="hover"]', '[class*="modal"]', '[class*="overlay"]',
  '[class*="dropdown"]', '[class*="flyout"]', '[class*="card-preview"]',
  '[data-tooltip]', '[data-tippy]', '[role="tooltip"]',
  '[aria-haspopup]',
].join(',');

const INTERACTIVE_ATTRS = [
  'onmouseover', 'onmouseout', 'onmouseenter', 'onmouseleave',
  'onclick', 'onkeydown', 'onkeyup', 'onfocus', 'onblur',
  'data-toggle', 'data-target', 'data-bs-toggle', 'data-bs-target',
  'data-tippy-content', 'data-tooltip',
];

function sanitizeContent(el) {
  // Remove tooltip/popup/overlay elements
  el.querySelectorAll(TOOLTIP_SELECTORS).forEach(node => node.remove());

  // Handle inline styles — reveal hidden content, strip layout-breaking positioning
  el.querySelectorAll('[style]').forEach(node => {
    const s = node.getAttribute('style') || '';
    let cleaned = s;

    if (/display\s*:\s*none|visibility\s*:\s*hidden/.test(s)) {
      // Remove small/empty hidden nodes (tooltip containers, decorative overlays)
      // but reveal hidden nodes with real content (collapsible sections, BibTeX, etc.)
      if (node.textContent.trim().length < 20) { node.remove(); return; }
      cleaned = cleaned
        .replace(/display\s*:\s*none\s*;?/gi, '')
        .replace(/visibility\s*:\s*hidden\s*;?/gi, '');
    }

    cleaned = cleaned
      .split(';')
      .filter(rule => !/position\s*:\s*(absolute|fixed|sticky)|z-index|top\s*:|left\s*:|right\s*:|bottom\s*:/.test(rule))
      .join(';');

    if (cleaned !== s) node.setAttribute('style', cleaned);
  });

  // Reveal elements hidden via HTML `hidden` attribute
  el.querySelectorAll('[hidden]').forEach(node => {
    if (node.textContent.trim().length >= 20) node.removeAttribute('hidden');
    else node.remove();
  });

  // Convert <textarea> to <pre> — common pattern for BibTeX/code copy-paste widgets
  el.querySelectorAll('textarea').forEach(ta => {
    const pre = document.createElement('pre');
    pre.textContent = ta.value || ta.textContent;
    ta.replaceWith(pre);
  });

  // Wrap BibTeX/code-like content in <pre> if not already formatted
  el.querySelectorAll('div, p').forEach(node => {
    const text = node.textContent.trim();
    if (/^@\w+\s*\{/.test(text) && !node.querySelector('pre, code')) {
      const pre = document.createElement('pre');
      pre.textContent = text;
      node.replaceWith(pre);
    }
  });

  // Strip event handler attributes — check hasAttribute first to avoid unnecessary mutations
  el.querySelectorAll('*').forEach(node => {
    for (const attr of INTERACTIVE_ATTRS) {
      if (node.hasAttribute(attr)) node.removeAttribute(attr);
    }
  });

  // Wrap tables in scrollable container
  el.querySelectorAll('table').forEach(table => {
    if (table.parentElement?.classList.contains('table-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
  });
}

// ── Lightbox ──────────────────────────────────────────────────────────
function openLightbox(src, alt) {
  const lb = document.createElement('div');
  lb.className = 'lightbox';

  const img = document.createElement('img');
  img.src = src;
  img.alt = alt || '';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'lightbox-close';
  closeBtn.textContent = '✕';

  lb.appendChild(img);
  lb.appendChild(closeBtn);
  document.body.appendChild(lb);

  function close() {
    lb.classList.add('closing');
    lb.addEventListener('animationend', () => lb.remove(), { once: true });
  }

  lb.addEventListener('click', e => { if (e.target === lb) close(); });
  closeBtn.addEventListener('click', close);

  const onKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
}

async function load() {
  if (!articleUrl) { showError('URL not specified.'); return; }

  document.getElementById('open-link').href = articleUrl;

  // Show hint title immediately while loading
  if (hintTitle) {
    document.getElementById('topbar-title').textContent = hintTitle;
    document.title = hintTitle;
  } else {
    document.getElementById('topbar-title').textContent = articleUrl;
  }

  const iconEl = document.getElementById('topbar-icon');
  let parsedUrl;
  try {
    parsedUrl = new URL(articleUrl);
  } catch {
    parsedUrl = null;
  }

  if (parsedUrl) {
    iconEl.src = `https://www.google.com/s2/favicons?domain=${parsedUrl.hostname}&sz=32`;
    iconEl.onload = () => { iconEl.style.display = ''; };
    iconEl.onerror = () => { iconEl.style.display = 'none'; };
  } else {
    iconEl.style.display = 'none';
  }

  let html, finalUrl;
  try {
    const res = await browser.runtime.sendMessage({ type: 'FETCH_ARTICLE', url: articleUrl });
    if (res.error) throw new Error(res.error);
    html = res.html;
    finalUrl = res.url || articleUrl;
  } catch (e) {
    showError('Could not load article: ' + e.message);
    return;
  }

  // Parse once — clone for Readability (mutates), keep original for content
  const doc = new DOMParser().parseFromString(html, 'text/html');

  let title = doc.querySelector('meta[property="og:title"]')?.getAttribute('content')
    || doc.querySelector('title')?.textContent?.trim()
    || hintTitle
    || articleUrl;
  let byline = doc.querySelector('meta[name="author"]')?.getAttribute('content') || '';
  let siteName = doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content') || '';

  const needsReadability = !title || title === articleUrl || !byline;
  if (needsReadability) {
    try {
      const docClone = doc.cloneNode(true);
      const reader = new Readability(docClone);
      const article = reader.parse();
      if (article) {
        if (!title || title === articleUrl) title = article.title || title;
        if (!byline) byline = article.byline || '';
        if (!siteName) siteName = article.siteName || '';
      }
    } catch {}
  }

  // Extract content from original DOM (preserves images in their positions)
  const mainEl = findMainContent(doc);

  // Inject audio players found anywhere in the doc if not already in content
  const docAudios = doc.querySelectorAll('audio');
  docAudios.forEach(audio => {
    if (!mainEl.contains(audio)) {
      const clone = audio.cloneNode(true);
      clone.setAttribute('controls', '');
      clone.removeAttribute('autoplay');
      mainEl.insertBefore(clone, mainEl.firstChild);
    }
  });

  // Remove non-content elements
  mainEl.querySelectorAll(REMOVE_SELECTORS.join(',')).forEach(e => e.remove());

  mainEl.querySelectorAll('.video-player, .video-player-wrapper, [class*="video-player"]').forEach(el => {
    const link = document.createElement('a');
    link.href = finalUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'video-fallback';
    link.textContent = '▶ Watch on original site';
    el.replaceWith(link);
  });

  // Resolve URLs
  resolveUrls(mainEl, finalUrl);

  // Strip interactive elements that break the reader (hover cards, tooltips, popups)
  sanitizeContent(mainEl);

  const words = mainEl.textContent.trim().split(/\s+/).length;
  const minutes = Math.max(1, Math.round(words / 238));

  document.title = title || 'paperboy';
  document.getElementById('topbar-title').textContent = title || articleUrl;
  document.getElementById('article-title').textContent = title;

  const meta = [];
  if (siteName) meta.push(siteName);
  if (byline) meta.push(byline);
  meta.push(`${minutes} min read`);
  document.getElementById('article-meta').textContent = meta.join(' · ');

  const content = document.getElementById('article-content');
  content.replaceChildren(...Array.from(mainEl.childNodes));

  if (content.textContent.trim().length < 200) {
    content.innerHTML = '';
    if (hintSummary) {
      const p = document.createElement('p');
      p.className = 'content-summary-fallback';
      p.textContent = hintSummary;
      content.appendChild(p);
    }
    const fallback = document.createElement('p');
    fallback.className = 'content-fallback';
    const a = document.createElement('a');
    a.href = articleUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = hintSummary ? 'Read full article →' : 'Open original →';
    fallback.appendChild(a);
    content.appendChild(fallback);
  }

  document.getElementById('loading').style.display = 'none';
  document.getElementById('article').style.display = 'block';

  const savedScroll = sessionStorage.getItem('scroll:' + articleUrl);
  if (savedScroll) requestAnimationFrame(() => window.scrollTo(0, parseInt(savedScroll, 10)));

  const qIdx = getQueueIdx();
  const nextItem = qIdx >= 0 ? readerQueue[qIdx + 1] : null;
  if (nextItem) {
    const nextEl = document.createElement('div');
    nextEl.className = 'next-article';
    const label = document.createElement('span');
    label.className = 'next-article-label';
    label.textContent = 'Next';
    const link = document.createElement('button');
    link.className = 'next-article-link';
    link.textContent = (nextItem.title || nextItem.url) + ' →';
    link.addEventListener('click', () => openQueueItem(nextItem));
    nextEl.appendChild(label);
    nextEl.appendChild(link);
    document.getElementById('article').appendChild(nextEl);
  }

  content.addEventListener('click', e => {
    const img = e.target.closest('img');
    if (img && img.src && !img.src.startsWith('data:')) openLightbox(img.src, img.alt);
  });

  // Table of contents
  const headings = Array.from(content.querySelectorAll('h1, h2, h3'));
  if (headings.length >= 2) {
    const toc = document.createElement('nav');
    toc.className = 'toc';
    const tocTitle = document.createElement('div');
    tocTitle.className = 'toc-title';
    tocTitle.textContent = 'Contents';
    toc.appendChild(tocTitle);

    headings.forEach((h, i) => {
      if (!h.id) h.id = 'h-' + i;
      const a = document.createElement('a');
      a.className = 'toc-item' + (h.tagName === 'H3' ? ' toc-h3' : '');
      a.href = '#' + h.id;
      a.textContent = h.textContent;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        h.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      toc.appendChild(a);
    });

    document.body.appendChild(toc);

    const tocToggle = document.createElement('button');
    tocToggle.id = 'toc-toggle';
    tocToggle.className = 'toc-toggle';
    tocToggle.title = 'Toggle contents (c)';
    tocToggle.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>';
    document.body.appendChild(tocToggle);

    const tocHidden = localStorage.getItem('tocHidden') === '1';
    if (!tocHidden) toc.classList.add('visible');

    tocToggle.classList.toggle('toc-open', !tocHidden);
    tocToggle.addEventListener('click', () => {
      const nowVisible = toc.classList.toggle('visible');
      tocToggle.classList.toggle('toc-open', nowVisible);
      localStorage.setItem('tocHidden', nowVisible ? '0' : '1');
    });

    setTimeout(() => tocToggle.classList.add('ready'), 400);

    let activeTocLink = null;
    function updateTocActive() {
      const threshold = window.scrollY + window.innerHeight * 0.25;
      let active = null;
      for (const h of headings) {
        if (h.getBoundingClientRect().top + window.scrollY <= threshold) active = h;
        else break;
      }
      const newLink = active ? toc.querySelector(`a[href="#${active.id}"]`) : null;
      if (newLink === activeTocLink) return;
      if (activeTocLink) activeTocLink.classList.remove('active');
      if (newLink) newLink.classList.add('active');
      activeTocLink = newLink;
    }

    let tocRaf = false;
    window.addEventListener('scroll', () => {
      if (!tocRaf) { tocRaf = true; requestAnimationFrame(() => { tocRaf = false; updateTocActive(); }); }
    }, { passive: true });
    updateTocActive();
  }

  // Scroll reveal for article blocks
  const proseObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('visible');
      proseObserver.unobserve(entry.target);
    });
  }, { threshold: 0.06, rootMargin: '0px 0px -24px 0px' });

  const blocks = content.querySelectorAll('p, h1, h2, h3, h4, blockquote, pre, ul, ol, figure, img, audio, video, table, hr');
  blocks.forEach((el, i) => {
    el.classList.add('prose-block');
    el.style.animationDelay = Math.min(i, 5) * 60 + 'ms';
    proseObserver.observe(el);
  });

  browser.runtime.sendMessage({
    type: 'RECORD_HISTORY',
    entry: { url: articleUrl, title: title || articleUrl, readAt: new Date().toISOString() }
  });

  const starBtn = document.getElementById('star-btn');
  browser.runtime.sendMessage({ type: 'IS_STARRED', url: articleUrl }).then(({ isStarred }) => {
    if (isStarred) {
      starBtn.classList.add('starred');
      starBtn.querySelector('svg').setAttribute('fill', 'currentColor');
    }
  });
  starBtn.addEventListener('click', async () => {
    const { isStarred } = await browser.runtime.sendMessage({
      type: 'TOGGLE_STAR',
      entry: { url: articleUrl, title: title || articleUrl, starredAt: new Date().toISOString() }
    });
    if (isStarred) {
      starBtn.classList.add('starred');
      starBtn.querySelector('svg').setAttribute('fill', 'currentColor');
    } else {
      starBtn.classList.remove('starred');
      starBtn.querySelector('svg').setAttribute('fill', 'none');
    }
  });
}

// ── Topbar menu ───────────────────────────────────────────────────────
const menuBtn = document.getElementById('menu-btn');
const topbarMenu = document.getElementById('topbar-menu');

menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  topbarMenu.classList.toggle('open');
});

document.addEventListener('click', (e) => {
  if (!topbarMenu.contains(e.target) && e.target !== menuBtn) {
    topbarMenu.classList.remove('open');
  }
});

topbarMenu.addEventListener('click', (e) => {
  if (e.target.closest('button') && !e.target.closest('#font-decrease, #font-increase')) {
    topbarMenu.classList.remove('open');
  }
});

// ── Keys modal ────────────────────────────────────────────────────────
const keysOverlay = document.getElementById('keys-overlay');

function closeOverlay(el) {
  el.classList.add('closing');
  el.addEventListener('animationend', () => {
    el.style.display = 'none';
    el.classList.remove('closing');
  }, { once: true });
}

document.getElementById('keys-btn').addEventListener('click', () => keysOverlay.style.display = 'flex');
document.getElementById('keys-close').addEventListener('click', () => closeOverlay(keysOverlay));
keysOverlay.addEventListener('click', e => { if (e.target === keysOverlay) closeOverlay(keysOverlay); });

// ── Keyboard shortcuts ────────────────────────────────────────────────
let lastKey = null;
let lastKeyTime = 0;
const SCROLL_STEP = 160;

document.addEventListener('keydown', e => {
  if (e.target.closest('input, textarea, [contenteditable]')) return;

  const now = Date.now();
  const isDouble = lastKey === e.key && now - lastKeyTime < 500;
  lastKey = e.key;
  lastKeyTime = now;

  switch (e.key) {
    case 'j':
      e.preventDefault();
      window.scrollBy({ top: SCROLL_STEP, behavior: 'smooth' });
      break;
    case 'k':
      e.preventDefault();
      window.scrollBy({ top: -SCROLL_STEP, behavior: 'smooth' });
      break;
    case 'd':
      e.preventDefault();
      window.scrollBy({ top: window.innerHeight * 0.5, behavior: 'smooth' });
      break;
    case 'u':
      e.preventDefault();
      window.scrollBy({ top: -window.innerHeight * 0.5, behavior: 'smooth' });
      break;
    case 'g':
      if (isDouble) { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      break;
    case 'G':
      e.preventDefault();
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      break;
    case 'Escape':
    case 'Backspace':
      if (e.key === 'Backspace' && e.target.tagName === 'A') break;
      e.preventDefault();
      history.length > 1 ? history.back() : window.close();
      break;
    case 's':
      e.preventDefault();
      document.getElementById('star-btn').click();
      break;
    case 't':
      e.preventDefault();
      document.getElementById('theme-btn').click();
      break;
    case 'f':
      e.preventDefault();
      cycleFontFamily();
      break;
    case ']':
      e.preventDefault();
      { const i = getQueueIdx(); openQueueItem(readerQueue[i + 1]); }
      break;
    case '[':
      e.preventDefault();
      { const i = getQueueIdx(); if (i > 0) openQueueItem(readerQueue[i - 1]); }
      break;
    case 'c': {
      e.preventDefault();
      const tocNext = document.querySelector('.toc');
      if (tocNext) {
        const nowVisible = tocNext.classList.toggle('visible');
        const toggleBtn = document.getElementById('toc-toggle');
        if (toggleBtn) toggleBtn.classList.toggle('toc-open', nowVisible);
        localStorage.setItem('tocHidden', nowVisible ? '0' : '1');
      }
      break;
    }
    case 'h': {
      e.preventDefault();
      const headingsBack = document.querySelectorAll('#article-content h1, #article-content h2, #article-content h3');
      const scrollY = window.scrollY + 80;
      let target = null;
      for (let i = headingsBack.length - 1; i >= 0; i--) {
        if (headingsBack[i].getBoundingClientRect().top + scrollY - window.innerHeight / 2 < scrollY - 20) {
          target = headingsBack[i];
          break;
        }
      }
      if (!target && headingsBack.length) target = headingsBack[0];
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      break;
    }
    case 'l': {
      e.preventDefault();
      const headingsFwd = document.querySelectorAll('#article-content h1, #article-content h2, #article-content h3');
      const scrollYFwd = window.scrollY + 80;
      let targetFwd = null;
      for (let i = 0; i < headingsFwd.length; i++) {
        if (headingsFwd[i].getBoundingClientRect().top + scrollYFwd - window.innerHeight / 2 > scrollYFwd + 20) {
          targetFwd = headingsFwd[i];
          break;
        }
      }
      if (targetFwd) targetFwd.scrollIntoView({ behavior: 'smooth', block: 'start' });
      break;
    }
    case ' ':
      e.preventDefault();
      window.scrollBy({ top: e.shiftKey ? -window.innerHeight * 0.9 : window.innerHeight * 0.9, behavior: 'smooth' });
      break;
    case 'o':
      e.preventDefault();
      document.getElementById('open-link').click();
      break;
    case '+':
    case '=':
      e.preventDefault();
      changeFontSize(1);
      break;
    case '-':
      e.preventDefault();
      changeFontSize(-1);
      break;
    case '?':
      keysOverlay.style.display = keysOverlay.style.display === 'none' ? 'flex' : 'none';
      break;
    default:
      break;
  }
});

function showError(msg) {
  document.getElementById('loading').style.display = 'none';
  const err = document.getElementById('error');
  err.textContent = msg;
  err.style.display = 'block';
}

load();
