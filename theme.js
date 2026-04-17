const THEMES = ['auto', 'dark', 'light'];

const ICONS = {
  auto: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>',
  dark:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  light: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
};

function isDaytime() {
  const h = new Date().getHours();
  return h >= 7 && h < 19;
}

function resolveTheme(pref) {
  if (pref === 'dark') return 'dark';
  if (pref === 'light') return 'light';
  return isDaytime() ? 'light' : 'dark';
}

function applyTheme(pref) {
  const resolved = resolveTheme(pref);
  document.documentElement.classList.remove('theme-dark', 'theme-light');
  document.documentElement.classList.add('theme-' + resolved);
}

function initTheme(btnId) {
  let pref = localStorage.getItem('theme') || 'auto';
  applyTheme(pref);

  const btn = document.getElementById(btnId);
  if (!btn) return;

  btn.innerHTML = ICONS[pref];
  btn.title = 'Theme: ' + pref;

  let themeInterval = null;

  function startAutoCheck(currentPref) {
    if (themeInterval) { clearInterval(themeInterval); themeInterval = null; }
    if (currentPref === 'auto') {
      themeInterval = setInterval(() => {
        if (localStorage.getItem('theme') === 'auto') applyTheme('auto');
      }, 60_000);
    }
  }

  btn.addEventListener('click', () => {
    const currentResolved = resolveTheme(pref);
    let idx = THEMES.indexOf(pref);
    let next;
    do {
      idx = (idx + 1) % THEMES.length;
      next = THEMES[idx];
    } while (resolveTheme(next) === currentResolved && next !== pref);
    pref = next;
    localStorage.setItem('theme', pref);
    applyTheme(pref);
    btn.innerHTML = ICONS[pref];
    btn.title = 'Theme: ' + pref;
    startAutoCheck(pref);
  });

  startAutoCheck(pref);
}