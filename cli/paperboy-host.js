#!/usr/bin/env node

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const os = require('os');

function getDir(msg) {
  if (msg.dir) {
    return msg.dir.replace(/^~/, os.homedir());
  }
  return path.join(os.homedir(), 'paperboy');
}

function readMessage() {
  return new Promise((resolve) => {
    const chunks = [];
    let size = null;
    let received = 0;

    process.stdin.on('readable', () => {
      if (size === null) {
        const bytesRead = process.stdin.read(4);
        if (!bytesRead) return;
        size = bytesRead.readUInt32LE(0);
      }

      const chunk = process.stdin.read(size - received);
      if (chunk) {
        chunks.push(chunk);
        received += chunk.length;
        if (received >= size) {
          const data = Buffer.concat(chunks).toString('utf8');
          resolve(JSON.parse(data));
        }
      }
    });
  });
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
  await fs.writeFile(filepath, JSON.stringify(data, null, 2) + '\n');
  fileCache.delete(filepath);
}

const fileCache = new Map();

async function main() {
  const msg = await readMessage();
  const dir = getDir(msg);
  const feedsFile = path.join(dir, 'feeds.json');
  const historyFile = path.join(dir, 'history.jsonl');
  const starredFile = path.join(dir, 'starred.jsonl');
  const categoriesFile = path.join(dir, 'categories.json');

  switch (msg.type) {
    case 'PING':
      sendMessage({ type: 'PONG' });
      break;

    case 'GET_FEEDS':
      try {
        if (fileCache.has(feedsFile)) {
          sendMessage({ type: 'FEEDS', feeds: fileCache.get(feedsFile) });
        } else {
          const content = await fs.readFile(feedsFile, 'utf8');
          const feeds = JSON.parse(content);
          fileCache.set(feedsFile, feeds);
          sendMessage({ type: 'FEEDS', feeds });
        }
      } catch {
        sendMessage({ type: 'FEEDS', feeds: [] });
      }
      break;

    case 'SET_FEEDS':
      await writeJSON(feedsFile, msg.feeds, dir);
      fileCache.set(feedsFile, msg.feeds);
      sendMessage({ type: 'OK' });
      break;

    case 'APPEND_HISTORY': {
      const existing = await readJSONL(historyFile);
      const idx = existing.findIndex(h => h.url === msg.entry.url);
      if (idx >= 0) {
        existing[idx] = msg.entry;
        await ensureDir(dir);
        await fs.writeFile(historyFile, existing.map(e => JSON.stringify(e)).join('\n') + '\n');
      } else {
        await appendJSONL(historyFile, msg.entry, dir);
      }
      sendMessage({ type: 'OK' });
      break;
    }

    case 'GET_HISTORY':
      sendMessage({ type: 'HISTORY', history: await readJSONL(historyFile) });
      break;

    case 'SET_STARRED':
      await writeJSON(starredFile, msg.starred, dir);
      fileCache.set(starredFile, msg.starred);
      sendMessage({ type: 'OK' });
      break;

    case 'GET_STARRED':
      sendMessage({ type: 'STARRED', starred: await readJSONL(starredFile) });
      break;

    case 'GET_CATEGORIES':
      try {
        if (fileCache.has(categoriesFile)) {
          sendMessage({ type: 'CATEGORIES', categories: fileCache.get(categoriesFile) });
        } else {
          const content = await fs.readFile(categoriesFile, 'utf8');
          const categories = JSON.parse(content);
          fileCache.set(categoriesFile, categories);
          sendMessage({ type: 'CATEGORIES', categories });
        }
      } catch {
        sendMessage({ type: 'CATEGORIES', categories: {} });
      }
      break;

    case 'SET_CATEGORIES':
      await writeJSON(categoriesFile, msg.categories, dir);
      fileCache.set(categoriesFile, msg.categories);
      sendMessage({ type: 'OK' });
      break;

    default:
      sendMessage({ type: 'ERROR', error: 'Unknown message type' });
  }
}

main().catch((e) => {
  sendMessage({ type: 'ERROR', error: e.message });
});