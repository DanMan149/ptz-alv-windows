# Alveus PTZ Control (Windows)

Local web app for controlling the Alveus Sanctuary PTZ cameras. It runs on your computer and talks to Twitch chat for you.

A step by step guide for beginners is in **PTZ-local-setup.pdf**.

## Install and run (Windows)

1. Install Node.js (LTS) from https://nodejs.org and restart your computer.
2. Download this repo (Code > Download ZIP) and unzip it somewhere easy.
3. Double click `install.bat` once.
4. Create a Twitch OAuth key, for example at https://twitchtokengenerator.com/ with the scopes `chat:read` and `chat:edit`.
5. Double click `start-ptz.bat` and leave the window open.
6. Open http://localhost:3000 in your browser (use `localhost` exactly).
7. Click the Settings cog, then Twitch Settings. Enter your Twitch username, channel and OAuth key. Restart `start-ptz.bat`.
8. Under Interface Settings, tick "Enable Full PTZ Perms" if you have move and tilt permissions.

To stop the app, close the black window.

Stream not showing? The stream URL in Twitch Settings needs `parent=localhost`, for example `https://player.twitch.tv/?channel=alveussanctuary&parent=localhost`, and the app must be opened at `http://localhost:3000`.

## Features

- Control the Alveus cameras from a web page on your own computer. Every button sends the matching command to Twitch chat as your account.
- Presets per camera (list or grid, search, hotkeys), custom presets, camera thumbnails, live Twitch chat widget.
- Control pad: move, zoom and focus, spin widget, swap widget.
- **Click on the video** to send the camera there. With **Click Preset** on (for subs), a click loads the nearest saved preset instead. **Calibrate** teaches the app each camera's field of view for better accuracy (nothing is sent to chat while calibrating).
- **Slots:** the app knows which camera is in which slot of the stream. **Sync Slots** or **Auto Sync** keeps the map up to date from the bot's replies.
  - Middle click (scroll wheel click) a slot: selects that slot's camera and scrolls the camera list to it.
  - Right click a slot: zoom list (10 to 600 percent) and focus list (-1000 to 1000) side by side.
  - Hold **Alt** (Option on Mac) or press the backtick key: pick another camera from the same group (for example pasture, pasturel, pasturefeeder) and swap to it.
  - Hold **Alt** and click another slot: swaps the selected camera with that slot (`!swap <slot> <slot>`).
  - A yellow box marks the slot of the selected camera.
- **Pano:** a map of every preset of a camera laid out by pan and tilt. Hover for a thumbnail, click to load.
- **Backup and Restore:** Settings > Twitch Settings > Backup and Restore exports or imports your cameras, presets, hotkeys, slot map, calibration, aliases and interface settings as one file.

Slot numbers follow the bot: 1 big main, 2 top left, 3 below it, 4 bottom left, 5 bottom middle, 6 bottom right.

## Settings and data

- `config.json` holds your Twitch username, channel, OAuth key and stream URLs. The copy in this repo is a blank template.
  **Never commit your real OAuth key.** After you fill it in, run `git update-index --skip-worktree config.json` so Git ignores your local edits.
- `public/cameras.json`, `public/custom-presets.json`, `public/hotkeys.json` and `public/custom-hotkeys.json` hold your camera list, presets and hotkeys.
- `public/preset-positions.json` holds the pan, tilt and zoom of each preset (used by Click Preset and Pano).
- `public/cam-aliases.json` maps the many names of each camera (parrot, littles, kasi...) to the app's camera names.
- `public/button-img` holds the preset thumbnails. This repo includes a small compressed set (320 px wide). The files keep the `.png` name but contain JPEG data, which browsers display normally. Replace them with full quality images any time.
- Most of your personal settings (slot map, calibration, aliases, interface switches) live in your browser, not in the files. Use Backup and Restore to move them.

## Upgrading

Do not overwrite your own `config.json`, `public/cameras.json`, `public/custom-presets.json`, `public/hotkeys.json` or `public/custom-hotkeys.json` with the copies from GitHub. They contain your setup. Export a backup first if unsure.

## Credits

Originally created by Dansza. This is a community-built, open source tool for controlling the Alveus Sanctuary cameras. It is not affiliated with Twitch or Alveus Sanctuary.
