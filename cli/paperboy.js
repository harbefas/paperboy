#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const DIR = path.join(os.homedir(), 'paperboy');

function ensureDir() {
  if (!fs.existsSync(DIR)) {
    fs.mkdirSync(DIR, { recursive: true });
  }
}

function init() {
  ensureDir();

  const feedsFile = path.join(DIR, 'feeds.json');
  if (!fs.existsSync(feedsFile)) {
    fs.writeFileSync(feedsFile, '[]\n');
  }

  const historyFile = path.join(DIR, 'history.jsonl');
  if (!fs.existsSync(historyFile)) {
    fs.writeFileSync(historyFile, '');
  }

  const starredFile = path.join(DIR, 'starred.jsonl');
  if (!fs.existsSync(starredFile)) {
    fs.writeFileSync(starredFile, '');
  }

  try {
    execSync('git init', { cwd: DIR, stdio: 'pipe' });
    console.log(`Initialized git repo in ${DIR}`);

    const gitignore = path.join(DIR, '.gitignore');
    if (!fs.existsSync(gitignore)) {
      fs.writeFileSync(gitignore, '');
    }
  } catch {
    console.log(`Git repo already exists in ${DIR}`);
  }

  console.log(`
paperboy initialized!

  Directory: ${DIR}
  Files:
    feeds.json      - your feed subscriptions
    history.jsonl   - append-only read history
    starred.jsonl   - saved articles
    .git/           - version control

  Next steps:
    1. cd ${DIR}
    2. git remote add origin <your-repo-url>
    3. git add -A && git commit -m "init"
    4. git push -u origin main

  The extension will automatically use these files
  when the native messaging host is installed.
`);
}

function sync() {
  ensureDir();
  try {
    execSync('git add -A', { cwd: DIR, stdio: 'pipe' });
    execSync('git commit -m "sync" --allow-empty', { cwd: DIR, stdio: 'pipe' });
    try {
      execSync('git pull --rebase', { cwd: DIR, stdio: 'pipe' });
    } catch (e) {
      const output = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
      if (output.toLowerCase().includes('conflict')) {
        console.error(`Merge conflict in ${DIR}. Resolve conflicts then run: git rebase --continue`);
        process.exit(1);
      }
      console.warn('Pull failed (no remote?):', e.message);
    }
    try {
      execSync('git push', { cwd: DIR, stdio: 'pipe' });
    } catch (e) {
      console.warn('Push failed:', e.message);
    }
  } catch (e) {
    console.error('Sync failed:', e.message);
  }
}

const cmd = process.argv[2];

switch (cmd) {
  case 'init':
    init();
    break;
  case 'sync':
    sync();
    break;
  default:
    console.log(`Usage: paperboy <command>

Commands:
  init    Initialize ~/paperboy/ directory with git
  sync    Commit changes and push/pull

Files:
  ~/paperboy/feeds.json      - feed subscriptions
  ~/paperboy/history.jsonl   - read history (append-only)
  ~/paperboy/starred.jsonl   - saved articles (append-only)`);
}