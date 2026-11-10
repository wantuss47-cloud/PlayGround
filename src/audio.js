// Tiny procedural sound engine: no external assets.
export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.ready = false;
    this.lastThud = 0;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.55 : 0;
    this.master.connect(this.ctx.destination);

    // ---- engine ----
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = 420;
    this.engineFilter.Q.value = 3;
    this.engineGain.connect(this.engineFilter);
    this.engineFilter.connect(this.master);

    this.osc1 = this.ctx.createOscillator();
    this.osc1.type = "sawtooth";
    this.osc1.frequency.value = 42;
    this.osc2 = this.ctx.createOscillator();
    this.osc2.type = "square";
    this.osc2.frequency.value = 21;
    this.osc3 = this.ctx.createOscillator();
    this.osc3.type = "triangle";
    this.osc3.frequency.value = 84;
    const g1 = this.ctx.createGain(); g1.gain.value = 0.5;
    const g2 = this.ctx.createGain(); g2.gain.value = 0.32;
    const g3 = this.ctx.createGain(); g3.gain.value = 0.12;
    this.osc1.connect(g1); g1.connect(this.engineGain);
    this.osc2.connect(g2); g2.connect(this.engineGain);
    this.osc3.connect(g3); g3.connect(this.engineGain);
    this.osc1.start(); this.osc2.start(); this.osc3.start();

    // ---- noise buffer for mud / wind / impacts ----
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    this.mudGain = this.ctx.createGain();
    this.mudGain.gain.value = 0;
    this.mudFilter = this.ctx.createBiquadFilter();
    this.mudFilter.type = "bandpass";
    this.mudFilter.frequency.value = 620;
    this.mudFilter.Q.value = 0.8;
    const mudSrc = this.ctx.createBufferSource();
    mudSrc.buffer = buf;
    mudSrc.loop = true;
    mudSrc.connect(this.mudFilter);
    this.mudFilter.connect(this.mudGain);
    this.mudGain.connect(this.master);
    mudSrc.start();

    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;
    const windSrc = this.ctx.createBufferSource();
    windSrc.buffer = buf;
    windSrc.loop = true;
    const wf = this.ctx.createBiquadFilter();
    wf.type = "lowpass"; wf.frequency.value = 900;
    windSrc.connect(wf); wf.connect(this.windGain); this.windGain.connect(this.master);
    windSrc.start();

    this.winchGain = this.ctx.createGain();
    this.winchGain.gain.value = 0;
    this.winchOsc = this.ctx.createOscillator();
    this.winchOsc.type = "sawtooth";
    this.winchOsc.frequency.value = 74;
    const wf2 = this.ctx.createBiquadFilter();
    wf2.type = "lowpass"; wf2.frequency.value = 340;
    this.winchOsc.connect(wf2); wf2.connect(this.winchGain); this.winchGain.connect(this.master);
    this.winchOsc.start();

    this.ready = true;
  }

  setMuted(m) {
    this.enabled = !m;
    if (this.master) {
      this.master.gain.setTargetAtTime(this.enabled ? 0.55 : 0, this.ctx.currentTime, 0.03);
    }
  }

  update(state) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    const { rpm = 0, throttle = 0, speed = 0, mud = 0, slip = 0, winch = 0, playing = true } = state;
    const idle = playing ? 1 : 0.35;
    const freq = 38 + rpm * 54 + Math.min(speed, 900) * 0.012;
    this.osc1.frequency.setTargetAtTime(freq, now, 0.08);
    this.osc2.frequency.setTargetAtTime(freq * 0.5, now, 0.08);
    this.osc3.frequency.setTargetAtTime(freq * 2.02, now, 0.08);
    this.engineFilter.frequency.setTargetAtTime(260 + throttle * 520 + rpm * 260, now, 0.09);
    const eg = playing ? (0.035 + throttle * 0.05 + rpm * 0.022) * idle : 0;
    this.engineGain.gain.setTargetAtTime(eg, now, 0.09);

    const mudLevel = playing ? Math.min(1, mud * 0.5 + slip / 420) * 0.16 : 0;
    this.mudGain.gain.setTargetAtTime(mudLevel, now, 0.06);
    this.mudFilter.frequency.setTargetAtTime(380 + Math.min(slip, 500) * 1.3, now, 0.08);

    this.windGain.gain.setTargetAtTime(playing ? Math.min(0.05, speed / 22000) : 0, now, 0.2);
    this.winchGain.gain.setTargetAtTime(playing ? Math.min(0.055, winch * 0.00000006) : 0, now, 0.08);
    this.winchOsc.frequency.setTargetAtTime(64 + Math.min(winch / 20000, 28), now, 0.12);
  }

  blip(freq = 900, dur = 0.12, type = "sine", vol = 0.1, slide = 1.5) {
    if (!this.ready || !this.enabled) return;
    const now = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, now);
    o.frequency.exponentialRampToValueAtTime(freq * slide, now + dur);
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g); g.connect(this.master);
    o.start(now); o.stop(now + dur + 0.02);
  }

  coin() {
    this.blip(960, 0.09, "sine", 0.1, 1.55);
    setTimeout(() => this.blip(1440, 0.13, "sine", 0.07, 1.2), 55);
  }

  buy() {
    this.blip(300, 0.1, "square", 0.06, 1.4);
    setTimeout(() => this.blip(520, 0.16, "square", 0.05, 1.25), 70);
  }

  click() {
    this.blip(520, 0.04, "square", 0.025, 0.7);
  }

  thud(power = 1) {
    if (!this.ready || !this.enabled) return;
    const now = this.ctx.currentTime;
    if (now - this.lastThud < 0.09) return;
    this.lastThud = now;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = 160;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.22, 0.07 * power), now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(now); src.stop(now + 0.24);
  }

  splash(power = 1) {
    if (!this.ready || !this.enabled) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass"; f.frequency.value = 480;
    f.Q.value = 1.4;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.16, 0.06 * power), now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(now); src.stop(now + 0.32);
  }

  winchAttach() {
    this.blip(170, 0.16, "sawtooth", 0.05, 1.9);
    setTimeout(() => this.blip(340, 0.08, "square", 0.035, 0.8), 120);
  }
}
