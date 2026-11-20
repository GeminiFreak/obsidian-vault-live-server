# Vault Live Server

A lightweight, dependency-free Obsidian desktop plugin that serves your live Obsidian vault as a clean, full-page interactive website at `http://localhost:8888/`—with zero vault duplication, no build steps, and no Docker containers.

## Features

- **Zero Vault Duplication:** Reads Markdown notes, images, audio, videos, CSS themes, and snippets directly from your existing vault on disk.
- **Pure Note Content:** Renders only your note content without Obsidian's sidebars, ribbon, file explorer, or tab chrome.
- **Full Theme & Snippet Parity:** Mirrors Obsidian's live workspace DOM hierarchy, active theme, enabled CSS snippets, and custom CSS variables so callouts, layouts, and custom styles match Obsidian.
- **Per-Note Dynamic Wallpapers:** Supports the Dynamic Wallpapers community plugin with per-note wallpaper resolution and viewport-locked sizing.
- **Dataview & Embeds Support:** Waits for Dataview tables/lists to render before serving and rewrites `[[wikilinks]]` and media embeds into working HTTP routes.
- **HTTP Range Video Streaming:** Streams `.mp4`, `.webm`, `.mkv`, and audio files directly from disk with seeking support.
- **Built-in Security:** Binds strictly to `127.0.0.1` (localhost only) by default and protects all routes with configurable HTTP Basic Authentication.
- **One-Click Controls:** Toggle the server on or off anytime from Obsidian's left ribbon, bottom-right status bar, or Command Palette.
- **Image Magnification on Click:** Click any embedded image in your served notes to view it magnified in a full-screen overlay without interfering with Dynamic Wallpapers.


## Installation

1. Download `manifest.json` and `main.js` from the latest release.
2. Create a folder named `vault-live-server` inside `<YourVault>/.obsidian/plugins/`.
3. Place both `manifest.json` and `main.js` inside that folder.
4. Open Obsidian **Settings -> Community plugins**, click the **Reload plugins** icon, and enable **Vault Live Server**.

## Configuration

Open **Settings -> Vault Live Server** in Obsidian to customize:

- **Server Port:** Default `8888` (`http://localhost:8888/`).
- **Default Landing Note:** The note served at `/` (e.g., `Home` or `master_list.md`).
- **Basic Auth Username & Password:** Required credentials to access the web server (leave both blank to disable login prompts on localhost).

## License

MIT License — see [LICENSE](LICENSE) for details.
