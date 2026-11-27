const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

const { StateStore } = require('../src/backend/store');
const { PetEngine } = require('../src/backend/petEngine');
const { createBackendServer } = require('../src/backend/server');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cozy-cat-test-'));
}

describe('StateStore', () => {
  it('loads default state when file does not exist and persists updates', () => {
    const dir = makeTempDir();
    const store = new StateStore(dir);
    const initial = store.load(1000);
    assert.equal(initial.pet.hunger, 5);
    assert.equal(initial.pet.energy, 5);
    assert.equal(initial.pet.mood, 5);
    assert.equal(initial.room.currentRoom, 'living');
    assert.equal(initial.settings.showCatOnDesktop, true);

    initial.pet.hunger = 8;
    store.save(initial);

    const reloaded = store.load(2000);
    assert.equal(reloaded.pet.hunger, 8);
  });
});

describe('PetEngine', () => {
  it('applies living room action deltas, prevents mid-animation spam, and enforces full-bar guards', () => {
    const dir = makeTempDir();
    let now = 100000;
    const engine = new PetEngine({ store: new StateStore(dir), clock: () => now });

    // Feed: +2 hunger (5 -> 7)
    const feed1 = engine.performAction('feed');
    assert.equal(feed1.ok, true);
    assert.equal(feed1.deltas.hunger, 2);
    assert.equal(feed1.state.pet.hunger, 7);

    // Spamming mid-animation is blocked
    const spam = engine.performAction('fish');
    assert.equal(spam.ok, false);
    assert.equal(spam.reason, 'busy');

    // Advance past animation duration
    now += 3000;
    const feed2 = engine.performAction('feed'); // 7 -> 9
    assert.equal(feed2.state.pet.hunger, 9);

    now += 3000;
    const feed3 = engine.performAction('feed'); // 9 -> 10
    assert.equal(feed3.state.pet.hunger, 10);

    // Feeding when already full (10) is blocked with message
    now += 3000;
    const feedBlocked = engine.performAction('feed');
    assert.equal(feedBlocked.ok, false);
    assert.equal(feedBlocked.reason, 'stat_full');
    assert.equal(feedBlocked.message, 'Cat already full, try feeding later');
  });

  it('enforces room constraints and applies bathroom actions accurately', () => {
    const dir = makeTempDir();
    let now = 100000;
    const engine = new PetEngine({ store: new StateStore(dir), clock: () => now });

    const wrongRoom = engine.performAction('bath');
    assert.equal(wrongRoom.ok, false);
    assert.equal(wrongRoom.reason, 'wrong_room');

    engine.switchRoom('bathroom');
    const bath = engine.performAction('bath');
    assert.equal(bath.ok, true);
    assert.equal(bath.state.pet.energy, 6);
    assert.equal(bath.state.pet.mood, 6);

    now += 3000;
    const toilet = engine.performAction('toilet');
    assert.equal(toilet.ok, true);
    assert.equal(toilet.state.pet.hunger, 4);
    assert.equal(toilet.state.pet.mood, 7);

    now += 3000;
    const wash = engine.performAction('wash_hands');
    assert.equal(wash.ok, true);
    assert.equal(wash.state.pet.energy, 7);
  });

  it('applies passive decay capped at 120 minutes', () => {
    const dir = makeTempDir();
    let now = 100000;
    const engine = new PetEngine({ store: new StateStore(dir), clock: () => now });

    // Advance 10 hours (should cap at 120 minutes)
    now += 10 * 60 * 60 * 1000;
    const changed = engine.applyDecay(now);
    assert.equal(changed, true);
    const snap = engine.getSnapshot();
    assert.equal(snap.pet.hunger, 0);
    assert.equal(snap.pet.energy, 0);
    assert.equal(snap.pet.mood, 0);
  });

  it('updates room decor, settings, and resets settings without wiping pet or room progress', () => {
    const dir = makeTempDir();
    let startupCalledWith = null;
    const engine = new PetEngine({
      store: new StateStore(dir),
      startupHandler: (val) => {
        startupCalledWith = val;
      },
    });

    engine.performAction('feed'); // hunger 5 -> 7
    engine.updateDecor({ wall: 'soft_sage', floor: 'dark_oak', couch: 'none', invalid: 'bad' });
    engine.updateSettings({ soundEffects: 150, backgroundMusic: -10, showCatOnDesktop: false, launchAtStartup: true });

    assert.equal(startupCalledWith, true);
    let snap = engine.getSnapshot();
    assert.equal(snap.settings.soundEffects, 100);
    assert.equal(snap.settings.backgroundMusic, 0);
    assert.equal(snap.settings.showCatOnDesktop, false);
    assert.equal(snap.settings.launchAtStartup, true);
    assert.equal(snap.room.wall, 'soft_sage');
    assert.equal(snap.room.couch, 'none');

    engine.resetSettingsToDefault();
    snap = engine.getSnapshot();
    assert.equal(snap.settings.soundEffects, 50);
    assert.equal(snap.settings.backgroundMusic, 50);
    assert.equal(snap.settings.showCatOnDesktop, true);
    assert.equal(snap.settings.launchAtStartup, false);
    // Pet and room progress must remain intact!
    assert.equal(snap.pet.hunger, 7);
    assert.equal(snap.room.wall, 'soft_sage');
  });
});

describe('HTTP & WebSocket Backend Server', () => {
  it('serves state, executes actions, broadcasts WS updates, and handles overlay commands', async () => {
    const dir = makeTempDir();
    let now = 500000;
    const engine = new PetEngine({ store: new StateStore(dir), clock: () => now });
    let openRoomCalled = false;
    let sendDesktopCalled = false;
    let quitCalled = false;

    const srv = createBackendServer({
      engine,
      port: 0,
      onOpenRoom: () => { openRoomCalled = true; },
      onSendToDesktop: () => { sendDesktopCalled = true; },
      onQuitApp: () => { quitCalled = true; },
    });

    const info = await srv.start();
    const ws = new WebSocket(info.wsUrl);
    try {
      const messages = [];
      await new Promise((resolve, reject) => {
        ws.once('error', reject);
        ws.on('message', (raw) => {
          messages.push(JSON.parse(raw.toString()));
          if (messages.length === 1) resolve();
        });
      });

      assert.equal(messages[0].type, 'state:update');
      assert.equal(messages[0].data.pet.mood, 5);

      // Pet from overlay
      const petRes = await fetch(`${info.baseUrl}/api/actions/pet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'overlay' }),
      });
      const petJson = await petRes.json();
      assert.equal(petJson.ok, true);
      assert.equal(petJson.state.pet.mood, 6);

      // Roaming toggle
      const roamRes = await fetch(`${info.baseUrl}/api/overlay/roaming`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const roamJson = await roamRes.json();
      assert.equal(roamJson.roaming, false);

      // Overlay IPC callbacks
      await fetch(`${info.baseUrl}/api/overlay/open-room`, { method: 'POST' });
      await fetch(`${info.baseUrl}/api/overlay/send-to-desktop`, { method: 'POST' });
      await fetch(`${info.baseUrl}/api/overlay/quit`, { method: 'POST' });
      await new Promise((r) => setTimeout(r, 30));

      assert.equal(openRoomCalled, true);
      assert.equal(sendDesktopCalled, true);
      assert.equal(quitCalled, true);

      // Ensure WS received action:started
      assert.ok(messages.some((m) => m.type === 'action:started' && m.data.actionId === 'pet'));
    } finally {
      ws.close();
      await srv.stop();
      engine.stop();
    }
  });
});

describe('Assets & File Integrity', () => {
  it('has all required local and Figma assets present and non-empty', () => {
    const root = path.resolve(__dirname, '..');
    const required = [
      'assets/figma/ic_bowl.png',
      'assets/figma/ic_fish.png',
      'assets/figma/ic_yarn.png',
      'assets/figma/ic_heart.png',
      'assets/figma/ic_bed.png',
      'assets/figma/ic_decorate.png',
      'assets/figma/ic_gear.png',
      'assets/figma/ic_x.png',
      'assets/figma/arrow_right.png',
      'assets/figma/w_brown.png',
      'assets/figma/f_tan.png',
      'assets/figma/i_window.png',
      'assets/figma/i_sofa.png',
      'assets/figma/i_bookshelf.png',
      'assets/figma/i_fire_off.png',
      'assets/figma/bath_tub_icon.png',
      'assets/figma/bath_toilet_icon.png',
      'assets/figma/bath_sink_icon.png',
      'assets/cat/sidewalk.png',
      'assets/cat/sideidle.png',
      'assets/cat/sitting.png',
      'assets/cat/sleeping.png',
      'assets/cat/catwithyarn.png',
      'assets/actions/eat/frame_0.png',
      'assets/actions/fish/frame_0.png',
      'assets/actions/pet/frame_0.png',
      'assets/actions/bath/frame_0.png',
      'assets/actions/toilet/frame_0.png',
      'assets/actions/wash_hands/frame_0.png',
      'node_modules/@fontsource/pixelify-sans/400.css',
    ];
    for (const rel of required) {
      const full = path.join(root, rel);
      assert.ok(fs.existsSync(full), `Missing asset: ${rel}`);
      assert.ok(fs.statSync(full).size > 0, `Empty asset: ${rel}`);
    }

    const indexHtml = fs.readFileSync(path.join(root, 'src/renderer/room/index.html'), 'utf8');
    const roomJs = fs.readFileSync(path.join(root, 'src/renderer/room/room.js'), 'utf8');
    assert.ok(indexHtml.includes('id="living-sprite-anim"'), 'Dedicated spritesheet container missing');
    assert.ok(roomJs.includes("getElementById('living-sprite-anim')"), 'play/sleep should render in living-sprite-anim');
  });
});
