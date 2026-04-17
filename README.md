# paperboy

A minimal RSS reader that replaces your browser's new tab page. No accounts, no ads, no tracking — your feeds live on your machine.

![paperboy — RSS reader as new tab](docs/screenshot.png)

## Features

- **New tab reader** — every new tab opens your feed list
- **RSS 2.0 & Atom** support with 15-minute background refresh
- **Article reader** — Readability-based content extraction, no tracking pixels
- **Starred articles** — save anything for later
- **Categories** — organize feeds by tag
- **Keyboard-first** — vim-like shortcuts (`j`/`k`, `gg`/`G`, `s` star, `r` refresh, `/` search)
- **Auto theme** — light during the day (7am–7pm), dark at night
- **File-based storage** — feeds, history and starred items sync to `~/paperboy/` as plain JSON/JSONL; git-friendly
- **Pure JS** — no build step, no npm, no transpilation

## Requirements

- Firefox or Chrome
- Node.js (for native file sync — optional)

## Install

```bash
git clone https://github.com/nfvelten/paperboy
cd paperboy/cli && bash install.sh
```

The install script:
- Creates symlinks in `~/.local/bin/`
- Installs native messaging manifests for Firefox and Chrome
- Sets up `~/paperboy/` as the local storage directory

### Load the extension

**Firefox:** go to `about:debugging` → *This Firefox* → *Load Temporary Add-on* → select `manifest.json`

**Chrome:** go to `chrome://extensions` → enable *Developer mode* → *Load unpacked* → select the repo root

### Initialize storage

```bash
paperboy init    # creates ~/paperboy with git repo
```

Optionally add a remote and auto-sync:

```bash
cd ~/paperboy
git remote add origin <your-repo-url>

# sync manually
paperboy sync

# or via cron every 5 minutes
*/5 * * * * paperboy sync
```

## Storage

Data lives in `~/paperboy/`:

| File | Format | Contents |
|------|--------|---------|
| `feeds.json` | JSON | Subscribed feed URLs |
| `history.jsonl` | Append-only JSONL | Read article history |
| `starred.jsonl` | Append-only JSONL | Starred articles |
| `categories.json` | JSON | Feed-to-tag mapping |

JSONL is intentional — append-only means no merge conflicts when syncing across machines via git.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `j` / `k` | Next / previous item |
| `gg` / `G` | First / last item |
| `s` | Star / unstar |
| `r` | Refresh feeds |
| `/` | Search |
| `Enter` | Open article |
| `Escape` | Close reader |

## Architecture

Three components:

- **`background.js`** — service worker; fetches and parses feeds, handles caching, background refresh alarm
- **`newtab.js` + `reader.js`** — UI layer; feed list, article reader, keyboard shortcuts
- **`cli/paperboy-host.js`** — Node.js native messaging host; reads/writes files in `~/paperboy/`

`storage.js` abstracts dual storage: `browser.storage.local` (primary) + optional native host sync.

## License

MIT
