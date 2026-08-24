# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**paperboy** is a minimal RSS reader browser extension (Firefox & Chrome) that replaces the new tab page. It's pure vanilla JavaScript — no build system, no package manager, no transpilation.

## Installation & Setup

```bash
# Install native messaging host and CLI tools
cd cli && bash install.sh
```

This creates symlinks in `~/.local/bin/` and installs native messaging manifests for Firefox/Chrome. It also sets up `~/paperboy/` as the file-based storage directory.

```bash
# CLI commands (after install)
paperboy init   # Initialize ~/paperboy dir with git repo
paperboy sync   # git add/commit/pull/push ~/paperboy
```

**Loading the extension:**
- Firefox: `about:debugging` → Load Temporary Add-on → select `manifest.json`
- Chrome: `chrome://extensions` → Developer mode → Load unpacked → select repo root

## Architecture

Three-tier design:

**1. Service Worker (`background.js`)** — the core engine:
- Fetches and parses RSS 2.0 and Atom feeds via `fetch()` + DOM parsing
- Routes messages from UI: `FETCH_FEEDS`, `FORCE_REFRESH`, `FETCH_ARTICLE`, `FETCH_OG_IMAGE`, `TOGGLE_STAR`, `RECORD_HISTORY`, `SET_FEEDS`, etc.
- 15-minute alarm-based background refresh; per-feed 15-minute cache TTL in `browser.storage.local`
- Image extraction priority: media namespace → enclosure → og:image fallback

**2. UI Layer:**
- `newtab.js` — main UI: sidebar nav, paginated feed list (10/page), search, starred view, category management, keyboard shortcuts (vim-like: `j`/`k`, `gg`/`G`, `s` star, `r` refresh, `/` search)
- `reader.js` — article reader using `lib/Readability.js` for content extraction; font size controls, scroll progress bar
- `theme.js` — shared auto-theme system (time-based: light 7am–7pm, dark otherwise); stored in `localStorage`

**3. Storage Bridge (`storage.js`)** — singleton `LibrssDir`:
- Abstracts dual storage: `browser.storage.local` (primary) + optional native messaging sync
- Key data: feeds list, read history (JSONL, max 1000 entries), starred items (JSONL), categories (JSON)
- `cli/paperboy-host.js` — Node.js native messaging host using 4-byte length-prefixed JSON stdio protocol; reads/writes files in `~/paperboy/`

## Data Files (~/paperboy/)

| File | Format | Purpose |
|------|--------|---------|
| `feeds.json` | JSON array | Subscribed feed URLs |
| `history.jsonl` | Append-only JSONL | Read article history |
| `starred.jsonl` | Append-only JSONL | Starred/saved articles |
| `categories.json` | JSON object | Feed-to-tag mapping |

JSONL format is intentional — git-friendly, append-only, no merge conflicts.

## Design

**Read `mateCreations/DESIGN.md` before touching any UI.** It is the spec for the Yerba Mate / Tererê design system (tokens, typography, components, do's and don'ts) and it governs this repo.

Palette, type scale, radii and motion come from `styles/mate-tokens.css`, which is generated upstream and vendored by `scripts/sync-tokens.sh` — there is no build step here, so the CSS is linked directly from `newtab.html` / `reader.html`. **Never edit that file, and never write a hex in `newtab.css` / `reader.css`**: change the JSON in `mateCreations/ui/tokens` and rerun the script. The theme switch is the `data-theme` attribute on `<html>`, set by `theme.js`.

## Key Constraints

- **No build step** — edits to `.js`/`.html`/`.css` files take effect on extension reload
- **No npm** — `lib/Readability.js` is vendored directly
- **Manifest V2** — uses `browser.alarms` and native messaging; not MV3
- The native host (`cli/paperboy-host.js`) runs as a separate Node.js process spawned by the browser; it communicates only via stdin/stdout
