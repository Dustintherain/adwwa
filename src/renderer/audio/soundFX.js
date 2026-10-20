// Procedural Valve-Style Sound Synthesizer using Web Audio API
// Generates authentic L4D/Source engine tactile clicks, weapon gunshots, zombie groans & horde tension

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.ambientGain = null;
    this.isMuted = false;
    this.masterVolume = 0.8;
    this.ambientRunning = false;
    this.ambientNodes = [];
  }

  init() {
    if (this.ctx) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime);
    this.masterGain.connect(this.ctx.destination);
  }

  resume() {
    if (!this.ctx) this.init();
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  setMasterVolume(val) {
    this.masterVolume = Math.max(0, Math.min(1, val));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.05);
    }
  }

  // Classic Valve hover
  playHover() {
    this.resume();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1400, t);
    osc.frequency.exponentialRampToValueAtTime(800, t + 0.025);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1600, t);
    filter.Q.setValueAtTime(4, t);

    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.03);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.035);
  }

  // Classic Valve select
  playSelect() {
    this.resume();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(120, t);
    subOsc.frequency.exponentialRampToValueAtTime(35, t + 0.18);
    subGain.gain.setValueAtTime(0.4, t);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    subOsc.connect(subGain);
    subGain.connect(this.masterGain);
    subOsc.start(t);
    subOsc.stop(t + 0.2);

    const clickOsc = this.ctx.createOscillator();
    const clickGain = this.ctx.createGain();
    clickOsc.type = 'square';
    clickOsc.frequency.setValueAtTime(750, t);
    clickOsc.frequency.exponentialRampToValueAtTime(320, t + 0.06);
    clickGain.gain.setValueAtTime(0.18, t);
    clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    clickOsc.connect(clickGain);
    clickGain.connect(this.masterGain);
    clickOsc.start(t);
    clickOsc.stop(t + 0.08);
  }

  playBack() {
    this.resume();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(450, t);
    osc.frequency.exponentialRampToValueAtTime(180, t + 0.08);

    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.09);
  }

  playWeaponAction() {
    this.resume();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;
    this._playMetallicSnap(t, 900, 0.25);
    this._playMetallicSnap(t + 0.12, 1600, 0.3);
    this._playMetallicSnap(t + 0.26, 700, 0.4);
  }

  // Optical scope zoom in / out sound
  playScopeZoom(isZoomIn = true) {
    this.resume();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = 'sine';
    if (isZoomIn) {
      osc.frequency.setValueAtTime(320, t);
      osc.frequency.exponentialRampToValueAtTime(780, t + 0.09);
    } else {
      osc.frequency.setValueAtTime(750, t);
      osc.frequency.exponentialRampToValueAtTime(260, t + 0.08);
    }

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1400, t);

    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.1);

    // Mechanical glass tap
    this._playMetallicSnap(t, isZoomIn ? 2400 : 1800, 0.15);
  }

  _playMetallicSnap(time, freq, vol) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.4, time + 0.04);

    filter.type = 'highpass';
    filter.frequency.setValueAtTime(800, time);

    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(time);
    osc.stop(time + 0.06);
  }

  // --- GAMEPLAY FPS AUDIO ENGINE ---

  // Assault Rifle Gunshot (Punchy crack + sub thump + mechanical tail)
  playGunshot(isSilenced = false) {
    this.resume();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;

    // 1. Initial transient crack (White noise burst)
    const noiseDuration = isSilenced ? 0.06 : 0.14;
    const bufferSize = Math.floor(this.ctx.sampleRate * noiseDuration);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.018));
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = isSilenced ? 'lowpass' : 'bandpass';
    noiseFilter.frequency.setValueAtTime(isSilenced ? 900 : 2400, t);
    noiseFilter.Q.setValueAtTime(isSilenced ? 2 : 1.2, t);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(isSilenced ? 0.35 : 0.75, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + noiseDuration);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    noise.start(t);

    // 2. Punchy low-end sub thump (Caliber 5.56 punch)
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    subOsc.type = 'triangle';
    subOsc.frequency.setValueAtTime(isSilenced ? 100 : 180, t);
    subOsc.frequency.exponentialRampToValueAtTime(30, t + 0.12);

    subGain.gain.setValueAtTime(isSilenced ? 0.3 : 0.65, t);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);

    subOsc.connect(subGain);
    subGain.connect(this.masterGain);
    subOsc.start(t);
    subOsc.stop(t + 0.14);

    // 3. Brass mechanical click
    if (!isSilenced) {
      setTimeout(() => {
        if (!this.ctx) return;
        const tt = this.ctx.currentTime;
        const clink = this.ctx.createOscillator();
        const clinkGain = this.ctx.createGain();
        clink.type = 'sine';
        clink.frequency.setValueAtTime(3200 + Math.random() * 400, tt);
        clinkGain.gain.setValueAtTime(0.04, tt);
        clinkGain.gain.exponentialRampToValueAtTime(0.001, tt + 0.05);
        clink.connect(clinkGain);
        clinkGain.connect(this.masterGain);
        clink.start(tt);
        clink.stop(tt + 0.06);
      }, 70);
    }
  }

  // Dry Fire / Empty Click
  playDryFire() {
    this.resume();
    if (!this.ctx || this.isMuted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(950, t);
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.05);
  }

  // Full Tactical Reload (Mag out, insert, bolt lock)
  playReload() {
    this.resume();
    if (!this.ctx || this.isMuted) return;
    const t = this.ctx.currentTime;
    // Mag drop
    this._playMetallicSnap(t, 600, 0.2);
    // Mag insert
    this._playMetallicSnap(t + 0.8, 1100, 0.35);
    // Bolt rack
    this._playMetallicSnap(t + 1.4, 1500, 0.4);
    this._playMetallicSnap(t + 1.6, 750, 0.5);
  }

  // Stage 1: Mag release latch & slide out
  playMagOut() {
    this.resume();
    if (!this.ctx || this.isMuted) return;
    const t = this.ctx.currentTime;
    this._playMetallicSnap(t, 850, 0.28);
    this._playMetallicSnap(t + 0.04, 520, 0.22);
  }

  // Stage 3: Magazine slam into magwell with authoritative metal/polymer click
  playMagIn() {
    this.resume();
    if (!this.ctx || this.isMuted) return;
    const t = this.ctx.currentTime;
    this._playMetallicSnap(t, 1200, 0.4);
    this._playMetallicSnap(t + 0.03, 720, 0.45);
    // Low thud of palm slapping magazine baseplate
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.08);
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  // Stage 4: Bolt release latch slap & chamber slide forward lock
  playBoltRelease() {
    this.resume();
    if (!this.ctx || this.isMuted) return;
    const t = this.ctx.currentTime;
    this._playMetallicSnap(t, 1600, 0.35);
    this._playMetallicSnap(t + 0.06, 950, 0.5);
    this._playMetallicSnap(t + 0.11, 480, 0.35);
  }

  // Empty magazine hitting concrete floor
  playMagDropGround() {
    this.resume();
    if (!this.ctx || this.isMuted) return;
    const t = this.ctx.currentTime;
    this._playMetallicSnap(t, 980, 0.15);
    setTimeout(() => {
      if (this.ctx) this._playMetallicSnap(this.ctx.currentTime, 750, 0.08);
    }, 60);
  }

  // Reactive Steel Target Impact Clang / Ping
  playSteelTargetHit(isBullseye = false) {
    this.resume();
    if (!this.ctx || this.isMuted) return;
    const t = this.ctx.currentTime;

    const ping = this.ctx.createOscillator();
    const pingGain = this.ctx.createGain();
    ping.type = 'sine';
    const baseFreq = isBullseye ? 2600 : 1750;
    ping.frequency.setValueAtTime(baseFreq, t);
    ping.frequency.exponentialRampToValueAtTime(baseFreq * 0.92, t + 0.35);

    pingGain.gain.setValueAtTime(isBullseye ? 0.45 : 0.32, t);
    pingGain.gain.exponentialRampToValueAtTime(0.001, t + (isBullseye ? 0.45 : 0.3));

    ping.connect(pingGain);
    pingGain.connect(this.masterGain);
    ping.start(t);
    ping.stop(t + 0.5);

    const overtone = this.ctx.createOscillator();
    const overGain = this.ctx.createGain();
    overtone.type = 'triangle';
    overtone.frequency.setValueAtTime(baseFreq * 1.58, t);
    overtone.frequency.exponentialRampToValueAtTime(baseFreq * 1.45, t + 0.25);

    overGain.gain.setValueAtTime(0.18, t);
    overGain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

    overtone.connect(overGain);
    overGain.connect(this.masterGain);
    overtone.start(t);
    overtone.stop(t + 0.3);

    this._playMetallicSnap(t, isBullseye ? 3400 : 2200, 0.4);
  }

  // Left 4 Dead Gun Shove / Melee Bash
  playMeleeShove(hit = false) {
    this.resume();
    if (!this.ctx || this.isMuted) return;
    const t = this.ctx.currentTime;

    // Whoosh air sound
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(260, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.16);
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.2);

    if (hit) {
      // Heavy blunt impact
      this.playFleshImpact(true);
    }
  }

  // Hitmarker Tick (normal or headshot)
  playHitmarker(isHeadshot = false) {
    this.resume();
    if (!this.ctx || this.isMuted) return;
    const t = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = isHeadshot ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(isHeadshot ? 2200 : 1300, t);
    osc.frequency.exponentialRampToValueAtTime(isHeadshot ? 3000 : 850, t + 0.04);

    gain.gain.setValueAtTime(isHeadshot ? 0.35 : 0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.06);

    if (isHeadshot) {
      this.playHeadshotSquish();
    }
  }

  playHeadshotSquish() {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(450, t);
    osc.frequency.exponentialRampToValueAtTime(110, t + 0.09);
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.11);
  }

  playFleshImpact(heavy = false) {
    const t = this.ctx.currentTime;
    const bufferSize = Math.floor(this.ctx.sampleRate * 0.08);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.015));
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(heavy ? 600 : 1200, t);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(heavy ? 0.5 : 0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    noise.start(t);
  }

  // Zombie Vocalizations
  playZombieGroan(pitchMod = 1.0) {
    this.resume();
    if (!this.ctx || this.isMuted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(90 * pitchMod, t);
    osc.frequency.linearRampToValueAtTime(120 * pitchMod, t + 0.2);
    osc.frequency.exponentialRampToValueAtTime(65 * pitchMod, t + 0.6);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(380 * pitchMod, t);
    filter.Q.setValueAtTime(4, t);

    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.65);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.7);
  }

  // Zombie Alert Screech
  playZombieAlert() {
    this.resume();
    if (!this.ctx || this.isMuted) return;
    const t = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.linearRampToValueAtTime(680, t + 0.25);
    osc.frequency.exponentialRampToValueAtTime(200, t + 0.55);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1400, t);

    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.3, t + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.65);
  }

  // Left 4 Dead Horde Stinger Chord (Piano/Brass dissonant horror hit)
  playHordeStinger() {
    this.resume();
    if (!this.ctx || this.isMuted) return;
    const t = this.ctx.currentTime;

    // Dissonant minor second / tritone cluster
    const freqs = [110, 116.5, 155.5, 220, 311.1];
    freqs.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = idx % 2 === 0 ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.22, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 2.2);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1200, t);
      filter.frequency.exponentialRampToValueAtTime(300, t + 2.0);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      osc.start(t);
      osc.stop(t + 2.3);
    });
  }

  // Tank Roar & Drum Strike
  playTankTheme() {
    this.resume();
    if (!this.ctx || this.isMuted) return;
    const t = this.ctx.currentTime;

    // Deep sub boom
    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(80, t);
    sub.frequency.exponentialRampToValueAtTime(25, t + 0.8);
    subGain.gain.setValueAtTime(0.7, t);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    sub.connect(subGain);
    subGain.connect(this.masterGain);
    sub.start(t);
    sub.stop(t + 0.95);
  }

  // Player Damage Grunt
  playPlayerHurt() {
    this.resume();
    if (!this.ctx || this.isMuted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.18);
    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.22);
  }

  // Medkit Use Bandage Wrap
  playMedkit() {
    this.resume();
    if (!this.ctx || this.isMuted) return;
    const t = this.ctx.currentTime;
    // Healing chime
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, t); // C5
    osc.frequency.exponentialRampToValueAtTime(1046.5, t + 0.35); // C6
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.5);
  }

  // Ambient Drone (Menu)
  startAmbientDrone() {
    if (this.ambientRunning) return;
    this.resume();
    if (!this.ctx) return;

    this.ambientRunning = true;
    const t = this.ctx.currentTime;

    this.ambientGain = this.ctx.createGain();
    this.ambientGain.gain.setValueAtTime(0.001, t);
    this.ambientGain.gain.linearRampToValueAtTime(0.18, t + 2);
    this.ambientGain.connect(this.masterGain);

    const sub1 = this.ctx.createOscillator();
    sub1.type = 'sawtooth';
    sub1.frequency.setValueAtTime(48, t);

    const sub2 = this.ctx.createOscillator();
    sub2.type = 'sawtooth';
    sub2.frequency.setValueAtTime(48.6, t);

    const subFilter = this.ctx.createBiquadFilter();
    subFilter.type = 'lowpass';
    subFilter.frequency.setValueAtTime(110, t);
    subFilter.Q.setValueAtTime(3, t);

    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(0.15, t);
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.setValueAtTime(30, t);
    lfo.connect(lfoGain);
    lfoGain.connect(subFilter.frequency);

    sub1.connect(subFilter);
    sub2.connect(subFilter);
    subFilter.connect(this.ambientGain);

    sub1.start(t);
    sub2.start(t);
    lfo.start(t);

    this.ambientNodes = [sub1, sub2, lfo];
  }

  stopAmbientDrone() {
    if (!this.ambientRunning || !this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.ambientGain) {
      this.ambientGain.gain.linearRampToValueAtTime(0.001, t + 0.5);
      setTimeout(() => {
        this.ambientNodes.forEach(node => {
          try { node.stop(); } catch(e) {}
        });
        this.ambientNodes = [];
        this.ambientRunning = false;
      }, 550);
    }
  }
}

export const soundEngine = new SoundEngine();
