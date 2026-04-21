const LibrssDir = (() => {
  let nativeDir = null;
  let dirLoaded = false;
  let _port = null;
  let _reqId = 0;
  const _pending = new Map(); // id -> { resolve, reject, timer }

  async function loadNativeDir() {
    if (dirLoaded) return;
    try {
      const { nativeDir: stored = null } = await browser.storage.local.get('nativeDir');
      nativeDir = stored;
    } catch {}
    dirLoaded = true;
  }

  function getPort() {
    if (_port) return _port;
    _port = browser.runtime.connectNative('paperboy');
    _port.onMessage.addListener((msg) => {
      const { id, ...rest } = msg;
      if (id !== undefined && _pending.has(id)) {
        const { resolve, timer } = _pending.get(id);
        clearTimeout(timer);
        _pending.delete(id);
        resolve(rest);
      }
    });
    _port.onDisconnect.addListener(() => {
      _port = null;
      for (const [, { reject, timer }] of _pending) {
        clearTimeout(timer);
        reject(new Error('Native port disconnected'));
      }
      _pending.clear();
    });
    return _port;
  }

  async function sendNative(msg) {
    await loadNativeDir();
    const payload = nativeDir ? { ...msg, dir: nativeDir } : { ...msg };
    try {
      const port = getPort();
      const id = ++_reqId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          _pending.delete(id);
          reject(new Error('Native message timeout'));
        }, 10_000);
        _pending.set(id, { resolve, reject, timer });
        port.postMessage({ ...payload, id });
      });
    } catch {
      return null;
    }
  }

  async function nativeAvailable() {
    const resp = await sendNative({ type: 'PING' });
    return resp?.type === 'PONG';
  }

  return {
    nativeAvailable,

    async getFeeds() {
      const resp = await sendNative({ type: 'GET_FEEDS' });
      if (resp?.feeds) {
        await browser.storage.local.set({ feeds: resp.feeds });
        return resp.feeds;
      }
      const { feeds = [] } = await browser.storage.local.get('feeds');
      return feeds;
    },

    async setFeeds(feeds) {
      await browser.storage.local.set({ feeds });
      await sendNative({ type: 'SET_FEEDS', feeds });
    },

    async appendHistory(entry) {
      await sendNative({ type: 'APPEND_HISTORY', entry });
    },

    async getHistory() {
      const { history = [] } = await browser.storage.local.get('history');
      return history;
    },

    async getStarred() {
      const { starred = [] } = await browser.storage.local.get('starred');
      return starred;
    },

    async isStarred(url) {
      const { starred = [] } = await browser.storage.local.get('starred');
      return starred.some(s => s.url === url);
    },

    async getCategories() {
      const resp = await sendNative({ type: 'GET_CATEGORIES' });
      if (resp?.categories) {
        await browser.storage.local.set({ categories: resp.categories });
        return resp.categories;
      }
      const { categories = {} } = await browser.storage.local.get('categories');
      return categories;
    },

    async setCategories(categories) {
      await browser.storage.local.set({ categories });
      await sendNative({ type: 'SET_CATEGORIES', categories });
    },

    setNativeDir(dir) {
      nativeDir = dir;
      dirLoaded = true;
      return browser.storage.local.set({ nativeDir: dir });
    },

    async setStarred(list) {
      await sendNative({ type: 'SET_STARRED', starred: list });
    },
  };
})();
