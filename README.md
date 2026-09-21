# Steam PiP

Steam PiP is a picture-in-picture video plugin for Decky Loader that gives you flexible, floating picture-in-picture viewing on the Steam Deck and Steam Machine. It floats a small, resizable browser window, a live news stream, a sporting event, video, whatever URL you give it, over whatever you're doing in SteamOS, so you can keep an eye on it without leaving your gameplay. It's also helpful for walkthroughs, game guides and tutorials.

Steam PiP works out of the box with YouTube, Twitch, and .m3u8 (HLS) streams from local DVRs (like [Channels DVR](https://getchannels.com/dvr-server/)) and IPTV providers, plus any other site or free streaming service you can point a browser at. It does not, however, work with copyrighted content protected by DRM such as Widevine (e.g. Netflix, Hulu, Disney+, etc.)

![Screenshot of PiP mode](picture.jpg)

## Features

- **Picture-in-picture or expanded view** — a small floating box you can position in any corner/edge, or blow up to a large near-fullscreen view. Maximize cycles through five steps — Small, Medium, Large, Extra Large, and full Expand — one tap at a time, or fine-tune the exact size with the Size slider at any point in between.
- **Freeform positioning** — grab the picture's own Move handle (in the on-screen overlay bar) and drag it anywhere on screen, instead of only the 8 preset corner/edge positions. The picture is kept from being dragged off-screen. The 8 presets and the Position button/QAM grid are still there and still work; freeform dragging is an additional option, not a replacement.
- **Works with streaming sites and raw streams** — YouTube, Twitch, and other browser-playable sites work directly; `.m3u8` (HLS) URLs from a local DVR (Channels DVR, Plex, HDHomeRun tuner, etc.) or an IPTV provider are routed through a bundled HLS.js player so they play instead of triggering a download prompt.
- **Saved channels/bookmarks** — save any number of URLs as named channels, pick from a dropdown, or cycle through them with a "Channel Surf" up/down control.
- **Reorderable channel list** — grab a channel by its handle and move it up or down the list, then lock it in place; no more hunting for tiny up/down arrows.
- **Playback controls** — play/pause (the button's icon reflects the last command you sent it, not a live readback of the embedded player, and is color-coded — green when it will play, blue when it will pause), jump back/ahead 10 or 30 seconds, volume and mute, all overlaid on the picture without needing to click into the embedded page.
- **On-screen overlay controls** — a floating control bar drawn right on top of the picture itself, for mouse/trackpad/touchscreen use without opening the Quick Access Menu at all. It can hug the picture as a single connected L-shaped bar, or split into a separate movable pill, and shows the same button set (in Expand mode, as a bottom dock). Which buttons appear, and in what order, is fully configurable — see Display Settings below.
- **Quiet-by-default volume curve** — the volume slider is tuned for background/second-screen listening: quiet is genuinely quiet and audible, and even the top of the slider stays well under full volume, so it never overpowers whatever game you're playing.
- **"Now playing" guide info (optional)** — if a channel has an XMLTV guide URL attached (e.g. from Channels DVR), Steam PiP shows what's currently airing — as a title in the Channel dropdown itself (so you can see what's on before picking), as persistent text in the panel, and as a brief overlay on the picture. Set one guide URL once (via the antenna icon) and it applies to every channel that doesn't set its own; a channel can also override which name it's looked up by in the guide, for cases where its display name and its guide listing don't share any text (e.g. a bookmark named after a network's on-air brand versus its real call letters). A single toggle turns guide data off completely (no background polling at all) if you don't want it.
- **Screenshots (optional)** — capture a frame of whatever's currently playing to a folder you choose, picked with the plugin's own in-panel folder browser. When a channel has "now playing" guide info, the saved filename embeds the show's title alongside the timestamp, so a folder of screenshots stays easy to sort through later.
- **Display Settings** — a dedicated settings screen for the on-screen overlay: a QAM Layout section with toggles for which of the four seek buttons (30s back, 10s back, 10s forward, 30s forward) show in the Quick Access Menu's own playback row; a Bar Layout section for whether the overlay is one connected bar or a separate movable pill; and drag-to-reorder lists (grab handle on each row) for exactly which buttons appear in the on-screen View and Control bars, and in what order — with a "Reset to Default Order" button to restore the original layout at any time.
- **Export/import your channel list** — back up your saved channels to a JSON file, or restore them, using the plugin's own in-panel folder/file browser — you choose the folder, filename, and source file yourself, and importing lets you append to or overwrite your current list. Export, Import, and Restore Defaults are all grouped behind a single Channel Management icon.

## Requirements

This is a plugin for **[Decky Loader](https://decky.xyz/)**, the plugin loader for SteamOS. Decky Loader isn't made by Valve — it's a community project that has to be installed once before any of its plugins (including this one) will work. If you don't already have it:

1. Install Decky Loader by following the instructions at [decky.xyz](https://decky.xyz/). This adds a new plugin icon to Game Mode.
2. Once Decky Loader is installed, come back here to install Steam PiP itself.

## Installing Steam PiP

Since this plugin isn't in the Decky Store (see below), it installs from a ZIP file:

1. Download the latest `decky-steam-pip.zip` from [Releases](https://github.com/Fofer/decky-steam-pip/releases), or build it yourself (see "Building" below).
2. Open the Decky Loader menu (the plug icon in Quick Access), go to Settings, and turn on **Developer Mode**.
3. A new "Install Plugin from ZIP" option appears under the Developer tab — use it to select `decky-steam-pip.zip`.
4. Steam PiP now shows up in the Decky Loader menu (Quick Access) with its own icon.

**If you're updating an existing install** and a feature that touches the plugin's backend (guide data, export/import, screenshots) doesn't seem to work after installing a new ZIP, restart Decky Loader itself — not just reinstall the plugin. Decky Loader's own backend process only picks up changes to the plugin's Python code on its next start, so a reinstall alone can leave it running old code. The Decky Loader menu doesn't currently offer a one-click restart for this from Game Mode, so the reliable option is rebooting the Steam Deck/Steam Machine.

## Using it

Open the Decky Loader menu, select **Steam PiP**, and hit **Open**. From there you can:

- Pick a saved channel from the dropdown, or cycle through them with the Channel Surf (up/down) buttons
- Add, edit, remove, or reorder channels — grab a channel's handle and drag it up or down, then lock it in place; give a channel a name, a URL, and optionally its own TV guide (XMLTV) URL
- Set one TV guide URL for every channel at once (the antenna icon) instead of repeating it per channel
- Export/import your whole channel list as a backup, or restore the curated defaults, all behind the Channel Management icon
- Control playback — play/pause, jump back/ahead 10s or 30s
- Mute and adjust volume
- Take a screenshot of what's currently playing, if enabled
- Toggle **Maximize** to cycle through five sizes (Small/Medium/Large/Extra Large/Expand), **Swap** to the last channel you were watching, **Hide** the picture temporarily (it keeps playing), turn **Guide Data** on or off, or **Close** the picture entirely
- Open **Display Settings** to choose which buttons show in the QAM and the on-screen overlay, and in what order
- While in picture-in-picture view: reposition it on an 8-point grid or drag it freely with the Move handle, and adjust its size, margin from the screen edge, and brightness

## Works on Steam Deck and Steam Machine

Fork of [rossimo/decky-pip](https://github.com/rossimo/decky-pip), which appears unmaintained. The original hardcoded Deck-only screen dimensions, which placed the picture-in-picture window incorrectly on any other device (e.g. a Steam Machine driving a TV). This fork detects the device and adjusts: a screen reporting Steam Deck's known native panel resolution (1280x800, true for both LCD and OLED) keeps the original, unmodified placement math; any other device measures its actual on-screen window size at runtime and places the picture correctly relative to it. See `src/screen.tsx` and `getScreenBounds()` in `src/pip.tsx`.

## Why isn't it in the Decky Store

The Decky Store's submission process requires confirming that generative AI was not used to write the majority of the code. Most of this fork — including everything added on top of the original `decky-pip` — was written with the help of Claude, an AI assistant, so that box can't be checked honestly. That's why it ships as a ZIP install instead.

## Building

```
pnpm install
pnpm run build
```

This produces `dist/index.js`. Zip the plugin folder (`plugin.json`, `dist/`, and the other top-level files) to get something Decky's "Install Plugin from ZIP" can use.
