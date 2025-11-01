/* Intermolecular Forces (IMFs): Interactive Particle Simulation + Molecule Close-ups
   - Scenarios: Honey (H-bond network with sugars + water), DMSO (dipole–dipole), Hexane (London dispersion)
   - Canvas-based 2D particle sim with LJ + directional terms
   - High-fidelity SVG molecule renderer lives in molecules.js
*/

import { renderMolecule, molecules } from "./molecules.js";

// ---------------- Utilities ----------------
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

// Gaussian(0,1) via Box–Muller
function randNorm() {
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// 2D vector helpers
function vAdd(a, b) {
  return [a[0] + b[0], a[1] + b[1]];
}
function vSub(a, b) {
  return [a[0] - b[0], a[1] - b[1]];
}
function vMul(a, k) {
  return [a[0] * k, a[1] * k];
}
function vLen(a) {
  return Math.hypot(a[0], a[1]);
}
function vNorm(a) {
  const L = vLen(a);
  return L > 1e-12 ? [a[0] / L, a[1] / L] : [0, 0];
}

// ---------------- Simulation Core ----------------
class NeighborGrid {
  constructor(width, height, cellSize) {
    this.width = width;
    this.height = height;
    this.cellSize = Math.max(8, cellSize);
    this.cols = Math.max(1, Math.floor(width / this.cellSize));
    this.rows = Math.max(1, Math.floor(height / this.cellSize));
    this.cells = new Array(this.cols * this.rows);
  }
  clear() {
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = undefined;
  }
  cellIndex(x, y) {
    const cx =
      ((Math.floor(x / this.cellSize) % this.cols) + this.cols) % this.cols;
    const cy =
      ((Math.floor(y / this.cellSize) % this.rows) + this.rows) % this.rows;
    return cy * this.cols + cx;
  }
  insert(particle) {
    const idx = this.cellIndex(particle.pos[0], particle.pos[1]);
    if (!this.cells[idx]) this.cells[idx] = [];
    this.cells[idx].push(particle);
  }
  forNeighbors(x, y, radius, fn) {
    const r = radius;
    const minCx = Math.floor((x - r) / this.cellSize);
    const maxCx = Math.floor((x + r) / this.cellSize);
    const minCy = Math.floor((y - r) / this.cellSize);
    const maxCy = Math.floor((y + r) / this.cellSize);
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const ix = ((cx % this.cols) + this.cols) % this.cols;
        const iy = ((cy % this.rows) + this.rows) % this.rows;
        const idx = iy * this.cols + ix;
        const cell = this.cells[idx];
        if (!cell) continue;
        for (let j = 0; j < cell.length; j++) fn(cell[j]);
      }
    }
  }
}

function makeParticle(x, y, kind) {
  return {
    kind, // "honey", "dmso", "hexane"
    pos: [x, y],
    vel: [randRange(-20, 20), randRange(-20, 20)],
    angle: Math.random() * Math.PI * 2,
    angVel: randRange(-2, 2),
    mass: 1,
    radius: 6,
    state: "liquid",
    gasUntil: 0,
    localNeighbors: 0,
  };
}

function scenarioDefaults(kind) {
  if (kind === "honey") {
    return {
      label: "Honey (H-bond)",
      epsilon: 0.7,
      sigma: 10,
      viscosity: 2.0,
      hbStrength: 1.8,
      dipole: 0.0,
      N: 100,
      color: "#5ac8fa",
    };
  }
  if (kind === "dmso") {
    return {
      label: "DMSO (dipole–dipole)",
      epsilon: 0.6,
      sigma: 10,
      viscosity: 1.2,
      hbStrength: 0.0,
      dipole: 1.6,
      N: 120,
      color: "#ffd60a",
    };
  }
  // hexane
  return {
    label: "Hexane (dispersion)",
    epsilon: 0.4,
    sigma: 10,
    viscosity: 0.6,
    hbStrength: 0.0,
    dipole: 0.0,
    N: 140,
    color: "#8ab6ff",
  };
}

class IMFSim {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = canvas.clientWidth || 900;
    this.height = canvas.clientHeight || 420;
    this.dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    this.setSize();
    this.running = false;
    this.params = { ...scenarioDefaults("honey"), kT: 1.0 };
    this.particles = [];
    this.grid = new NeighborGrid(this.width, this.height, 24);
    this.lastMs = 0;
    this.frameId = 0;
    this.gravityOn = false;
    this.contourOn = false;
    this.shadeContour = true;
    this.lastThermoMs = 0;
    this.heatingOn = false;
    this.heatAccel = 80; // px/s^2 along velocity direction when heating
    this.spawnParticles();
    this.onVisibility = () => {
      if (document.hidden) this.stop();
    };
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  setSize() {
    const cssW = this.canvas.clientWidth || 900;
    const cssH = this.canvas.clientHeight || 420;
    this.width = cssW;
    this.height = cssH;
    this.canvas.width = Math.floor(cssW * this.dpr);
    this.canvas.height = Math.floor(cssH * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  spawnParticles() {
    this.particles.length = 0;
    for (let i = 0; i < this.params.N; i++) {
      this.particles.push(
        makeParticle(
          Math.random() * this.width,
          Math.random() * this.height,
          "mol"
        )
      );
    }
  }

  adjustParticleCount(targetN) {
    const n = Math.max(1, Math.floor(targetN));
    this.params.N = n;
    // Remove extras
    while (this.particles.length > n) this.particles.pop();
    // Add new ones
    while (this.particles.length < n) {
      const p = makeParticle(
        Math.random() * this.width,
        Math.random() * this.height,
        "mol"
      );
      // Slightly lower initial speeds for stability when adding
      p.vel[0] *= 0.5;
      p.vel[1] *= 0.5;
      this.particles.push(p);
    }
  }

  changeScenario(kind) {
    const def = scenarioDefaults(kind);
    this.params = { ...def, kT: this.params.kT };
    this.spawnParticles();
  }

  // Periodic wrap
  wrap(p) {
    if (p.pos[0] < 0) p.pos[0] += this.width;
    if (p.pos[0] >= this.width) p.pos[0] -= this.width;
    if (p.pos[1] < 0) p.pos[1] += this.height;
    if (p.pos[1] >= this.height) p.pos[1] -= this.height;
  }

  // Lennard–Jones force (soft-capped)
  ljForce(rVec) {
    const r = vLen(rVec) + 1e-9;
    const { sigma } = this.params;
    // Base cohesion from viscosity (stronger to promote clumping)
    const epsilon = 0.3 + 0.5 * (this.params.viscosity || 0);
    const sr = sigma / r;
    const sr2 = sr * sr;
    const sr6 = sr2 * sr2 * sr2;
    const sr12 = sr6 * sr6;
    // F = 24*epsilon*(2*(sigma/r)^12 - (sigma/r)^6) * (1/r) * rhat
    let mag = 24 * epsilon * (2 * sr12 - sr6) * (1 / r);
    // Cutoff & smoothing
    const rCut = 2.5 * sigma;
    if (r > rCut) mag = 0;
    // Soft clip
    mag = clamp(mag, -60, 60);
    return vMul(vNorm(rVec), -mag);
  }

  // Directional hydrogen-bond-like attraction: favor alignment (proxy)
  hbForce(rVec) {
    const r = vLen(rVec) + 1e-9;
    const E = this.params.hbStrength;
    if (E <= 0) return [0, 0];
    const rCut = 1.8 * this.params.sigma;
    if (r > rCut) return [0, 0];
    const align = 1; // simple scalar; could read particle angles for more fidelity
    const f = -E * align * Math.max(0, 1 - r / rCut);
    return vMul(vNorm(rVec), f);
  }

  // Dipole–dipole proxy: short-range directional term (anti-parallel alignment)
  dipoleForce(rVec) {
    const r = vLen(rVec) + 1e-9;
    const D = this.params.dipole;
    if (D <= 0) return [0, 0];
    const rCut = 2.2 * this.params.sigma;
    if (r > rCut) return [0, 0];
    const f = -D * (1 / (r * r)) * Math.max(0.1, 1 - r / rCut);
    return vMul(vNorm(rVec), f);
  }

  computeForces(dt) {
    // Neighbor build
    this.grid.clear();
    for (let i = 0; i < this.particles.length; i++)
      this.grid.insert(this.particles[i]);
    const rMax = 28;
    for (let i = 0; i < this.particles.length; i++) {
      this.particles[i].acc = [0, 0];
      this.particles[i].localNeighbors = 0;
    }
    for (let i = 0; i < this.particles.length; i++) {
      const a = this.particles[i];
      const ax = a.pos[0];
      const ay = a.pos[1];
      const densityCut = 2.4 * this.params.sigma;
      this.grid.forNeighbors(ax, ay, rMax, (b) => {
        if (a === b) return;
        // Minimum image under periodic boundaries
        let dx = b.pos[0] - ax;
        let dy = b.pos[1] - ay;
        if (dx > this.width / 2) dx -= this.width;
        if (dx < -this.width / 2) dx += this.width;
        if (dy > this.height / 2) dy -= this.height;
        if (dy < -this.height / 2) dy += this.height;
        const rVec = [dx, dy];
        const dist = Math.hypot(dx, dy);
        if (dist < densityCut) a.localNeighbors++;
        const gasScale = a.state === "gas" || b.state === "gas" ? 0.2 : 1.0;
        const fLJ = vMul(this.ljForce(rVec), this.params.cohLJ || 1);
        const fHB = vMul(this.hbForce(rVec), this.params.cohHB || 1);
        const fDP = vMul(this.dipoleForce(rVec), this.params.cohDP || 1);
        const f = vAdd(
          vAdd(vMul(fLJ, gasScale), vMul(fHB, gasScale)),
          vMul(fDP, gasScale)
        );
        a.acc = vAdd(a.acc, f);
      });
    }
    // Drag + thermostat
    const gamma = 0.3; // fixed moderate drag for stability
    const kT = Math.max(0, this.params.kT || 0);
    const kickSigma = Math.sqrt(2 * gamma * kT);
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.acc[0] += -gamma * p.vel[0] + randNorm() * kickSigma;
      p.acc[1] += -gamma * p.vel[1] + randNorm() * kickSigma;
    }
    // Gentle velocity rescale toward target KE every ~0.5s
    const nowT = performance.now();
    if (!this.lastThermoMs) this.lastThermoMs = nowT;
    if (nowT - this.lastThermoMs > 500) {
      let keSum = 0;
      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        keSum +=
          0.5 * (p.mass || 1) * (p.vel[0] * p.vel[0] + p.vel[1] * p.vel[1]);
      }
      const n = Math.max(1, this.particles.length);
      const keAvg = keSum / n;
      const keTarget = 40 * (kT + 0.05);
      const s = Math.max(
        0.9,
        Math.min(
          1.1,
          Math.sqrt(Math.max(1e-6, keTarget / Math.max(1e-6, keAvg)))
        )
      );
      if (Math.abs(s - 1) > 0.02) {
        for (let i = 0; i < this.particles.length; i++) {
          this.particles[i].vel[0] *= s;
          this.particles[i].vel[1] *= s;
        }
      }
      this.lastThermoMs = nowT;
    }
  }

  step(dt) {
    // Forces
    this.computeForces(dt);
    // Gravity
    if (this.gravityOn) {
      const g = 900; // px/s^2
      for (let i = 0; i < this.particles.length; i++)
        this.particles[i].acc[1] += g;
    }
    // External heating: accelerate along current velocity direction
    if (this.heatingOn) {
      const aH = this.heatAccel;
      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        const vx = p.vel[0],
          vy = p.vel[1];
        const sp = Math.hypot(vx, vy);
        if (sp > 1e-3) {
          p.acc[0] += (vx / sp) * aH;
          p.acc[1] += (vy / sp) * aH;
        } else {
          // randomize direction if at rest
          const ang = Math.random() * Math.PI * 2;
          p.acc[0] += Math.cos(ang) * aH;
          p.acc[1] += Math.sin(ang) * aH;
        }
      }
    }
    // Gas buoyancy (if gravity on): help gas rise
    if (this.gravityOn) {
      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        if (p.state === "gas") p.acc[1] -= 600;
      }
    }
    // Integrate
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.vel[0] += (p.acc[0] / p.mass) * dt;
      p.vel[1] += (p.acc[1] / p.mass) * dt;
      p.pos[0] += p.vel[0] * dt;
      p.pos[1] += p.vel[1] * dt;
      if (this.gravityOn) this.handleWalls(p);
      else this.wrap(p);
    }
    // Gas/liquid state hysteresis based on kinetic energy and local density
    const epsBase = 0.15 + 0.25 * (this.params.viscosity || 0);
    const c1 = 120,
      c2 = 10; // thresholds tuning factors
    const rhoMin = 3; // neighbor count threshold
    const nowS = performance.now();
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const v2 = p.vel[0] * p.vel[0] + p.vel[1] * p.vel[1];
      const vGas2 = c1 * (this.params.kT || 0) + c2 * epsBase;
      if (p.state === "liquid") {
        if (v2 > vGas2 && p.localNeighbors < rhoMin) {
          p.state = "gas";
          p.gasUntil = nowS + 1500;
        }
      } else {
        if (
          nowS > p.gasUntil ||
          v2 < 0.6 * vGas2 ||
          p.localNeighbors >= rhoMin
        ) {
          p.state = "liquid";
        }
      }
    }
    // Collisions: run twice for stability
    this.resolveCollisions();
    this.resolveCollisions();
  }

  handleWalls(p) {
    const w = this.width;
    const h = this.height;
    const r = p.radius || 6;
    const e = 0.2; // restitution
    const fx = 0.98; // floor friction
    if (p.pos[0] < r) {
      p.pos[0] = r;
      p.vel[0] = -p.vel[0] * e;
    }
    if (p.pos[0] > w - r) {
      p.pos[0] = w - r;
      p.vel[0] = -p.vel[0] * e;
    }
    if (p.pos[1] < r) {
      p.pos[1] = r;
      p.vel[1] = -p.vel[1] * e;
      p.vel[0] *= fx;
    }
    if (p.pos[1] > h - r) {
      p.pos[1] = h - r;
      p.vel[1] = -p.vel[1] * e;
      p.vel[0] *= fx;
    }
  }

  resolveCollisions() {
    const rMax = 14; // neighbor search radius for collisions
    // rebuild neighbor grid for collision pass
    this.grid.clear();
    for (let i = 0; i < this.particles.length; i++)
      this.grid.insert(this.particles[i]);
    const e = 0.2; // restitution
    for (let i = 0; i < this.particles.length; i++) {
      const a = this.particles[i];
      const ax = a.pos[0];
      const ay = a.pos[1];
      this.grid.forNeighbors(ax, ay, rMax, (b) => {
        if (a === b) return;
        let dx = b.pos[0] - ax;
        let dy = b.pos[1] - ay;
        if (dx > this.width / 2) dx -= this.width;
        if (dx < -this.width / 2) dx += this.width;
        if (dy > this.height / 2) dy -= this.height;
        if (dy < -this.height / 2) dy += this.height;
        const dist = Math.hypot(dx, dy) || 1e-9;
        const minDist = (a.radius || 6) + (b.radius || 6);
        if (dist < minDist) {
          const nx = dx / dist;
          const ny = dy / dist;
          const overlap = minDist - dist;
          // position correction (split)
          const corr = overlap * 0.5;
          a.pos[0] -= nx * corr;
          a.pos[1] -= ny * corr;
          b.pos[0] += nx * corr;
          b.pos[1] += ny * corr;
          // velocity impulse along normal
          const rvx = b.vel[0] - a.vel[0];
          const rvy = b.vel[1] - a.vel[1];
          const vn = rvx * nx + rvy * ny;
          if (vn < 0) {
            const j = (-(1 + e) * vn) / (1 / (a.mass || 1) + 1 / (b.mass || 1));
            const jx = j * nx;
            const jy = j * ny;
            a.vel[0] -= jx / (a.mass || 1);
            a.vel[1] -= jy / (a.mass || 1);
            b.vel[0] += jx / (b.mass || 1);
            b.vel[1] += jy / (b.mass || 1);
          }
        }
      });
    }
  }

  draw() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    ctx.clearRect(0, 0, w, h);
    // Background
    // Prefer canvas-computed background (works inside Shadow DOM), fallback to var or dark
    const bgFromCanvas = getComputedStyle(this.canvas).backgroundColor;
    ctx.fillStyle =
      (bgFromCanvas && bgFromCanvas !== "rgba(0, 0, 0, 0)" && bgFromCanvas) ||
      getComputedStyle(document.body).getPropertyValue("--panel") ||
      "#0c121d";
    ctx.fillRect(0, 0, w, h);

    // Particles (solid spheres)
    const base = this.params.color || "#5ac8fa";
    ctx.fillStyle = base;
    ctx.strokeStyle = "rgba(0,0,0,0.2)";
    ctx.lineWidth = 1;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const r = p.radius || 6;
      ctx.beginPath();
      ctx.arc(p.pos[0], p.pos[1], r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Optional liquid contour overlay
    if (this.contourOn) {
      this.drawContourOverlay(ctx, base);
    }

    // Overlay (choose legible text color against current background)
    try {
      const m = (bgFromCanvas || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      let textColor = "#0e1116";
      if (m) {
        const r = Math.min(255, Math.max(0, parseInt(m[1], 10)));
        const g = Math.min(255, Math.max(0, parseInt(m[2], 10)));
        const b = Math.min(255, Math.max(0, parseInt(m[3], 10)));
        const sr = r / 255;
        const sg = g / 255;
        const sb = b / 255;
        const lin = (c) =>
          c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        const L = 0.2126 * lin(sr) + 0.7152 * lin(sg) + 0.0722 * lin(sb);
        textColor = L > 0.6 ? "#0e1116" : "#e9eef5";
      }
      ctx.fillStyle = textColor;
    } catch (_) {
      ctx.fillStyle = "#0e1116";
    }
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto";
    ctx.fillText(this.params.label, 10, 18);
    // Right-side overlay: kT and KE
    try {
      let keSum = 0;
      const n = Math.max(1, this.particles.length);
      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        keSum +=
          0.5 * (p.mass || 1) * (p.vel[0] * p.vel[0] + p.vel[1] * p.vel[1]);
      }
      const keAvg = keSum / n;
      const label = `kT ${this.params.kT.toFixed(2)}  •  KE ${keAvg.toFixed(
        1
      )}`;
      const tw = ctx.measureText(label).width;
      ctx.fillText(label, w - 10 - tw, 18);
    } catch (_) {}
  }

  drawContourOverlay(ctx, baseColor) {
    const cellSize = 16;
    const w = this.width;
    const h = this.height;
    const nx = Math.max(2, Math.ceil(w / cellSize));
    const ny = Math.max(2, Math.ceil(h / cellSize));
    const grid = new Float32Array(nx * ny);
    // Build density grid
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const r = p.radius || 6;
      const sigma = r * 1.6;
      const sigma2 = sigma * sigma;
      const minX = Math.max(0, Math.floor((p.pos[0] - 3 * sigma) / cellSize));
      const maxX = Math.min(
        nx - 1,
        Math.floor((p.pos[0] + 3 * sigma) / cellSize)
      );
      const minY = Math.max(0, Math.floor((p.pos[1] - 3 * sigma) / cellSize));
      const maxY = Math.min(
        ny - 1,
        Math.floor((p.pos[1] + 3 * sigma) / cellSize)
      );
      for (let gy = minY; gy <= maxY; gy++) {
        const cy = gy * cellSize;
        for (let gx = minX; gx <= maxX; gx++) {
          const cx = gx * cellSize;
          const dx = cx - p.pos[0];
          const dy = cy - p.pos[1];
          const d2 = dx * dx + dy * dy;
          const val = Math.exp(-d2 / (2 * sigma2));
          grid[gy * nx + gx] += val;
        }
      }
    }
    // Threshold: fraction of max
    let maxVal = 0;
    for (let k = 0; k < grid.length; k++)
      if (grid[k] > maxVal) maxVal = grid[k];
    if (maxVal <= 0.0001) return;
    const threshold = maxVal * 0.35;

    // Marching squares - collect closed loops
    const segments = [];
    function interp(ax, ay, av, bx, by, bv) {
      const t = (threshold - av) / (bv - av || 1e-6);
      return [ax + (bx - ax) * t, ay + (by - ay) * t];
    }
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const x = i * cellSize;
        const y = j * cellSize;
        const v0 = grid[j * nx + i];
        const v1 = grid[j * nx + i + 1];
        const v2 = grid[(j + 1) * nx + i + 1];
        const v3 = grid[(j + 1) * nx + i];
        let idx = 0;
        if (v0 > threshold) idx |= 1;
        if (v1 > threshold) idx |= 2;
        if (v2 > threshold) idx |= 4;
        if (v3 > threshold) idx |= 8;
        if (idx === 0 || idx === 15) continue;
        const e = [];
        switch (idx) {
          case 1:
          case 14:
            e.push(interp(x, y, v0, x + cellSize, y, v1));
            e.push(interp(x, y, v0, x, y + cellSize, v3));
            break;
          case 2:
          case 13:
            e.push(interp(x + cellSize, y, v1, x + cellSize, y + cellSize, v2));
            e.push(interp(x, y, v0, x + cellSize, y, v1));
            break;
          case 3:
          case 12:
            e.push(interp(x + cellSize, y, v1, x + cellSize, y + cellSize, v2));
            e.push(interp(x, y, v0, x, y + cellSize, v3));
            break;
          case 4:
          case 11:
            e.push(interp(x + cellSize, y, v1, x + cellSize, y + cellSize, v2));
            e.push(interp(x, y + cellSize, v3, x + cellSize, y + cellSize, v2));
            break;
          case 5:
            e.push(interp(x, y, v0, x, y + cellSize, v3));
            e.push(interp(x + cellSize, y, v1, x + cellSize, y + cellSize, v2));
            break;
          case 6:
          case 9:
            e.push(interp(x, y, v0, x + cellSize, y, v1));
            e.push(interp(x, y + cellSize, v3, x + cellSize, y + cellSize, v2));
            break;
          case 7:
          case 8:
            e.push(interp(x, y + cellSize, v3, x + cellSize, y + cellSize, v2));
            e.push(interp(x, y, v0, x, y + cellSize, v3));
            break;
          case 10:
            e.push(interp(x, y, v0, x + cellSize, y, v1));
            e.push(interp(x, y + cellSize, v3, x + cellSize, y + cellSize, v2));
            break;
        }
        if (e.length === 2) segments.push(e);
      }
    }

    // Connect segments into paths
    const paths = [];
    const used = new Array(segments.length).fill(false);
    function key(pt) {
      return pt[0].toFixed(1) + "," + pt[1].toFixed(1);
    }
    const endpointMap = new Map();
    for (let si = 0; si < segments.length; si++) {
      const [a, b] = segments[si];
      const ka = key(a),
        kb = key(b);
      (endpointMap.get(ka) || endpointMap.set(ka, []).get(ka)).push(si);
      (endpointMap.get(kb) || endpointMap.set(kb, []).get(kb)).push(si);
    }
    for (let i = 0; i < segments.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      let [a, b] = segments[i];
      const path = [a, b];
      // Grow forward
      let end = b;
      while (true) {
        const k = key(end);
        const list = endpointMap.get(k) || [];
        let found = false;
        for (const si of list) {
          if (used[si]) continue;
          const [p, q] = segments[si];
          if (Math.hypot(q[0] - end[0], q[1] - end[1]) < 0.51) {
            path.push(p);
            end = p;
            used[si] = true;
            found = true;
            break;
          } else if (Math.hypot(p[0] - end[0], p[1] - end[1]) < 0.51) {
            path.push(q);
            end = q;
            used[si] = true;
            found = true;
            break;
          }
        }
        if (!found) break;
      }
      paths.push(path);
    }

    // Draw
    ctx.save();
    ctx.strokeStyle = baseColor;
    ctx.lineWidth = 2;
    const fillColor = baseColor + "66";
    for (const path of paths) {
      if (path.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(path[0][0], path[0][1]);
      for (let i = 1; i < path.length; i++) ctx.lineTo(path[i][0], path[i][1]);
      if (this.shadeContour) {
        try {
          ctx.fillStyle = fillColor;
          ctx.fill();
        } catch (_) {}
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  loop = (now) => {
    if (!this.running) return;
    const dt = clamp((now - this.lastMs) / 1000, 0, 0.033);
    this.lastMs = now;
    this.step(dt);
    this.draw();
    // Record KE and update graph
    try {
      if (this.keCtx && this.keCanvas) {
        let keSum = 0;
        const n = Math.max(1, this.particles.length);
        for (let i = 0; i < this.particles.length; i++) {
          const p = this.particles[i];
          keSum +=
            0.5 * (p.mass || 1) * (p.vel[0] * p.vel[0] + p.vel[1] * p.vel[1]);
        }
        const keAvg = keSum / n;
        const t = (performance.now() - this.keStart) / 1000;
        this.keSeries.push({ t, ke: keAvg, kT: this.params.kT || 0 });
        if (this.keSeries.length > this.keMaxPoints) this.keSeries.shift();
        this.drawKEGraph();
      }
    } catch (_) {}
    this.frameId = requestAnimationFrame(this.loop);
  };

  start() {
    if (this.running) return;
    this.running = true;
    this.lastMs = performance.now();
    this.frameId = requestAnimationFrame(this.loop);
  }
  stop() {
    this.running = false;
    if (this.frameId) cancelAnimationFrame(this.frameId);
    this.frameId = 0;
  }
  destroy() {
    this.stop();
    document.removeEventListener("visibilitychange", this.onVisibility);
  }
}

// Extend IMFSim with KE graph (lightweight)
IMFSim.prototype.setKECanvas = function (canvas) {
  this.keCanvas = canvas;
  this.keCtx = canvas.getContext("2d");
  this.keSeries = []; // {t, ke, kT}
  this.keStart = performance.now();
  this.keMaxPoints = 10000; // accumulate a lot without panning
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const cssW = canvas.clientWidth || 900;
  const cssH = canvas.clientHeight || 80;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  this.keDPR = dpr;
  this.drawKEGraph = () => {
    const ctx = this.keCtx;
    if (!ctx) return;
    const w = this.keCanvas.width;
    const h = this.keCanvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // Compute ranges
    let tMax = 0;
    let minKE = Infinity,
      maxKE = -Infinity;
    let minKT = Infinity,
      maxKT = -Infinity;
    for (let i = 0; i < this.keSeries.length; i++) {
      const s = this.keSeries[i];
      if (s.t > tMax) tMax = s.t;
      if (s.ke < minKE) minKE = s.ke;
      if (s.ke > maxKE) maxKE = s.ke;
      if (s.kT < minKT) minKT = s.kT;
      if (s.kT > maxKT) maxKT = s.kT;
    }
    if (!isFinite(tMax) || tMax <= 0) tMax = 1;
    if (!isFinite(minKE) || !isFinite(maxKE) || minKE === maxKE) {
      minKE = 0;
      maxKE = 1;
    }
    if (!isFinite(minKT) || !isFinite(maxKT) || minKT === maxKT) {
      minKT = 0;
      maxKT = Math.max(1, minKT + 1);
    }
    // Padding
    const pL = 42,
      pR = 42,
      pT = 10,
      pB = 24;
    const plotW = Math.max(10, w - pL - pR);
    const plotH = Math.max(10, h - pT - pB);
    const xOf = pL,
      yOf = pT;
    // Axes
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xOf, yOf + plotH);
    ctx.lineTo(xOf + plotW, yOf + plotH);
    ctx.moveTo(xOf, yOf);
    ctx.lineTo(xOf, yOf + plotH);
    // Right y-axis for kT
    ctx.moveTo(xOf + plotW, yOf);
    ctx.lineTo(xOf + plotW, yOf + plotH);
    ctx.stroke();
    ctx.fillStyle = "#6b7280";
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto";
    ctx.fillText("time (s)", xOf + plotW - 56, yOf + plotH + 18);
    ctx.save();
    ctx.translate(10, yOf + 12);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("KE(avg)", 0, 0);
    ctx.restore();
    ctx.save();
    ctx.translate(xOf + plotW + 30, yOf + 12);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("kT", 0, 0);
    ctx.restore();
    // Ticks (x: 4 ticks)
    ctx.fillStyle = "#9ca3af";
    for (let i = 0; i <= 4; i++) {
      const t = (i / 4) * tMax;
      const x = xOf + (t / tMax) * plotW;
      ctx.beginPath();
      ctx.moveTo(x, yOf + plotH);
      ctx.lineTo(x, yOf + plotH + 4);
      ctx.strokeStyle = "#e5e7eb";
      ctx.stroke();
      const label = t.toFixed(0);
      const lw = ctx.measureText(label).width;
      ctx.fillText(label, x - lw / 2, yOf + plotH + 16);
    }
    // Y ticks (KE: 3 ticks)
    for (let i = 0; i <= 3; i++) {
      const v = minKE + (i / 3) * (maxKE - minKE);
      const y = yOf + plotH - ((v - minKE) / (maxKE - minKE)) * plotH;
      ctx.beginPath();
      ctx.moveTo(xOf - 4, y);
      ctx.lineTo(xOf, y);
      ctx.strokeStyle = "#e5e7eb";
      ctx.stroke();
      const label = v.toFixed(1);
      const lw = ctx.measureText(label).width;
      ctx.fillText(label, xOf - 6 - lw, y + 4);
    }
    // Right Y ticks (kT: 3 ticks)
    for (let i = 0; i <= 3; i++) {
      const v = minKT + (i / 3) * (maxKT - minKT);
      const y = yOf + plotH - ((v - minKT) / (maxKT - minKT)) * plotH;
      ctx.beginPath();
      ctx.moveTo(xOf + plotW, y);
      ctx.lineTo(xOf + plotW + 4, y);
      ctx.strokeStyle = "#e5e7eb";
      ctx.stroke();
      const label = v.toFixed(2);
      ctx.fillText(label, xOf + plotW + 6, y + 4);
    }
    // KE polyline
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < this.keSeries.length; i++) {
      const s = this.keSeries[i];
      const x = xOf + (s.t / tMax) * plotW;
      const y = yOf + plotH - ((s.ke - minKE) / (maxKE - minKE)) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // kT polyline (orange)
    ctx.strokeStyle = "#f59e0b";
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    for (let i = 0; i < this.keSeries.length; i++) {
      const s = this.keSeries[i];
      const x = xOf + (s.t / tMax) * plotW;
      const y = yOf + plotH - ((s.kT - minKT) / (maxKT - minKT)) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // Legend
    ctx.fillStyle = "#111827";
    ctx.fillText("KE", xOf + 8, yOf + 14);
    ctx.fillStyle = "#6b7280";
    ctx.fillText("kT", xOf + 40, yOf + 14);
  };
};
// ---------------- Light DOM UI (Style-guide aligned) ----------------

function getCSSVar(name, fallback) {
  const cs = getComputedStyle(document.body);
  const v = cs.getPropertyValue(name);
  return v && v.trim().length ? v.trim() : fallback;
}

function scenarioColor(kind) {
  if (kind === "honey") return getCSSVar("--accent", "#5ac8fa");
  if (kind === "dmso") return getCSSVar("--yellow", "#ffd60a");
  return getCSSVar("--green", "#34c759"); // hexane
}

function applyIMFCoeffsFor(sim, kind) {
  const v = Math.max(0, Number(sim.params.viscosity || 0));
  if (kind === "honey") {
    sim.params.hbStrength = 1.6 * v; // scale HB with viscosity
    sim.params.dipole = 0.0;
    sim.params.cohLJ = 1.0 + 0.6 * v;
    sim.params.cohHB = 1.2 + 0.8 * v;
    sim.params.cohDP = 1.0;
  } else if (kind === "dmso") {
    sim.params.hbStrength = 0.0;
    sim.params.dipole = 1.3 * v; // scale dipole with viscosity
    sim.params.cohLJ = 0.9 + 0.5 * v;
    sim.params.cohHB = 1.0;
    sim.params.cohDP = 1.1 + 0.7 * v;
  } else {
    sim.params.hbStrength = 0.0;
    sim.params.dipole = 0.0; // dispersion is in LJ via viscosity
    sim.params.cohLJ = 0.7 + 0.7 * v;
    sim.params.cohHB = 1.0;
    sim.params.cohDP = 1.0;
  }
}

export function mountIMFs(root) {
  // Build Shadow DOM host to isolate Harvard‑Westlake stylesheet
  const host = document.createElement("div");
  host.id = "imfs-host";
  root.innerHTML = "";
  root.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });

  // Load HW stylesheet inside shadow
  const IMFSCSS_HREF = "https://learnhw.web.app/assets/index-DGT0gdx8.css";
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = IMFSCSS_HREF;
  shadow.appendChild(link);

  // IMFs local shim styles for sizing and rounding
  const shim = document.createElement("style");
  shim.textContent = `
    .imfs-shell { padding: 12px 0; }
    .imfs-wrap { display: grid; grid-template-columns: 400px 1fr; gap: 16px; }
    @media (max-width: 1100px) { .imfs-wrap { grid-template-columns: 1fr; } }
    .imfs-sim { width: 100%; height: 420px; display: block; border-radius: 12px; background: #ffffff; overflow: hidden; }
    .imfs-3d { width: 100%; height: 280px; min-height: 200px; border-radius: 12px; background: #ffffff; overflow: hidden; position: relative; }
    .imfs-ke { width: 100%; height: 80px; background: #ffffff; border: 1px solid #d1d5db; border-radius: 12px; display: block; }
    /* removed thermostat box */
    /* Ensure molecule strokes and labels are visible on light background */
    #imfs-mol line { stroke: #0e1116; stroke-width: 3px; }
    #imfs-mol text { fill: #0e1116; }
    /* Scenario buttons with yellow hover + glow */
    .scenario { background: #ffffff; color: #111827; border: 1px solid #d1d5db; }
    .scenario:hover { border-color: #ffd60a; background: #fff7cc; box-shadow: 0 0 0 2px #ffd60a inset, 0 0 12px rgba(255,214,10,0.55); }
    .scenario.is-active { border-color: #ffd60a; background: #fff7cc; box-shadow: 0 0 0 2px #ffd60a inset, 0 0 16px rgba(255,214,10,0.66); }
    /* Molecule/3D panels glow with scenario accent */
    .imfs-shell[data-kind] .imfs-mol, .imfs-shell[data-kind] .imfs-3d { box-shadow: 0 0 0 2px var(--imfs-accent, #ffd60a) inset, 0 0 16px color-mix(in srgb, var(--imfs-accent, #ffd60a) 55%, transparent); }
    /* High-contrast overrides inside Shadow DOM (HW red CTAs) */
    .imfs-shell .panel { background: #ffffff; color: #0e1116; border: 1px solid #d1d5db; }
    .imfs-shell .muted { color: #4b5563; }
    .imfs-shell .label { color: #111827; font-weight: 600; }
    .imfs-shell .btn { background: #dc2626; color: #ffffff; border: 1px solid #dc2626; }
    .imfs-shell .btn:hover { background: #b91c1c; border-color: #b91c1c; }
    .imfs-shell .btn.btn--outline { background: transparent; color: #b91c1c; border: 1px solid #dc2626; }
    .imfs-shell .btn.btn--outline:hover { background: #fee2e2; }
    .imfs-shell .btn.btn--ghost { background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; }
    .imfs-shell .btn:focus-visible { outline: 3px solid #ef4444; outline-offset: 2px; }
    .imfs-shell .range { accent-color: #dc2626; }
    .stack-sm { display: grid; gap: 8px; }
    .row { display: grid; gap: 8px; }
    .row.controls { display: flex; flex-wrap: wrap; gap: 8px; }
  `;
  shadow.appendChild(shim);

  // Build HW-styled markup while preserving element IDs for logic
  const shell = document.createElement("div");
  shell.className = "container container--wide imfs-shell";
  shell.innerHTML = `
    <section class="panel">
      <h2 class="h5 eyebrow">IMFs: Intermolecular Forces Playground</h2>
      <p class="muted">Explore hydrogen bonding, dipole–dipole, and dispersion using a particle-level sandbox with molecule close-ups for context.</p>
    </section>
    <section class="panel">
      <div class="imfs-wrap">
        <div class="panel">
          <h3 class="h5" style="margin-top:0;">Intermolecular Forces</h3>
          <div class="row controls" style="margin-bottom:8px;">
            <button id="b-honey" class="btn scenario">Honey (H-bond)</button>
            <button id="b-dmso" class="btn scenario">DMSO (dipole)</button>
            <button id="b-hexane" class="btn scenario">Hexane (dispersion)</button>
          </div>
          <div class="row controls" style="margin-bottom:8px;">
            <button id="t-gravity" class="btn btn--outline">Gravity</button>
            <button id="t-contour" class="btn btn--outline">Contour</button>
            <button id="t-shade" class="btn btn--outline">Shade Contour</button>
            <button id="t-heat" class="btn btn--outline">Heat</button>
          </div>
          <div class="stack-sm">
            <div class="field"><label class="label">Temperature (kT)</label><input id="s-temp" class="range" type="range" min="0" max="3" step="0.05" value="1.00"><span class="muted" id="v-temp"></span></div>
            <div class="field"><label class="label">Viscosity (γ)</label><input id="s-visc" class="range" type="range" min="0" max="3" step="0.05" value="1.20"><span class="muted" id="v-visc"></span></div>
            <div class="field"><label class="label">Particles (N)</label><input id="s-n" class="range" type="range" min="40" max="220" step="5" value="120"><span class="muted" id="v-n"></span></div>
          </div>
          <div class="row controls" style="margin-top:8px;">
            <button id="b-play" class="btn">Play</button>
            <button id="b-pause" class="btn btn--outline">Pause</button>
            <button id="b-reset" class="btn btn--ghost">Reset</button>
          </div>
          <div class="caption muted" style="margin-top:8px;">Tip: Try higher viscosity for honey to feel the H-bond network.</div>
          <div class="muted" style="margin-top:10px;" id="explain"></div>
        </div>
        <div class="stack-sm">
          <canvas id="imfs-sim" class="imfs-sim" width="900" height="420" aria-label="Intermolecular forces simulation" role="img"></canvas>
          <div id="imfs-3d" class="imfs-3d" aria-label="3D molecule" role="img"></div>
          <canvas id="imfs-ke" class="imfs-ke" height="80" aria-label="Kinetic energy chart" role="img"></canvas>
        </div>
      </div>
    </section>
  `;
  shadow.appendChild(shell);

  const refs = {
    sim: shadow.querySelector("#imfs-sim"),
    mol: shadow.querySelector("#imfs-mol"),
    mol3d: shadow.querySelector("#imfs-3d"),
    bHoney: shadow.querySelector("#b-honey"),
    bDmso: shadow.querySelector("#b-dmso"),
    bHex: shadow.querySelector("#b-hexane"),
    sTemp: shadow.querySelector("#s-temp"),
    sVisc: shadow.querySelector("#s-visc"),
    sN: shadow.querySelector("#s-n"),
    vTemp: shadow.querySelector("#v-temp"),
    vVisc: shadow.querySelector("#v-visc"),
    vN: shadow.querySelector("#v-n"),
    explain: shadow.querySelector("#explain"),
    tGravity: shadow.querySelector("#t-gravity"),
    tContour: shadow.querySelector("#t-contour"),
    tShade: shadow.querySelector("#t-shade"),
    tHeat: shadow.querySelector("#t-heat"),
    // no thermostat box; KE is graphed below
  };

  const sim = new IMFSim(refs.sim);
  // 3Dmol viewer setup
  let viewer = null;
  let themeObserver = null;
  async function ensureViewer() {
    if (viewer || !refs.mol3d) return viewer;
    if (!window.$3Dmol) return null;
    const bg = getComputedStyle(refs.mol3d).backgroundColor || "#ffffff";
    viewer = $3Dmol.createViewer(refs.mol3d, { backgroundColor: bg.trim() });
    themeObserver = new MutationObserver(() => {
      const newBg = getComputedStyle(refs.mol3d).backgroundColor || "#ffffff";
      try {
        viewer.setBackgroundColor(newBg.trim());
        viewer.render();
      } catch (_) {}
    });
    themeObserver.observe(refs.mol3d, { attributes: true });
    return viewer;
  }
  async function fetchSDFByCID(cid) {
    const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/SDF?record_type=3d`;
    try {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error(String(res.status));
      const text = await res.text();
      if (!text || text.length < 10) throw new Error("Empty SDF");
      return text;
    } catch (_) {
      return null;
    }
  }
  const SDF_FALLBACK = {
    679: `
  DMSO
  3Dmol

  8  7  0  0  0  0            999 V2000
    0.0000   0.0000   0.0000 S   0  0  0  0  0  0
    1.4300   0.0000   0.0000 O   0  0  0  0  0  0
   -0.5400   1.2000   0.8000 C   0  0  0  0  0  0
   -0.5400  -1.2000  -0.8000 C   0  0  0  0  0  0
   -1.5400   1.9000   0.4000 H   0  0  0  0  0  0
    0.1600   1.8000   1.6000 H   0  0  0  0  0  0
   -0.0400   1.4000  -0.1000 H   0  0  0  0  0  0
   -1.5400  -1.9000  -0.4000 H   0  0  0  0  0  0
  1  2  2  0  0  0  0
  1  3  1  0  0  0  0
  1  4  1  0  0  0  0
  3  5  1  0  0  0  0
  3  6  1  0  0  0  0
  3  7  1  0  0  0  0
  4  8  1  0  0  0  0
M  END
`,
    8058: `
  HEXANE
  3Dmol

  20 19  0  0  0  0            999 V2000
   -2.0000   0.0000   0.0000 C   0  0  0  0  0  0
   -1.0000   0.8000   0.8000 C   0  0  0  0  0  0
    0.0000   0.0000   0.0000 C   0  0  0  0  0  0
    1.0000   0.8000   0.8000 C   0  0  0  0  0  0
    2.0000   0.0000   0.0000 C   0  0  0  0  0  0
    3.0000   0.8000   0.8000 C   0  0  0  0  0  0
   -2.6000  -0.9000   0.4000 H   0  0  0  0  0  0
   -2.6000   0.9000  -0.4000 H   0  0  0  0  0  0
   -1.4000   1.7000   0.2000 H   0  0  0  0  0  0
   -1.4000   0.3000   1.7000 H   0  0  0  0  0  0
    0.4000   0.9000  -0.8000 H   0  0  0  0  0  0
   -0.4000  -0.9000  -0.8000 H   0  0  0  0  0  0
    0.6000   1.7000   1.6000 H   0  0  0  0  0  0
    1.4000   0.3000   1.7000 H   0  0  0  0  0  0
    2.4000   0.9000  -0.8000 H   0  0  0  0  0  0
    1.6000  -0.9000  -0.8000 H   0  0  0  0  0  0
    3.6000   1.7000   0.2000 H   0  0  0  0  0  0
    3.6000   0.3000   1.7000 H   0  0  0  0  0  0
    3.4000   0.0000   0.0000 H   0  0  0  0  0  0
    2.6000  -0.9000  -0.8000 H   0  0  0  0  0  0
  1  2  1  0  0  0  0
  2  3  1  0  0  0  0
  3  4  1  0  0  0  0
  4  5  1  0  0  0  0
  5  6  1  0  0  0  0
  1  7  1  0  0  0  0
  1  8  1  0  0  0  0
  2  9  1  0  0  0  0
  2 10  1  0  0  0  0
  3 11  1  0  0  0  0
  3 12  1  0  0  0  0
  4 13  1  0  0  0  0
  4 14  1  0  0  0  0
  5 15  1  0  0  0  0
  5 16  1  0  0  0  0
  6 17  1  0  0  0  0
  6 18  1  0  0  0  0
  6 19  1  0  0  0  0
M  END
`,
  };
  async function load3DByCID(cid) {
    const v = await ensureViewer();
    if (!v) return;
    try {
      v.clear();
    } catch (_) {}
    let sdf = await fetchSDFByCID(cid);
    if (!sdf && SDF_FALLBACK[cid]) sdf = SDF_FALLBACK[cid];
    if (sdf) {
      v.addModel(sdf, "sdf");
      v.setStyle(
        {},
        { stick: { colorscheme: "Jmol" }, sphere: { scale: 0.25 } }
      );
      v.zoomTo();
      v.render();
    }
  }
  function choosePreviewCID(kind) {
    if (kind === "dmso") return 679;
    if (kind === "hexane") return 8058;
    const ids = [5793, 5984, 962];
    const key = "imfs_honey3d_idx";
    let idx = 0;
    try {
      idx = (parseInt(localStorage.getItem(key) || "0", 10) || 0) + 1;
    } catch (_) {}
    idx = idx % ids.length;
    try {
      localStorage.setItem(key, String(idx));
    } catch (_) {}
    return ids[idx];
  }

  function updateReadouts() {
    refs.vTemp.textContent = String(sim.params.kT.toFixed(2));
    refs.vVisc.textContent = String(sim.params.viscosity.toFixed(2));
    refs.vN.textContent = String(sim.params.N);
    // KE readout is updated via animation loop
  }

  let currentKind = "honey";
  // Removed 3D mode

  function setScenario(kind) {
    sim.changeScenario(kind);
    const accent = scenarioColor(kind);
    sim.params.color = accent;
    applyIMFCoeffsFor(sim, kind);
    // Update shell dataset and CSS var for accent glow
    try {
      const rootShell = shadow.querySelector(".imfs-shell");
      if (rootShell) {
        rootShell.dataset.kind = kind;
        rootShell.style.setProperty("--imfs-accent", accent);
      }
    } catch (_) {}
    // Toggle active state on scenario buttons
    try {
      [refs.bHoney, refs.bDmso, refs.bHex].forEach(
        (btn) => btn && btn.classList.remove("is-active")
      );
      if (kind === "honey" && refs.bHoney)
        refs.bHoney.classList.add("is-active");
      if (kind === "dmso" && refs.bDmso) refs.bDmso.classList.add("is-active");
      if (kind === "hexane" && refs.bHex) refs.bHex.classList.add("is-active");
    } catch (_) {}
    if (kind === "honey") {
      if (refs.mol)
        renderMolecule(refs.mol, molecules.honeyDuo(), {
          scale: 1.0,
          stroke: accent,
          labelColor: accent,
        });
      refs.explain.innerHTML = `Multiple –OH groups on sugars act as donors/acceptors, forming a transient hydrogen-bond network with water. This network raises cohesion and viscosity.`;
      // No 3D viewer
    } else if (kind === "dmso") {
      if (refs.mol)
        renderMolecule(refs.mol, molecules.dmso(), {
          scale: 1.0,
          stroke: accent,
          labelColor: accent,
        });
      refs.explain.innerHTML = `Dimethyl sulfoxide has a strong S=O dipole (δ− on O, δ+ on S). Molecules align anti-parallel, producing significant dipole–dipole attraction.`;
      // No 3D viewer
    } else {
      if (refs.mol)
        renderMolecule(refs.mol, molecules.hexane(), {
          scale: 1.0,
          stroke: accent,
          labelColor: accent,
        });
      refs.explain.innerHTML = `Hexane is nonpolar; only London dispersion occurs. Attractions are weakest, giving low cohesion and viscosity.`;
      // No 3D viewer
    }
    updateReadouts();
    currentKind = kind;
    // Update ball-and-stick 3D preview (3Dmol)
    try {
      const cid = choosePreviewCID(kind);
      load3DByCID(cid);
    } catch (_) {}
  }

  // Events
  refs.bHoney.addEventListener("click", () => setScenario("honey"));
  refs.bDmso.addEventListener("click", () => setScenario("dmso"));
  refs.bHex.addEventListener("click", () => setScenario("hexane"));
  refs.sTemp.addEventListener("input", (e) => {
    sim.params.kT = Number(e.target.value);
    updateReadouts();
  });
  refs.sVisc.addEventListener("input", (e) => {
    sim.params.viscosity = Number(e.target.value);
    applyIMFCoeffsFor(sim, currentKind);
    updateReadouts();
  });
  refs.sN.addEventListener("input", (e) => {
    sim.params.N = Math.round(Number(e.target.value));
    sim.adjustParticleCount(sim.params.N);
    updateReadouts();
  });
  shadow.querySelector("#b-play").addEventListener("click", () => sim.start());
  shadow.querySelector("#b-pause").addEventListener("click", () => sim.stop());
  shadow.querySelector("#b-reset").addEventListener("click", () => {
    sim.spawnParticles();
    sim.draw();
  });

  // New toggles: Gravity, Contour, Shade Contour
  if (refs.tGravity)
    refs.tGravity.addEventListener("click", () => {
      sim.gravityOn = !sim.gravityOn;
      refs.tGravity.classList.toggle("is-active", sim.gravityOn);
    });
  if (refs.tContour)
    refs.tContour.addEventListener("click", () => {
      sim.contourOn = !sim.contourOn;
      refs.tContour.classList.toggle("is-active", sim.contourOn);
    });
  if (refs.tShade)
    refs.tShade.addEventListener("click", () => {
      sim.shadeContour = !sim.shadeContour;
      refs.tShade.classList.toggle("is-active", sim.shadeContour);
    });
  if (refs.tHeat)
    refs.tHeat.addEventListener("click", () => {
      sim.heatingOn = !sim.heatingOn;
      refs.tHeat.classList.toggle("is-active", sim.heatingOn);
    });

  // (Removed 2D/3D toggle handlers)

  // Init
  setScenario("honey");
  sim.params.color = scenarioColor("honey");
  sim.draw();
  sim.start();
  // Attach KE graph canvas to sim
  try {
    const keCanvas = shadow.querySelector("#imfs-ke");
    if (keCanvas && typeof sim.setKECanvas === "function")
      sim.setKECanvas(keCanvas);
  } catch (_) {}
  // Initialize 3D viewer with current scenario
  try {
    const cid = choosePreviewCID("honey");
    load3DByCID(cid);
  } catch (_) {}

  return () => {
    sim.destroy();
    try {
      if (themeObserver) themeObserver.disconnect();
    } catch (_) {}
    try {
      if (viewer) {
        viewer.clear();
        viewer = null;
      }
    } catch (_) {}
    try {
      const h = root.querySelector("#imfs-host");
      if (h && h.parentNode) h.parentNode.removeChild(h);
    } catch (_) {}
  };
}
