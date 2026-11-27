# Cozy Cat App

A pixel-art Windows desktop virtual pet companion built with **Electron**, **Node.js**, **Express**, and **WebSockets**. Cozy Cat combines a cozy interactive home (Living Room + Bathroom + Build Mode) with a transparent, always-on-top **Windows desktop overlay** and **system tray** companion.

---

## Features

### Virtual Pet Care & Needs
- **Three Live Status Meters** (`0–10` scale): **HUNGER**, **ENERGY**, and **MOOD**, with passive time-based decay (offline catch-up capped at 120 minutes).
- **Floating Stat Deltas & Guards**: Displays `+n` / `-n` feedback on interactions, blocks action spamming mid-animation, and shows clear status messages when a stat is already full or too low (e.g., `"Cat already full, try feeding later"`).

### Rooms & Interactions

| Room | Action | Effect | Notes |
| --- | --- | --- | --- |
| **Living Room** | **Feed** | `Hunger +2` | Fills bowl with kibble (`eat` animation) |
| **Living Room** | **Fish** | `Hunger +1`, `Mood +1` | Fish treat bowl animation |
| **Living Room** | **Play** | `Mood +2`, `Energy -1` | Yarn ball animation |
| **Living Room** | **Pet** | `Mood +1` | Sidebar button or click directly on the cat |
| **Living Room** | **Sleep** | `Energy +3`, `Hunger -1` | Cat bed nap animation |
| **Bathroom** | **Bath** | `Energy +1`, `Mood +1` | Bathtub splash animation |
| **Bathroom** | **Toilet** | `Hunger -1`, `Mood +1` | Toilet animation |
| **Bathroom** | **Wash Hands** | `Energy +1` | Sink paw-wash animation |
| **Bathroom** | **Pet** | `Mood +1` | Sidebar button or click directly on the cat |

Use the isometric arrow in the top corner of the room to switch between the **Living Room** and **Bathroom**.

### Build Mode (`Decorate`)
- Live scaled room preview while customizing:
  - **Furniture**: Couches, Fireplaces, and Bookshelves (including `"None (Minimal)"` options).
  - **Walls**: Warm brown, Honey gold, Soft sage, Plain warm.
  - **Floors**: Tan oak, Dark oak, Plain oak.

### Settings & Audio
- **Sound effects** & **Background music** volume sliders (`0–100%`) powered by a built-in Web Audio synthesizer (no external audio assets required).
- **Show cat on desktop**: Keeps Cozy Cat on your Windows desktop when you close the room window, plus a **"Send cat to desktop now"** shortcut.
- **Automatically Open Cozy Cat when System starts**: Configures OS login startup.
- **UNDO**, **Set to Default** (resets settings only—preserves pet stats and room decor), and **Save Settings** (the main window close button is disabled while Settings is open).

### Windows Desktop Overlay & System Tray
- **Click-Through Transparent Window**: Spans the primary display work area so clicks anywhere outside the cat, hint bubble, or menu pass straight through to your desktop and open apps.
- **First-Time Hint Bubble**: Guides new users (`"Left Click to Move me / Right Click / Press 'Tab' on Keyboard to Open Menu"`).
- **Desktop Cat Controls**:
  - **Left-click cat**: Moves/scoots the cat away from your cursor so it never blocks desktop clicks.
  - **Hold left-click drag cat**: Drag the cat to other places on the desktop.
  - **Right-click cat** (or press `Tab` when focused / `Alt+Shift+C` globally): Opens the **Cozy Cat** context menu.
  - **Keyboard Menu Navigation**: `ArrowUp` / `ArrowDown` to highlight, `Enter` to select, `Esc` to close.
  - **Menu Actions**: `Open room`, `Pet cat`, dynamic `Toggle Roaming` (`Pause` / `Continue`), and `Quit Cozy Cat` (with a confirmation dialog).
- **Windows System Tray**: Mirrors the desktop menu (`Open room`, `Pet cat`, `Pause/Continue Roaming`, `Send cat to desktop`, `Quit Cozy Cat`); left-clicking the tray icon opens the room.

---

## Prerequisites

- **OS**: Windows 10 / 11 (recommended for full desktop overlay, taskbar edge alignment, login startup, and system tray support)
- **Node.js**: v20+ recommended (verified on Node.js v25.9.0)
- **npm**: v10+ (verified on npm 11.19.1)

---

## How to Run

### 1. Clone the repository & install dependencies

```powershell
git clone https://github.com/strvz7/Cozy-Cat-CSC4130.git
cd "Cozy Cat App"
npm install
```

### 2. Optional Environment Variables

No `.env` file or API keys are required to run the app locally. You can optionally set:

- `COZY_CAT_DATA_DIR`: Custom directory for persisting `state.json` (defaults to `%APPDATA%\CozyCatApp\state.json` on Windows).
- `COZY_CAT_PORT`: Port for the standalone backend (`npm run backend`, defaults to `38472`; the Electron app binds to an ephemeral localhost port automatically).

### 3. Start the Desktop Application

```powershell
npm start
```

This runs `electron .`, launches the embedded Express/WebSocket backend, opens the `960×640` Cozy Cat Room window, initializes the Windows system tray icon, and prepares the transparent Desktop Overlay window.

### 4. Run the Standalone Backend Only (Optional)

If you want to run just the HTTP + WebSocket backend server (`node src/backend/standalone.js`) without launching Electron:

```powershell
npm run backend
```

By default, the standalone server listens on `http://127.0.0.1:38472` (WebSocket at `ws://127.0.0.1:38472/ws`). To use a custom port:

```powershell
$env:COZY_CAT_PORT = "4000"
npm run backend
```

### 5. Run Automated Tests

```powershell
npm test
```

Runs `node --test tests/*.test.js`, covering `StateStore`, `PetEngine`, the Express/WebSocket server, and asset integrity.

### 6. Build / Packaging

No `build` or packaging script is currently configured in `package.json`—the app runs directly via Electron (`npm start`).

---

## Project Structure

```text
Cozy Cat App/
├── assets/                 # Curated pixel-art sprites, room props, icons & action frames
├── src/
│   ├── backend/
│   │   ├── constants.js    # Stat bounds, action definitions, decay rates, decor catalog
│   │   ├── petEngine.js    # Core simulation engine, guards, timers & event emitter
│   │   ├── server.js       # Express REST API + WebSocket (/ws) broadcaster
│   │   ├── standalone.js   # Standalone backend CLI entry point
│   │   └── store.js        # Atomic JSON state persistence
│   ├── main/
│   │   ├── main.js         # Electron main process, Room/Overlay windows, Tray & IPC
│   │   └── preload.js      # Secure contextBridge API for renderer windows
│   └── renderer/
│       ├── room/           # Room, Bathroom, Build Mode, Settings UI & Web Audio SFX/BGM
│       └── overlay/        # Transparent desktop pet overlay, menu & quit confirmation
├── tests/
│   └── backend.test.js     # Automated backend, API, WebSocket & asset verification tests
├── package.json
└── README.md
```

---

## Backend API Overview

When running, the backend exposes REST endpoints and a WebSocket stream (`/ws`):

- `GET /api/health` — Service health check
- `GET /api/state` — Full pet, room, settings, overlay, and activity snapshot
- `POST /api/actions/:actionId` — Trigger an action (`feed`, `fish`, `play`, `pet`, `sleep`, `bath`, `toilet`, `wash_hands`)
- `POST /api/room` — Switch `currentRoom` (`living` | `bathroom`) or update decor (`wall`, `floor`, `couch`, `fireplace`, `bookshelf`)
- `GET /api/settings` / `PUT /api/settings` — Read or update settings
- `POST /api/settings/reset` — Reset settings to defaults
- `POST /api/overlay/roaming` — Toggle or set overlay roaming state
- `POST /api/overlay/position` — Save overlay cat coordinates
- `POST /api/overlay/hint-dismiss` — Mark first-time hint bubble as seen
- `POST /api/overlay/open-room` / `POST /api/overlay/send-to-desktop` / `POST /api/overlay/quit` — Window & app lifecycle actions

---

## Data Persistence

Application state is saved automatically to:

- **Windows default**: `%APPDATA%\CozyCatApp\state.json`
- **Custom override**: Set the `COZY_CAT_DATA_DIR` environment variable to store `state.json` in a custom directory.

---

## License & Credits

- Application code is licensed under the **MIT License** (see `package.json`).
- Cat spritesheets and props from the **Cozy Cat Pixel Art Pack** (`Copyright © 2026 FOTOPIXY`).
