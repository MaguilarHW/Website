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
    const { epsilon, sigma } = this.params;
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
    for (let i = 0; i < this.particles.length; i++)
      this.particles[i].acc = [0, 0];
    for (let i = 0; i < this.particles.length; i++) {
      const a = this.particles[i];
      const ax = a.pos[0];
      const ay = a.pos[1];
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
        const fLJ = this.ljForce(rVec);
        const fHB = this.hbForce(rVec);
        const fDP = this.dipoleForce(rVec);
        const f = vAdd(vAdd(fLJ, fHB), fDP);
        a.acc = vAdd(a.acc, f);
      });
    }
    // Drag + thermostat
    const gamma = clamp(this.params.viscosity, 0, 4);
    const kick = this.params.kT * 2.0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.acc[0] += -gamma * p.vel[0] + randRange(-kick, kick);
      p.acc[1] += -gamma * p.vel[1] + randRange(-kick, kick);
    }
  }

  step(dt) {
    // Verlet-like integration
    this.computeForces(dt);
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.vel[0] += (p.acc[0] / p.mass) * dt;
      p.vel[1] += (p.acc[1] / p.mass) * dt;
      p.pos[0] += p.vel[0] * dt;
      p.pos[1] += p.vel[1] * dt;
      this.wrap(p);
    }
  }

  draw() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    ctx.clearRect(0, 0, w, h);
    // Background
    ctx.fillStyle = "#0c121d";
    ctx.fillRect(0, 0, w, h);

    // Particles
    ctx.fillStyle = this.params.color || "#5ac8fa";
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      ctx.beginPath();
      ctx.arc(p.pos[0], p.pos[1], 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Overlay
    ctx.fillStyle = "#a9b4c2";
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto";
    ctx.fillText(this.params.label, 10, 18);
  }

  loop = (now) => {
    if (!this.running) return;
    const dt = clamp((now - this.lastMs) / 1000, 0, 0.033);
    this.lastMs = now;
    this.step(dt);
    this.draw();
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

// ---------------- Custom Element ----------------
class IMFSimElement extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.state = {
      scenario: "honey",
      paused: false,
      moleculesReady: false,
    };
  }

  connectedCallback() {
    this.render();
    this.mount();
  }
  disconnectedCallback() {
    this.cleanup?.();
  }

  setStyles(root) {
    const style = document.createElement("style");
    style.textContent = `
      :host { display: block; }
      .wrap { display: grid; gap: 16px; }
      @media (min-width: 1100px) {
        .wrap { grid-template-columns: 340px 1fr; align-items: start; }
      }
      .card { background: #0f1420; border: 1px solid #202838; border-radius: 14px; padding: 14px; box-shadow: 0 8px 28px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04); }
      .card h3 { margin: 0 0 10px 0; font-size: 15px; color: #e9eef5; }
      .controls { display:flex; flex-wrap:wrap; gap:8px; }
      button { appearance:none; border:1px solid #2a3241; background:#152030; color:#e9eef5; border-radius:10px; padding:10px 12px; font-size:14px; cursor:pointer; transition:background .2s ease, transform .06s ease; }
      button:hover { background:#1a283d; }
      button.primary { background:#123042; border-color:#28465a; color:#d8f1ff; }
      button.success { background:#0e2e1a; border-color:#1c4a2b; color:#dbffe6; }
      button.danger { background:#3a1518; border-color:#562229; color:#ffd7dc; }
      .field { display:grid; gap:6px; }
      label { color:#a9b4c2; font-size:12px; }
      input[type="range"] { width: 100%; }
      input[type="range"], input[type="number"], select { background:#0b101a; border:1px solid #263247; color:#e9eef5; border-radius:10px; padding:10px 12px; font-size:14px; }
      .viz { display:grid; gap: 12px; }
      .molecule { width: 100%; height: 240px; background:#0c121d; border:1px solid #1e2738; border-radius:12px; display:block; }
      canvas.sim { width: 100%; height: 420px; display:block; background: linear-gradient(180deg, #0c121d 0%, #0a0f19 100%); border:1px solid #1e2738; border-radius:12px; }
      .muted { color:#a9b4c2; font-size: 13px; }
      .explain { font-size:14px; line-height:1.5; color:#dbe6f5; }
    `;
    root.appendChild(style);
  }

  render() {
    const root = this.shadowRoot;
    root.innerHTML = "";
    this.setStyles(root);

    const wrap = document.createElement("div");
    wrap.className = "wrap";

    const left = document.createElement("div");
    left.className = "card";
    left.innerHTML = `
      <h3>Intermolecular Forces</h3>
      <div class="controls" style="margin-bottom:8px;">
        <button id="b-honey" class="primary">Honey (H-bond)</button>
        <button id="b-dmso">DMSO (dipole)</button>
        <button id="b-hexane">Hexane (dispersion)</button>
      </div>
      <div class="field"><label>Temperature (kT)</label><input id="s-temp" type="range" min="0" max="3" step="0.05" value="1.00"><span class="muted" id="v-temp"></span></div>
      <div class="field"><label>Viscosity (γ)</label><input id="s-visc" type="range" min="0" max="3" step="0.05" value="1.20"><span class="muted" id="v-visc"></span></div>
      <div class="field"><label>Particles (N)</label><input id="s-n" type="range" min="40" max="220" step="5" value="120"><span class="muted" id="v-n"></span></div>
      <div class="controls" style="margin-top:8px;">
        <button id="b-play" class="success">Play</button>
        <button id="b-pause">Pause</button>
        <button id="b-reset" class="danger">Reset</button>
      </div>
      <div class="explain" style="margin-top:10px;">
        <div id="explain"></div>
      </div>
    `;

    const right = document.createElement("div");
    right.className = "viz";
    right.innerHTML = `
      <canvas id="sim" class="sim" width="900" height="420" aria-label="Intermolecular forces simulation" role="img"></canvas>
      <svg id="mol" class="molecule" viewBox="0 0 900 240" aria-label="Molecule close-up" role="img"></svg>
    `;

    wrap.appendChild(left);
    wrap.appendChild(right);
    root.appendChild(wrap);

    // cache refs
    this.refs = {
      sim: right.querySelector("#sim"),
      mol: right.querySelector("#mol"),
      bHoney: left.querySelector("#b-honey"),
      bDmso: left.querySelector("#b-dmso"),
      bHex: left.querySelector("#b-hexane"),
      sTemp: left.querySelector("#s-temp"),
      sVisc: left.querySelector("#s-visc"),
      sN: left.querySelector("#s-n"),
      vTemp: left.querySelector("#v-temp"),
      vVisc: left.querySelector("#v-visc"),
      vN: left.querySelector("#v-n"),
      bPlay: left.querySelector("#b-play"),
      bPause: left.querySelector("#b-pause"),
      bReset: left.querySelector("#b-reset"),
      explain: left.querySelector("#explain"),
    };
  }

  mount() {
    const sim = new IMFSim(this.refs.sim);
    this.sim = sim;
    const updateReadouts = () => {
      this.refs.vTemp.textContent = String(sim.params.kT.toFixed(2));
      this.refs.vVisc.textContent = String(sim.params.viscosity.toFixed(2));
      this.refs.vN.textContent = String(sim.params.N);
    };
    const setScenario = (s) => {
      this.state.scenario = s;
      sim.changeScenario(s);
      this.updateExplainer();
      if (s === "honey") {
        // Show glucose + fructose side-by-side in the same SVG
        renderMolecule(this.refs.mol, molecules.honeyDuo(), { scale: 1.0 });
      } else if (s === "dmso") {
        renderMolecule(this.refs.mol, molecules.dmso(), { scale: 1.0 });
      } else {
        renderMolecule(this.refs.mol, molecules.hexane(), { scale: 1.0 });
      }
      updateReadouts();
    };
    // controls
    this.refs.bHoney.addEventListener("click", () => setScenario("honey"));
    this.refs.bDmso.addEventListener("click", () => setScenario("dmso"));
    this.refs.bHex.addEventListener("click", () => setScenario("hexane"));
    this.refs.sTemp.addEventListener("input", (e) => {
      sim.params.kT = Number(e.target.value);
      updateReadouts();
    });
    this.refs.sVisc.addEventListener("input", (e) => {
      sim.params.viscosity = Number(e.target.value);
      updateReadouts();
    });
    this.refs.sN.addEventListener("input", (e) => {
      sim.params.N = Math.round(Number(e.target.value));
      sim.spawnParticles();
      updateReadouts();
    });
    this.refs.bPlay.addEventListener("click", () => sim.start());
    this.refs.bPause.addEventListener("click", () => sim.stop());
    this.refs.bReset.addEventListener("click", () => {
      sim.spawnParticles();
      sim.draw();
    });

    // initial state
    setScenario("honey");
    sim.draw();
    sim.start();

    this.cleanup = () => {
      sim.destroy();
    };
  }

  updateExplainer() {
    const s = this.state.scenario;
    const el = this.refs.explain;
    if (s === "honey") {
      el.innerHTML = `Multiple –OH groups on sugars act as donors/acceptors, forming a transient hydrogen-bond network with water. This network raises cohesion and viscosity.`;
    } else if (s === "dmso") {
      el.innerHTML = `Dimethyl sulfoxide has a strong S=O dipole (δ− on O, δ+ on S). Molecules align anti-parallel, producing significant dipole–dipole attraction.`;
    } else {
      el.innerHTML = `Hexane is nonpolar; only London dispersion occurs. Attractions are weakest, giving low cohesion and viscosity.`;
    }
  }
}

customElements.define("imf-sim", IMFSimElement);

export function mountIMFs(root) {
  root.innerHTML = `
    <section class="panel narrow">
      <h2 class="section-title">IMFs: Intermolecular Forces Playground</h2>
      <p class="muted">Explore hydrogen bonding, dipole–dipole, and dispersion using a particle-level sandbox with molecule close-ups for context.</p>
    </section>
    <section class="panel">
      <imf-sim></imf-sim>
    </section>
  `;
  const el = root.querySelector("imf-sim");
  return () => {
    el?.cleanup?.();
  };
}
