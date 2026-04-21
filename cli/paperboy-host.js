#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');
const os = require('os');

function getDir(msg) {
  const home = os.homedir();
  let dir;
  if (msg.dir) {
    dir = path.resolve(msg.dir.replace(/^~/, home));
  } else {
    dir = path.join(home, 'paperboy');
  }
  if (dir !== home && !dir.startsWith(home + path.sep)) {
    dir = path.join(home, 'paperboy');
  }
  return dir;
}

async function* readMessages() {
  let leftover = Buffer.alloc(0);
  for await (const chunk of process.stdin) {
    leftover = Buffer.concat([leftover, chunk]);
    while (leftover.length >= 4) {
      const size = leftover.readUInt32LE(0);
      if (leftover.length < 4 + size) break;
      const msgBuf = leftover.slice(4, 4 + size);
      leftover = leftover.slice(4 + size);
      try { yield JSON.parse(msgBuf.toString('utf8')); } catch {}
    }
  }
}

function sendMessage(msg) {
  const data = Buffer.from(JSON.stringify(msg), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(data.length, 0);
  process.stdout.write(header);
  process.stdout.write(data);
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function readJSONL(filepath) {
  if (fileCache.has(filepath)) return fileCache.get(filepath);
  try {
    const content = await fs.readFile(filepath, 'utf8');
    const entries = content.split('\n').filter(line => line.trim()).map(line => {
      try { return JSON.parse(line); }
      catch { return null; }
    }).filter(Boolean);
    fileCache.set(filepath, entries);
    return entries;
  } catch {
    fileCache.set(filepath, []);
    return [];
  }
}

async function appendJSONL(filepath, entry, dir) {
  await ensureDir(dir);
  await fs.appendFile(filepath, JSON.stringify(entry) + '\n');
  const cached = fileCache.get(filepath);
  if (cached) cached.push(entry);
}

async function writeJSON(filepath, data, dir) {
  await ensureDir(dir);
  const tmp = filepath + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data) + '\n');
  await fs.rename(tmp, filepath);
  fileCache.delete(filepath);
}

const fileCache = new Map();

async function handleMessage(msg) {
  const dir = getDir(msg);
  const id = msg.id;
  const feedsFile = path.join(dir, 'feeds.json');
  const historyFile = path.join(dir, 'history.jsonl');
  const starredFile = path.join(dir, 'starred.jsonl');
  const categoriesFile = path.join(dir, 'categories.json');

  switch (msg.type) {
    case 'PING':
      sendMessage({ type: 'PONG', id });
      break;

    case 'GET_FEEDS':
      try {
        if (fileCache.has(feedsFile)) {
          sendMessage({ type: 'FEEDS', feeds: fileCache.get(feedsFile), id });
        } else {
          const content = await fs.readFile(feedsFile, 'utf8');
          const feeds = JSON.parse(content);
          fileCache.set(feedsFile, feeds);
          sendMessage({ type: 'FEEDS', feeds, id });
        }
      } catch {
        sendMessage({ type: 'FEEDS', feeds: [], id });
      }
      break;

    case 'SET_FEEDS':
      await writeJSON(feedsFile, msg.feeds, dir);
      fileCache.set(feedsFile, msg.feeds);
      sendMessage({ type: 'OK', id });
      break;

    case 'APPEND_HISTORY': {
      const existing = await readJSONL(historyFile);
      const idx = existing.findIndex(h => h.url === msg.entry.url);
      if (idx >= 0) {
        existing[idx] = msg.entry;
        await ensureDir(dir);
        await fs.writeFile(historyFile, existing.map(e => JSON.stringify(e)).join('\n') + '\n');
        fileCache.set(historyFile, existing);
      } else {
        await appendJSONL(historyFile, msg.entry, dir);
      }
      sendMessage({ type: 'OK', id });
      break;
    }

    case 'GET_HISTORY':
      sendMessage({ type: 'HISTORY', history: await readJSONL(historyFile), id });
      break;

    case 'SET_STARRED':
      await writeJSON(starredFile, msg.starred, dir);
      fileCache.set(starredFile, msg.starred);
      sendMessage({ type: 'OK', id });
      break;

    case 'GET_STARRED':
      sendMessage({ type: 'STARRED', starred: await readJSONL(starredFile), id });
      break;

    case 'GET_CATEGORIES':
      try {
        if (fileCache.has(categoriesFile)) {
          sendMessage({ type: 'CATEGORIES', categories: fileCache.get(categoriesFile), id });
        } else {
          const content = await fs.readFile(categoriesFile, 'utf8');
          const categories = JSON.parse(content);
          fileCache.set(categoriesFile, categories);
          sendMessage({ type: 'CATEGORIES', categories, id });
        }
      } catch {
        sendMessage({ type: 'CATEGORIES', categories: {}, id });
      }
      break;

    case 'SET_CATEGORIES':
      await writeJSON(categoriesFile, msg.categories, dir);
      fileCache.set(categoriesFile, msg.categories);
      sendMessage({ type: 'OK', id });
      break;

    default:
      sendMessage({ type: 'ERROR', error: 'Unknown message type', id });
  }
}

async function main() {
  for await (const msg of readMessages()) {
    handleMessage(msg).catch(e => {
      sendMessage({ type: 'ERROR', error: e.message, id: msg.id });
    });
  }
}

main().catch(() => {});
