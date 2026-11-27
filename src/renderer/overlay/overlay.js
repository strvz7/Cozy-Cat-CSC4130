class DesktopOverlayController {
  constructor() {
    this.config = null;
    this.state = null;
    this.ws = null;
    this.audio = new window.CozyAudio();
    this.audio.roomVisible = false;

    this.catEl = document.getElementById('overlay-cat');
    this.petAnimEl = document.getElementById('overlay-pet-anim');
    this.hintEl = document.getElementById('hint-bubble');
    this.menuEl = document.getElementById('cat-menu');
    this.quitEl = document.getElementById('quit-dialog');

    this.x = 540;
    this.y = 400;
    this.positionInitialized = false;
    this.direction = 1; // 1 = right, -1 = left
    this.walkFrame = 0;
    this.idlePauseTicks = 0;
    this.menuOpen = false;
    this.quitOpen = false;
    this.menuIndex = 0;
    this.hoverCount = 0;
    this.petAnimTimer = null;
    this.hintTimeout = null;
    this.petting = false;

    // Drag state
    this.pointerDown = false;
    this.isDragging = false;
    this.suppressNextClick = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragOffsetX = 0;
    this.dragOffsetY = 0;
  }

  async init() {
    this.config = await window.cozyApi.getConfig();
    const w = window.innerWidth || (this.config.workArea && this.config.workArea.width) || 960;
    const h = window.innerHeight || (this.config.workArea && this.config.workArea.height) || 640;

    this.x = Math.round(w * 0.58);
    this.y = Math.max(0, h - 96);

    await this.fetchState();
    this.connectWebSocket();
    this.bindEvents();
    this.positionCat();
    this.startAnimationLoop();
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
        if (msg.data.actionId === 'pet') {
          this.playPetHearts();
        }
      }
    };
    this.ws.onclose = () => {
      setTimeout(() => this.connectWebSocket(), 1500);
    };
  }

  applyState(nextState) {
    this.state = nextState;
    this.audio.setVolumes(nextState.settings.soundEffects, 0);

    // Only restore saved position once on startup so periodic decay broadcasts
    // never overwrite live walking/dragged coordinates.
    if (!this.positionInitialized) {
      this.positionInitialized = true;
      if (nextState.overlay.x !== null && nextState.overlay.y !== null) {
        const maxX = Math.max(0, window.innerWidth - 96);
        const maxY = Math.max(0, window.innerHeight - 96);
        this.x = Math.min(maxX, Math.max(0, nextState.overlay.x));
        this.y = Math.min(maxY, Math.max(0, nextState.overlay.y));
        this.positionCat();
      }
    }

    const pill = document.getElementById('menu-roaming-pill');
    if (pill) {
      pill.textContent = nextState.overlay.roaming ? 'Pause' : 'Continue';
    }

    if (!nextState.overlay.seenHintBubble && !this.hintTimeout && !this.menuOpen) {
      this.showHintBubble();
    }
  }

  updateInteractiveFlag() {
    const shouldInteract =
      this.hoverCount > 0 || this.menuOpen || this.quitOpen || this.pointerDown || this.isDragging;
    window.cozyApi.setOverlayInteractive(shouldInteract);
  }

  bindEvents() {
    document.querySelectorAll('.interactive').forEach((el) => {
      el.addEventListener('mouseenter', () => {
        this.hoverCount += 1;
        this.updateInteractiveFlag();
      });
      el.addEventListener('mouseleave', () => {
        this.hoverCount = Math.max(0, this.hoverCount - 1);
        this.updateInteractiveFlag();
      });
    });

    // Drag cat around anywhere on screen (uses sitting cat sprite as placeholder)
    this.catEl.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || this.petting) return;
      this.pointerDown = true;
      this.isDragging = false;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.dragOffsetX = e.clientX - this.x;
      this.dragOffsetY = e.clientY - this.y;
      this.updateInteractiveFlag();
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.pointerDown) return;
      const dist = Math.hypot(e.clientX - this.dragStartX, e.clientY - this.dragStartY);
      if (!this.isDragging && dist > 6) {
        this.isDragging = true;
        if (this.menuOpen) this.closeMenu();
        this.dismissHint();
        this.catEl.classList.add('dragging');
        this.catEl.classList.remove('facing-left');
        this.catEl.style.background = "url('../../../assets/cat/sitting.png') 0px 0px / 864px 96px";
      }
      if (this.isDragging) {
        const maxX = Math.max(0, window.innerWidth - 96);
        const maxY = Math.max(0, window.innerHeight - 96);
        this.x = Math.min(maxX, Math.max(0, e.clientX - this.dragOffsetX));
        this.y = Math.min(maxY, Math.max(0, e.clientY - this.dragOffsetY));
        this.positionCat();
      }
    });

    window.addEventListener('mouseup', () => {
      if (!this.pointerDown) return;
      const wasDragging = this.isDragging;
      this.pointerDown = false;
      this.isDragging = false;
      this.catEl.classList.remove('dragging');
      if (wasDragging) {
        this.suppressNextClick = true;
        fetch(`${this.config.baseUrl}/api/overlay/position`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ x: this.x, y: this.y }),
        }).catch(() => {});
      }
      this.updateInteractiveFlag();
    });

    // Left-click cat: scoot away so it never blocks desktop clicks (Report p.6)
    this.catEl.addEventListener('click', (e) => {
      if (e.button !== 0) return;
      if (this.suppressNextClick) {
        this.suppressNextClick = false;
        return;
      }
      if (this.menuOpen) {
        this.closeMenu();
        return;
      }
      this.moveAwayFromCursor(e.clientX);
    });

    // Right-click cat: open Cozy Cat context menu
    this.catEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      window.cozyApi.focusOverlay();
      this.dismissHint();
      this.openMenu();
    });

    this.hintEl.addEventListener('click', () => {
      this.dismissHint();
      this.openMenu();
    });

    // Menu item clicks
    this.menuEl.querySelectorAll('.menu-item').forEach((btn, idx) => {
      btn.addEventListener('mouseenter', () => {
        this.setMenuSelection(idx);
      });
      btn.addEventListener('click', () => {
        this.executeMenuAction(btn.dataset.action);
      });
    });

    document.getElementById('btn-quit-cancel').addEventListener('click', () => {
      this.quitOpen = false;
      this.quitEl.classList.add('hidden');
      this.updateInteractiveFlag();
    });

    document.getElementById('btn-quit-confirm').addEventListener('click', () => {
      window.cozyApi.quitApp();
    });

    // Click outside menu closes menu
    document.getElementById('overlay-root').addEventListener('mousedown', (e) => {
      if (this.menuOpen && !e.target.closest('#cat-menu') && !e.target.closest('#overlay-cat')) {
        this.closeMenu();
      }
    });

    // Keyboard navigation: Tab opens menu, ArrowUp/Down navigate, Enter activates, Esc closes
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        this.dismissHint();
        if (this.menuOpen) {
          this.closeMenu();
        } else {
          this.openMenu();
        }
        return;
      }

      if (this.quitOpen) {
        if (e.key === 'Escape') {
          this.quitOpen = false;
          this.quitEl.classList.add('hidden');
          this.updateInteractiveFlag();
        } else if (e.key === 'Enter') {
          window.cozyApi.quitApp();
        }
        return;
      }

      if (!this.menuOpen) return;
      const items = this.menuEl.querySelectorAll('.menu-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.setMenuSelection((this.menuIndex + 1) % items.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.setMenuSelection((this.menuIndex - 1 + items.length) % items.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.executeMenuAction(items[this.menuIndex].dataset.action);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.closeMenu();
      }
    });

    window.cozyApi.onOverlayShortcut((payload) => {
      if (!payload) return;
      if (payload.command === 'toggle-menu') {
        this.dismissHint();
        this.menuOpen ? this.closeMenu() : this.openMenu();
      } else if (payload.command === 'open-quit-confirm') {
        this.openQuitDialog();
      }
    });
  }

  showHintBubble() {
    this.hintEl.classList.remove('hidden');
    this.positionHintBubble();
    this.hintTimeout = setTimeout(() => {
      this.dismissHint();
    }, 8000);
  }

  dismissHint() {
    if (!this.hintEl.classList.contains('hidden')) {
      this.hintEl.classList.add('hidden');
      fetch(`${this.config.baseUrl}/api/overlay/hint-dismiss`, { method: 'POST' }).catch(() => {});
    }
    if (this.hintTimeout) {
      clearTimeout(this.hintTimeout);
      this.hintTimeout = null;
    }
  }

  moveAwayFromCursor(cursorX) {
    const maxX = Math.max(0, window.innerWidth - 96);
    const jump = 220;
    const goLeft = cursorX > this.x + 48 || this.x + jump > maxX;
    this.direction = goLeft ? -1 : 1;
    this.x = Math.max(16, Math.min(maxX - 16, this.x + this.direction * jump));
    this.positionCat();
    fetch(`${this.config.baseUrl}/api/overlay/position`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: this.x, y: this.y }),
    }).catch(() => {});
  }

  openMenu() {
    this.menuOpen = true;
    this.menuEl.classList.remove('hidden');
    this.setMenuSelection(0);

    const menuW = 256;
    const menuH = 196;
    const left = Math.min(window.innerWidth - menuW - 12, Math.max(12, this.x + 76));
    const top = Math.max(12, this.y - menuH + 26);
    this.menuEl.style.left = `${left}px`;
    this.menuEl.style.top = `${top}px`;
    this.updateInteractiveFlag();
  }

  closeMenu() {
    this.menuOpen = false;
    this.menuEl.classList.add('hidden');
    this.updateInteractiveFlag();
  }

  setMenuSelection(idx) {
    const items = this.menuEl.querySelectorAll('.menu-item');
    this.menuIndex = idx;
    items.forEach((btn, i) => btn.classList.toggle('active', i === idx));
  }

  async executeMenuAction(action) {
    if (action === 'open-room') {
      this.closeMenu();
      window.cozyApi.openRoom();
    } else if (action === 'pet-cat') {
      this.closeMenu();
      await fetch(`${this.config.baseUrl}/api/actions/pet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'overlay' }),
      });
    } else if (action === 'toggle-roaming') {
      await fetch(`${this.config.baseUrl}/api/overlay/roaming`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    } else if (action === 'quit-prompt') {
      this.closeMenu();
      this.openQuitDialog();
    }
  }

  openQuitDialog() {
    this.quitOpen = true;
    this.quitEl.classList.remove('hidden');
    const left = Math.round((window.innerWidth - 312) / 2);
    const top = Math.round((window.innerHeight - 210) / 2);
    this.quitEl.style.left = `${left}px`;
    this.quitEl.style.top = `${top}px`;
    this.updateInteractiveFlag();
  }

  playPetHearts() {
    this.audio.playAction('pet');
    this.petting = true;
    this.catEl.classList.add('hidden');
    this.petAnimEl.classList.remove('hidden');
    this.petAnimEl.style.left = `${this.x}px`;
    this.petAnimEl.style.top = `${this.y - 14}px`;

    let f = 0;
    const frames = [0, 1, 2, 3, 4].map((i) => `../../../assets/actions/pet/frame_${i}.png`);
    const tick = () => {
      this.petAnimEl.src = frames[f % frames.length];
      f += 1;
    };
    tick();
    clearInterval(this.petAnimTimer);
    this.petAnimTimer = setInterval(tick, 280);

    setTimeout(() => {
      clearInterval(this.petAnimTimer);
      this.petting = false;
      this.petAnimEl.classList.add('hidden');
      this.catEl.classList.remove('hidden');
    }, 1700);
  }

  positionCat() {
    this.catEl.style.left = `${Math.round(this.x)}px`;
    this.catEl.style.top = `${Math.round(this.y)}px`;
    this.catEl.classList.toggle('facing-left', !this.isDragging && this.direction < 0);
    if (!this.hintEl.classList.contains('hidden')) {
      this.positionHintBubble();
    }
  }

  positionHintBubble() {
    const left = Math.min(window.innerWidth - 250, Math.max(12, this.x - 45));
    const top = Math.max(12, this.y - 84);
    this.hintEl.style.left = `${Math.round(left)}px`;
    this.hintEl.style.top = `${Math.round(top)}px`;
  }

  startAnimationLoop() {
    setInterval(() => {
      if (this.petting || this.isDragging) return;
      const roaming = this.state ? this.state.overlay.roaming : true;
      const maxX = Math.max(16, window.innerWidth - 112);

      if (roaming && !this.menuOpen && !this.quitOpen) {
        if (this.idlePauseTicks > 0) {
          this.idlePauseTicks -= 1;
          this.walkFrame = (this.walkFrame + 1) % 3;
          this.catEl.style.background = `url('../../../assets/cat/sideidle.png') ${-(this.walkFrame * 96)}px 0px / 288px 96px`;
        } else {
          this.x += this.direction * 14;
          if (this.x >= maxX) {
            this.x = maxX;
            this.direction = -1;
          } else if (this.x <= 16) {
            this.x = 16;
            this.direction = 1;
          } else if (Math.random() < 0.04) {
            this.idlePauseTicks = 6;
          }
          this.walkFrame = (this.walkFrame + 1) % 3;
          this.catEl.style.background = `url('../../../assets/cat/sidewalk.png') ${-(this.walkFrame * 96)}px 0px / 288px 96px`;
          this.positionCat();
        }
      } else {
        this.walkFrame = (this.walkFrame + 1) % 3;
        this.catEl.style.background = `url('../../../assets/cat/sideidle.png') ${-(this.walkFrame * 96)}px 0px / 288px 96px`;
      }
    }, 220);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const overlay = new DesktopOverlayController();
  overlay.init();
});
