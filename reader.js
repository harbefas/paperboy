initTheme('theme-btn');

const params = new URLSearchParams(window.location.search);
const articleUrl = params.get('url');
const hintTitle = params.get('title');

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

// ── Progress bar ──────────────────────────────────────────────────────
const progressBar = document.getElementById('progress-bar');

const topbar = document.querySelector('.topbar');

window.addEventListener('scroll', () => {
  const scrolled = window.scrollY;
  const total = document.documentElement.scrollHeight - window.innerHeight;
  const pct = total > 0 ? Math.min(100, (scrolled / total) * 100) : 0;
  progressBar.style.width = pct + '%';
  topbar.classList.toggle('scrolled', scrolled > 20);
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
  'form', '[aria-hidden="true"]',
];

function findMainContent(doc) {
  for (const sel of CONTENT_SELECTORS) {
    const el = doc.querySelector(sel);
    if (el && el.textContent.trim().length > 200) return el;
  }
  return doc.body;
}

function resolveUrls(el, base) {
  el.querySelectorAll('img').forEach(img => {
    const lazySrc = img.dataset.src || img.dataset.lazySrc || img.dataset.original
      || img.dataset.imgSrc || img.getAttribute('data-lazy') || img.getAttribute('data-url');
    const rawSrc = lazySrc || img.getAttribute('src') || '';
    if (!rawSrc || rawSrc.startsWith('data:')) { img.remove(); return; }
    try { img.src = new URL(rawSrc, base).href; } catch { img.remove(); return; }
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    img.removeAttribute('width');
    img.removeAttribute('height');
    img.loading = 'lazy';
  });
  el.querySelectorAll('a').forEach(a => {
    try { a.href = new URL(a.getAttribute('href') || '', base).href; } catch {}
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  });

  el.querySelectorAll('audio source, video source').forEach(source => {
    const rawSrc = source.getAttribute('src') || '';
    if (!rawSrc || rawSrc.startsWith('data:')) { source.remove(); return; }
    try { source.src = new URL(rawSrc, base).href; } catch { source.remove(); }
  });

  el.querySelectorAll('audio, video').forEach(media => {
    const rawSrc = media.getAttribute('src') || media.dataset.src || media.dataset.lazySrc || '';
    if (rawSrc && !rawSrc.startsWith('data:')) {
      try { media.src = new URL(rawSrc, base).href; } catch {}
    }
    media.setAttribute('controls', '');
    media.removeAttribute('autoplay');
    media.style.width = '100%';
  });
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
  REMOVE_SELECTORS.forEach(sel => mainEl.querySelectorAll(sel).forEach(e => e.remove()));

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

  // Filter out tiny images (tracking pixels, icons)
  mainEl.querySelectorAll('img').forEach(img => {
    const w = parseInt(img.getAttribute('width') || '0');
    const h = parseInt(img.getAttribute('height') || '0');
    if ((w > 0 && w < 60) || (h > 0 && h < 60)) img.remove();
  });

  document.title = title || 'paperboy';
  document.getElementById('topbar-title').textContent = title || articleUrl;
  document.getElementById('article-title').textContent = title;

  const meta = [];
  if (siteName) meta.push(siteName);
  if (byline) meta.push(byline);
  document.getElementById('article-meta').textContent = meta.join(' · ');

  const content = document.getElementById('article-content');
  content.innerHTML = mainEl.innerHTML;

  if (content.textContent.trim().length < 200) {
    content.innerHTML = `<p class="content-fallback">Could not extract article content. <a href="${articleUrl}" target="_blank" rel="noopener noreferrer">Open original →</a></p>`;
  }

  const words = mainEl.textContent.trim().split(/\s+/).length;
  const minutes = Math.max(1, Math.round(words / 238));
  meta.push(`${minutes} min read`);

  document.getElementById('loading').style.display = 'none';
  document.getElementById('article').style.display = 'block';

  // Table of contents
  const headings = Array.from(content.querySelectorAll('h1, h2, h3'));
  if (headings.length >= 3) {
    const toc = document.createElement('nav');
    toc.className = 'toc';
    const tocTitle = document.createElement('div');
    tocTitle.className = 'toc-title';
    tocTitle.textContent = 'Contents';
    toc.appendChild(tocTitle);

    headings.forEach((h, i) => {
      if (!h.id) h.id = 'h-' + i;
      const a = document.createElement('a');
      a.className = 'toc-item' + (h.tagName === 'H3' ? ' h3' : '');
      a.href = '#' + h.id;
      a.textContent = h.textContent;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        h.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      toc.appendChild(a);
    });

    document.body.appendChild(toc);
    setTimeout(() => toc.classList.add('visible'), 400);

    const tocObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const link = toc.querySelector(`a[href="#${entry.target.id}"]`);
        if (link) link.classList.toggle('active', entry.isIntersecting);
      });
    }, { rootMargin: '-10% 0px -80% 0px' });

    headings.forEach(h => tocObserver.observe(h));
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
    case 'c': {
      e.preventDefault();
      const tocNext = document.querySelector('.toc');
      if (tocNext) tocNext.classList.toggle('visible');
      break;
    }
    case '[': {
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
    case ']': {
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
    default: {
      const num = e.key === '0' ? 9 : parseInt(e.key) - 1;
      if (!isNaN(num) && num >= 0 && num <= 9) {
        const links = document.querySelectorAll('.toc .toc-item');
        if (links[num]) {
          e.preventDefault();
          links[num].click();
        }
      }
    }
  }
});

function showError(msg) {
  document.getElementById('loading').style.display = 'none';
  const err = document.getElementById('error');
  err.textContent = msg;
  err.style.display = 'block';
}

load();
