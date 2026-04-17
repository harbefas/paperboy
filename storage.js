const LibrssDir = (() => {
  let nativeDir = null;
  let dirLoaded = false;

  async function loadNativeDir() {
    if (dirLoaded) return;
    try {
      const { nativeDir: stored = null } = await browser.storage.local.get('nativeDir');
      nativeDir = stored;
    } catch {}
    dirLoaded = true;
  }

  async function sendNative(msg) {
    await loadNativeDir();
    if (nativeDir) msg.dir = nativeDir;
    try {
      return await browser.runtime.sendNativeMessage('paperboy', msg);
    } catch {
      return null;
    }
  }

  async function nativeAvailable() {
    const resp = await sendNative({ type: 'PING' });
    return resp?.type === 'PONG';
  }

  const HISTORY_MAX = 1000;

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
      const { history = [] } = await browser.storage.local.get('history');
      const urlSet = new Set(history.map(h => h.url));
      if (urlSet.has(entry.url)) {
        const idx = history.findIndex(h => h.url === entry.url);
        history[idx] = entry;
      } else {
        history.push(entry);
      }
      if (history.length > HISTORY_MAX) {
        history.splice(0, history.length - HISTORY_MAX);
      }
      await browser.storage.local.set({ history });
      await sendNative({ type: 'APPEND_HISTORY', entry });
    },

    async getHistory() {
      const { history = [] } = await browser.storage.local.get('history');
      return history;
    },

    async toggleStar(entry) {
      const { starred = [] } = await browser.storage.local.get('starred');
      const urlSet = new Set(starred.map(s => s.url));
      let isStarred;
      if (urlSet.has(entry.url)) {
        const idx = starred.findIndex(s => s.url === entry.url);
        starred.splice(idx, 1);
        isStarred = false;
      } else {
        starred.push(entry);
        isStarred = true;
      }
      await browser.storage.local.set({ starred });
      await sendNative({ type: 'SET_STARRED', starred });
      return isStarred;
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

    async appendHistoryList(list) {
      await sendNative({ type: 'SET_STARRED', starred: list });
    },

    async setStarred(list) {
      await sendNative({ type: 'SET_STARRED', starred: list });
    },
  };
})();
