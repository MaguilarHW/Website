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
    // Clamp to valid grid bounds (no wrapping)
    const cx = Math.max(
      0,
      Math.min(this.cols - 1, Math.floor(x / this.cellSize))
    );
    const cy = Math.max(
      0,
      Math.min(this.rows - 1, Math.floor(y / this.cellSize))
    );
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
        if (cx < 0 || cx >= this.cols || cy < 0 || cy >= this.rows) continue;
        const ix = cx;
        const iy = cy;
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
    radius: 3, // Reduced by 50% from 6
    state: "liquid",
    gasUntil: 0,
    localNeighbors: 0,
    thermalEnergy: 0, // 0-1, accumulates when heated
    lastStateChange: 0, // timestamp of last state change
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
    this.gravityOn = true;
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
    // disabled; using wall collisions instead
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
        let dx = b.pos[0] - ax;
        let dy = b.pos[1] - ay;
        const rVec = [dx, dy];
        const dist = Math.hypot(dx, dy);
        if (dist < densityCut) a.localNeighbors++;
        // Strengthen liquid-liquid interactions, weaken gas interactions
        const bothLiquid = a.state === "liquid" && b.state === "liquid";
        const gasScale = a.state === "gas" || b.state === "gas" ? 0.2 : 1.0;
        const liquidCohesionBoost = bothLiquid ? 1.3 : 1.0; // 30% stronger for liquid-liquid

        const fLJ = vMul(
          this.ljForce(rVec),
          (this.params.cohLJ || 1) * liquidCohesionBoost
        );
        const fHB = vMul(
          this.hbForce(rVec),
          (this.params.cohHB || 1) * liquidCohesionBoost
        );
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
    // Skip dense liquid particles to preserve blob structure
    const nowT = performance.now();
    if (!this.lastThermoMs) this.lastThermoMs = nowT;
    if (nowT - this.lastThermoMs > 500) {
      let keSum = 0;
      let count = 0;
      const rhoMin = 3; // Same threshold as state transitions

      // Only consider non-dense particles for thermostat
      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        // Skip particles in dense liquid blob (they maintain their own dynamics)
        if (p.localNeighbors < rhoMin || p.state === "gas") {
          keSum +=
            0.5 * (p.mass || 1) * (p.vel[0] * p.vel[0] + p.vel[1] * p.vel[1]);
          count++;
        }
      }

      if (count > 0) {
        const keAvg = keSum / count;
        const keTarget = 40 * (kT + 0.05);
        const s = Math.max(
          0.9,
          Math.min(
            1.1,
            Math.sqrt(Math.max(1e-6, keTarget / Math.max(1e-6, keAvg)))
          )
        );
        if (Math.abs(s - 1) > 0.02) {
          // Only rescale non-dense particles
          for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            if (p.localNeighbors < rhoMin || p.state === "gas") {
              p.vel[0] *= s;
              p.vel[1] *= s;
            }
          }
        }
      }
      this.lastThermoMs = nowT;
    }
  }

  step(dt) {
    let substeps = 1;
    if (this.gravityOn) {
      let maxSpeed = 0;
      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        const sp = Math.hypot(p.vel[0], p.vel[1]);
        if (sp > maxSpeed) maxSpeed = sp;
      }
      const minR = 0.5 * (this.particles[0]?.radius || 3);
      const safeDisp = Math.max(2, minR); // pixels
      substeps = Math.min(
        12,
        Math.max(2, Math.ceil((maxSpeed * dt) / safeDisp))
      );
    }
    const dtStep = dt / substeps;
    for (let s = 0; s < substeps; s++) {
      // Forces
      this.computeForces(dtStep);
      // Gravity
      if (this.gravityOn) {
        const g = 900;
        for (let i = 0; i < this.particles.length; i++)
          this.particles[i].acc[1] += g;
      }
      // Heating (bottom 10% of container with gradient - stovetop simulation)
      if (this.heatingOn) {
        const aH = this.heatAccel;
        const heatingZoneHeight = this.height * 0.1; // bottom 10% of container
        const heatingZoneTop = this.height - heatingZoneHeight;
        const minHeatIntensity = 0.2; // 20% heat at the 10% mark (top of heating zone)
        const thermalGainRate = 0.03; // Reduced from 0.1 - slower, more realistic heating rate per second
        const thermalDissipationRate = 0.015; // Rate per second for dissipation

        // Create non-uniform heating pattern along X-axis (hotspots like real stovetop)
        // Use multiple hotspots with varying intensities
        const hotspotCount = 3; // Number of hotspots
        const hotspotSpacing = this.width / (hotspotCount + 1);

        for (let i = 0; i < this.particles.length; i++) {
          const p = this.particles[i];
          // Ensure thermalEnergy is initialized
          if (p.thermalEnergy === undefined) p.thermalEnergy = 0;

          const r = p.radius || 3;
          const particleBottom = p.pos[1] + r; // bottom edge of particle
          const particleX = p.pos[0]; // X position for hotspot calculation

          // Only heat particles in the bottom 10% of container
          if (particleBottom >= heatingZoneTop) {
            // Calculate normalized position in heating zone (0 = very bottom, 1 = 10% mark)
            const distFromBottom = this.height - particleBottom;
            const normalizedDist = Math.max(
              0,
              Math.min(1, distFromBottom / heatingZoneHeight)
            );

            // Vertical gradient: 100% heat at bottom, minHeatIntensity at 10% mark
            const verticalIntensity =
              1.0 - normalizedDist * (1.0 - minHeatIntensity);

            // Calculate horizontal hotspot intensity (non-uniform along X-axis)
            // Use smooth falloff to reduce visual artifacts
            let horizontalIntensity = 0.3; // Base intensity (minimum)
            let totalHotspotContribution = 0;
            let weightedStrength = 0;

            // Check distance to each hotspot and accumulate contributions smoothly
            for (let h = 0; h < hotspotCount; h++) {
              const hotspotX = hotspotSpacing * (h + 1);
              const distToHotspot = Math.abs(particleX - hotspotX);
              const hotspotRadius = this.width * 0.15; // Hotspot influence radius

              // Smooth exponential falloff (squared for smoother transition)
              const normalizedDist = distToHotspot / hotspotRadius;
              const hotspotIntensity = Math.max(
                0,
                Math.pow(1.0 - Math.min(1.0, normalizedDist), 2)
              );

              if (hotspotIntensity > 0) {
                const hotspotStrengths = [1.0, 0.85, 0.7];
                const hotspotStrength = hotspotStrengths[h] || 1.0;
                totalHotspotContribution += hotspotIntensity;
                weightedStrength += hotspotIntensity * hotspotStrength;
              }
            }

            // Blend hotspot contributions smoothly
            const avgHotspotStrength =
              totalHotspotContribution > 0
                ? weightedStrength / totalHotspotContribution
                : 0.7; // Default if no hotspots

            // Combine horizontal and vertical intensity with smooth blending
            horizontalIntensity =
              0.3 + totalHotspotContribution * 0.7 * avgHotspotStrength;
            const heatIntensity = verticalIntensity * horizontalIntensity;

            // Accumulate thermal energy based on heat intensity
            // Scale by dtStep to make it frame-rate independent (rate per second)
            const thermalGain = thermalGainRate * heatIntensity * dtStep;
            p.thermalEnergy = Math.min(
              1.0,
              (p.thermalEnergy || 0) + thermalGain
            );

            // Add upward acceleration for heated particles (buoyancy effect)
            // Heated particles naturally want to rise - use acceleration to overcome gravity
            // Thermal energy provides upward force that opposes gravity
            // At thermalEnergy = 0.4, upwardAccel = -1600, which overcomes gravity (900)
            const upwardAccel = p.thermalEnergy * -2000; // Negative Y = upward, strong enough to overcome gravity
            p.acc[1] += upwardAccel;

            // Also add some direct upward velocity boost for immediate effect
            if (p.thermalEnergy > 0.2) {
              const upwardVelocityBoost = p.thermalEnergy * -40; // Additional upward boost
              p.vel[1] += upwardVelocityBoost * dtStep;
            }

            // Add vibration: particles with high thermal energy vibrate more
            // This helps them break free from cohesive forces
            // Increased strength for visibility - vibration scales with thermal energy
            const vibrationStrength = p.thermalEnergy * 120; // Increased from 30 for visibility
            const vibrationX = (Math.random() - 0.5) * vibrationStrength;
            const vibrationY = (Math.random() - 0.5) * vibrationStrength;
            p.acc[0] += vibrationX;
            p.acc[1] += vibrationY;

            // Apply heating scaled by intensity
            const scaledAccel = aH * heatIntensity;
            const vx = p.vel[0],
              vy = p.vel[1];
            const sp = Math.hypot(vx, vy);
            if (sp > 1e-3) {
              p.acc[0] += (vx / sp) * scaledAccel;
              p.acc[1] += (vy / sp) * scaledAccel;
            } else {
              const ang = Math.random() * Math.PI * 2;
              p.acc[0] += Math.cos(ang) * scaledAccel;
              p.acc[1] += Math.sin(ang) * scaledAccel;
            }
          } else {
            // Dissipate thermal energy when not in heating zone
            // Scale by dtStep to make it frame-rate independent
            p.thermalEnergy = Math.max(
              0,
              (p.thermalEnergy || 0) - thermalDissipationRate * dtStep
            );
            // Particles with thermal energy still vibrate (they carry heat with them)
            if (p.thermalEnergy > 0.1) {
              // Add upward acceleration for particles carrying thermal energy
              const upwardAccel = p.thermalEnergy * -1800; // Slightly less than in heating zone
              p.acc[1] += upwardAccel;

              // Also add upward velocity boost for immediate effect
              if (p.thermalEnergy > 0.2) {
                const upwardVelocityBoost = p.thermalEnergy * -35;
                p.vel[1] += upwardVelocityBoost * dtStep;
              }

              const vibrationStrength = p.thermalEnergy * 80; // Increased from 20 for visibility
              const vibrationX = (Math.random() - 0.5) * vibrationStrength;
              const vibrationY = (Math.random() - 0.5) * vibrationStrength;
              p.acc[0] += vibrationX;
              p.acc[1] += vibrationY;
            }
          }
        }
      } else {
        // When heating is off, gradually dissipate thermal energy
        const thermalDissipationRate = 0.02; // Rate per second (matches heating dissipation)
        for (let i = 0; i < this.particles.length; i++) {
          const p = this.particles[i];
          // Ensure thermalEnergy is initialized
          if (p.thermalEnergy === undefined) p.thermalEnergy = 0;
          p.thermalEnergy = Math.max(
            0,
            (p.thermalEnergy || 0) - thermalDissipationRate * dtStep
          );
        }
      }
      // Buoyancy (reduced for more realistic behavior)
      if (this.gravityOn) {
        for (let i = 0; i < this.particles.length; i++) {
          const p = this.particles[i];
          if (p.state === "gas") p.acc[1] -= 300; // Reduced from 600
        }
      }
      // Integrate
      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        p.vel[0] += (p.acc[0] / p.mass) * dtStep;
        p.vel[1] += (p.acc[1] / p.mass) * dtStep;
        p.pos[0] += p.vel[0] * dtStep;
        p.pos[1] += p.vel[1] * dtStep;

        // Add direct velocity vibration for heated particles (more visible)
        // This creates the jittery vibration effect
        const thermalEnergy = p.thermalEnergy || 0;
        if (thermalEnergy > 0.1) {
          // Frame-independent vibration - scales with thermal energy
          const vibVelStrength = thermalEnergy * 8; // Velocity units per frame
          p.vel[0] += (Math.random() - 0.5) * vibVelStrength;
          p.vel[1] += (Math.random() - 0.5) * vibVelStrength;
        }

        this.handleWalls(p);
      }
      // Collisions iterations
      for (let it = 0; it < 5; it++) {
        this.resolveCollisions();
        // Re-clamp particles to walls after collision resolution
        // (collision resolution can push particles outside bounds)
        for (let i = 0; i < this.particles.length; i++) {
          this.handleWalls(this.particles[i]);
        }
      }
      // State update - boiling behavior with thermal energy and hysteresis
      const epsBase = 0.15 + 0.25 * (this.params.viscosity || 0);
      const c1 = 120,
        c2 = 10;
      const rhoMin = 3;
      const nowS = performance.now();
      const minStateDuration = 300; // Minimum time in state before transitioning (ms)

      // Higher energy threshold for escaping dense liquid (boiling)
      const escapeMultiplier = 1.5;
      const thermalBoilingThreshold = 0.4; // Lowered from 0.6 - thermal energy needed to boil

      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        const v2 = p.vel[0] * p.vel[0] + p.vel[1] * p.vel[1];
        const vGas2 = c1 * (this.params.kT || 0) + c2 * epsBase;
        const thermalEnergy = p.thermalEnergy || 0;
        const timeSinceStateChange = nowS - (p.lastStateChange || 0);

        if (p.state === "liquid") {
          // Require minimum time in liquid state before transitioning
          // But allow very hot particles to transition faster
          const hotParticle = thermalEnergy > 0.7;
          const effectiveMinDuration = hotParticle
            ? minStateDuration * 0.5
            : minStateDuration;
          if (timeSinceStateChange < effectiveMinDuration) continue;

          // Boiling: Need both high thermal energy AND high kinetic energy
          // Surface particles can evaporate more easily
          if (p.localNeighbors < rhoMin) {
            // Surface/edge particles: normal evaporation threshold
            const surfaceThreshold = vGas2 * 0.9; // Slightly easier than bulk
            if (v2 > surfaceThreshold && thermalEnergy > 0.2) {
              p.state = "gas";
              p.gasUntil = nowS + 1500;
              p.lastStateChange = nowS;
              // Give upward boost to help escape
              if (p.vel[1] < 50) {
                p.vel[1] -= 30;
              }
            }
          } else {
            // Dense liquid particles: need thermal energy + high kinetic energy to boil
            // Make kinetic energy threshold scale with thermal energy - hotter particles boil easier
            const baseEscapeThreshold = vGas2 * escapeMultiplier;
            // When thermal energy is high, reduce kinetic energy requirement
            const thermalBonus = thermalEnergy * 0.5; // Increased from 0.4 - up to 50% reduction
            const escapeThreshold = baseEscapeThreshold * (1.0 - thermalBonus);

            // Very hot particles can boil with lower kinetic energy
            const veryHotBonus = thermalEnergy > 0.7 ? 0.2 : 0; // Extra 20% reduction for very hot
            const finalThreshold = escapeThreshold * (1.0 - veryHotBonus);

            // Boiling requires accumulated thermal energy from heating
            if (
              v2 > finalThreshold &&
              thermalEnergy > thermalBoilingThreshold
            ) {
              p.state = "gas";
              p.gasUntil = nowS + 2000;
              p.lastStateChange = nowS;
              // Give upward boost to help escape the liquid blob
              if (p.vel[1] < 50) {
                p.vel[1] -= 40;
              }
            }
          }
        } else {
          // Gas particles: condense when they cool down
          // Require minimum time in gas state before transitioning back
          if (timeSinceStateChange < minStateDuration) continue;

          const isRising = p.vel[1] < -10; // Moving upward significantly
          const isNearTop = p.pos[1] < this.height * 0.2; // Top 20% of container

          // Condensation thresholds (hysteresis - harder to condense than evaporate)
          const condenseThreshold = isRising ? 0.3 * vGas2 : 0.5 * vGas2;
          const thermalCondenseThreshold = 0.2; // Cool down before condensing

          // Condense if: low energy, low thermal energy, high density (not rising), or reached top
          if (
            (v2 < condenseThreshold &&
              thermalEnergy < thermalCondenseThreshold &&
              !isRising) ||
            (isNearTop &&
              thermalEnergy < thermalCondenseThreshold &&
              v2 < 0.8 * vGas2) ||
            (p.localNeighbors >= rhoMin &&
              !isRising &&
              thermalEnergy < thermalCondenseThreshold)
          ) {
            p.state = "liquid";
            p.lastStateChange = nowS;
            // Reset thermal energy when condensing (unless still in heating zone)
            if (p.pos[1] + p.radius < this.height * 0.9) {
              p.thermalEnergy = Math.max(0, thermalEnergy * 0.5); // Reduce but don't fully reset
            }
          }
        }
      }
    }
  }

  handleWalls(p) {
    const w = this.width;
    const h = this.height;
    const r = p.radius || 3;
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
    const rMax = 16; // neighbor search radius (increased for safety)
    // rebuild neighbor grid for collision pass
    this.grid.clear();
    for (let i = 0; i < this.particles.length; i++)
      this.grid.insert(this.particles[i]);
    const e = 0.2; // restitution
    const mu = 0.3; // friction coefficient
    const processed = new Set(); // Track processed pairs to avoid double-counting
    for (let i = 0; i < this.particles.length; i++) {
      const a = this.particles[i];
      const ax = a.pos[0];
      const ay = a.pos[1];
      this.grid.forNeighbors(ax, ay, rMax, (b) => {
        if (a === b) return;
        // Find index of b
        let j = -1;
        for (let k = 0; k < this.particles.length; k++) {
          if (this.particles[k] === b) {
            j = k;
            break;
          }
        }
        if (j < 0) return; // Safety check
        // Avoid processing same pair twice (always use smaller index first)
        const pairKey = i < j ? `${i},${j}` : `${j},${i}`;
        if (processed.has(pairKey)) return;
        processed.add(pairKey);
        let dx = b.pos[0] - ax;
        let dy = b.pos[1] - ay;
        const dist = Math.hypot(dx, dy) || 1e-9;
        const minDist = (a.radius || 3) + (b.radius || 3);
        if (dist < minDist) {
          const nx = dx / dist;
          const ny = dy / dist;
          const overlap = minDist - dist;
          // position correction (split, but fully resolve per iteration)
          const invMa = 1 / (a.mass || 1);
          const invMb = 1 / (b.mass || 1);
          const invSum = invMa + invMb;
          let moveA = overlap * (invMa / Math.max(1e-9, invSum));
          let moveB = overlap * (invMb / Math.max(1e-9, invSum));
          // Shock propagation against floor: favor moving the non-grounded body
          const rA = a.radius || 3;
          const rB = b.radius || 3;
          const groundedA = a.pos[1] >= this.height - rA - 0.6;
          const groundedB = b.pos[1] >= this.height - rB - 0.6;
          // If pushing B further into floor (ny>0), don't move B; move A fully
          if (!groundedA && groundedB && ny > 0) {
            moveA = overlap;
            moveB = 0;
          }
          // If pushing A into floor (ny<0), don't move A; move B fully
          if (groundedA && !groundedB && ny < 0) {
            moveB = overlap;
            moveA = 0;
          }
          a.pos[0] -= nx * moveA;
          a.pos[1] -= ny * moveA;
          b.pos[0] += nx * moveB;
          b.pos[1] += ny * moveB;
          // Safety check: ensure minimum separation is maintained (handle floating point errors)
          const dx2 = b.pos[0] - a.pos[0];
          const dy2 = b.pos[1] - a.pos[1];
          const dist2 = Math.hypot(dx2, dy2) || 1e-9;
          if (dist2 < minDist * 0.99) {
            // Still overlapping, apply additional correction
            const overlap2 = minDist - dist2;
            const nx2 = dx2 / dist2;
            const ny2 = dy2 / dist2;
            a.pos[0] -= nx2 * overlap2 * 0.5;
            a.pos[1] -= ny2 * overlap2 * 0.5;
            b.pos[0] += nx2 * overlap2 * 0.5;
            b.pos[1] += ny2 * overlap2 * 0.5;
          }
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
            // friction impulse along tangent
            const rvx2 = b.vel[0] - a.vel[0];
            const rvy2 = b.vel[1] - a.vel[1];
            // tangent = rv - (rv·n) n
            let tx = rvx2 - (rvx2 * nx + rvy2 * ny) * nx;
            let ty = rvy2 - (rvx2 * nx + rvy2 * ny) * ny;
            const tl = Math.hypot(tx, ty);
            if (tl > 1e-6) {
              tx /= tl;
              ty /= tl;
              const jt = -mu * Math.abs(j);
              const jtx = jt * tx;
              const jty = jt * ty;
              a.vel[0] -= jtx / (a.mass || 1);
              a.vel[1] -= jty / (a.mass || 1);
              b.vel[0] += jtx / (b.mass || 1);
              b.vel[1] += jty / (b.mass || 1);
            }
            // Thermal conduction: transfer kinetic energy between particles
            // After collision, transfer a fraction of energy difference to simulate heat flow
            const ma = a.mass || 1;
            const mb = b.mass || 1;
            const keA = 0.5 * ma * (a.vel[0] * a.vel[0] + a.vel[1] * a.vel[1]);
            const keB = 0.5 * mb * (b.vel[0] * b.vel[0] + b.vel[1] * b.vel[1]);
            const keTotal = keA + keB;

            // Transfer coefficient: fraction of energy difference transferred per collision
            const transferCoeff = 0.15;
            const keDiff = keA - keB;
            const dE = transferCoeff * keDiff;

            // Only transfer if there's a meaningful energy difference and total KE is positive
            if (Math.abs(dE) > 0.1 && keTotal > 0.5) {
              const newKeA = Math.max(0.5, keA - dE);
              const newKeB = Math.max(0.5, keB + dE);

              // Calculate velocity magnitudes
              const vMagA = Math.hypot(a.vel[0], a.vel[1]);
              const vMagB = Math.hypot(b.vel[0], b.vel[1]);

              if (vMagA > 1e-6 && vMagB > 1e-6) {
                // Scale velocities to achieve target kinetic energies
                // This preserves direction while transferring energy
                const scaleA = Math.sqrt((2 * newKeA) / (ma * vMagA * vMagA));
                const scaleB = Math.sqrt((2 * newKeB) / (mb * vMagB * vMagB));

                // Apply scaling (small adjustments preserve momentum approximately)
                a.vel[0] *= scaleA;
                a.vel[1] *= scaleA;
                b.vel[0] *= scaleB;
                b.vel[1] *= scaleB;
              }
            }
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

    // Bottom heat source visual indicator (stovetop - bottom 10% with hotspots)
    if (this.heatingOn) {
      const gradientHeight = this.height * 0.1; // bottom 10% of container
      const hotspotCount = 3;
      const hotspotSpacing = w / (hotspotCount + 1);
      const hotspotStrengths = [1.0, 0.85, 0.7];

      // Draw hotspot pattern
      for (let hotspotIdx = 0; hotspotIdx < hotspotCount; hotspotIdx++) {
        const hotspotX = hotspotSpacing * (hotspotIdx + 1);
        const hotspotRadius = w * 0.15;
        const hotspotStrength = hotspotStrengths[hotspotIdx];

        // Create radial gradient for each hotspot
        const hotspotGradient = ctx.createRadialGradient(
          hotspotX,
          h,
          0, // center
          hotspotX,
          h,
          hotspotRadius // outer radius
        );

        // Base intensity scaled by hotspot strength
        const maxIntensity = 0.5 * hotspotStrength;
        hotspotGradient.addColorStop(0, `rgba(255, 100, 0, ${maxIntensity})`);
        hotspotGradient.addColorStop(
          0.5,
          `rgba(255, 100, 0, ${maxIntensity * 0.6})`
        );
        hotspotGradient.addColorStop(1, "rgba(255, 100, 0, 0)");

        // Draw vertical gradient overlay for each hotspot
        const verticalGradient = ctx.createLinearGradient(
          0,
          h - gradientHeight,
          0,
          h
        );
        verticalGradient.addColorStop(0, "rgba(255, 100, 0, 0)");
        verticalGradient.addColorStop(
          0.5,
          `rgba(255, 100, 0, ${maxIntensity * 0.3})`
        );
        verticalGradient.addColorStop(1, `rgba(255, 100, 0, ${maxIntensity})`);

        // Draw hotspot area
        ctx.fillStyle = hotspotGradient;
        ctx.beginPath();
        ctx.arc(hotspotX, h, hotspotRadius, 0, Math.PI * 2);
        ctx.fill();

        // Draw vertical gradient overlay
        ctx.fillStyle = verticalGradient;
        ctx.fillRect(
          hotspotX - hotspotRadius,
          h - gradientHeight,
          hotspotRadius * 2,
          gradientHeight
        );
      }

      // Add subtle base heating across entire bottom
      const baseGradient = ctx.createLinearGradient(
        0,
        h - gradientHeight,
        0,
        h
      );
      baseGradient.addColorStop(0, "rgba(255, 100, 0, 0)");
      baseGradient.addColorStop(0.7, "rgba(255, 100, 0, 0.1)");
      baseGradient.addColorStop(1, "rgba(255, 100, 0, 0.2)");
      ctx.fillStyle = baseGradient;
      ctx.fillRect(0, h - gradientHeight, w, gradientHeight);
    }

    // Particles (solid spheres) with temperature-based coloring
    const base = this.params.color || "#5ac8fa";
    // Warm colors for gas particles and heated particles (red/orange)
    const warmColor = "#ff6b35";
    // Cool colors for liquid particles (use base color)
    const coolColor = base;

    // Helper function to interpolate between two hex colors
    function lerpColor(color1, color2, t) {
      const c1 = parseInt(color1.slice(1), 16);
      const c2 = parseInt(color2.slice(1), 16);
      const r1 = (c1 >> 16) & 255;
      const g1 = (c1 >> 8) & 255;
      const b1 = c1 & 255;
      const r2 = (c2 >> 16) & 255;
      const g2 = (c2 >> 8) & 255;
      const b2 = c2 & 255;
      const r = Math.round(r1 + (r2 - r1) * t);
      const g = Math.round(g1 + (g2 - g1) * t);
      const b = Math.round(b1 + (b2 - b1) * t);
      return `rgb(${r}, ${g}, ${b})`;
    }

    ctx.strokeStyle = "rgba(0,0,0,0.2)";
    ctx.lineWidth = 1;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const r = p.radius || 3;
      const thermalEnergy = p.thermalEnergy || 0;

      // Color based on particle state and thermal energy
      if (p.state === "gas") {
        ctx.fillStyle = warmColor;
      } else {
        // Interpolate between cool and warm based on thermal energy
        // Liquid particles become orange as they heat up
        const colorT = Math.min(1.0, thermalEnergy * 1.5); // Scale thermal energy for color
        ctx.fillStyle = lerpColor(coolColor, warmColor, colorT);
      }

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
      const r = p.radius || 3;
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

  getParticleDebugData(particle) {
    if (!particle) return null;

    const v2 =
      particle.vel[0] * particle.vel[0] + particle.vel[1] * particle.vel[1];
    const ke = 0.5 * (particle.mass || 1) * v2;
    const speed = Math.hypot(particle.vel[0], particle.vel[1]);
    const thermalEnergy = particle.thermalEnergy || 0;

    // Calculate forces from nearby particles
    let totalLJForce = 0;
    let totalHBForce = 0;
    let totalDipoleForce = 0;
    let nearestNeighborDist = Infinity;
    let nearestNeighbor = null;
    const rMax = 28;
    const ax = particle.pos[0];
    const ay = particle.pos[1];

    this.grid.forNeighbors(ax, ay, rMax, (b) => {
      if (particle === b) return;
      const dx = b.pos[0] - ax;
      const dy = b.pos[1] - ay;
      const rVec = [dx, dy];
      const dist = Math.hypot(dx, dy);

      if (dist < nearestNeighborDist) {
        nearestNeighborDist = dist;
        nearestNeighbor = b;
      }

      const fLJ = this.ljForce(rVec);
      const fHB = this.hbForce(rVec);
      const fDP = this.dipoleForce(rVec);

      totalLJForce += Math.hypot(fLJ[0], fLJ[1]);
      totalHBForce += Math.hypot(fHB[0], fHB[1]);
      totalDipoleForce += Math.hypot(fDP[0], fDP[1]);
    });

    // Check if in heating zone
    const r = particle.radius || 3;
    const particleBottom = particle.pos[1] + r;
    const heatingZoneHeight = this.height * 0.1;
    const heatingZoneTop = this.height - heatingZoneHeight;
    const inHeatingZone = particleBottom >= heatingZoneTop;

    // Calculate distance from bottom
    const distFromBottom = this.height - particleBottom;

    return {
      index: this.particles.indexOf(particle),
      position: {
        x: particle.pos[0].toFixed(2),
        y: particle.pos[1].toFixed(2),
      },
      velocity: {
        x: particle.vel[0].toFixed(2),
        y: particle.vel[1].toFixed(2),
        speed: speed.toFixed(2),
      },
      kineticEnergy: ke.toFixed(2),
      thermalEnergy: thermalEnergy.toFixed(3),
      state: particle.state,
      mass: particle.mass || 1,
      radius: r,
      localNeighbors: particle.localNeighbors || 0,
      forces: {
        lj: totalLJForce.toFixed(2),
        hb: totalHBForce.toFixed(2),
        dipole: totalDipoleForce.toFixed(2),
        total: (totalLJForce + totalHBForce + totalDipoleForce).toFixed(2),
      },
      nearestNeighbor: {
        distance: nearestNeighborDist.toFixed(2),
        state: nearestNeighbor?.state || "none",
      },
      heating: {
        inZone: inHeatingZone,
        distFromBottom: distFromBottom.toFixed(2),
        heatingZoneTop: heatingZoneTop.toFixed(2),
      },
      gasUntil: particle.gasUntil
        ? (particle.gasUntil - performance.now()).toFixed(0)
        : "N/A",
      lastStateChange: particle.lastStateChange
        ? (performance.now() - particle.lastStateChange).toFixed(0)
        : "N/A",
    };
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
    /* Debug panel styles */
    .debug-panel { 
      position: fixed; 
      top: 20px; 
      right: 20px; 
      width: 320px; 
      max-height: 80vh; 
      overflow-y: auto; 
      background: #ffffff; 
      border: 2px solid #dc2626; 
      border-radius: 8px; 
      padding: 12px; 
      font-family: 'IBM Plex Mono', monospace; 
      font-size: 11px; 
      z-index: 1000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      display: none;
    }
    .debug-panel.active { display: block; }
    .debug-panel h4 { margin: 0 0 8px 0; color: #dc2626; font-size: 13px; font-weight: 600; }
    .debug-panel .debug-section { margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #e5e7eb; }
    .debug-panel .debug-section:last-child { border-bottom: none; }
    .debug-panel .debug-row { display: flex; justify-content: space-between; margin: 4px 0; }
    .debug-panel .debug-label { color: #6b7280; font-weight: 600; }
    .debug-panel .debug-value { color: #111827; }
    .debug-panel .debug-note { color: #9ca3af; font-size: 10px; margin-top: 4px; font-style: italic; }
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
            <div class="field"><label class="label">Particles (N)</label><input id="s-n" class="range" type="range" min="40" max="500" step="10" value="200"><span class="muted" id="v-n"></span></div>
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
          <canvas id="imfs-ke" class="imfs-ke" height="80" aria-label="Kinetic energy chart" role="img"></canvas>
          <div id="imfs-3d" class="imfs-3d" aria-label="3D molecule" role="img"></div>
        </div>
      </div>
    </section>
    <div id="debug-panel" class="debug-panel">
      <h4>🔍 Particle Debug Info</h4>
      <div id="debug-content"></div>
    </div>
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
    debugPanel: shadow.querySelector("#debug-panel"),
    debugContent: shadow.querySelector("#debug-content"),
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

  // Debug panel functionality
  let selectedParticle = null;
  let debugUpdateInterval = null;

  function updateDebugPanel() {
    if (!refs.debugPanel || !refs.debugContent) return;

    if (!selectedParticle) {
      refs.debugPanel.classList.remove("active");
      if (debugUpdateInterval) {
        clearInterval(debugUpdateInterval);
        debugUpdateInterval = null;
      }
      return;
    }

    // Rebuild grid for force calculations
    sim.grid.clear();
    for (let i = 0; i < sim.particles.length; i++) {
      sim.grid.insert(sim.particles[i]);
    }

    const data = sim.getParticleDebugData(selectedParticle);
    if (!data) return;

    refs.debugPanel.classList.add("active");

    refs.debugContent.innerHTML = `
      <div class="debug-section">
        <div class="debug-row"><span class="debug-label">Index:</span><span class="debug-value">${
          data.index
        }</span></div>
        <div class="debug-row"><span class="debug-label">State:</span><span class="debug-value">${
          data.state
        }</span></div>
        <div class="debug-row"><span class="debug-label">Mass:</span><span class="debug-value">${
          data.mass
        }</span></div>
        <div class="debug-row"><span class="debug-label">Radius:</span><span class="debug-value">${
          data.radius
        }</span></div>
      </div>
      
      <div class="debug-section">
        <h4>Position</h4>
        <div class="debug-row"><span class="debug-label">X:</span><span class="debug-value">${
          data.position.x
        }</span></div>
        <div class="debug-row"><span class="debug-label">Y:</span><span class="debug-value">${
          data.position.y
        }</span></div>
        <div class="debug-row"><span class="debug-label">Dist from bottom:</span><span class="debug-value">${
          data.heating.distFromBottom
        }</span></div>
      </div>
      
      <div class="debug-section">
        <h4>Velocity</h4>
        <div class="debug-row"><span class="debug-label">Vx:</span><span class="debug-value">${
          data.velocity.x
        }</span></div>
        <div class="debug-row"><span class="debug-label">Vy:</span><span class="debug-value">${
          data.velocity.y
        }</span></div>
        <div class="debug-row"><span class="debug-label">Speed:</span><span class="debug-value">${
          data.velocity.speed
        }</span></div>
      </div>
      
      <div class="debug-section">
        <h4>Energy</h4>
        <div class="debug-row"><span class="debug-label">Kinetic Energy:</span><span class="debug-value">${
          data.kineticEnergy
        }</span></div>
        <div class="debug-row"><span class="debug-label">Thermal Energy:</span><span class="debug-value">${
          data.thermalEnergy
        }</span></div>
      </div>
      
      <div class="debug-section">
        <h4>Forces (Total Magnitude)</h4>
        <div class="debug-row"><span class="debug-label">LJ Force:</span><span class="debug-value">${
          data.forces.lj
        }</span></div>
        <div class="debug-row"><span class="debug-label">HB Force:</span><span class="debug-value">${
          data.forces.hb
        }</span></div>
        <div class="debug-row"><span class="debug-label">Dipole Force:</span><span class="debug-value">${
          data.forces.dipole
        }</span></div>
        <div class="debug-row"><span class="debug-label">Total Force:</span><span class="debug-value">${
          data.forces.total
        }</span></div>
      </div>
      
      <div class="debug-section">
        <h4>Neighbors</h4>
        <div class="debug-row"><span class="debug-label">Local Neighbors:</span><span class="debug-value">${
          data.localNeighbors
        }</span></div>
        <div class="debug-row"><span class="debug-label">Nearest Dist:</span><span class="debug-value">${
          data.nearestNeighbor.distance
        }</span></div>
        <div class="debug-row"><span class="debug-label">Nearest State:</span><span class="debug-value">${
          data.nearestNeighbor.state
        }</span></div>
      </div>
      
      <div class="debug-section">
        <h4>Heating</h4>
        <div class="debug-row"><span class="debug-label">In Heating Zone:</span><span class="debug-value">${
          data.heating.inZone ? "Yes" : "No"
        }</span></div>
        <div class="debug-row"><span class="debug-label">Zone Top:</span><span class="debug-value">${
          data.heating.heatingZoneTop
        }</span></div>
      </div>
      
      <div class="debug-section">
        <h4>State Timing</h4>
        <div class="debug-row"><span class="debug-label">Gas Until (ms):</span><span class="debug-value">${
          data.gasUntil
        }</span></div>
        <div class="debug-row"><span class="debug-label">Last State Change (ms):</span><span class="debug-value">${
          data.lastStateChange
        }</span></div>
      </div>
      
      <div class="debug-note">Click another particle to inspect it</div>
    `;
  }

  // Click detection on canvas
  refs.sim.addEventListener("click", (e) => {
    const rect = refs.sim.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Find closest particle
    let closestParticle = null;
    let closestDist = Infinity;

    for (let i = 0; i < sim.particles.length; i++) {
      const p = sim.particles[i];
      const dx = p.pos[0] - x;
      const dy = p.pos[1] - y;
      const dist = Math.hypot(dx, dy);
      const r = p.radius || 3;

      if (dist < r + 5 && dist < closestDist) {
        // 5px click tolerance
        closestDist = dist;
        closestParticle = p;
      }
    }

    // Clear existing interval
    if (debugUpdateInterval) {
      clearInterval(debugUpdateInterval);
      debugUpdateInterval = null;
    }

    selectedParticle = closestParticle;
    updateDebugPanel();

    // Update debug panel continuously when particle is selected
    if (selectedParticle && sim.running) {
      debugUpdateInterval = setInterval(() => {
        if (selectedParticle && sim.particles.includes(selectedParticle)) {
          updateDebugPanel();
        } else {
          clearInterval(debugUpdateInterval);
          debugUpdateInterval = null;
          selectedParticle = null;
          updateDebugPanel();
        }
      }, 100); // Update every 100ms
    }
  });

  // (Removed 2D/3D toggle handlers)

  // Init
  setScenario("honey");
  sim.params.color = scenarioColor("honey");
  sim.draw();
  sim.start();
  // Set gravity button to active state (gravity is on by default)
  if (refs.tGravity && sim.gravityOn) {
    refs.tGravity.classList.add("is-active");
  }
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
