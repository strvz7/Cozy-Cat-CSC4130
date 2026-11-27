/**
 * Procedural Web Audio synthesizer for Cozy Cat sound effects and soft ambient room tunes.
 * Avoids external audio file dependencies while respecting Settings volume sliders (0-100).
 */
class CozyAudio {
  constructor() {
    this.ctx = null;
    this.sfxVolume = 0.5;
    this.bgmVolume = 0.5;
    this.bgmTimer = null;
    this.bgmStep = 0;
    this.roomVisible = true;
  }

  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  setVolumes(sfx, bgm) {
    this.sfxVolume = Math.max(0, Math.min(1, Number(sfx) / 100));
    this.bgmVolume = Math.max(0, Math.min(1, Number(bgm) / 100));
    if (this.bgmVolume <= 0.01) {
      this.stopMusic();
    } else if (this.roomVisible && !this.bgmTimer) {
      this.startMusic();
    }
  }

  playTone(freq, duration = 0.12, type = 'triangle', volume = 0.2, delay = 0) {
    if (this.sfxVolume <= 0.01) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.002, volume * this.sfxVolume), start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  playAction(actionId) {
    switch (actionId) {
      case 'feed':
      case 'fish':
        this.playTone(523.25, 0.1, 'triangle', 0.25, 0);
        this.playTone(659.25, 0.12, 'triangle', 0.25, 0.1);
        this.playTone(783.99, 0.15, 'triangle', 0.22, 0.2);
        break;
      case 'pet':
        // Cute soft meow / purr
        this.playTone(620, 0.12, 'sine', 0.22, 0);
        this.playTone(740, 0.16, 'sine', 0.20, 0.1);
        break;
      case 'play':
        this.playTone(587.33, 0.09, 'square', 0.12, 0);
        this.playTone(783.99, 0.09, 'square', 0.12, 0.09);
        this.playTone(987.77, 0.14, 'square', 0.12, 0.18);
        break;
      case 'sleep':
        this.playTone(392.0, 0.22, 'sine', 0.18, 0);
        this.playTone(329.63, 0.28, 'sine', 0.16, 0.2);
        break;
      case 'bath':
      case 'wash_hands':
        this.playTone(698.46, 0.08, 'sine', 0.18, 0);
        this.playTone(880.0, 0.08, 'sine', 0.18, 0.08);
        this.playTone(1046.5, 0.12, 'sine', 0.15, 0.16);
        break;
      case 'toilet':
        this.playTone(440, 0.1, 'triangle', 0.2, 0);
        this.playTone(554.37, 0.15, 'triangle', 0.2, 0.11);
        break;
      case 'blocked':
        this.playTone(220, 0.12, 'sawtooth', 0.12, 0);
        this.playTone(185, 0.16, 'sawtooth', 0.12, 0.11);
        break;
      default:
        this.playTone(520, 0.08, 'triangle', 0.15, 0);
    }
  }

  startMusic() {
    if (this.bgmTimer || this.bgmVolume <= 0.01) return;
    // Gentle pentatonic music-box loop
    const notes = [523.25, 659.25, 783.99, 659.25, 587.33, 659.25, 523.25, 392.0];
    this.bgmTimer = setInterval(() => {
      if (!this.roomVisible || this.bgmVolume <= 0.01 || document.hidden) return;
      const ctx = this.ensureContext();
      if (!ctx) return;
      const freq = notes[this.bgmStep % notes.length];
      this.bgmStep += 1;
      const start = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      const peak = Math.max(0.002, 0.06 * this.bgmVolume);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.55);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.58);
    }, 650);
  }

  stopMusic() {
    if (this.bgmTimer) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
  }
}

window.CozyAudio = CozyAudio;
