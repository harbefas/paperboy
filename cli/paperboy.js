#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec: execCb } = require('child_process');
const { promisify } = require('util');

const exec = promisify(execCb);
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
    require('child_process').execSync('git init', { cwd: DIR, stdio: 'pipe' });
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

async function sync() {
  ensureDir();
  try {
    await exec('git add -A', { cwd: DIR });
    await exec('git commit -m "sync" --allow-empty', { cwd: DIR });
    try {
      await exec('git pull --rebase', { cwd: DIR });
    } catch (e) {
      const output = (e.stdout || '') + (e.stderr || '');
      if (output.toLowerCase().includes('conflict')) {
        console.error(`Merge conflict in ${DIR}. Resolve conflicts then run: git rebase --continue`);
        process.exit(1);
      }
      console.warn('Pull failed (no remote?):', e.message);
    }
    try {
      await exec('git push', { cwd: DIR });
    } catch (e) {
      console.warn('Push failed:', e.message);
    }
  } catch (e) {
    console.error('Sync failed:', e.message);
  }
}

async function doctor() {
  let allOk = true;

  function ok(msg) { console.log('✓', msg); }
  function fail(msg, hint) {
    console.log('✗', msg);
    if (hint) console.log(' ', hint);
    allOk = false;
  }

  // Directory
  if (fs.existsSync(DIR)) {
    ok(`Directory: ${DIR}`);
  } else {
    fail(`Directory missing: ${DIR}`, 'Run: paperboy init');
  }

  // feeds.json
  const feedsFile = path.join(DIR, 'feeds.json');
  if (fs.existsSync(feedsFile)) {
    try {
      const feeds = JSON.parse(fs.readFileSync(feedsFile, 'utf8'));
      ok(`feeds.json valid (${feeds.length} feed${feeds.length !== 1 ? 's' : ''})`);
    } catch {
      fail('feeds.json is invalid JSON', 'Fix or delete and run: paperboy init');
    }
  } else {
    fail('feeds.json missing', 'Run: paperboy init');
  }

  // git
  try {
    await exec('git rev-parse --git-dir', { cwd: DIR });
    ok('Git initialized');
  } catch {
    fail('Git not initialized', `Run: cd ${DIR} && git init`);
  }

  // Native messaging host manifest
  const nativeManifestPaths = [
    path.join(os.homedir(), '.mozilla/native-messaging-hosts/paperboy.json'),
    path.join(os.homedir(), 'Library/Application Support/Mozilla/NativeMessagingHosts/paperboy.json'),
    path.join(os.homedir(), 'AppData/Roaming/Mozilla/NativeMessagingHosts/paperboy.json'),
  ];
  const manifestPath = nativeManifestPaths.find(p => fs.existsSync(p));
  if (manifestPath) {
    ok(`Native host manifest: ${manifestPath}`);
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const hostScript = manifest.path;
      if (fs.existsSync(hostScript)) {
        ok(`Host script: ${hostScript}`);
      } else {
        fail(`Host script not found: ${hostScript}`, 'Reinstall the native host');
      }
    } catch {
      fail('Native host manifest is invalid JSON');
    }
  } else {
    fail('Native host manifest not found', `Expected at: ${nativeManifestPaths[0]}`);
  }

  console.log('');
  console.log(allOk ? '✓ All checks passed' : '✗ Some checks failed — see above');
}

async function install() {
  const platform = os.platform();
  const scriptDir = path.dirname(fs.realpathSync(process.argv[1]));
  const hostScript = path.join(scriptDir, 'paperboy-host.js');
  const cliScript  = path.join(scriptDir, 'paperboy.js');

  if (!fs.existsSync(hostScript)) {
    console.error(`Host script not found: ${hostScript}`);
    process.exit(1);
  }

  fs.chmodSync(hostScript, '755');
  fs.chmodSync(cliScript,  '755');

  const binDir = path.join(os.homedir(), '.local', 'bin');
  fs.mkdirSync(binDir, { recursive: true });

  const symlinkSafe = (src, dest) => {
    try { fs.unlinkSync(dest); } catch {}
    fs.symlinkSync(src, dest);
  };
  symlinkSafe(hostScript, path.join(binDir, 'paperboy-host'));
  symlinkSafe(cliScript,  path.join(binDir, 'paperboy'));
  console.log(`✓ Symlinks created in ${binDir}`);

  const manifest = JSON.stringify({
    name: 'paperboy',
    description: 'paperboy native messaging host',
    path: path.join(binDir, 'paperboy-host'),
    type: 'stdio',
    allowed_extensions: ['paperboy@paperboy.dev']
  }, null, 2);

  let manifestDirs = [];
  if (platform === 'linux') {
    manifestDirs = [path.join(os.homedir(), '.mozilla/native-messaging-hosts')];
  } else if (platform === 'darwin') {
    manifestDirs = [path.join(os.homedir(), 'Library/Application Support/Mozilla/NativeMessagingHosts')];
  } else {
    console.warn('Unsupported platform for automatic manifest installation. Place the manifest manually.');
  }

  for (const dir of manifestDirs) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'paperboy.json'), manifest);
    console.log(`✓ Manifest → ${dir}/paperboy.json`);
  }

  console.log('\nInitializing ~/paperboy...');
  init();
}

const cmd = process.argv[2];

switch (cmd) {
  case 'init':
    init();
    break;
  case 'install':
    install().catch(e => { console.error(e.message); process.exit(1); });
    break;
  case 'sync':
    sync().catch(e => console.error(e.message));
    break;
  case 'doctor':
    doctor().catch(e => console.error(e.message));
    break;
  default:
    console.log(`Usage: paperboy <command>

Commands:
  install   Install native host and create ~/paperboy/
  init      Initialize ~/paperboy/ directory with git
  sync      Commit changes and push/pull
  doctor    Check setup and diagnose issues

Files:
  ~/paperboy/feeds.json      - feed subscriptions
  ~/paperboy/history.jsonl   - read history (append-only)
  ~/paperboy/starred.jsonl   - saved articles (append-only)`);
}
