import { Terrain, START_X, PX_PER_M, clamp } from "./terrain.js";
import { Truck } from "./physics.js";
import { Renderer } from "./renderer.js";
import { Sound } from "./audio.js";

const FIXED = 1 / 240;
const SAVE_KEY = "uaz-trial-save-v1";

const UPGRADES = [
  {
    key: "tires",
    name: "Mud Tires",
    tag: "TRACTION",
    desc: "Tall, soft, aggressive rubber. Floats over ruts and bites in the slop.",
    costs: [120, 220, 340, 480],
    icon: "tire",
  },
  {
    key: "portal",
    name: "Portal Axles",
    tag: "CLEARANCE",
    desc: "Raised drivetrain and more suspension travel. Keeps the belly out of the bog.",
    costs: [160, 260, 380, 520],
    icon: "portal",
  },
  {
    key: "winch",
    name: "Winch",
    tag: "RECOVERY",
    desc: "A longer, stronger cable. When momentum dies, steel gets you home.",
    costs: [140, 240, 360, 500],
    icon: "winch",
  },
  {
    key: "engine",
    name: "Engine Power",
    tag: "TORQUE",
    desc: "More grunt for steep climbs and for clawing out of deep wallows.",
    costs: [150, 250, 370, 510],
    icon: "engine",
  },
];

const DEFAULT_SAVE = {
  coins: 120,
  upgrades: { tires: 0, portal: 0, winch: 0, engine: 0 },
  best: 0,
  muted: false,
};

const ICONS = {
  tire: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="16" cy="16" r="11"/><circle cx="16" cy="16" r="5.2"/><path d="M16 5v4M16 23v4M5 16h4M23 16h4M8.2 8.2l2.8 2.8M21 21l2.8 2.8M23.8 8.2 21 11M11 21l-2.8 2.8"/></svg>`,
  portal: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 21h26M8 21v-4h6v4M18 21v-4h6v4"/><circle cx="8" cy="23" r="3"/><circle cx="24" cy="23" r="3"/><path d="M11 9h10v5H11zM16 9V5"/></svg>`,
  winch: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="13" cy="13" r="7"/><circle cx="13" cy="13" r="2.4"/><path d="M20 13h6v6h-3M23 19c-3 0-4 3-7 3"/><path d="M14 20v6h4v-3"/></svg>`,
  engine: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M6 14h4V9h10v5h3l3 4v6H9v-4H6z"/><path d="M10 9V6h8v3M26 17h3M12 14v4h6v-4"/></svg>`,
  coin: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.4" fill="#f3c349" stroke="#8c641c" stroke-width="1.5"/><text x="12" y="16.2" text-anchor="middle" font-size="9.5" font-weight="800" fill="#6d4b12" font-family="Arial">₽</text></svg>`,
};

class Game {
  constructor() {
    this.canvas = document.getElementById("game");
    this.sound = new Sound();
    this.save = this.loadSave();
    this.progress = {
      coins: this.save.coins,
      upgrades: { ...this.save.upgrades },
      best: this.save.best,
    };
    this.state = "menu";
    this.garageReturn = "menu";
    this.keys = { gas: false, brake: false, left: false, right: false };
    this.touch = { gas: false, brake: false, left: false, right: false };
    this.diffLocked = false;
    this.terrain = new Terrain(1337);
    this.truck = new Truck(this.terrain, this.progress.upgrades);
    this.renderer = new Renderer(this.canvas, this.terrain);
    this.renderer.snapCamera(this.truck);
    this.coins = [];
    this.coinFrontier = START_X + 260;
    this.coinRng = Math.random;
    this.distance = 0;
    this.best = this.progress.best;
    this.sector = 1;
    this.lastSafe = { x: START_X };
    this.safeTimer = 0;
    this.stuck = false;
    this.lowSpeedTimer = 0;
    this.flipTimer = 0;
    this.wasGrounded = false;
    this.lastAirVy = 0;
    this.acc = 0;
    this.lastTime = performance.now();
    this.saveTimer = 0;
    this.toastCount = 0;
    this.hintFlags = {};
    this.lastHud = {};
    this.playingTime = 0;
    this.coinAnimTimer = 0;
    this.hudTimer = 0;
    this.started = false;
    this.debug = new URLSearchParams(location.search).has("debug");
    this.autostart = new URLSearchParams(location.search).has("autostart");
    const seedParam = new URLSearchParams(location.search).get("seed");
    this.fixedSeed = seedParam ? parseInt(seedParam, 10) : null;

    this.bindUI();
    this.bindInput();
    this.buildGarage();
    this.updateStartStats();
    this.settleTruck();
    this.generateCoins(this.truck.x + 3600);
    this.updateHUD(true);
    this.setupDebug();

    if (this.autostart) {
      setTimeout(() => this.startRun(), 250);
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return { ...DEFAULT_SAVE, upgrades: { ...DEFAULT_SAVE.upgrades } };
      const p = JSON.parse(raw);
      return {
        coins: Number.isFinite(p.coins) ? p.coins : DEFAULT_SAVE.coins,
        upgrades: { ...DEFAULT_SAVE.upgrades, ...(p.upgrades || {}) },
        best: Number.isFinite(p.best) ? p.best : 0,
        muted: !!p.muted,
      };
    } catch {
      return { ...DEFAULT_SAVE, upgrades: { ...DEFAULT_SAVE.upgrades } };
    }
  }

  saveProgress() {
    try {
      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({
          coins: this.progress.coins,
          upgrades: this.progress.upgrades,
          best: Math.max(this.progress.best, this.best),
          muted: !this.sound.enabled,
        })
      );
    } catch {
      /* storage may be unavailable */
    }
  }

  settleTruck() {
    for (let i = 0; i < 4; i++) {
      this.truck.update(FIXED, { gas: 0, brake: 0, tilt: 0, diff: false });
    }
    this.truck.vx = 0;
    this.truck.vy = 0;
    this.truck.av = 0;
    this.truck.angle = Math.atan(this.terrain.slopeAt(this.truck.x));
  }

  // ---------------- run lifecycle ----------------
  startRun() {
    this.sound.init();
    const seed = this.fixedSeed ?? Math.floor(Math.random() * 100000) + 7;
    this.terrain = new Terrain(seed);
    this.truck = new Truck(this.terrain, this.progress.upgrades);
    this.renderer.terrain = this.terrain;
    this.renderer.particles.length = 0;
    this.renderer.anchorHint = null;
    this.coins = [];
    this.coinFrontier = START_X + 260;
    this.distance = 0;
    this.sector = 1;
    this.stuck = false;
    this.lowSpeedTimer = 0;
    this.flipTimer = 0;
    this.safeTimer = 0;
    this.lastSafe = { x: START_X };
    this.diffLocked = false;
    this.keys = { gas: false, brake: false, left: false, right: false };
    this.touch = { gas: false, brake: false, left: false, right: false };
    this.hintFlags = {};
    this.playingTime = 0;
    this.wasGrounded = false;
    this.acc = 0;
    this.settleTruck();
    this.generateCoins(this.truck.x + 3800);
    this.renderer.snapCamera(this.truck);
    this.renderer.cam.x = this.truck.x + 30;
    this.state = "playing";
    this.started = true;
    this.hideOverlays();
    this.updateStartStats();
    this.toast("SECTOR 1 — KEEP MOVING", "good");
    this.updateHUD(true);
    this.sound.click();
  }

  restartRun() {
    this.hideOverlays();
    this.startRun();
  }

  recover() {
    if (this.state !== "playing") return;
    const x = this.lastSafe.x || START_X;
    this.truck.placeAt(x);
    this.truck.detachWinch();
    this.settleTruck();
    this.renderer.snapCamera(this.truck);
    this.stuck = false;
    this.lowSpeedTimer = 0;
    this.flipTimer = 0;
    this.renderer.addShake(0.35);
    this.sound.thud(0.8);
    this.toast("RECOVERED TO SOLID GROUND");
    this.updateHUD(true);
  }

  // ---------------- input ----------------
  bindInput() {
    window.addEventListener("keydown", (e) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
        e.preventDefault();
      }
      if (e.repeat) return;
      const c = e.code;
      if (c === "KeyW" || c === "ArrowUp") this.keys.gas = true;
      if (c === "KeyS" || c === "ArrowDown" || c === "Space") this.keys.brake = true;
      if (c === "KeyA" || c === "ArrowLeft") this.keys.left = true;
      if (c === "KeyD" || c === "ArrowRight") this.keys.right = true;
      if (c === "ShiftLeft" || c === "ShiftRight" || c === "KeyL") this.toggleDiff();
      if (c === "KeyE") this.toggleWinch();
      if (c === "KeyR") this.recover();
      if (c === "KeyG") this.toggleGarage();
      if (c === "KeyP" || c === "Escape") this.handleEscape();
      if (c === "KeyM") this.toggleMute();
      if (c === "Enter" && this.state === "menu") this.startRun();
    });
    window.addEventListener("keyup", (e) => {
      const c = e.code;
      if (c === "KeyW" || c === "ArrowUp") this.keys.gas = false;
      if (c === "KeyS" || c === "ArrowDown" || c === "Space") this.keys.brake = false;
      if (c === "KeyA" || c === "ArrowLeft") this.keys.left = false;
      if (c === "KeyD" || c === "ArrowRight") this.keys.right = false;
    });
    window.addEventListener("blur", () => {
      this.keys = { gas: false, brake: false, left: false, right: false };
      this.touch = { gas: false, brake: false, left: false, right: false };
    });
    window.addEventListener("resize", () => {
      this.renderer.resize();
      this.renderer.snapCamera(this.truck);
    });
    window.addEventListener("beforeunload", () => this.saveProgress());
  }

  bindUI() {
    document.getElementById("startBtn").addEventListener("click", () => this.startRun());
    document.getElementById("startGarageBtn").addEventListener("click", () => {
      this.sound.init();
      this.sound.click();
      this.openGarage("menu");
    });
    document.getElementById("garageBtn").addEventListener("click", () => this.toggleGarage());
    document.getElementById("garageClose").addEventListener("click", () => this.closeGarage());
    document.getElementById("pauseBtn").addEventListener("click", () => this.pause());
    document.getElementById("resumeBtn").addEventListener("click", () => this.resume());
    document.getElementById("pauseGarageBtn").addEventListener("click", () => {
      document.getElementById("pauseOverlay").classList.add("hidden");
      this.openGarage("paused");
    });
    document.getElementById("restartBtn").addEventListener("click", () => this.restartRun());
    document.getElementById("recoverBtn").addEventListener("click", () => this.recover());
    document.getElementById("recoverHintBtn").addEventListener("click", () => this.recover());
    document.getElementById("winchHintBtn").addEventListener("click", () => this.toggleWinch());
    document.getElementById("muteBtn").addEventListener("click", () => this.toggleMute());
    document.getElementById("resetProgress").addEventListener("click", () => {
      if (!confirm("Reset all coins, upgrades and best distance?")) return;
      this.progress = { coins: DEFAULT_SAVE.coins, upgrades: { tires: 0, portal: 0, winch: 0, engine: 0 }, best: 0 };
      this.best = 0;
      this.truck.setUpgrades(this.progress.upgrades);
      this.saveProgress();
      this.buildGarage();
      this.updateStartStats();
      this.updateHUD(true);
      this.toast("PROGRESS RESET");
    });

    document.getElementById("muteBtn").classList.toggle("muted", this.save.muted);
    this.sound.enabled = !this.save.muted;

    // touch controls
    const touchControls = document.getElementById("touchControls");
    touchControls.addEventListener("pointerdown", (e) => {
      const btn = e.target.closest("[data-ctrl]");
      if (!btn) return;
      e.preventDefault();
      const c = btn.dataset.ctrl;
      if (c === "diff") this.toggleDiff();
      else if (c === "winch") this.toggleWinch();
      else {
        this.touch[c] = true;
        btn.setPointerCapture?.(e.pointerId);
      }
      btn.classList.add("pressed");
    });
    const release = (e) => {
      const btn = e.target.closest?.("[data-ctrl]");
      if (!btn) return;
      const c = btn.dataset.ctrl;
      if (c !== "diff" && c !== "winch") this.touch[c] = false;
      btn.classList.remove("pressed");
    };
    touchControls.addEventListener("pointerup", release);
    touchControls.addEventListener("pointercancel", release);
    touchControls.addEventListener("pointerleave", release);
  }

  get input() {
    return {
      gas: this.keys.gas || this.touch.gas ? 1 : 0,
      brake: this.keys.brake || this.touch.brake ? 1 : 0,
      tilt: (this.keys.right || this.touch.right ? 1 : 0) - (this.keys.left || this.touch.left ? 1 : 0),
      diff: this.diffLocked,
    };
  }

  toggleDiff() {
    if (this.state !== "playing") return;
    this.diffLocked = !this.diffLocked;
    this.sound.click();
    this.toast(this.diffLocked ? "DIFFERENTIAL LOCKED" : "DIFFERENTIAL OPEN", this.diffLocked ? "good" : "");
    this.updateHUD(true);
  }

  toggleMute() {
    this.sound.init();
    const muted = this.sound.enabled;
    this.sound.setMuted(muted);
    this.save.muted = muted;
    document.getElementById("muteBtn").classList.toggle("muted", muted);
    this.saveProgress();
    if (!muted) this.sound.click();
  }

  // ---------------- overlays ----------------
  hideOverlays() {
    for (const id of ["startOverlay", "garageOverlay", "pauseOverlay"]) {
      document.getElementById(id).classList.add("hidden");
    }
  }

  pause() {
    if (this.state !== "playing") return;
    this.state = "paused";
    this.keys = { gas: false, brake: false, left: false, right: false };
    this.touch = { gas: false, brake: false, left: false, right: false };
    document.getElementById("pauseOverlay").classList.remove("hidden");
    this.sound.click();
  }

  resume() {
    if (this.state !== "paused") return;
    this.state = "playing";
    document.getElementById("pauseOverlay").classList.add("hidden");
    this.lastTime = performance.now();
    this.sound.click();
  }

  handleEscape() {
    if (this.state === "garage") this.closeGarage();
    else if (this.state === "paused") this.resume();
    else if (this.state === "playing") this.pause();
    else if (this.state === "menu") return;
  }

  toggleGarage() {
    if (this.state === "garage") this.closeGarage();
    else if (this.state === "playing") this.openGarage("playing");
    else if (this.state === "menu") this.openGarage("menu");
    else if (this.state === "paused") {
      document.getElementById("pauseOverlay").classList.add("hidden");
      this.openGarage("paused");
    }
  }

  openGarage(from = "playing") {
    this.garageReturn = from;
    this.state = "garage";
    this.keys = { gas: false, brake: false, left: false, right: false };
    this.touch = { gas: false, brake: false, left: false, right: false };
    this.buildGarage();
    document.getElementById("garageOverlay").classList.remove("hidden");
    document.getElementById("pauseOverlay").classList.add("hidden");
    this.sound.click();
  }

  closeGarage() {
    document.getElementById("garageOverlay").classList.add("hidden");
    if (this.garageReturn === "paused") {
      this.state = "paused";
      document.getElementById("pauseOverlay").classList.remove("hidden");
    } else if (this.garageReturn === "menu") {
      this.state = "menu";
      document.getElementById("startOverlay").classList.remove("hidden");
      this.updateStartStats();
    } else {
      this.state = "playing";
      this.lastTime = performance.now();
    }
    this.sound.click();
  }

  // ---------------- garage ----------------
  buildGarage() {
    const grid = document.getElementById("upgradeGrid");
    const levels = this.progress.upgrades;
    document.getElementById("garageCoins").textContent = this.progress.coins;
    grid.innerHTML = "";
    for (const up of UPGRADES) {
      const lvl = levels[up.key] || 0;
      const maxed = lvl >= 4;
      const cost = maxed ? 0 : up.costs[lvl];
      const canBuy = !maxed && this.progress.coins >= cost;
      const card = document.createElement("div");
      card.className = "upgrade-card" + (maxed ? " maxed" : "");
      card.innerHTML = `
        <div class="upgrade-icon">${ICONS[up.icon]}</div>
        <div>
          <div class="upgrade-name">${up.name} <em>${up.tag}</em></div>
          <div class="upgrade-desc">${up.desc}</div>
          <div class="upgrade-bottom">
            <div class="pips">${[0, 1, 2, 3].map((i) => `<i class="pip${i < lvl ? " on" : ""}"></i>`).join("")}</div>
            <span class="lvl-label">LV ${lvl}/4</span>
            ${
              maxed
                ? `<button class="buy-btn maxed-label" disabled>MAXED</button>`
                : `<button class="buy-btn" data-key="${up.key}" ${canBuy ? "" : "disabled"}>${ICONS.coin} ${cost}</button>`
            }
          </div>
        </div>`;
      grid.appendChild(card);
    }
    grid.querySelectorAll(".buy-btn[data-key]").forEach((btn) => {
      btn.addEventListener("click", () => this.buyUpgrade(btn.dataset.key));
    });
  }

  buyUpgrade(key) {
    const up = UPGRADES.find((u) => u.key === key);
    if (!up) return;
    const lvl = this.progress.upgrades[key] || 0;
    if (lvl >= 4) return;
    const cost = up.costs[lvl];
    if (this.progress.coins < cost) {
      this.toast("NOT ENOUGH COINS", "bad");
      return;
    }
    this.progress.coins -= cost;
    this.progress.upgrades[key] = lvl + 1;
    this.truck.setUpgrades(this.progress.upgrades);
    this.saveProgress();
    this.buildGarage();
    this.updateStartStats();
    this.updateHUD(true);
    this.sound.buy();
    this.toast(`${up.name.toUpperCase()} → LV ${lvl + 1}`, "good");
  }

  // ---------------- gameplay systems ----------------
  generateCoins(untilX) {
    while (this.coinFrontier < untilX) {
      this.coinFrontier += 270 + Math.random() * 430;
      const x0 = this.coinFrontier;
      if (x0 < START_X + 320) continue;
      this.terrain.generateUntil(x0 + 400);
      const baseY = this.terrain.heightAt(x0);
      const soft = this.terrain.softnessAt(x0);
      const height = soft > 0.35 ? 36 : 44 + Math.random() * 34;
      const roll = Math.random();
      if (roll < 0.46) {
        const n = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) {
          const x = x0 + i * 46;
          this.coins.push({
            x,
            y: this.terrain.heightAt(x) - height - Math.sin((i / Math.max(1, n - 1)) * Math.PI) * 22,
            taken: false,
            seed: Math.random() * 100,
          });
        }
      } else if (roll < 0.8) {
        const n = 4;
        for (let i = 0; i < n; i++) {
          const x = x0 + i * 44;
          this.coins.push({
            x,
            y: this.terrain.heightAt(x) - height - Math.sin((i / (n - 1)) * Math.PI) * 62,
            taken: false,
            seed: Math.random() * 100,
          });
        }
      } else {
        this.coins.push({ x: x0, y: baseY - height, taken: false, seed: Math.random() * 100 });
        this.coins.push({ x: x0 + 54, y: baseY - height - 18, taken: false, seed: Math.random() * 100 });
      }
    }
  }

  collectCoins() {
    const truck = this.truck;
    for (const c of this.coins) {
      if (c.taken) continue;
      if (Math.abs(c.x - truck.x) > 80) continue;
      const dx = c.x - truck.x;
      const dy = c.y - truck.y;
      if (dx * dx + dy * dy < 78 * 78) {
        c.taken = true;
        this.progress.coins += 10;
        this.best = Math.max(this.best, this.distance);
        this.renderer.coinBurst(c.x, c.y);
        this.sound.coin();
        this.coinAnimTimer = 0.28;
        document.getElementById("coinPill").classList.remove("bump");
        void document.getElementById("coinPill").offsetWidth;
        document.getElementById("coinPill").classList.add("bump");
        this.saveProgress();
        this.updateHUD(true);
      }
    }
    if (this.coins.length > 400) {
      this.coins = this.coins.filter((c) => !c.taken || Math.abs(c.x - truck.x) < 1600);
    }
  }

  findWinchAnchor() {
    const truck = this.truck;
    const dir = Math.cos(truck.angle) >= 0 ? 1 : -1;
    const maxR = truck.winch.maxRope;
    const wp = truck.localToWorld(116, -14);
    const tree = this.terrain.treeNear(truck.x, dir, maxR * 0.9);
    if (tree) {
      const anchor = { x: tree.x, y: tree.y - tree.h * (tree.anchor ? 0.74 : 0.55) };
      const d = Math.hypot(anchor.x - wp.x, anchor.y - wp.y);
      if (d < maxR && d > 60) return { anchor, type: "tree" };
    }
    // pick a high point ahead (ground stake)
    let best = null;
    for (let d = 150; d <= maxR; d += 42) {
      const x = truck.x + dir * d;
      const y = this.terrain.heightAt(x) - 5;
      const dist = Math.hypot(x - wp.x, y - wp.y);
      if (dist > maxR) continue;
      if (!best || y < best.y - 3) best = { x, y, dist };
    }
    if (best) return { anchor: { x: best.x, y: best.y }, type: "ground" };
    return null;
  }

  toggleWinch() {
    if (this.state !== "playing") return;
    const truck = this.truck;
    if (truck.winch.attached) {
      truck.detachWinch();
      this.renderer.anchorHint = null;
      this.sound.click();
      this.toast("WINCH RELEASED");
      this.updateHUD(true);
      return;
    }
    const found = this.findWinchAnchor();
    if (!found) {
      this.toast("NO ANCHOR IN RANGE", "bad");
      return;
    }
    const res = truck.attachWinch(found.anchor, found.type);
    if (res === "too-far") {
      this.toast("ANCHOR TOO FAR", "bad");
      return;
    }
    this.renderer.anchorHint = null;
    this.sound.winchAttach();
    this.renderer.addShake(0.12);
    this.toast("WINCH HOOKED — REELING IN", "good");
    this.updateHUD(true);
  }

  updateWinchHint() {
    if (this.state !== "playing" || this.truck.winch.attached) {
      this.renderer.anchorHint = null;
      return;
    }
    const soft = this.terrain.softnessAt(this.truck.x);
    const shouldHint = this.stuck || (this.truck.speed < 70 && soft > 0.18);
    if (!shouldHint) {
      this.renderer.anchorHint = null;
      return;
    }
    const found = this.findWinchAnchor();
    this.renderer.anchorHint = found ? found.anchor : null;
  }

  checkProgress(dt) {
    const truck = this.truck;
    this.distance = Math.max(this.distance, (truck.x - START_X) / PX_PER_M);
    this.best = Math.max(this.best, this.distance);
    const sector = Math.floor(this.distance / 250) + 1;
    if (sector > this.sector) {
      this.sector = sector;
      this.progress.coins += 30;
      this.saveProgress();
      this.sound.coin();
      this.toast(`SECTOR ${sector} CLEARED  +30 ₽`, "good");
      this.updateStartStats();
      this.updateHUD(true);
    }

    // checkpoint
    this.safeTimer += dt;
    const a = Math.abs(this.normalizeAngle(truck.angle));
    const soft = Math.max(
      this.terrain.softnessAt(truck.x),
      this.terrain.softnessAt(truck.x - 90),
      this.terrain.softnessAt(truck.x + 90)
    );
    if (truck.grounded && truck.speed > 35 && a < 0.6 && soft < 0.24) {
      if (this.safeTimer > 0.9) {
        this.lastSafe = { x: truck.x };
        this.safeTimer = 0;
      }
    }

    // stuck / flipped detection
    const throttle = (this.keys.gas || this.touch.gas || this.keys.brake || this.touch.brake) ? 1 : 0;
    if (truck.speed < 15 && truck.grounded && throttle) {
      this.lowSpeedTimer += dt;
    } else {
      this.lowSpeedTimer = Math.max(0, this.lowSpeedTimer - dt * 2);
    }
    if (this.lowSpeedTimer > 1.45) this.stuck = true;
    if (truck.speed > 38) this.stuck = false;

    if (a > 1.7 && truck.speed < 45) {
      this.flipTimer += dt;
    } else {
      this.flipTimer = Math.max(0, this.flipTimer - dt * 1.5);
    }

    const banner = document.getElementById("stuckBanner");
    const showStuck = this.state === "playing" && (this.stuck || this.flipTimer > 1.2);
    banner.classList.toggle("hidden", !showStuck);
    if (showStuck) {
      const title = banner.querySelector(".stuck-title");
      const sub = banner.querySelector(".stuck-sub");
      if (this.flipTimer > 1.2) {
        title.textContent = "ON ITS ROOF";
        sub.textContent = "The old UAZ is upside down. Winch or recover to solid ground.";
      } else {
        title.textContent = "BOGGED DOWN";
        sub.textContent = soft > 0.2
          ? "Momentum lost in the mud. Hook the winch or recover to solid ground."
          : "Traction lost. Try diff lock, winch, or recover to solid ground.";
      }
    }

    // first-mud hint
    if (!this.hintFlags.mud && soft > 0.35) {
      this.hintFlags.mud = true;
      this.toast("DEEP MUD — KEEP YOUR MOMENTUM", "bad");
    }
    if (!this.hintFlags.lock && this.distance > 90 && !this.diffLocked) {
      this.hintFlags.lock = true;
      this.toast("SHIFT LOCKS THE DIFFERENTIAL", "good");
    }
  }

  normalizeAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  checkLanding() {
    const truck = this.truck;
    if (truck.grounded && !this.wasGrounded) {
      const impact = Math.min(1, Math.abs(this.lastAirVy) / 900);
      if (impact > 0.12) {
        this.sound.thud(0.4 + impact);
        this.renderer.addShake(impact * 0.7);
        for (const w of truck.wheels) {
          if (w.contact) {
            if (w.softness > 0.2) this.renderer.splashBurst(w.contactX, w.contactY, 0.8 + impact);
            else for (let i = 0; i < 5; i++) {
              this.renderer.spawnDust(
                w.contactX + (Math.random() - 0.5) * 22,
                w.contactY - 2,
                (Math.random() - 0.5) * 80,
                -20 - Math.random() * 50,
                2 + Math.random() * 4
              );
            }
          }
        }
      }
    }
    this.wasGrounded = truck.grounded;
    if (!truck.grounded) this.lastAirVy = truck.vy;
  }

  // ---------------- frame loop ----------------
  frame(now) {
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;

    if (this.state === "playing") {
      this.playingTime += dt;
      this.terrain.generateUntil(this.truck.x + 3200);
      this.generateCoins(this.truck.x + 3400);
      this.acc += dt;
      let steps = 0;
      while (this.acc >= FIXED && steps < 12) {
        this.truck.update(FIXED, this.input);
        this.acc -= FIXED;
        steps++;
      }
      if (steps >= 12) this.acc = 0;
      this.collectCoins();
      this.checkLanding();
      this.checkProgress(dt);
      this.updateWinchHint();
      this.renderer.updateParticles(dt, this);
      this.renderer.updateCamera(this.truck, dt);
      this.saveTimer += dt;
      if (this.saveTimer > 2.5) {
        this.saveTimer = 0;
        this.progress.best = Math.max(this.progress.best, this.best);
        this.saveProgress();
      }
      this.coinAnimTimer = Math.max(0, this.coinAnimTimer - dt);
    } else if (this.state === "menu") {
      // settle visuals only
      this.renderer.time += dt;
      this.renderer.updateCamera(this.truck, dt);
      this.renderer.anchorHint = null;
    } else {
      this.renderer.time += dt;
    }

    this.renderer.render(this);
    this.hudTimer += dt;
    if (this.hudTimer > 0.075) {
      this.hudTimer = 0;
      this.updateHUD(false);
    }
    this.sound.update({
      rpm: this.truck.engineRpm,
      throttle: this.state === "playing" ? this.input.gas : 0,
      speed: this.truck.speed,
      mud: this.truck.mud,
      slip: this.truck.slip || 0,
      winch: this.truck.winch.attached ? this.truck.winch.force : 0,
      playing: this.state === "playing",
    });
    this.updateDebug();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------- HUD ----------------
  updateHUD(force = false) {
    const set = (id, val) => {
      if (force || this.lastHud[id] !== val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
        this.lastHud[id] = val;
      }
    };
    const truck = this.truck;
    const kmh = Math.round(truck.kmh);
    set("speed", String(kmh));
    const gauge = document.getElementById("gaugeFill");
    const gp = Math.min(100, (kmh / 72) * 100);
    if (force || this.lastHud.gauge !== Math.round(gp)) {
      gauge.style.width = gp.toFixed(1) + "%";
      this.lastHud.gauge = Math.round(gp);
    }
    const vf = truck.forwardSpeed();
    set("gear", vf < -8 ? "R" : Math.abs(vf) < 4 ? "N" : "D");
    set("distance", String(Math.floor(this.distance)));
    set("best", String(Math.floor(this.best)));
    set("sectorRow", `SECTOR ${this.sector}`);
    set("coins", String(this.progress.coins));
    set("driveMode", this.diffLocked ? "4WD LOCK" : "4WD");
    const lock = document.getElementById("lockLamp");
    lock.classList.toggle("on", this.diffLocked);
    document.getElementById("diffStatus").classList.toggle("on", this.diffLocked);
    document.getElementById("winchStatus").classList.toggle("winch-on", truck.winch.attached);
    const inMud = truck.mud > 0.12 || this.terrain.softnessAt(truck.x) > 0.2;
    document.getElementById("mudStatus").classList.toggle("on", inMud);
    const next = this.nextUpgrade();
    const hint = document.getElementById("nextUpgradeHint");
    if (next) {
      const lvl = this.progress.upgrades[next.key] || 0;
      hint.textContent = `${next.name.toUpperCase()} LV ${lvl + 1} · ${next.costs[lvl]}`;
    } else {
      hint.textContent = "FULLY BUILT";
    }
  }

  nextUpgrade() {
    let best = null;
    for (const up of UPGRADES) {
      const lvl = this.progress.upgrades[up.key] || 0;
      if (lvl >= 4) continue;
      const cost = up.costs[lvl];
      if (!best || cost < best.cost) best = { ...up, cost };
    }
    return best;
  }

  updateStartStats() {
    const best = Math.floor(Math.max(this.best, this.progress.best));
    document.getElementById("startBest").textContent = best;
    document.getElementById("startCoins").textContent = this.progress.coins;
    document.getElementById("startSector").textContent = Math.floor(best / 250) + 1;
    document.getElementById("startCoins")?.parentElement?.classList.remove("hidden");
  }

  toast(text, type = "") {
    const wrap = document.getElementById("toasts");
    const el = document.createElement("div");
    el.className = "toast " + type;
    el.textContent = text;
    wrap.appendChild(el);
    while (wrap.children.length > 3) wrap.removeChild(wrap.firstChild);
    setTimeout(() => el.remove(), 2900);
    this.toastCount++;
  }

  // ---------------- debug ----------------
  setupDebug() {
    if (!this.debug) return;
    const div = document.createElement("div");
    div.id = "debugPanel";
    div.style.cssText =
      "position:fixed;left:8px;bottom:8px;z-index:50;background:rgba(0,0,0,.72);color:#b7d68a;font:10px/1.45 monospace;padding:8px 10px;white-space:pre;pointer-events:none;border:1px solid #445;";
    document.body.appendChild(div);
    this.debugPanel = div;
    this.fps = 0;
  }

  updateDebug() {
    if (!this.debugPanel) return;
    const t = this.truck;
    const wheels = t.wheels
      .map(
        (w) =>
          `${w.id.padEnd(5)} c:${w.contact ? 1 : 0} N:${Math.round(w.N / 1000)}k slip:${Math.round(w.slip)} soft:${w.softness.toFixed(2)} ω:${w.omega.toFixed(1)}`
      )
      .join("\n");
    this.debugPanel.textContent =
      `state:${this.state}  dist:${this.distance.toFixed(1)}m  kmh:${t.kmh.toFixed(1)}\n` +
      `x:${t.x.toFixed(0)} y:${t.y.toFixed(0)} ang:${(t.angle * 57.3).toFixed(0)}°  av:${t.av.toFixed(2)}\n` +
      `coins:${this.progress.coins}  sector:${this.sector}  stuck:${this.stuck ? 1 : 0}  diff:${this.diffLocked ? 1 : 0}\n` +
      `winch:${t.winch.attached ? t.winch.type + " " + Math.round(t.winch.force / 1000) + "k" : "off"}\n` +
      wheels;
  }
}

// boot
window.addEventListener("DOMContentLoaded", () => {
  const game = new Game();
  window.__uaz = {
    game,
    get truck() { return game.truck; },
    get terrain() { return game.terrain; },
    get renderer() { return game.renderer; },
    get state() { return game.state; },
    startRun: () => game.startRun(),
    recover: () => game.recover(),
    toggleWinch: () => game.toggleWinch(),
    toggleGarage: () => game.toggleGarage(),
    startGarage: () => game.openGarage("menu"),
    buy: (k) => game.buyUpgrade(k),
    addCoins: (n) => { game.progress.coins += n; game.buildGarage(); game.updateHUD(true); },
    setState: (s) => { game.state = s; },
    teleport: (x) => {
      game.terrain.generateUntil(x + 3000);
      game.truck.placeAt(x);
      game.settleTruck();
      game.renderer.snapCamera(game.truck);
    },
  };
});
