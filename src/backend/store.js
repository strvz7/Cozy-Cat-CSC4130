const fs = require('fs');
const path = require('path');
const {
  DEFAULT_STATS,
  DEFAULT_SETTINGS,
  DEFAULT_ROOM,
  DEFAULT_OVERLAY,
} = require('./constants');

function getDefaultDataDir() {
  if (process.env.COZY_CAT_DATA_DIR) {
    return process.env.COZY_CAT_DATA_DIR;
  }
  const appData = process.env.APPDATA || path.join(require('os').homedir(), '.cozy-cat-app');
  return path.join(appData, 'CozyCatApp');
}

function createInitialState(now = Date.now()) {
  return {
    version: 1,
    pet: {
      ...DEFAULT_STATS,
      lastDecayAt: now,
      lastAction: null,
      lastActionAt: null,
    },
    room: {
      ...DEFAULT_ROOM,
    },
    settings: {
      ...DEFAULT_SETTINGS,
    },
    overlay: {
      ...DEFAULT_OVERLAY,
    },
  };
}

class StateStore {
  constructor(dataDir = getDefaultDataDir()) {
    this.dataDir = dataDir;
    this.filePath = path.join(this.dataDir, 'state.json');
  }

  load(now = Date.now()) {
    const base = createInitialState(now);
    try {
      if (!fs.existsSync(this.filePath)) {
        return base;
      }
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        version: 1,
        pet: { ...base.pet, ...(parsed.pet || {}) },
        room: { ...base.room, ...(parsed.room || {}) },
        settings: { ...base.settings, ...(parsed.settings || {}) },
        overlay: { ...base.overlay, ...(parsed.overlay || {}) },
      };
    } catch {
      return base;
    }
  }

  save(state) {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.filePath);
  }
}

module.exports = {
  StateStore,
  createInitialState,
  getDefaultDataDir,
};
