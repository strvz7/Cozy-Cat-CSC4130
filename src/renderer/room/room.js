const LIVING_BUTTONS = [
  { id: 'feed', icon: '../../../assets/figma/ic_bowl.png', title: 'Feed', desc: 'Fill food bowl (Hunger +2)' },
  { id: 'fish', icon: '../../../assets/figma/ic_fish.png', title: 'Fish', desc: 'Fish treat: Hunger +1, Mood +1' },
  { id: 'play', icon: '../../../assets/figma/ic_yarn.png', title: 'Play', desc: 'Yarn ball: Mood +2, Energy -1' },
  { id: 'pet', icon: '../../../assets/figma/ic_heart.png', title: 'Pet', desc: 'Stroke the cat: Mood +1' },
  { id: 'sleep', icon: '../../../assets/figma/ic_bed.png', title: 'Sleep', desc: 'Cat bed nap: Energy +3, Hunger -1' },
  { id: 'decorate', icon: '../../../assets/figma/ic_decorate.png', title: 'Decorate', desc: 'Customize walls, floors & furniture' },
  { id: 'settings', icon: '../../../assets/figma/ic_gear.png', title: 'Settings', desc: 'Sound, desktop companion & startup' },
];

const BATHROOM_BUTTONS = [
  { id: 'bath', icon: '../../../assets/figma/bath_tub_icon.png', title: 'Bath', desc: 'Bubble bath: Energy +1, Mood +1' },
  { id: 'toilet', icon: '../../../assets/figma/bath_toilet_icon.png', title: 'Toilet', desc: 'Use Toilet: Hunger -1, Mood +1' },
  { id: 'wash_hands', icon: '../../../assets/figma/bath_sink_icon.png', title: 'Wash Hands', desc: 'Wash Paws: Energy +1' },
  { id: 'pet', icon: '../../../assets/figma/ic_heart.png', title: 'Pet', desc: 'Stroke the cat: Mood +1' },
  { id: 'settings', icon: '../../../assets/figma/ic_gear.png', title: 'Settings', desc: 'Sound, desktop companion & startup' },
];

const COUCH_ASSETS = {
  original: '../../../assets/figma/i_sofa.png',
  ash_gray: '../../../assets/figma/furn_couch_2.png',
  none: null,
};

const FIREPLACE_ASSETS = {
  original: '../../../assets/figma/i_fire_off.png',
  stone: '../../../assets/figma/furn_fire_2.png',
  terracotta: '../../../assets/figma/furn_fire_3.png',
  slate: '../../../assets/figma/furn_fire_4.png',
  none: null,
};

const BOOKSHELF_ASSETS = {
  original: '../../../assets/figma/i_bookshelf.png',
  pastel: '../../../assets/figma/furn_shelf_2.png',
  oak_cabinet: '../../../assets/figma/furn_shelf_3.png',
  white_shelf: '../../../assets/figma/furn_shelf_4.png',
  white_cabinet: '../../../assets/figma/furn_shelf_5.png',
  walnut_cabinet: '../../../assets/figma/furn_shelf_6.png',
  none: null,
};

const ACTION_SPRITES = {
  eat: {
    frames: [0, 1, 2, 3, 4].map((i) => `../../../assets/actions/eat/frame_${i}.png`),
    intervalMs: 320,
    style: { left: '382px', top: '348px', width: '192px', height: '132px' },
  },
  fish: {
    frames: [0, 1, 2, 3, 4].map((i) => `../../../assets/actions/fish/frame_${i}.png`),
    intervalMs: 320,
    style: { left: '365px', top: '356px', width: '199px', height: '128px' },
  },
  pet: {
    frames: [0, 1, 2, 3, 4].map((i) => `../../../assets/actions/pet/frame_${i}.png`),
    intervalMs: 280,
    styleLiving: { left: '442px', top: '364px', width: '108px', height: '112px' },
    styleBath: { left: '332px', top: '340px', width: '108px', height: '112px' },
  },
  bath: {
    frames: [0, 1, 2, 3, 4, 5].map((i) => `../../../assets/actions/bath/frame_${i}.png`),
    intervalMs: 320,
    style: { left: '590px', top: '214px', width: '220px', height: '120px' },
  },
  toilet: {
    frames: [0, 1, 2, 3, 4, 5, 6].map((i) => `../../../assets/actions/toilet/frame_${i}.png`),
    intervalMs: 280,
    style: { left: '332px', top: '176px', width: '132px', height: '144px' },
  },
  wash_hands: {
    frames: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `../../../assets/actions/wash_hands/frame_${i}.png`),
    intervalMs: 240,
    style: { left: '120px', top: '204px', width: '164px', height: '146px' },
  },
};

class RoomController {
  constructor() {
    this.config = null;
    this.state = null;
    this.ws = null;
    this.audio = new window.CozyAudio();
    this.buildMode = false;
    this.buildTab = 'furniture';
    this.settingsOpen = false;
    this.settingsDraft = null;
    this.settingsSnapshotOnOpen = null;
    this.bannerTimer = null;
    this.deltaTimers = {};
    this.idleFrame = 0;
    this.animTimer = null;
    this.idleTimer = null;
  }

  async init() {
    this.config = await window.cozyApi.getConfig();
    this.bindWindowDrag();
    this.bindEvents();
    await this.fetchState();
    this.connectWebSocket();
    this.startIdleLoop();
  }

  async fetchState() {
    const res = await fetch(`${this.config.baseUrl}/api/state`);
    const data = await res.json();
    if (data.ok) {
      this.applyState(data.state);
    }
  }

  connectWebSocket() {
    this.ws = new WebSocket(this.config.wsUrl);
    this.ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.type === 'state:update') {
        this.applyState(msg.data);
      } else if (msg.type === 'action:started') {
        this.applyState(msg.data.state);
        this.onActionStarted(msg.data);
      } else if (msg.type === 'action:blocked') {
        this.audio.playAction('blocked');
        this.showBanner(msg.data.message);
      }
    };
    this.ws.onclose = () => {
      setTimeout(() => this.connectWebSocket(), 1500);
    };
  }

  bindWindowDrag() {
    const titleBar = document.getElementById('title-bar');
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    titleBar.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true;
      lastX = e.screenX;
      lastY = e.screenY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.screenX - lastX;
      const dy = e.screenY - lastY;
      lastX = e.screenX;
      lastY = e.screenY;
      if (dx !== 0 || dy !== 0) {
        window.cozyApi.dragWindow(dx, dy);
      }
    });

    window.addEventListener('mouseup', () => {
      dragging = false;
    });
  }

  bindEvents() {
    document.getElementById('btn-close-app').addEventListener('click', () => {
      if (this.settingsOpen) return;
      window.cozyApi.closeRoomWindow();
    });

    document.getElementById('btn-to-bathroom').addEventListener('click', () => this.switchRoom('bathroom'));
    document.getElementById('btn-to-living').addEventListener('click', () => this.switchRoom('living'));

    document.getElementById('living-cat').addEventListener('click', () => this.triggerAction('pet'));
    document.getElementById('bath-cat').addEventListener('click', () => this.triggerAction('pet'));

    document.querySelectorAll('.build-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        this.buildTab = tab.dataset.tab;
        this.renderBuildMode();
      });
    });

    document.getElementById('btn-build-done').addEventListener('click', () => {
      this.buildMode = false;
      this.render();
    });

    // Settings Controls
    const sliderSfx = document.getElementById('slider-sfx');
    const sliderBgm = document.getElementById('slider-bgm');

    sliderSfx.addEventListener('input', () => {
      this.settingsDraft.soundEffects = Number(sliderSfx.value);
      document.getElementById('val-sfx').textContent = `${this.settingsDraft.soundEffects}%`;
      this.audio.setVolumes(this.settingsDraft.soundEffects, this.settingsDraft.backgroundMusic);
    });

    sliderBgm.addEventListener('input', () => {
      this.settingsDraft.backgroundMusic = Number(sliderBgm.value);
      document.getElementById('val-bgm').textContent = `${this.settingsDraft.backgroundMusic}%`;
      this.audio.setVolumes(this.settingsDraft.soundEffects, this.settingsDraft.backgroundMusic);
    });

    document.getElementById('toggle-desktop').addEventListener('click', () => {
      this.settingsDraft.showCatOnDesktop = !this.settingsDraft.showCatOnDesktop;
      this.renderSettingsModal();
    });

    document.getElementById('toggle-startup').addEventListener('click', () => {
      this.settingsDraft.launchAtStartup = !this.settingsDraft.launchAtStartup;
      this.renderSettingsModal();
    });

    document.getElementById('btn-send-desktop-now').addEventListener('click', async () => {
      await this.saveSettings(false);
      window.cozyApi.sendToDesktop();
    });

    document.getElementById('btn-settings-undo').addEventListener('click', () => {
      this.settingsDraft = { ...this.settingsSnapshotOnOpen };
      this.audio.setVolumes(this.settingsDraft.soundEffects, this.settingsDraft.backgroundMusic);
      this.renderSettingsModal();
    });

    document.getElementById('btn-settings-default').addEventListener('click', () => {
      this.settingsDraft = {
        soundEffects: 50,
        backgroundMusic: 50,
        showCatOnDesktop: true,
        launchAtStartup: false,
      };
      this.audio.setVolumes(50, 50);
      this.renderSettingsModal();
    });

    document.getElementById('btn-settings-save').addEventListener('click', async () => {
      await this.saveSettings(true);
    });

    document.addEventListener('visibilitychange', () => {
      this.audio.roomVisible = !document.hidden;
      if (document.hidden) {
        this.audio.stopMusic();
      } else if (this.state) {
        this.audio.setVolumes(this.state.settings.soundEffects, this.state.settings.backgroundMusic);
      }
    });
  }

  async triggerAction(actionId) {
    this.audio.ensureContext();
    const res = await fetch(`${this.config.baseUrl}/api/actions/${actionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'room' }),
    });
    const data = await res.json();
    if (!data.ok && data.message) {
      this.audio.playAction('blocked');
      this.showBanner(data.message);
    }
  }

  async switchRoom(targetRoom) {
    this.buildMode = false;
    await fetch(`${this.config.baseUrl}/api/room`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentRoom: targetRoom }),
    });
  }

  async updateDecor(patch) {
    await fetch(`${this.config.baseUrl}/api/room`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  }

  openSettings() {
    this.settingsOpen = true;
    this.settingsSnapshotOnOpen = { ...this.state.settings };
    this.settingsDraft = { ...this.state.settings };
    this.render();
  }

  async saveSettings(closeAfter = true) {
    await fetch(`${this.config.baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.settingsDraft),
    });
    if (closeAfter) {
      this.settingsOpen = false;
      this.render();
    }
  }

  applyState(nextState) {
    this.state = nextState;
    if (!this.settingsOpen) {
      this.audio.setVolumes(nextState.settings.soundEffects, nextState.settings.backgroundMusic);
    }
    this.render();
  }

  onActionStarted(evt) {
    this.audio.playAction(evt.actionId);
    for (const [stat, delta] of Object.entries(evt.deltas || {})) {
      this.showStatDelta(stat, delta);
    }
    this.playActionAnimation(evt.animation || evt.actionId, evt.durationMs);
  }

  showStatDelta(stat, delta) {
    const el = document.getElementById(`delta-${stat}`);
    if (!el) return;
    el.textContent = delta > 0 ? `+${delta}` : `${delta}`;
    el.className = `stat-delta show ${delta > 0 ? 'pos' : 'neg'}`;
    clearTimeout(this.deltaTimers[stat]);
    this.deltaTimers[stat] = setTimeout(() => {
      el.classList.remove('show');
    }, 1800);
  }

  showBanner(message) {
    const banner = document.getElementById('status-banner');
    document.getElementById('status-banner-text').textContent = message;
    banner.classList.remove('hidden');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => {
      banner.classList.add('hidden');
    }, 2200);
  }

  startIdleLoop() {
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.idleTimer = setInterval(() => {
      this.idleFrame = (this.idleFrame + 1) % 9;
      this.updateCatIdleSprites();
    }, 350);
  }

  updateCatIdleSprites() {
    const busy = this.state && this.state.activity && this.state.activity.busy;
    const livingCat = document.getElementById('living-cat');
    const bathCat = document.getElementById('bath-cat');

    if (busy) {
      livingCat.classList.add('hidden');
      bathCat.classList.add('hidden');
      return;
    }

    livingCat.classList.remove('hidden');
    bathCat.classList.remove('hidden');

    const offsetX = -(this.idleFrame * 96);
    const bg = `url('../../../assets/cat/sitting.png') ${offsetX}px 0px / 864px 96px`;
    livingCat.style.background = bg;
    bathCat.style.background = bg;
  }

  playActionAnimation(animId, durationMs) {
    clearInterval(this.animTimer);
    const room = this.state.room.currentRoom;
    const livingAnim = document.getElementById('living-action-anim');
    const bathAnim = document.getElementById('bath-action-anim');
    const livingCat = document.getElementById('living-cat');
    const livingBowl = document.getElementById('living-bowl');

    livingAnim.classList.add('hidden');
    bathAnim.classList.add('hidden');

    const targetImg = room === 'bathroom' ? bathAnim : livingAnim;

    if (animId === 'eat') {
      livingBowl.src = '../../../assets/figma/p4_food.png';
    }

    // Spritesheet animations (Play with Yarn, Sleep on Bed)
    if (animId === 'play') {
      let frame = 0;
      livingCat.classList.remove('hidden');
      livingCat.style.left = '440px';
      livingCat.style.top = '342px';
      livingCat.style.width = '128px';
      livingCat.style.height = '128px';
      const step = () => {
        livingCat.style.background = `url('../../../assets/cat/catwithyarn.png') ${-(frame * 128)}px 0px / 512px 128px`;
        frame = (frame + 1) % 4;
      };
      step();
      this.animTimer = setInterval(step, 140);
      setTimeout(() => this.resetCatSpriteGeometry(), durationMs);
      return;
    }

    if (animId === 'sleep') {
      let frame = 0;
      livingCat.classList.remove('hidden');
      livingCat.style.left = '630px';
      livingCat.style.top = '428px';
      livingCat.style.width = '128px';
      livingCat.style.height = '96px';
      const step = () => {
        livingCat.style.background = `url('../../../assets/cat/sleeping.png') ${-(frame * 128)}px 0px / 384px 96px`;
        frame = (frame + 1) % 3;
      };
      step();
      this.animTimer = setInterval(step, 350);
      setTimeout(() => this.resetCatSpriteGeometry(), durationMs);
      return;
    }

    const spec = ACTION_SPRITES[animId];
    if (!spec) return;

    const style =
      animId === 'pet'
        ? room === 'bathroom'
          ? spec.styleBath
          : spec.styleLiving
        : spec.style;

    Object.assign(targetImg.style, style);
    targetImg.classList.remove('hidden');
    let frame = 0;
    const step = () => {
      targetImg.src = spec.frames[frame % spec.frames.length];
      frame += 1;
    };
    step();
    this.animTimer = setInterval(step, spec.intervalMs);

    setTimeout(() => {
      clearInterval(this.animTimer);
      targetImg.classList.add('hidden');
      livingBowl.src = '../../../assets/figma/p4_empty.png';
      this.updateCatIdleSprites();
    }, durationMs);
  }

  resetCatSpriteGeometry() {
    clearInterval(this.animTimer);
    const livingCat = document.getElementById('living-cat');
    livingCat.style.left = '446px';
    livingCat.style.top = '374px';
    livingCat.style.width = '96px';
    livingCat.style.height = '96px';
    this.updateCatIdleSprites();
  }

  render() {
    if (!this.state) return;

    // Stat bars (10 ticks -> percentage)
    document.getElementById('bar-hunger').style.width = `${(this.state.pet.hunger / 10) * 100}%`;
    document.getElementById('bar-energy').style.width = `${(this.state.pet.energy / 10) * 100}%`;
    document.getElementById('bar-mood').style.width = `${(this.state.pet.mood / 10) * 100}%`;

    // Disable main window close X while Settings is open (Heuristic #9)
    document.getElementById('btn-close-app').disabled = this.settingsOpen;

    this.renderRail();
    this.renderRoomDecor();

    const livingEl = document.getElementById('view-living');
    const bathEl = document.getElementById('view-bathroom');
    const buildEl = document.getElementById('view-build');

    livingEl.classList.toggle('hidden', this.buildMode || this.state.room.currentRoom !== 'living');
    bathEl.classList.toggle('hidden', this.buildMode || this.state.room.currentRoom !== 'bathroom');
    buildEl.classList.toggle('hidden', !this.buildMode);

    if (this.buildMode) {
      this.renderBuildMode();
    }

    this.renderSettingsModal();
    if (!this.state.activity.busy) {
      this.updateCatIdleSprites();
    }
  }

  renderRail() {
    const rail = document.getElementById('button-rail');
    const tooltip = document.getElementById('rail-tooltip');
    const buttons = this.state.room.currentRoom === 'bathroom' ? BATHROOM_BUTTONS : LIVING_BUTTONS;
    const busy = this.state.activity && this.state.activity.busy;

    rail.innerHTML = '';
    buttons.forEach((btnDef, idx) => {
      const btn = document.createElement('button');
      btn.className = 'rail-btn';
      if (btnDef.id === 'decorate' && this.buildMode) btn.classList.add('active');
      if (btnDef.id === 'settings' && this.settingsOpen) btn.classList.add('active');

      const isAction = !['decorate', 'settings'].includes(btnDef.id);
      if (busy && isAction) btn.disabled = true;

      const img = document.createElement('img');
      img.src = btnDef.icon;
      img.alt = btnDef.title;
      btn.appendChild(img);

      btn.addEventListener('mouseenter', () => {
        document.getElementById('rail-tooltip-title').textContent = btnDef.title;
        document.getElementById('rail-tooltip-desc').textContent = btnDef.desc;
        tooltip.style.top = `${Math.min(450, 8 + idx * 74)}px`;
        tooltip.classList.remove('hidden');
      });

      btn.addEventListener('mouseleave', () => {
        tooltip.classList.add('hidden');
      });

      btn.addEventListener('click', () => {
        tooltip.classList.add('hidden');
        if (btnDef.id === 'decorate') {
          this.buildMode = !this.buildMode;
          this.render();
        } else if (btnDef.id === 'settings') {
          this.openSettings();
        } else {
          this.triggerAction(btnDef.id);
        }
      });

      rail.appendChild(btn);
    });
  }

  renderRoomDecor() {
    const r = this.state.room;
    const wallEl = document.getElementById('living-wall');
    const floorEl = document.getElementById('living-floor');
    wallEl.className = `living-wall wall-${r.wall}`;
    floorEl.className = `living-floor floor-${r.floor}`;

    const sofaEl = document.getElementById('living-sofa');
    const sofaSrc = COUCH_ASSETS[r.couch];
    sofaEl.classList.toggle('hidden', !sofaSrc);
    if (sofaSrc) sofaEl.src = sofaSrc;

    const fireEl = document.getElementById('living-fireplace');
    const fireSrc = FIREPLACE_ASSETS[r.fireplace];
    fireEl.classList.toggle('hidden', !fireSrc);
    if (fireSrc) fireEl.src = fireSrc;

    const shelfEl = document.getElementById('living-bookshelf');
    const shelfSrc = BOOKSHELF_ASSETS[r.bookshelf];
    shelfEl.classList.toggle('hidden', !shelfSrc);
    if (shelfSrc) shelfEl.src = shelfSrc;
  }

  renderBuildMode() {
    document.querySelectorAll('.build-tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.tab === this.buildTab);
    });

    // Live scaled preview clone of living room
    const previewContainer = document.getElementById('build-preview-room');
    const livingClone = document.getElementById('view-living').cloneNode(true);
    livingClone.classList.remove('hidden');
    livingClone.removeAttribute('id');
    livingClone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    previewContainer.innerHTML = '';
    previewContainer.appendChild(livingClone);

    const picker = document.getElementById('material-picker');
    const r = this.state.room;
    const cat = this.state.catalog;

    const findLabel = (list, id) => (list.find((x) => x.id === id) || { label: id }).label;

    if (this.buildTab === 'furniture') {
      document.getElementById('build-preview-caption').textContent = 'Furniture Selected';
      document.getElementById('build-preview-summary').textContent =
        `${findLabel(cat.couches, r.couch)} • ${findLabel(cat.fireplaces, r.fireplace)} • ${findLabel(cat.bookshelves, r.bookshelf)}`;

      picker.innerHTML = `
        <div class="picker-title">Furnitures</div>
        <div class="picker-sub">Choose a finish for your room.</div>
        <div class="picker-group-label">Couches</div>
        <div class="picker-grid" id="pick-couches"></div>
        <div class="picker-group-label">Fireplace</div>
        <div class="picker-grid" id="pick-fire"></div>
        <div class="picker-group-label">Bookshelves</div>
        <div class="picker-grid picker-grid-3" id="pick-shelf"></div>
      `;

      cat.couches.forEach((opt) => {
        const btn = document.createElement('button');
        btn.className = `swatch-btn ${r.couch === opt.id ? 'selected' : ''}`;
        const src = COUCH_ASSETS[opt.id];
        btn.innerHTML = src ? `<img src="${src}" alt="" /><span>${opt.label}</span>` : `<span>${opt.label}</span>`;
        btn.addEventListener('click', () => this.updateDecor({ couch: opt.id }));
        picker.querySelector('#pick-couches').appendChild(btn);
      });

      cat.fireplaces.forEach((opt) => {
        const btn = document.createElement('button');
        btn.className = `swatch-btn ${r.fireplace === opt.id ? 'selected' : ''}`;
        const src = FIREPLACE_ASSETS[opt.id];
        btn.innerHTML = src ? `<img src="${src}" alt="" /><span>${opt.label}</span>` : `<span>${opt.label}</span>`;
        btn.addEventListener('click', () => this.updateDecor({ fireplace: opt.id }));
        picker.querySelector('#pick-fire').appendChild(btn);
      });

      cat.bookshelves.forEach((opt) => {
        const btn = document.createElement('button');
        btn.className = `swatch-btn ${r.bookshelf === opt.id ? 'selected' : ''}`;
        const src = BOOKSHELF_ASSETS[opt.id];
        btn.innerHTML = src ? `<img src="${src}" alt="" /><span>${opt.label}</span>` : `<span>${opt.label}</span>`;
        btn.addEventListener('click', () => this.updateDecor({ bookshelf: opt.id }));
        picker.querySelector('#pick-shelf').appendChild(btn);
      });
    } else if (this.buildTab === 'walls') {
      document.getElementById('build-preview-caption').textContent = 'Walls Selected';
      document.getElementById('build-preview-summary').textContent =
        `${findLabel(cat.walls, r.wall)} walls + ${findLabel(cat.floors, r.floor)} floor`;

      picker.innerHTML = `
        <div class="picker-title">Walls</div>
        <div class="picker-sub">Choose a wallpaper finish.</div>
        <div class="picker-grid" id="pick-walls"></div>
      `;

      cat.walls.forEach((opt) => {
        const btn = document.createElement('button');
        btn.className = `swatch-btn ${r.wall === opt.id ? 'selected' : ''}`;
        btn.innerHTML = `<div class="swatch-color" style="background:${opt.color}"></div><span>${opt.label}</span>`;
        btn.addEventListener('click', () => this.updateDecor({ wall: opt.id }));
        picker.querySelector('#pick-walls').appendChild(btn);
      });
    } else {
      document.getElementById('build-preview-caption').textContent = 'Floors Selected';
      document.getElementById('build-preview-summary').textContent =
        `${findLabel(cat.walls, r.wall)} walls + ${findLabel(cat.floors, r.floor)} floor`;

      picker.innerHTML = `
        <div class="picker-title">Floors</div>
        <div class="picker-sub">Choose a flooring finish.</div>
        <div class="picker-grid" id="pick-floors"></div>
      `;

      cat.floors.forEach((opt) => {
        const btn = document.createElement('button');
        btn.className = `swatch-btn ${r.floor === opt.id ? 'selected' : ''}`;
        btn.innerHTML = `<div class="swatch-color" style="background:${opt.color}"></div><span>${opt.label}</span>`;
        btn.addEventListener('click', () => this.updateDecor({ floor: opt.id }));
        picker.querySelector('#pick-floors').appendChild(btn);
      });
    }
  }

  renderSettingsModal() {
    const modal = document.getElementById('settings-modal');
    modal.classList.toggle('hidden', !this.settingsOpen);
    if (!this.settingsOpen || !this.settingsDraft) return;

    document.getElementById('slider-sfx').value = this.settingsDraft.soundEffects;
    document.getElementById('val-sfx').textContent = `${this.settingsDraft.soundEffects}%`;
    document.getElementById('slider-bgm').value = this.settingsDraft.backgroundMusic;
    document.getElementById('val-bgm').textContent = `${this.settingsDraft.backgroundMusic}%`;

    const desktopBtn = document.getElementById('toggle-desktop');
    desktopBtn.className = `toggle-chip ${this.settingsDraft.showCatOnDesktop ? 'on' : 'off'}`;
    desktopBtn.textContent = this.settingsDraft.showCatOnDesktop ? '✓ ON' : 'OFF';

    const startupBtn = document.getElementById('toggle-startup');
    startupBtn.className = `toggle-chip ${this.settingsDraft.launchAtStartup ? 'on' : 'off'}`;
    startupBtn.textContent = this.settingsDraft.launchAtStartup ? '✓ ON' : 'OFF';
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const controller = new RoomController();
  controller.init();
});
