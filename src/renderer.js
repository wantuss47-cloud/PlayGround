// Canvas renderer: layered landscape, detailed UAZ, particles and camera.
import { clamp, lerp, PX_PER_M, STEP, START_X } from "./terrain.js";

const TAU = Math.PI * 2;
const hash = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export class Renderer {
  constructor(canvas, terrain) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.terrain = terrain;
    this.W = 1280;
    this.H = 720;
    this.dpr = 1;
    this.baseZoom = 1;
    this.zoom = 1;
    this.cam = { x: START_X, y: terrain.heightAt(START_X) - 100 };
    this.targetZoom = 1;
    this.time = 0;
    this.shake = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.particles = [];
    this.exhaustTimer = 0;
    this.anchorHint = null;
    this.winchPulse = 0;
    this.clouds = [];
    for (let i = 0; i < 12; i++) {
      this.clouds.push({
        x: hash(i * 3.1) * 2400,
        y: 40 + hash(i * 7.7) * 190,
        s: 0.5 + hash(i * 11.3) * 1.1,
        a: 0.1 + hash(i * 5.5) * 0.18,
      });
    }
    this.resize();
  }

  resize() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = W;
    this.H = H;
    this.canvas.width = Math.round(W * this.dpr);
    this.canvas.height = Math.round(H * this.dpr);
    this.canvas.style.width = W + "px";
    this.canvas.style.height = H + "px";
    this.baseZoom = clamp(Math.min(W / 1280, H / 760), 0.58, 1.18);
    this.zoom = this.baseZoom;
    this.targetZoom = this.baseZoom;
  }

  snapCamera(truck) {
    this.cam.x = truck.x + 30;
    this.cam.y = truck.y - 10;
    this.zoom = this.baseZoom;
    this.targetZoom = this.baseZoom;
  }

  updateCamera(truck, dt, snap = false) {
    const speed = Math.hypot(truck.vx, truck.vy);
    const tx = truck.x + clamp(truck.vx * 0.3, -150, 230) + 150;
    const ty = truck.y - 16 + clamp(truck.vy * 0.1, -70, 90);
    const k = snap ? 1 : 1 - Math.exp(-dt * 3.4);
    const ky = snap ? 1 : 1 - Math.exp(-dt * 2.6);
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * ky;
    this.targetZoom = this.baseZoom * (1 - Math.min(0.1, speed / 11000));
    this.zoom += (this.targetZoom - this.zoom) * (snap ? 1 : 1 - Math.exp(-dt * 2));
  }

  addShake(amount) {
    this.shake = Math.min(1.4, this.shake + amount);
  }

  spawnParticle(p) {
    if (this.particles.length > 460) this.particles.shift();
    this.particles.push(p);
  }

  spawnMud(x, y, vx, vy, size = 3, life = 0.8) {
    this.spawnParticle({
      x, y, vx, vy,
      g: 950,
      life,
      maxLife: life,
      size,
      type: "mud",
      rot: Math.random() * TAU,
      vr: (Math.random() - 0.5) * 10,
    });
  }

  spawnDust(x, y, vx, vy, size = 4) {
    this.spawnParticle({
      x, y, vx, vy, g: 80, life: 0.9 + Math.random() * 0.7,
      maxLife: 1.6, size, type: "dust", grow: 9,
    });
  }

  spawnSmoke(x, y, vx, vy) {
    this.spawnParticle({
      x, y, vx, vy, g: -22, life: 0.9 + Math.random() * 0.5,
      maxLife: 1.4, size: 3 + Math.random() * 3, type: "smoke", grow: 12,
    });
  }

  spawnSpark(x, y, vx, vy) {
    this.spawnParticle({
      x, y, vx, vy, g: 500, life: 0.45 + Math.random() * 0.3,
      maxLife: 0.75, size: 1.5 + Math.random() * 1.8, type: "spark",
    });
  }

  coinBurst(x, y) {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + Math.random() * 0.4;
      const sp = 60 + Math.random() * 120;
      this.spawnParticle({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
        g: 260, life: 0.5 + Math.random() * 0.4, maxLife: 0.9,
        size: 2 + Math.random() * 2.4, type: "spark",
      });
    }
  }

  splashBurst(x, y, power = 1) {
    for (let i = 0; i < 16; i++) {
      const a = -Math.PI * 0.15 - Math.random() * Math.PI * 0.7;
      const sp = (60 + Math.random() * 210) * power;
      this.spawnMud(
        x + (Math.random() - 0.5) * 30,
        y,
        Math.cos(a) * sp,
        Math.sin(a) * sp,
        2 + Math.random() * 4,
        0.6 + Math.random() * 0.7
      );
    }
  }

  updateParticles(dt, game) {
    const truck = game.truck;
    const playing = game.state === "playing";
    this.time += dt;
    this.winchPulse += dt;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.6);
      this.shakeX = (Math.random() - 0.5) * this.shake * 13;
      this.shakeY = (Math.random() - 0.5) * this.shake * 10;
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }

    if (playing) {
      // exhaust
      this.exhaustTimer -= dt;
      const throttle = truck.input.gas || 0;
      if (this.exhaustTimer <= 0 && (throttle > 0 || Math.abs(truck.forwardSpeed()) > 80)) {
        this.exhaustTimer = 0.06 + Math.random() * 0.06;
        const p = truck.localToWorld(-126, 34);
        const f = truck.localToWorld(-100, 34);
        this.spawnSmoke(
          p.x, p.y,
          (p.x - f.x) * 1.1 + (Math.random() - 0.5) * 18,
          (p.y - f.y) * 1.1 - 10 - Math.random() * 14
        );
      }

      // wheel spray & dust
      for (const w of truck.wheels) {
        if (!w.contact) {
          w._spray = 0;
          continue;
        }
        const speed = Math.abs(w.slip);
        if (w.softness > 0.14 && speed > 35) {
          w._spray = (w._spray || 0) + dt * (6 + speed * 0.13);
          while (w._spray > 1) {
            w._spray -= 1;
            const back = -Math.sign(w.slip || 1);
            this.spawnMud(
              w.contactX + (Math.random() - 0.5) * 20,
              w.contactY - 2,
              w.tangent.x * back * (60 + Math.random() * 210) + (Math.random() - 0.5) * 40,
              -40 - Math.random() * 190,
              1.8 + Math.random() * 4,
              0.5 + Math.random() * 0.8
            );
          }
        } else if (w.softness < 0.2 && truck.speed > 120) {
          w._spray = (w._spray || 0) + dt * 2.2;
          while (w._spray > 1) {
            w._spray -= 1;
            this.spawnDust(
              w.contactX + (Math.random() - 0.5) * 24,
              w.contactY - 2,
              -Math.sign(truck.vx || 1) * (20 + Math.random() * 50),
              -10 - Math.random() * 30,
              2 + Math.random() * 4
            );
          }
        }
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy += (p.g || 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.type === "mud" || p.type === "spark") {
        p.vx *= 1 - dt * 1.4;
      } else if (p.type === "dust" || p.type === "smoke") {
        p.vx *= 1 - dt * 1.1;
        p.vy *= 1 - dt * 0.8;
        p.size += (p.grow || 0) * dt;
      }
      if (p.rot !== undefined) p.rot += (p.vr || 0) * dt;
    }
  }

  // ---------------- drawing ----------------
  render(game) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    this.drawSky(game);
    this.drawParallax(game);

    ctx.save();
    ctx.translate(this.W / 2 + this.shakeX, this.H / 2 + this.shakeY);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.cam.x, -this.cam.y);

    this.drawTerrain();
    this.drawWorldDecor(game);
    this.drawCoins(game);
    this.drawWinchHint(game);
    this.drawTruck(game.truck);
    this.drawParticles();
    this.drawWinchCable(game.truck);
    ctx.restore();

    this.drawScreenOverlays(game);
  }

  drawSky(game) {
    const ctx = this.ctx;
    const W = this.W;
    const H = this.H;
    const g = ctx.createLinearGradient(0, 0, 0, H * 0.72);
    g.addColorStop(0, "#5d7f91");
    g.addColorStop(0.34, "#8fa5a2");
    g.addColorStop(0.62, "#cbbd9a");
    g.addColorStop(0.85, "#e6c996");
    g.addColorStop(1, "#e9c48e");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // sun
    const sx = W * 0.77;
    const sy = H * 0.18 - (this.cam.y - 450) * 0.035;
    const sun = ctx.createRadialGradient(sx, sy, 4, sx, sy, 160);
    sun.addColorStop(0, "rgba(255, 243, 204, 0.95)");
    sun.addColorStop(0.12, "rgba(255, 227, 158, 0.7)");
    sun.addColorStop(0.45, "rgba(255, 210, 130, 0.16)");
    sun.addColorStop(1, "rgba(255, 200, 120, 0)");
    ctx.fillStyle = sun;
    ctx.fillRect(sx - 180, sy - 180, 360, 360);
    ctx.beginPath();
    ctx.arc(sx, sy, 25, 0, TAU);
    ctx.fillStyle = "rgba(255, 246, 215, 0.85)";
    ctx.fill();

    // clouds
    const drift = this.time * 3 + this.cam.x * 0.012;
    for (const c of this.clouds) {
      let x = ((c.x - drift) % 2400 + 2400) % 2400 - 400;
      const y = c.y + Math.sin(c.x) * 16 - (this.cam.y - 450) * 0.025;
      if (x < -400 || x > W + 400) continue;
      ctx.save();
      ctx.globalAlpha = c.a;
      ctx.fillStyle = "#f3e7cc";
      ctx.beginPath();
      ctx.ellipse(x, y, 90 * c.s, 16 * c.s, 0, 0, TAU);
      ctx.ellipse(x + 44 * c.s, y - 8 * c.s, 58 * c.s, 14 * c.s, 0, 0, TAU);
      ctx.ellipse(x - 48 * c.s, y + 2 * c.s, 52 * c.s, 11 * c.s, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  drawParallax() {
    const ctx = this.ctx;
    const W = this.W;
    const H = this.H;
    const camX = this.cam.x;
    const camY = this.cam.y;
    const horizon = H * 0.66 - (camY - 450) * 0.05;

    const layers = [
      { f: 0.06, amp: 92, base: horizon - 42, color: "#8b9a8c", step: 0.0035, ph: 1.2 },
      { f: 0.11, amp: 126, base: horizon + 6, color: "#73846f", step: 0.0027, ph: 4.1 },
      { f: 0.19, amp: 158, base: horizon + 58, color: "#596b56", step: 0.0021, ph: 2.2 },
      { f: 0.31, amp: 130, base: horizon + 112, color: "#44543f", step: 0.0031, ph: 5.4 },
    ];
    for (const L of layers) {
      ctx.beginPath();
      ctx.moveTo(-80, H + 10);
      for (let x = -80; x <= W + 80; x += 18) {
        const wx = x + camX * L.f;
        const y =
          L.base +
          Math.sin(wx * L.step + L.ph) * L.amp +
          Math.sin(wx * L.step * 2.7 + L.ph * 1.7) * L.amp * 0.34 +
          Math.sin(wx * L.step * 0.37 + 2) * L.amp * 0.5;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W + 80, H + 10);
      ctx.closePath();
      ctx.fillStyle = L.color;
      ctx.fill();
    }

    // haze at the tree line
    const haze = ctx.createLinearGradient(0, horizon + 10, 0, horizon + 190);
    haze.addColorStop(0, "rgba(231, 208, 168, 0.34)");
    haze.addColorStop(1, "rgba(231, 208, 168, 0)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, horizon + 10, W, 190);

    // distant tree line
    ctx.fillStyle = "rgba(45, 58, 42, 0.62)";
    for (let i = 0; i < 90; i++) {
      const wx = i * 47 + camX * 0.26;
      const x = ((wx % (W + 200)) + W + 200) % (W + 200) - 100;
      const h = 16 + hash(i * 4.7) * 36;
      const baseY = horizon + 72 + Math.sin(i * 0.8) * 10;
      ctx.beginPath();
      ctx.moveTo(x, baseY);
      ctx.lineTo(x + 6, baseY - h);
      ctx.lineTo(x + 12, baseY);
      ctx.fill();
    }

    // birds
    ctx.strokeStyle = "rgba(36, 42, 34, 0.55)";
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 4; i++) {
      const bx = ((this.time * (6 + i * 2) + i * 240 - camX * 0.02) % (W + 200)) - 100;
      const by = H * 0.16 + i * 26 + Math.sin(this.time * 0.8 + i) * 8;
      ctx.beginPath();
      ctx.moveTo(bx - 6, by);
      ctx.quadraticCurveTo(bx - 2, by - 4, bx, by);
      ctx.quadraticCurveTo(bx + 2, by - 4, bx + 6, by);
      ctx.stroke();
    }
  }

  drawTerrain() {
    const ctx = this.ctx;
    const t = this.terrain;
    const left = this.cam.x - this.W / (2 * this.zoom) - 80;
    const right = this.cam.x + this.W / (2 * this.zoom) + 80;
    const bottom = this.cam.y + this.H / (2 * this.zoom) + 200;
    let i0 = Math.floor(left / STEP);
    let i1 = Math.ceil(right / STEP);
    i0 = clamp(i0, 1, t.count - 2);
    i1 = clamp(i1, i0 + 2, t.count - 2);

    // terrain body
    ctx.beginPath();
    ctx.moveTo(i0 * STEP, bottom + 40);
    for (let i = i0; i <= i1; i += 2) {
      ctx.lineTo(i * STEP, t.heights[i]);
    }
    ctx.lineTo(i1 * STEP, bottom + 40);
    ctx.closePath();

    const topY = Math.min(t.heights[i0], t.heights[i1]) - 80;
    const g = ctx.createLinearGradient(0, topY, 0, bottom);
    g.addColorStop(0, "#4b3a28");
    g.addColorStop(0.25, "#3a2d20");
    g.addColorStop(0.65, "#2b2118");
    g.addColorStop(1, "#1b1611");
    ctx.fillStyle = g;
    ctx.fill();

    ctx.save();
    ctx.clip();

    // strata
    for (let s = 0; s < 4; s++) {
      const depth = 62 + s * 88;
      ctx.beginPath();
      for (let i = i0; i <= i1; i += 4) {
        const x = i * STEP;
        const y = t.heights[i] + depth + Math.sin(x * 0.008 + s * 2.4) * (8 + s * 3);
        if (i === i0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = s % 2 ? "rgba(255, 232, 195, 0.045)" : "rgba(0, 0, 0, 0.16)";
      ctx.lineWidth = 2 + s * 0.6;
      ctx.stroke();
    }

    // embedded stones
    for (let x = Math.floor(left / 90) * 90; x < right; x += 90) {
      const h = hash(x * 0.031);
      if (h < 0.42) continue;
      const gy = t.heightAt(x) + 34 + hash(x * 0.017) * 190;
      const s = 2 + hash(x * 0.071) * 7;
      ctx.beginPath();
      ctx.ellipse(x + h * 22, gy, s * 1.4, s, h * 2, 0, TAU);
      ctx.fillStyle = h > 0.75 ? "rgba(120, 105, 80, 0.22)" : "rgba(10, 8, 6, 0.25)";
      ctx.fill();
    }

    // topsoil band
    ctx.beginPath();
    for (let i = i0; i <= i1; i += 2) {
      const x = i * STEP;
      const y = t.heights[i];
      if (i === i0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "#5a432c";
    ctx.lineWidth = 20;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.strokeStyle = "#4a3624";
    ctx.lineWidth = 10;
    ctx.stroke();

    // wet mud pools
    for (const pit of t.mudPits) {
      if (pit.x < left - pit.w || pit.x > right + pit.w) continue;
      const gy = t.heightAt(pit.x);
      const pg = ctx.createLinearGradient(0, gy - 10, 0, gy + 24);
      pg.addColorStop(0, "rgba(28, 21, 15, 0.75)");
      pg.addColorStop(1, "rgba(22, 17, 12, 0.2)");
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.ellipse(pit.x, gy + 3, pit.w * 0.48, 11, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "rgba(210, 190, 150, 0.14)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(pit.x - pit.w * 0.08, gy - 1, pit.w * 0.3, 4, 0, 0, TAU);
      ctx.stroke();
    }

    // disturbed / rutted ground
    ctx.lineCap = "round";
    for (let i = i0; i < i1; i += 2) {
      const x = i * STEP;
      const d = t.disturb[i];
      if (d < 0.16) continue;
      const y = t.heights[i];
      ctx.beginPath();
      ctx.moveTo(x, y - 1);
      ctx.lineTo((i + 2) * STEP, t.heights[Math.min(t.count - 1, i + 2)] - 1);
      ctx.strokeStyle = `rgba(32, 23, 15, ${Math.min(0.65, 0.18 + d * 0.45)})`;
      ctx.lineWidth = 9 + Math.min(8, d * 8);
      ctx.stroke();
    }

    ctx.restore();

    // surface line (grass / dirt / mud)
    ctx.lineCap = "round";
    for (let i = i0; i < i1; i += 2) {
      const x = i * STEP;
      const nx = (i + 2) * STEP;
      const s = Math.max(t.softness[i], t.softness[Math.min(t.count - 1, i + 2)]);
      const d = Math.max(t.disturb[i], t.disturb[Math.min(t.count - 1, i + 2)]);
      const y = t.heights[i];
      const ny = t.heights[Math.min(t.count - 1, i + 2)];
      let color = "#7c8c49";
      let width = 4.5;
      if (d > 0.3 || s > 0.62) {
        color = "#3a2a1c";
        width = 9;
      } else if (s > 0.28) {
        color = "#5d452c";
        width = 7;
      } else if (s > 0.12) {
        color = "#6b6236";
        width = 5.5;
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      if (s < 0.2) {
        ctx.strokeStyle = "rgba(171, 186, 104, 0.5)";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x, y - 1);
        ctx.lineTo(nx, ny - 1);
        ctx.stroke();
      }
    }

    // grass tufts
    for (let x = Math.floor(left / 26) * 26; x < right; x += 26) {
      const s = t.softnessAt(x);
      if (s > 0.28) continue;
      const h = hash(x * 0.13);
      if (h < 0.28) continue;
      const gy = t.heightAt(x);
      const n = 2 + Math.floor(h * 3);
      ctx.strokeStyle = h > 0.7 ? "rgba(147, 163, 87, 0.8)" : "rgba(103, 121, 62, 0.85)";
      ctx.lineWidth = 1.4;
      for (let k = 0; k < n; k++) {
        const bx = x + (k - n / 2) * 3;
        ctx.beginPath();
        ctx.moveTo(bx, gy);
        ctx.quadraticCurveTo(
          bx + (hash(x + k * 9) - 0.5) * 8,
          gy - 7 - h * 8,
          bx + (hash(x + k * 13) - 0.5) * 13,
          gy - 11 - h * 12
        );
        ctx.stroke();
      }
      if (h > 0.82) {
        ctx.fillStyle = "rgba(220, 192, 105, 0.85)";
        ctx.beginPath();
        ctx.arc(x + 4, gy - 12 - h * 8, 1.8, 0, TAU);
        ctx.fill();
      }
    }
  }

  drawWorldDecor(game) {
    const t = this.terrain;
    const left = this.cam.x - this.W / (2 * this.zoom) - 160;
    const right = this.cam.x + this.W / (2 * this.zoom) + 160;

    // trees
    for (const tree of t.trees) {
      if (tree.x < left || tree.x > right) continue;
      this.drawTree(tree);
    }
    // bushes
    for (const b of t.bushes) {
      if (b.x < left || b.x > right) continue;
      this.drawBush(b);
    }
    // rocks
    for (const r of t.rocks) {
      if (r.x < left || r.x > right) continue;
      this.drawRock(r);
    }

    // distance flags
    const flagSpacing = 100 * PX_PER_M;
    const startFlag = Math.floor((left - START_X) / flagSpacing) * flagSpacing + START_X;
    for (let x = startFlag; x < right; x += flagSpacing) {
      if (x < START_X + 200) continue;
      const m = Math.round((x - START_X) / PX_PER_M);
      if (m <= 0) continue;
      this.drawDistanceFlag(x, m);
    }

    // mud warning stakes
    for (const pit of t.mudPits) {
      if (pit.x < left - pit.w || pit.x > right + pit.w) continue;
      this.drawMudStake(pit.x - pit.w * 0.56);
      this.drawMudStake(pit.x + pit.w * 0.56);
    }

    void game;
  }

  drawTree(tree) {
    const ctx = this.ctx;
    const sway = Math.sin(this.time * 0.55 + tree.seed) * 0.018;
    const scale = tree.h / 130;
    ctx.save();
    ctx.translate(tree.x, tree.y + 2);
    ctx.rotate(tree.lean + sway);
    ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
    ctx.beginPath();
    ctx.ellipse(0, 2, 24 * scale, 5 * scale, 0, 0, TAU);
    ctx.fill();

    if (tree.type === "pine") {
      ctx.fillStyle = "#3c2f21";
      ctx.fillRect(-2.5 * scale, -tree.h * 0.55, 5 * scale, tree.h * 0.58);
      const layers = 3;
      for (let i = 0; i < layers; i++) {
        const y = -tree.h * (0.25 + i * 0.22);
        const w = (30 - i * 6) * scale;
        const h = (44 - i * 5) * scale;
        ctx.fillStyle = i === 0 ? "#2f4128" : i === 1 ? "#394d2d" : "#455b33";
        ctx.beginPath();
        ctx.moveTo(-w, y + h * 0.35);
        ctx.lineTo(0, y - h * 0.7);
        ctx.lineTo(w, y + h * 0.35);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = "rgba(120, 143, 80, 0.25)";
      ctx.beginPath();
      ctx.moveTo(-12 * scale, -tree.h * 0.6);
      ctx.lineTo(0, -tree.h * 0.88);
      ctx.lineTo(6 * scale, -tree.h * 0.6);
      ctx.closePath();
      ctx.fill();
    } else if (tree.type === "birch") {
      ctx.strokeStyle = "#cbc5ab";
      ctx.lineWidth = 4.4 * scale;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(4 * scale, -tree.h * 0.4, 2 * scale, -tree.h * 0.78);
      ctx.stroke();
      ctx.strokeStyle = "rgba(48, 45, 35, 0.7)";
      ctx.lineWidth = 1.4 * scale;
      for (let i = 0; i < 7; i++) {
        const yy = -tree.h * (0.12 + i * 0.09);
        ctx.beginPath();
        ctx.moveTo(-3 * scale, yy);
        ctx.lineTo(3.4 * scale, yy - 1.5);
        ctx.stroke();
      }
      const blobs = [
        [0, -0.8, 23], [15, -0.68, 16], [-15, -0.7, 18],
        [7, -0.9, 14], [-8, -0.88, 13],
      ];
      for (const [bx, by, br] of blobs) {
        ctx.fillStyle = hash(tree.seed + bx) > 0.5 ? "#64783e" : "#748846";
        ctx.beginPath();
        ctx.arc(bx * scale, by * tree.h, br * scale, 0, TAU);
        ctx.fill();
      }
    } else {
      ctx.strokeStyle = "#5b5344";
      ctx.lineWidth = 4 * scale;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-4 * scale, -tree.h * 0.35, 3 * scale, -tree.h * 0.66);
      ctx.stroke();
      ctx.lineWidth = 2 * scale;
      for (let i = 0; i < 4; i++) {
        const y = -tree.h * (0.3 + i * 0.11);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo((i % 2 ? 1 : -1) * (12 + i * 3) * scale, y - 14 * scale);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawBush(b) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.fillStyle = "rgba(0,0,0,0.14)";
    ctx.beginPath();
    ctx.ellipse(0, 1, 16 * b.s, 4 * b.s, 0, 0, TAU);
    ctx.fill();
    const n = 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      ctx.fillStyle = i % 2 ? "#4b5c31" : "#5a6b38";
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 7 * b.s, -8 * b.s + Math.sin(a) * 4 * b.s, (8 + hash(b.seed + i) * 4) * b.s, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawRock(r) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.rotate(r.rot);
    ctx.fillStyle = "#5d5b4f";
    ctx.beginPath();
    ctx.moveTo(-r.s, 1);
    ctx.lineTo(-r.s * 0.5, -r.s * 0.75);
    ctx.lineTo(r.s * 0.35, -r.s * 0.9);
    ctx.lineTo(r.s, -r.s * 0.1);
    ctx.lineTo(r.s * 0.55, r.s * 0.3);
    ctx.lineTo(-r.s * 0.7, r.s * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.moveTo(-r.s * 0.5, -r.s * 0.7);
    ctx.lineTo(r.s * 0.3, -r.s * 0.82);
    ctx.lineTo(r.s * 0.1, -r.s * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawDistanceFlag(x, m) {
    const ctx = this.ctx;
    const y = this.terrain.heightAt(x);
    const sector = m % 250 === 0;
    const h = sector ? 76 : 52;
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = "#4c4536";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -h);
    ctx.stroke();
    ctx.fillStyle = sector ? "#d9a63a" : "#8da150";
    ctx.beginPath();
    ctx.moveTo(0, -h + 2);
    ctx.lineTo(sector ? 42 : 30, -h + (sector ? 13 : 9));
    ctx.lineTo(0, -h + (sector ? 26 : 18));
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(24, 26, 18, 0.8)";
    ctx.font = `700 ${sector ? 10 : 8}px "Arial Narrow", Arial`;
    ctx.textAlign = "center";
    ctx.fillText(`${m}m`, sector ? 17 : 12, -h + (sector ? 16 : 12));
    ctx.restore();
  }

  drawMudStake(x) {
    const ctx = this.ctx;
    const y = this.terrain.heightAt(x);
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = "#6a5334";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -26);
    ctx.stroke();
    ctx.fillStyle = "#d6c9a2";
    ctx.fillRect(-5, -30, 10, 7);
    ctx.fillStyle = "#b4603b";
    ctx.fillRect(-5, -26, 10, 3);
    ctx.restore();
  }

  drawCoins(game) {
    const ctx = this.ctx;
    const t = this.time;
    const left = this.cam.x - this.W / (2 * this.zoom) - 80;
    const right = this.cam.x + this.W / (2 * this.zoom) + 80;
    for (const c of game.coins) {
      if (c.taken || c.x < left || c.x > right) continue;
      const bob = Math.sin(t * 2.6 + c.seed) * 4;
      const spin = Math.abs(Math.cos(t * 2.2 + c.seed));
      const sx = 0.3 + spin * 0.7;
      const y = c.y + bob;
      const glow = ctx.createRadialGradient(c.x, y, 2, c.x, y, 26);
      glow.addColorStop(0, "rgba(255, 210, 110, 0.34)");
      glow.addColorStop(1, "rgba(255, 210, 110, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(c.x, y, 26, 0, TAU);
      ctx.fill();
      ctx.save();
      ctx.translate(c.x, y);
      ctx.scale(sx, 1);
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, TAU);
      ctx.fillStyle = "#d7a432";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#f8dd8c";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 6.4, 0, TAU);
      ctx.strokeStyle = "rgba(122, 82, 17, 0.75)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = "rgba(255, 245, 205, 0.9)";
      ctx.font = "700 8px Arial";
      ctx.textAlign = "center";
      ctx.fillText("₽", 0, 3);
      ctx.restore();
    }
  }

  drawWinchHint(game) {
    if (!this.anchorHint || game.truck.winch.attached) return;
    const ctx = this.ctx;
    const p = this.anchorHint;
    const pulse = (Math.sin(this.winchPulse * 3) + 1) * 0.5;
    ctx.save();
    ctx.strokeStyle = `rgba(157, 180, 91, ${0.28 + pulse * 0.4})`;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.arc(p.x, p.y - 26, 18 + pulse * 5, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = `rgba(157, 180, 91, ${0.55 + pulse * 0.35})`;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 52 - pulse * 4);
    ctx.lineTo(p.x - 5, p.y - 60 - pulse * 4);
    ctx.lineTo(p.x + 5, p.y - 60 - pulse * 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawTruck(truck) {
    const ctx = this.ctx;
    const t = this.terrain;
    const cos = Math.cos(truck.angle);
    const sin = Math.sin(truck.angle);
    const r = truck.radius;

    // ground shadow
    const gy = t.heightAt(truck.x);
    const air = clamp(1 - (gy - truck.y) / 300, 0.25, 1);
    ctx.save();
    ctx.translate(truck.x, gy + 3);
    ctx.fillStyle = `rgba(8, 7, 5, ${0.26 * air})`;
    ctx.beginPath();
    ctx.ellipse(0, 0, 126 * (0.8 + air * 0.2), 9, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    // suspension arms + springs
    const wheelLocal = truck.wheels.map((w) => {
      const dx = w.cx - truck.x;
      const dy = w.cy - truck.y;
      return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos, w };
    });

    ctx.save();
    ctx.translate(truck.x, truck.y);
    ctx.rotate(truck.angle);

    for (const wl of wheelLocal) {
      const ax = wl.w.ax;
      const ay = wl.w.ay;
      ctx.strokeStyle = "#22251d";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(ax * 0.45, ay + 2);
      ctx.lineTo(wl.x, wl.y);
      ctx.stroke();
      ctx.strokeStyle = "#3a3e31";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(wl.x, wl.y);
      ctx.stroke();
      // coil spring
      const dx = wl.x - ax;
      const dy = wl.y - ay;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      ctx.strokeStyle = "#8b8b6e";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      const coils = 7;
      for (let i = 0; i <= coils; i++) {
        const f = i / coils;
        const off = (i % 2 ? 1 : -1) * 3;
        const px = ax + dx * f + nx * off;
        const py = ay + dy * f + ny * off;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // wheels
    for (const wl of wheelLocal) this.drawWheel(wl.x, wl.y, r, wl.w, truck);

    this.drawBody(truck, r);

    // fender flares
    for (const wl of wheelLocal) {
      ctx.save();
      ctx.translate(wl.x, wl.y);
      ctx.strokeStyle = "#252a1d";
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.arc(0, 0, r + 5, Math.PI * 1.02, Math.PI * 1.98);
      ctx.stroke();
      ctx.strokeStyle = "#4d5735";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, r + 5, Math.PI * 1.04, Math.PI * 1.96);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  drawWheel(x, y, r, w, truck) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(w.spin);

    // tire
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fillStyle = "#1c1b17";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#0f0f0c";
    ctx.stroke();

    // tread blocks
    const blocks = 13;
    for (let i = 0; i < blocks; i++) {
      const a = (i / blocks) * TAU;
      ctx.save();
      ctx.rotate(a);
      ctx.fillStyle = i % 2 ? "#24221c" : "#2c2922";
      ctx.fillRect(r - 5, -r * 0.135, 4.5, r * 0.27);
      ctx.fillStyle = "rgba(255,255,255,0.035)";
      ctx.fillRect(r - 5, -r * 0.135, 1.5, r * 0.27);
      ctx.restore();
    }

    // sidewall
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.8, 0, TAU);
    ctx.strokeStyle = "#302d26";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, 0, TAU);
    ctx.fillStyle = "#65614d";
    ctx.fill();
    ctx.strokeStyle = "#8e886b";
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // steel rim + lugs
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 0.36, Math.sin(a) * r * 0.36, 2.4, 0, TAU);
      ctx.fillStyle = "#3d3c30";
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.23, 0, TAU);
    ctx.fillStyle = "#4a493a";
    ctx.fill();
    ctx.strokeStyle = "#9a9578";
    ctx.lineWidth = 1;
    ctx.stroke();

    // mud on tire
    if (truck.mud > 0.08 || w.softness > 0.2) {
      ctx.globalAlpha = Math.min(0.75, truck.mud * 0.55 + w.softness * 0.3);
      ctx.fillStyle = "#3a2b1d";
      ctx.beginPath();
      ctx.arc(0, 0, r, Math.PI * 0.1, Math.PI * 0.9);
      ctx.arc(0, 0, r * 0.72, Math.PI * 0.9, Math.PI * 0.1, true);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  drawBody(truck, r) {
    const ctx = this.ctx;

    // main silhouette
    ctx.beginPath();
    ctx.moveTo(-128, 42);
    ctx.lineTo(-132, 4);
    ctx.lineTo(-120, -32);
    ctx.lineTo(-98, -38);
    ctx.lineTo(-82, -64);
    ctx.lineTo(44, -64);
    ctx.lineTo(60, -30);
    ctx.lineTo(128, -30);
    ctx.lineTo(131, 2);
    ctx.lineTo(126, 42);
    ctx.closePath();
    const bodyGrad = ctx.createLinearGradient(0, -64, 0, 44);
    bodyGrad.addColorStop(0, "#6b7549");
    bodyGrad.addColorStop(0.35, "#5d673f");
    bodyGrad.addColorStop(0.78, "#4d5636");
    bodyGrad.addColorStop(1, "#3c442a");
    ctx.fillStyle = bodyGrad;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#2c3220";
    ctx.stroke();

    // roof canvas
    ctx.beginPath();
    ctx.moveTo(-82, -64);
    ctx.quadraticCurveTo(-20, -68, 44, -64);
    ctx.lineTo(40, -58);
    ctx.quadraticCurveTo(-20, -61, -80, -58);
    ctx.closePath();
    ctx.fillStyle = "#414b2d";
    ctx.fill();
    ctx.strokeStyle = "#2b3120";
    ctx.lineWidth = 1;
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(-64 + i * 24, -64);
      ctx.lineTo(-62 + i * 24, -58);
      ctx.strokeStyle = "rgba(20, 24, 15, 0.35)";
      ctx.stroke();
    }

    // hood
    ctx.beginPath();
    ctx.moveTo(60, -30);
    ctx.lineTo(128, -30);
    ctx.lineTo(129, -22);
    ctx.lineTo(62, -22);
    ctx.closePath();
    ctx.fillStyle = "#717b4e";
    ctx.fill();
    ctx.strokeStyle = "rgba(30, 35, 20, 0.5)";
    ctx.stroke();
    // hood highlight
    ctx.strokeStyle = "rgba(225, 224, 180, 0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(64, -29);
    ctx.lineTo(126, -29);
    ctx.stroke();
    // hood latches
    ctx.fillStyle = "#2c3120";
    ctx.fillRect(116, -28, 5, 3);
    ctx.fillRect(88, -28, 5, 3);

    // windshield / side glass
    const glass = ctx.createLinearGradient(0, -62, 0, -30);
    glass.addColorStop(0, "#8fa4a2");
    glass.addColorStop(0.55, "#637a7a");
    glass.addColorStop(1, "#485c5b");
    ctx.fillStyle = glass;
    ctx.beginPath();
    ctx.moveTo(40, -58);
    ctx.lineTo(56, -32);
    ctx.lineTo(60, -32);
    ctx.lineTo(46, -60);
    ctx.closePath();
    ctx.fill();
    // front side window
    ctx.beginPath();
    ctx.moveTo(1, -58);
    ctx.lineTo(36, -58);
    ctx.lineTo(48, -34);
    ctx.lineTo(1, -34);
    ctx.closePath();
    ctx.fill();
    // rear side window
    ctx.beginPath();
    ctx.moveTo(-60, -58);
    ctx.lineTo(-6, -58);
    ctx.lineTo(-6, -34);
    ctx.lineTo(-60, -34);
    ctx.closePath();
    ctx.fill();
    // window divider
    ctx.fillStyle = "#3c452a";
    ctx.fillRect(-7, -59, 4, 26);
    // glass reflections
    ctx.strokeStyle = "rgba(230, 238, 220, 0.28)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-54, -54);
    ctx.lineTo(-42, -38);
    ctx.moveTo(10, -54);
    ctx.lineTo(22, -38);
    ctx.stroke();
    // driver silhouette
    ctx.fillStyle = "rgba(24, 29, 22, 0.5)";
    ctx.beginPath();
    ctx.ellipse(24, -43, 5, 7, 0.15, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(18, -35, 9, 6, 0, 0, TAU);
    ctx.fill();

    // door seams + handles
    ctx.strokeStyle = "rgba(28, 33, 20, 0.65)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-4, -33);
    ctx.lineTo(-4, 30);
    ctx.moveTo(-64, -33);
    ctx.lineTo(-64, 30);
    ctx.stroke();
    ctx.fillStyle = "#2b3020";
    ctx.fillRect(-24, -10, 10, 2.6);
    ctx.fillRect(-84, -10, 10, 2.6);
    // hinges
    ctx.fillRect(-66, -24, 2.4, 6);
    ctx.fillRect(-66, 6, 2.4, 6);

    // rear spare wheel
    ctx.save();
    ctx.translate(-119, 4);
    ctx.beginPath();
    ctx.arc(0, 0, 19, 0, TAU);
    ctx.fillStyle = "#211f1a";
    ctx.fill();
    ctx.strokeStyle = "#333026";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, TAU);
    ctx.fillStyle = "#5f5b48";
    ctx.fill();
    ctx.strokeStyle = "#898467";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.strokeStyle = "rgba(20, 22, 16, 0.8)";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-16, -8);
    ctx.lineTo(16, 8);
    ctx.moveTo(-16, 8);
    ctx.lineTo(16, -8);
    ctx.stroke();
    ctx.restore();

    // roof rack
    ctx.strokeStyle = "#31352a";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(-86, -71);
    ctx.lineTo(38, -71);
    ctx.moveTo(-80, -64);
    ctx.lineTo(-80, -71);
    ctx.moveTo(-40, -64);
    ctx.lineTo(-40, -71);
    ctx.moveTo(0, -64);
    ctx.lineTo(0, -71);
    ctx.moveTo(36, -64);
    ctx.lineTo(36, -71);
    ctx.stroke();
    // jerry can
    ctx.fillStyle = "#4a5533";
    ctx.fillRect(-76, -92, 22, 22);
    ctx.strokeStyle = "#2b3120";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(-76, -92, 22, 22);
    ctx.beginPath();
    ctx.moveTo(-72, -88);
    ctx.lineTo(-58, -74);
    ctx.moveTo(-72, -74);
    ctx.lineTo(-58, -88);
    ctx.stroke();
    ctx.fillStyle = "#2b3120";
    ctx.fillRect(-70, -95, 10, 4);

    // snorkel
    ctx.strokeStyle = "#23261d";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(58, -28);
    ctx.lineTo(56, -52);
    ctx.lineTo(49, -64);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#3d4132";
    ctx.beginPath();
    ctx.moveTo(58, -28);
    ctx.lineTo(56, -52);
    ctx.lineTo(49, -64);
    ctx.stroke();
    ctx.fillStyle = "#23261d";
    ctx.beginPath();
    ctx.ellipse(48, -67, 4.5, 2.6, -0.4, 0, TAU);
    ctx.fill();

    // mirror
    ctx.strokeStyle = "#2c3024";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(48, -48);
    ctx.lineTo(58, -51);
    ctx.stroke();
    ctx.fillStyle = "#4e5a3c";
    ctx.fillRect(57, -56, 5, 9);

    // side trim + rocker
    ctx.fillStyle = "#3e472c";
    ctx.fillRect(-124, 22, 246, 8);
    ctx.fillStyle = "#343c26";
    ctx.fillRect(-120, 30, 238, 11);
    // step bar
    ctx.fillStyle = "#26291f";
    ctx.fillRect(-80, 42, 104, 5);
    ctx.strokeStyle = "#4b4c3b";
    ctx.lineWidth = 1;
    ctx.strokeRect(-80, 42, 104, 5);

    // front bumper + winch
    ctx.fillStyle = "#2f3227";
    ctx.fillRect(124, 16, 16, 14);
    ctx.fillStyle = "#4a4c3c";
    ctx.fillRect(124, 16, 16, 3);
    ctx.beginPath();
    ctx.arc(136, 23, 5.5, 0, TAU);
    ctx.fillStyle = "#5d5f4b";
    ctx.fill();
    ctx.strokeStyle = "#26281e";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // tow hooks
    ctx.strokeStyle = "#77785f";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(132, 33, 3.4, 0.2, Math.PI * 1.5);
    ctx.stroke();

    // rear bumper + exhaust
    ctx.fillStyle = "#2c2f24";
    ctx.fillRect(-138, 18, 14, 12);
    ctx.fillStyle = "#4d4b3b";
    ctx.fillRect(-134, 32, 13, 4);
    ctx.fillStyle = "#23241d";
    ctx.fillRect(-134, 30, 5, 6);

    // grille + lights
    ctx.fillStyle = "#26291f";
    ctx.fillRect(120, -18, 8, 16);
    ctx.strokeStyle = "#565945";
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(121, -16 + i * 3.6);
      ctx.lineTo(127, -16 + i * 3.6);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(123, -12, 5.2, 0, TAU);
    ctx.fillStyle = "#d8c584";
    ctx.fill();
    ctx.strokeStyle = "#7e7350";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(123, -12, 2.2, 0, TAU);
    ctx.fillStyle = "rgba(255, 244, 190, 0.9)";
    ctx.fill();
    ctx.fillStyle = "#b06a37";
    ctx.beginPath();
    ctx.arc(119, 2, 2.2, 0, TAU);
    ctx.fill();

    // markings
    ctx.fillStyle = "rgba(232, 228, 201, 0.75)";
    ctx.font = '700 10px "Arial Narrow", Arial';
    ctx.textAlign = "left";
    ctx.fillText("UAZ", -30, 8);
    ctx.font = '700 7px "Arial Narrow", Arial';
    ctx.fillStyle = "rgba(232, 228, 201, 0.5)";
    ctx.fillText("469", -29, 16);

    // scratches & rust
    for (let i = 0; i < 16; i++) {
      const sx = -110 + hash(i * 3.7) * 220;
      const sy = -24 + hash(i * 8.3) * 58;
      const len = 2 + hash(i * 5.1) * 7;
      ctx.strokeStyle = hash(i * 9.2) > 0.6
        ? "rgba(118, 74, 44, 0.4)"
        : "rgba(220, 215, 180, 0.14)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + len, sy + (hash(i) - 0.5) * 4);
      ctx.stroke();
    }

    // mud on body
    const mud = Math.min(1, truck.mud * 0.85);
    if (mud > 0.03) {
      ctx.globalAlpha = mud * 0.75;
      ctx.fillStyle = "#3a2b1d";
      for (let i = 0; i < 22; i++) {
        const mx = -126 + hash(i * 2.3) * 250;
        const my = 10 + hash(i * 4.9) * 32;
        const mr = 2 + hash(i * 7.7) * 9;
        ctx.beginPath();
        ctx.ellipse(mx, my, mr, mr * 0.7, hash(i) * 3, 0, TAU);
        ctx.fill();
      }
      // splatter up the doors
      for (let i = 0; i < 10; i++) {
        const mx = -100 + hash(i * 6.1) * 210;
        const my = -8 + hash(i * 2.9) * 24;
        ctx.beginPath();
        ctx.arc(mx, my, 1 + hash(i * 3.3) * 2.2, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // headlight glow
    const glow = ctx.createRadialGradient(123, -12, 1, 123, -12, 40);
    glow.addColorStop(0, "rgba(255, 233, 160, 0.24)");
    glow.addColorStop(1, "rgba(255, 233, 160, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(123, -12, 40, 0, TAU);
    ctx.fill();

    // winch fairlead on bumper
    ctx.fillStyle = "#6b6c55";
    ctx.fillRect(134, 12, 4, 8);
    void r;
  }

  drawWinchCable(truck) {
    const w = truck.winch;
    if (!w.attached || !w.anchor) return;
    const ctx = this.ctx;
    const p = truck.localToWorld(136, 14);
    const a = w.anchor;
    const dx = a.x - p.x;
    const dy = a.y - p.y;
    const dist = Math.hypot(dx, dy);
    const sag = w.taut ? Math.min(3, 30 / Math.max(dist, 1)) : Math.min(34, dist * 0.08);
    const mx = (p.x + a.x) / 2;
    const my = (p.y + a.y) / 2 + sag;
    ctx.save();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.quadraticCurveTo(mx, my, a.x, a.y);
    ctx.stroke();
    ctx.strokeStyle = w.taut ? "#c9c1a1" : "#77745e";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.quadraticCurveTo(mx, my, a.x, a.y);
    ctx.stroke();
    // hook
    ctx.translate(a.x, a.y);
    ctx.strokeStyle = "#c7b87e";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 4.5, 0.2, Math.PI * 1.7);
    ctx.stroke();
    ctx.restore();
  }

  drawParticles() {
    const ctx = this.ctx;
    for (const p of this.particles) {
      const a = clamp(p.life / p.maxLife, 0, 1);
      if (p.type === "mud") {
        ctx.fillStyle = `rgba(49, 35, 23, ${0.85 * a})`;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * 0.7, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      } else if (p.type === "dust") {
        ctx.fillStyle = `rgba(189, 169, 127, ${0.22 * a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.fill();
      } else if (p.type === "smoke") {
        ctx.fillStyle = `rgba(70, 70, 62, ${0.16 * a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.fill();
      } else if (p.type === "spark") {
        ctx.fillStyle = `rgba(255, 209, 103, ${0.95 * a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * a, 0, TAU);
        ctx.fill();
      }
    }
  }

  drawScreenOverlays(game) {
    const ctx = this.ctx;
    const W = this.W;
    const H = this.H;
    // subtle sun rays / haze near bottom
    const haze = ctx.createLinearGradient(0, H * 0.72, 0, H);
    haze.addColorStop(0, "rgba(233, 196, 142, 0)");
    haze.addColorStop(1, "rgba(233, 196, 142, 0.08)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, H * 0.72, W, H * 0.28);

    // speed streaks at speed
    const truck = game.truck;
    const speed = truck.speed;
    if (speed > 600 && game.state === "playing") {
      const alpha = Math.min(0.16, (speed - 600) / 3000);
      ctx.strokeStyle = `rgba(238, 232, 211, ${alpha})`;
      ctx.lineWidth = 1;
      for (let i = 0; i < 7; i++) {
        const y = H * 0.35 + ((i * 73 + this.time * 90) % (H * 0.45));
        const x = W * 0.1 + ((i * 173 + this.time * 240) % (W * 0.8));
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 30 - speed * 0.03, y);
        ctx.stroke();
      }
    }
  }
}
