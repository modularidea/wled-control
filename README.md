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
- Codeblock buttons allowing for custom states and sequences.

## Installation

Not yet on the Obsidian Community Plugins list. Manual install for now:

1. Download `main.js`, `manifest.json`, and `styles.css` from a [release](../../releases) (or
   build from source, see below).
2. Copy them into `<your vault>/.obsidian/plugins/wled-control/`.
3. Reload Obsidian and enable **WLED Control** under Settings → Community plugins.

## Usage

1. Open Settings → WLED Control and add a device (manual IP, or click "Start search").
2. Open the WLED Control sidebar (ribbon icon or the "Open sidebar" command) to control it.

### Codeblock buttons

1. Start a fenced code block with the language `wled-effect`.
2. In JSON format write either the device name or the device id ("device-name"/"device-id") of the device you want to address.
3. Also add "effect-name" to give a name to the button.

- Optionally, in the `"status"` field define the state you want the device to have after the effect is done. Basically the end state. For more info on the specific state object look at the official API documentation by WLED: https://kno.wled.ge/interfaces/json-api/#state-object

- Optionally, in the `"sequence"` field multiple effects can be defined in a JSON list that will be played in sequence. For each entry use the `"status"` field to define the state that should be displayed, and the `"delay"` field to declare the time in milliseconds to wait until the next effect in the sequence is displayed.

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
