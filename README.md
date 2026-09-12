# WLED Control

Control [WLED](https://kno.wled.ge/) LED controllers on your local network directly from
Obsidian — color, brightness, presets, and on/off, with automatic device discovery.

> **⚠️ Beta software.** This plugin is early and largely untested against real-world setups
> beyond the author's own device. It talks to network hardware and writes to your Obsidian
> plugin data — use at your own risk. **No warranty or liability of any kind is provided**;
> see [LICENSE](./LICENSE). Please back up your vault and report issues on GitHub.

## Features

- Auto-discovery of WLED devices on your local subnet (HTTP scan, with mDNS as a secondary
  best-effort attempt — see [Known limitations](#known-limitations))
- Manual add by IP address / hostname
- Live control: color wheel, brightness, presets, segments, on/off — synced in real time via
  the device's WebSocket connection
- Ribbon icon and status bar entry per device for one-click toggling, with live color feedback
- Commands (with hotkey support) to toggle a specific device
- Open a device's own web dashboard in a browser tab, or embedded as an in-app tab

## Installation

Not yet on the Obsidian Community Plugins list. Manual install for now:

1. Download `main.js`, `manifest.json`, and `styles.css` from a [release](../../releases) (or
   build from source, see below).
2. Copy them into `<your vault>/.obsidian/plugins/wled-control/`.
3. Reload Obsidian and enable **WLED Control** under Settings → Community plugins.

## Usage

1. Open Settings → WLED Control and add a device (manual IP, or click "Start search").
2. Open the WLED Control sidebar (ribbon icon or the "Open sidebar" command) to control it.

## Known limitations

- **mDNS discovery does not work reliably on macOS.** Obsidian.app does not declare a local
  network usage entitlement, so macOS silently drops mDNS traffic from it. The plugin works
  around this with an active HTTP subnet scan (enabled by default), which does not require
  that entitlement — but it only finds devices on the same subnet as your computer.
- Desktop only (`isDesktopOnly: true`) — requires Node APIs not available on mobile.
- No USB/serial control yet.
- No effects/palette editing yet — color, brightness, presets, segments, and on/off only.

## Development

```bash
npm install
npm run dev      # esbuild watch build
npm run build    # typecheck + production build
```

See `CLAUDE.md` and `docs/` for architecture notes and decision history.

## License

MIT — see [LICENSE](./LICENSE).
