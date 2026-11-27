const EventEmitter = require('events');
const {
  STAT_MIN,
  STAT_MAX,
  DEFAULT_SETTINGS,
  ACTIONS,
  CUSTOMIZATION_CATALOG,
  DECAY_PER_MINUTE,
} = require('./constants');

function clampStat(value) {
  return Math.max(STAT_MIN, Math.min(STAT_MAX, Number(value)));
}

function clampVolume(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 50;
  return Math.max(0, Math.min(100, Math.round(num)));
}

class PetEngine extends EventEmitter {
  constructor({ store, clock = () => Date.now(), startupHandler = null } = {}) {
    super();
    this.store = store;
    this.clock = clock;
    this.startupHandler = startupHandler;
    this.state = this.store.load(this.clock());
    this.activeAction = null; // { actionId, animation, startedAt, endsAt, deltas }
    this._actionTimer = null;
    this._decayTimer = null;
  }

  start() {
    if (!this._decayTimer) {
      this._decayTimer = setInterval(() => {
        this.applyDecay();
      }, 15000);
      if (this._decayTimer.unref) this._decayTimer.unref();
    }
    this.applyDecay();
  }

  stop() {
    if (this._decayTimer) {
      clearInterval(this._decayTimer);
      this._decayTimer = null;
    }
    if (this._actionTimer) {
      clearTimeout(this._actionTimer);
      this._actionTimer = null;
    }
  }

  getSnapshot() {
    const now = this.clock();
    const busy = Boolean(this.activeAction && now < this.activeAction.endsAt);
    return {
      pet: {
        hunger: Number(this.state.pet.hunger.toFixed(2)),
        energy: Number(this.state.pet.energy.toFixed(2)),
        mood: Number(this.state.pet.mood.toFixed(2)),
        hungerTicks: Math.round(this.state.pet.hunger),
        energyTicks: Math.round(this.state.pet.energy),
        moodTicks: Math.round(this.state.pet.mood),
        lastDecayAt: this.state.pet.lastDecayAt,
        lastAction: this.state.pet.lastAction,
        lastActionAt: this.state.pet.lastActionAt,
      },
      room: { ...this.state.room },
      settings: { ...this.state.settings },
      overlay: { ...this.state.overlay },
      activity: busy
        ? { ...this.activeAction, busy: true }
        : { actionId: null, animation: 'idle', busy: false },
      catalog: CUSTOMIZATION_CATALOG,
      actions: ACTIONS,
    };
  }

  persistAndEmit(eventName = 'state:update', payload = {}) {
    this.store.save(this.state);
    const snapshot = this.getSnapshot();
    this.emit('state:update', snapshot);
    if (eventName !== 'state:update') {
      this.emit(eventName, { ...payload, state: snapshot });
    }
    return snapshot;
  }

  /**
   * Applies passive decay based on elapsed time since lastDecayAt.
   * Caps offline catch-up at 120 minutes so returning after days doesn't leave all bars empty immediately.
   */
  applyDecay(now = this.clock()) {
    const elapsedMs = Math.max(0, now - (this.state.pet.lastDecayAt || now));
    if (elapsedMs < 5000) {
      return false;
    }
    const cappedMinutes = Math.min(120, elapsedMs / 60000);
    const prev = {
      hunger: this.state.pet.hunger,
      energy: this.state.pet.energy,
      mood: this.state.pet.mood,
    };

    this.state.pet.hunger = clampStat(prev.hunger - DECAY_PER_MINUTE.hunger * cappedMinutes);
    this.state.pet.energy = clampStat(prev.energy - DECAY_PER_MINUTE.energy * cappedMinutes);
    this.state.pet.mood = clampStat(prev.mood - DECAY_PER_MINUTE.mood * cappedMinutes);
    this.state.pet.lastDecayAt = now;

    const changed =
      Math.abs(this.state.pet.hunger - prev.hunger) > 0.001 ||
      Math.abs(this.state.pet.energy - prev.energy) > 0.001 ||
      Math.abs(this.state.pet.mood - prev.mood) > 0.001;

    if (changed) {
      this.persistAndEmit();
    } else {
      this.store.save(this.state);
    }
    return changed;
  }

  performAction(actionId, { source = 'room' } = {}) {
    const now = this.clock();
    this.applyDecay(now);

    const spec = ACTIONS[actionId];
    if (!spec) {
      return { ok: false, reason: 'unknown_action', message: `Unknown action: ${actionId}` };
    }

    // Prevent mid-animation spamming bug documented in Heuristic Evaluation #4
    if (this.activeAction && now < this.activeAction.endsAt) {
      const result = {
        ok: false,
        reason: 'busy',
        message: 'Cozy Cat is busy right now!',
        state: this.getSnapshot(),
      };
      this.emit('action:blocked', result);
      return result;
    }

    if (spec.room !== 'any' && source !== 'overlay' && this.state.room.currentRoom !== spec.room) {
      return {
        ok: false,
        reason: 'wrong_room',
        message: `Switch to the ${spec.room} to do ${spec.label}.`,
        state: this.getSnapshot(),
      };
    }

    // Check full-bar guards (Heuristic Evaluation #4: show message instead of fake animation)
    if (spec.fullCheckStat && this.state.pet[spec.fullCheckStat] >= STAT_MAX) {
      const result = {
        ok: false,
        reason: 'stat_full',
        stat: spec.fullCheckStat,
        message: spec.fullMessage,
        state: this.getSnapshot(),
      };
      this.emit('action:blocked', result);
      return result;
    }

    if (spec.fullCheckAll && spec.fullCheckAll.every((s) => this.state.pet[s] >= STAT_MAX)) {
      const result = {
        ok: false,
        reason: 'stat_full',
        message: spec.fullMessage,
        state: this.getSnapshot(),
      };
      this.emit('action:blocked', result);
      return result;
    }

    if (spec.minCheck && this.state.pet[spec.minCheck.stat] < spec.minCheck.min) {
      const result = {
        ok: false,
        reason: 'stat_low',
        stat: spec.minCheck.stat,
        message: spec.minCheck.message,
        state: this.getSnapshot(),
      };
      this.emit('action:blocked', result);
      return result;
    }

    // Apply stat deltas & compute actual applied delta for +n / -n feedback
    const appliedDeltas = {};
    for (const [stat, delta] of Object.entries(spec.deltas)) {
      const before = this.state.pet[stat];
      const after = clampStat(before + delta);
      this.state.pet[stat] = after;
      const actual = Math.round(after - before);
      if (actual !== 0) {
        appliedDeltas[stat] = actual;
      } else if (delta !== 0) {
        appliedDeltas[stat] = delta;
      }
    }

    this.state.pet.lastAction = actionId;
    this.state.pet.lastActionAt = now;
    this.state.pet.lastDecayAt = now;

    this.activeAction = {
      actionId,
      animation: spec.animation,
      startedAt: now,
      endsAt: now + spec.durationMs,
      deltas: appliedDeltas,
      source,
    };

    if (this._actionTimer) {
      clearTimeout(this._actionTimer);
    }
    this._actionTimer = setTimeout(() => {
      if (this.activeAction && this.clock() >= this.activeAction.endsAt) {
        this.activeAction = null;
        this.emit('state:update', this.getSnapshot());
      }
    }, spec.durationMs);
    if (this._actionTimer.unref) this._actionTimer.unref();

    const snapshot = this.persistAndEmit('action:started', {
      actionId,
      deltas: appliedDeltas,
      animation: spec.animation,
      durationMs: spec.durationMs,
      source,
    });

    return {
      ok: true,
      actionId,
      deltas: appliedDeltas,
      animation: spec.animation,
      durationMs: spec.durationMs,
      state: snapshot,
    };
  }

  switchRoom(targetRoom) {
    if (targetRoom !== 'living' && targetRoom !== 'bathroom') {
      return { ok: false, reason: 'invalid_room', message: `Invalid room: ${targetRoom}` };
    }
    if (this.activeAction && this.clock() < this.activeAction.endsAt) {
      this.activeAction = null;
    }
    this.state.room.currentRoom = targetRoom;
    const state = this.persistAndEmit();
    return { ok: true, state };
  }

  updateDecor(patch = {}) {
    const validWalls = new Set(CUSTOMIZATION_CATALOG.walls.map((w) => w.id));
    const validFloors = new Set(CUSTOMIZATION_CATALOG.floors.map((f) => f.id));
    const validCouches = new Set(CUSTOMIZATION_CATALOG.couches.map((c) => c.id));
    const validFireplaces = new Set(CUSTOMIZATION_CATALOG.fireplaces.map((f) => f.id));
    const validBookshelves = new Set(CUSTOMIZATION_CATALOG.bookshelves.map((b) => b.id));

    if (patch.wall !== undefined && validWalls.has(patch.wall)) {
      this.state.room.wall = patch.wall;
    }
    if (patch.floor !== undefined && validFloors.has(patch.floor)) {
      this.state.room.floor = patch.floor;
    }
    if (patch.couch !== undefined && validCouches.has(patch.couch)) {
      this.state.room.couch = patch.couch;
    }
    if (patch.fireplace !== undefined && validFireplaces.has(patch.fireplace)) {
      this.state.room.fireplace = patch.fireplace;
    }
    if (patch.bookshelf !== undefined && validBookshelves.has(patch.bookshelf)) {
      this.state.room.bookshelf = patch.bookshelf;
    }

    const state = this.persistAndEmit();
    return { ok: true, state };
  }

  updateSettings(patch = {}) {
    const next = { ...this.state.settings };
    if (patch.soundEffects !== undefined) {
      next.soundEffects = clampVolume(patch.soundEffects);
    }
    if (patch.backgroundMusic !== undefined) {
      next.backgroundMusic = clampVolume(patch.backgroundMusic);
    }
    if (patch.showCatOnDesktop !== undefined) {
      next.showCatOnDesktop = Boolean(patch.showCatOnDesktop);
    }
    if (patch.launchAtStartup !== undefined) {
      next.launchAtStartup = Boolean(patch.launchAtStartup);
    }

    const startupChanged = next.launchAtStartup !== this.state.settings.launchAtStartup;
    this.state.settings = next;

    if (startupChanged && typeof this.startupHandler === 'function') {
      try {
        this.startupHandler(next.launchAtStartup);
      } catch {
        // Ignore OS startup registration failures in dev/headless test environments
      }
    }

    const state = this.persistAndEmit('settings:updated', { settings: next });
    return { ok: true, settings: next, state };
  }

  resetSettingsToDefault() {
    return this.updateSettings({ ...DEFAULT_SETTINGS });
  }

  setOverlayRoaming(roaming) {
    this.state.overlay.roaming = Boolean(roaming);
    const state = this.persistAndEmit('overlay:roaming', { roaming: this.state.overlay.roaming });
    return { ok: true, roaming: this.state.overlay.roaming, state };
  }

  toggleOverlayRoaming() {
    return this.setOverlayRoaming(!this.state.overlay.roaming);
  }

  setOverlayPosition(x, y) {
    if (Number.isFinite(Number(x)) && Number.isFinite(Number(y))) {
      this.state.overlay.x = Math.round(Number(x));
      this.state.overlay.y = Math.round(Number(y));
    }
    const state = this.persistAndEmit();
    return { ok: true, state };
  }

  dismissOverlayHintBubble() {
    this.state.overlay.seenHintBubble = true;
    const state = this.persistAndEmit();
    return { ok: true, state };
  }
}

module.exports = {
  PetEngine,
  clampStat,
  clampVolume,
};
