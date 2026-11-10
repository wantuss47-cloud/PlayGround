// Custom 2D rigid-body / raycast-suspension physics for the UAZ.
import { clamp, lerp, PX_PER_M } from "./terrain.js";

const G = 620;
const MASS = 1850;
const BODY_W = 252;
const BODY_H = 96;
const WHEELBASE = 192;
const ANCHOR_Y = 26;
const AIR_DRAG = 0.00034;

export const UPGRADE_MAX = 4;

export class Truck {
  constructor(terrain, upgrades = {}) {
    this.terrain = terrain;
    this.x = 1000;
    this.y = terrain.heightAt(1000) - 92;
    this.vx = 0;
    this.vy = 0;
    this.angle = 0;
    this.av = 0;
    this.mass = MASS;
    this.inertia = (MASS * (BODY_W * BODY_W + BODY_H * BODY_H)) / 12;
    this.wheels = [
      this.makeWheel(-WHEELBASE / 2, "rear"),
      this.makeWheel(WHEELBASE / 2, "front"),
    ];
    this.upgrades = { tires: 0, portal: 0, winch: 0, engine: 0, ...upgrades };
    this.winch = {
      attached: false,
      anchor: null,
      ropeLen: 0,
      maxRope: 520,
      forceMax: 980000,
      reelSpeed: 95,
      taut: false,
      type: "tree",
      force: 0,
    };
    this.setUpgrades(this.upgrades);
    this.input = { gas: 0, brake: 0, tilt: 0, diff: false };
    this.diffLocked = false;
    this.airTime = 0;
    this.grounded = false;
    this.mud = 0;
    this.engineRpm = 0;
    this.impact = 0;
    this.spin = 0;
    this.tiltAmount = 0;
    this.winchCooldown = 0;
    this.anchorY = ANCHOR_Y;
    this.placeAt(this.x, this.angle);
  }

  makeWheel(x, id) {
    return {
      id,
      ax: x,
      ay: ANCHOR_Y,
      spin: 0,
      omega: 0,
      contact: false,
      N: 0,
      slip: 0,
      softness: 0,
      cx: 0,
      cy: 0,
      contactX: 0,
      contactY: 0,
      normal: { x: 0, y: -1 },
      tangent: { x: 1, y: 0 },
      load: 0,
      surface: "dirt",
      sink: 0,
    };
  }

  setUpgrades(u) {
    this.upgrades = { ...u };
    this.radius = 27 + u.tires * 4.6;
    this.restLen = 34 + u.portal * 5;
    this.travel = 27 + u.portal * 3.5;
    this.droop = 21 + u.portal * 2;
    this.engineMult = 1 + u.engine * 0.17;
    this.gripMult = 1 + u.tires * 0.055;
    this.mudFloat = 1 - u.tires * 0.12;
    this.winch.maxRope = 520 + u.winch * 85;
    this.winch.forceMax = 980000 + u.winch * 330000;
    this.winch.reelSpeed = 95 + u.winch * 32;
    this.winch.grip = 1;
  }

  placeAt(x, angle = 0) {
    this.terrain.generateUntil(x + 2000);
    this.x = x;
    this.y = this.terrain.heightAt(x) - (ANCHOR_Y + this.restLen + this.radius) - 3;
    this.angle = angle || Math.atan(this.terrain.slopeAt(x));
    this.vx = 0;
    this.vy = 0;
    this.av = 0;
    this.airTime = 0;
    this.winch.attached = false;
    for (const w of this.wheels) {
      w.omega = 0;
      w.spin = 0;
    }
  }

  get speed() {
    return Math.hypot(this.vx, this.vy);
  }

  get kmh() {
    return Math.hypot(this.vx, this.vy) * 0.06;
  }

  forwardSpeed() {
    return this.vx * Math.cos(this.angle) + this.vy * Math.sin(this.angle);
  }

  localToWorld(lx, ly) {
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    return { x: this.x + lx * c - ly * s, y: this.y + lx * s + ly * c };
  }

  velocityAt(lx, ly) {
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    const rx = lx * c - ly * s;
    const ry = lx * s + ly * c;
    return { x: this.vx - this.av * ry, y: this.vy + this.av * rx };
  }

  attachWinch(anchor, type = "tree") {
    if (this.winch.attached) {
      this.detachWinch();
      return false;
    }
    const wp = this.localToWorld(112, -12);
    const dist = Math.hypot(anchor.x - wp.x, anchor.y - wp.y);
    if (dist > this.winch.maxRope) return "too-far";
    this.winch.attached = true;
    this.winch.anchor = { x: anchor.x, y: anchor.y };
    this.winch.ropeLen = Math.min(dist + 8, this.winch.maxRope);
    this.winch.type = type;
    this.winch.taut = false;
    this.winch.force = 0;
    return true;
  }

  detachWinch() {
    this.winch.attached = false;
    this.winch.anchor = null;
    this.winch.force = 0;
    this.winch.taut = false;
  }

  applyForce(fx, fy, rx, ry) {
    this._fx += fx;
    this._fy += fy;
    this._torque += rx * fy - ry * fx;
  }

  update(dt, input) {
    this.input = input;
    const wasLocked = this.diffLocked;
    this.diffLocked = !!input.diff;
    if (this.diffLocked && !wasLocked) this.diffLocked = true;

    const t = this.terrain;
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);
    const down = { x: -sin, y: cos };
    const fwd = { x: cos, y: sin };

    this._fx = 0;
    this._fy = 0;
    this._torque = 0;

    // gravity + aero drag
    this._fy += this.mass * G;
    this._fx -= this.vx * Math.abs(this.vx) * AIR_DRAG;
    this._fy -= this.vy * Math.abs(this.vy) * AIR_DRAG * 0.75;

    // driver tilt control
    this.tiltAmount = input.tilt || 0;
    if (this.tiltAmount) {
      this._torque += this.tiltAmount * this.inertia * 2.9;
    }

    const gas = clamp(input.gas || 0, 0, 1);
    const brake = clamp(input.brake || 0, 0, 1);
    const vF = this.forwardSpeed();
    let engine = 0;
    let braking = 0;
    if (gas > 0) engine = gas;
    if (brake > 0) {
      if (vF > 22) braking = brake;
      else if (vF > -170) engine = -0.62 * brake;
    }
    const diffBoost = this.diffLocked ? 1.1 : 1;
    const lowSpeedAssist = this.diffLocked && Math.abs(vF) < 90 ? 1.25 : 1;
    const baseTorque = 7400000 * this.engineMult * diffBoost * lowSpeedAssist;

    let contactCount = 0;
    let totalN = 0;
    let avgSlip = 0;
    let avgOmega = 0;
    let mudWheel = 0;

    for (const w of this.wheels) {
      const A = this.localToWorld(w.ax, w.ay);
      w.cx = A.x + down.x * this.restLen;
      w.cy = A.y + down.y * this.restLen;
      w.contact = false;
      w.N = 0;
      w.slip = 0;
      w.softness = 0;

      // ray-cast downward through the wheel
      let contact = false;
      let L = this.restLen;
      let groundX = A.x + down.x * this.restLen;
      if (down.y > 0.22) {
        const groundY = t.heightAt(groundX);
        const rawL = (groundY - this.radius - A.y) / down.y;
        if (rawL < this.restLen + this.droop) {
          L = clamp(rawL, 8, this.restLen + this.droop);
          contact = true;
        }
      }

      const C = { x: A.x + down.x * L, y: A.y + down.y * L };
      w.cx = C.x;
      w.cy = C.y;

      if (contact) {
        contactCount++;
        const n = t.normalAt(groundX);
        const slope = n.slope;
        const tlen = Math.hypot(1, slope);
        const tang = { x: 1 / tlen, y: slope / tlen };
        w.normal = { x: n.x, y: n.y };
        w.tangent = tang;
        w.contactX = C.x;
        w.contactY = C.y + this.radius;
        w.softness = t.softnessAt(groundX);

        // suspension spring + damper
        const comp = this.restLen - L;
        const vA = this.velocityAt(w.ax, w.ay);
        const vDown = vA.x * down.x + vA.y * down.y;
        const k = 47000 + this.upgrades.portal * 2600;
        const c = 10600;
        let N = k * comp + c * vDown;
        N = clamp(N, 0, 3200000);
        if (N > 0) {
          w.contact = true;
          w.N = N;
          w.load = N;
          totalN += N;
          this.applyForce(n.x * N, n.y * N, A.x - this.x, A.y - this.y);
        }

        // wheel angular speed
        const vC = this.velocityAt(w.cx - this.x, w.cy - this.y);
        const vT = vC.x * tang.x + vC.y * tang.y;
        const slip = w.omega * this.radius - vT;
        w.slip = slip;

        const soft = clamp(w.softness * this.mudFloat, 0, 1.2);
        let grip = 0.94 * this.gripMult;
        if (soft > 0.03) {
          grip = lerp(grip, Math.max(0.1, 0.66 - 0.62 * soft), clamp(soft * 1.6, 0, 1));
        }
        if (this.diffLocked) grip *= 1.62;
        const maxGrip = Math.max(0, N * grip);

        const slipForce = clamp(slip * 5400, -maxGrip, maxGrip);
        // friction acts on the chassis at the contact patch
        this.applyForce(
          tang.x * slipForce,
          tang.y * slipForce,
          w.contactX - this.x,
          w.contactY - this.y
        );

        // mud resistance / suction
        if (soft > 0.05) {
          mudWheel = Math.max(mudWheel, soft);
          const speedFactor = 0.14 + 0.07 * Math.min(1, Math.abs(vT) / 260);
          let dragMag = N * soft * speedFactor;
          if (Math.abs(vT) < 50) dragMag *= 1.45;
          if (this.diffLocked) dragMag *= 0.86;
          const dir = vT > 0 ? -1 : 1;
          this.applyForce(
            tang.x * dragMag * dir,
            tang.y * dragMag * dir,
            w.contactX - this.x,
            w.contactY - this.y
          );
          // spinning digs a rut
          if (Math.abs(slip) > 22) {
            const dig = (2.1 + Math.min(9.5, Math.abs(slip) / 38)) * soft * dt;
            t.deform(w.contactX, dig, this.radius * 0.85);
          }
          w.sink = Math.min(30, w.sink + soft * dt * 7);
        } else {
          w.sink = Math.max(0, w.sink - dt * 22);
          // light rolling resistance on hard ground
          const rr = Math.min(Math.abs(vT) * 240, N * 0.018);
          this.applyForce(
            -tang.x * Math.sign(vT) * rr,
            -tang.y * Math.sign(vT) * rr,
            w.contactX - this.x,
            w.contactY - this.y
          );
        }

        // engine / brake torque at the wheel
        const torqueCurve = 1 - 0.5 * Math.min(1, Math.abs(w.omega) / 55);
        const driveTorque = engine * baseTorque * Math.max(0.35, torqueCurve);
        let wheelTorque = driveTorque - slipForce * this.radius;
        if (braking > 0) {
          const bt = 6200000 * braking;
          const dv = Math.min(Math.abs(w.omega), (bt / (0.5 * 190 * this.radius * this.radius)) * dt);
          w.omega -= Math.sign(w.omega) * dv;
        }
        const Iw = 0.5 * 190 * this.radius * this.radius;
        w.omega += (wheelTorque / Iw) * dt;
        w.omega = clamp(w.omega, -60, 60);
        // a little rolling drag on the wheel itself
        w.omega *= 1 - 0.18 * dt;
        w.spin += w.omega * dt;
        avgSlip += Math.abs(slip);
        avgOmega += Math.abs(w.omega);
      } else {
        // free-spinning wheel in the air
        const torqueCurve = 1 - 0.5 * Math.min(1, Math.abs(w.omega) / 55);
        const driveTorque = engine * baseTorque * Math.max(0.35, torqueCurve);
        const Iw = 0.5 * 190 * this.radius * this.radius;
        w.omega += (driveTorque / Iw) * dt;
        if (braking > 0) {
          w.omega -= Math.sign(w.omega) * Math.min(Math.abs(w.omega), 10 * dt);
        }
        w.omega *= 1 - 1.1 * dt;
        w.omega = clamp(w.omega, -60, 60);
        w.spin += w.omega * dt;
        avgOmega += Math.abs(w.omega);
        w.sink = Math.max(0, w.sink - dt * 22);
      }
    }

    // locked diffs keep both axles spinning together
    if (this.diffLocked && this.wheels[0].contact && this.wheels[1].contact) {
      const avg = (this.wheels[0].omega + this.wheels[1].omega) * 0.5;
      for (const w of this.wheels) w.omega = lerp(w.omega, avg, 0.32);
    }

    this.grounded = contactCount > 0;
    if (this.grounded) {
      this.airTime = 0;
      this.spin = Math.min(1, this.spin + dt * 2);
    } else {
      this.airTime += dt;
      this.spin = Math.max(0, this.spin - dt * 1.6);
    }
    this.mud = Math.max(this.mud * (1 - dt * 0.06), mudWheel);
    this.engineRpm = clamp(avgOmega / 40, 0, 1.4);
    this.slip = contactCount ? avgSlip / contactCount : 0;

    // chassis hull collisions (corners, roof, rockers)
    const hull = [
      [-126, -64], [126, -64], [130, 43], [-130, 43],
      [0, -66], [0, 43], [-126, 20], [126, 20],
      [-68, 43], [68, 43], [-68, -65], [68, -65],
      [128, -20], [-128, -20],
    ];
    for (const [lx, ly] of hull) {
      const P = this.localToWorld(lx, ly);
      const gy = t.heightAt(P.x);
      const pen = P.y - gy;
      if (pen > 0) {
        const n = t.normalAt(P.x);
        const vp = this.velocityAt(lx, ly);
        const vn = vp.x * n.x + vp.y * n.y;
        let Fn = 175000 * pen - 5400 * vn;
        Fn = clamp(Fn, 0, 3600000);
        this.applyForce(n.x * Fn, n.y * Fn, P.x - this.x, P.y - this.y);
        // scrape friction
        const tlen = Math.hypot(1, n.slope);
        const tang = { x: 1 / tlen, y: n.slope / tlen };
        const vt = vp.x * tang.x + vp.y * tang.y;
        const ff = clamp(-vt * 1600, -Fn * 0.7, Fn * 0.7);
        this.applyForce(tang.x * ff, tang.y * ff, P.x - this.x, P.y - this.y);
        if (pen > 4) this.impact = Math.max(this.impact, Math.min(1, pen / 30));
      }
    }

    // winch cable
    if (this.winch.attached) {
      const wp = this.localToWorld(116, -14);
      const anchor = this.winch.anchor;
      let dx = anchor.x - wp.x;
      let dy = anchor.y - wp.y;
      const dist = Math.hypot(dx, dy) || 1;
      dx /= dist;
      dy /= dist;

      this.winch.ropeLen = Math.max(58, this.winch.ropeLen - this.winch.reelSpeed * dt);
      const stretch = dist - this.winch.ropeLen;
      if (stretch > -2) {
        const vp = this.velocityAt(116, -14);
        const vAlong = vp.x * dx + vp.y * dy;
        let force = clamp(stretch * 11500 - vAlong * 1400, 0, this.winch.forceMax);
        // the winch motor always pulls while taut
        force = Math.max(force, Math.min(this.winch.forceMax, 170000 + stretch * 2600));
        this.winch.force = force;
        this.winch.taut = true;
        this.applyForce(dx * force, dy * force, wp.x - this.x, wp.y - this.y);
      } else {
        this.winch.force = 0;
        this.winch.taut = false;
      }
      if (dist < 62 || dist > this.winch.maxRope * 1.35) this.detachWinch();
    }

    // angular damping
    this._torque -= this.av * this.inertia * (this.grounded ? 1.1 : 0.55);

    // integrate
    this.vx += (this._fx / this.mass) * dt;
    this.vy += (this._fy / this.mass) * dt;
    this.av += (this._torque / this.inertia) * dt;
    this.vx = clamp(this.vx, -1600, 1600);
    this.vy = clamp(this.vy, -1700, 1700);
    this.av = clamp(this.av, -7.5, 7.5);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.angle += this.av * dt;

    // keep the body from tunnelling through the ground on huge impacts
    if (this.y > t.heightAt(this.x) + 55) {
      this.y = t.heightAt(this.x) + 55;
      this.vy = Math.min(this.vy, 0);
    }

    this.impact *= 1 - dt * 5;
    this.winchCooldown = Math.max(0, this.winchCooldown - dt);
  }
}
