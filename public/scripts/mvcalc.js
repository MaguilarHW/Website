/* Multivariable Calculus: 3D Distance Demonstrator
   - Three.js-based interactive 3D grapher with OrbitControls
   - Four scenarios with inputs (integers only):
     1) Point–Line distance
     2) Lines: Intersecting
     3) Lines: Parallel
     4) Lines: Skew
   - Step-by-step solution that updates the grapher each step
   - Orbit camera with mouse (drag), zoom (wheel), pan (Shift+drag)
*/

import * as THREE from "https://unpkg.com/three@0.155.0/build/three.module.js";
import { OrbitControls } from "https://unpkg.com/three@0.155.0/examples/jsm/controls/OrbitControls.js";

// ---------- Math utilities ----------
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function mul3(a, k) {
  return [a[0] * k, a[1] * k, a[2] * k];
}
function len3(a) {
  return Math.sqrt(dot3(a, a));
}
function norm3(a) {
  const L = len3(a);
  if (L < 1e-12) return [0, 0, 0];
  return [a[0] / L, a[1] / L, a[2] / L];
}

function almostEqual(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

function formatNum(n, digits = 3) {
  if (!isFinite(n)) return "—";
  const x = Math.abs(n);
  if (x >= 10000 || (x > 0 && x < 0.001)) return n.toExponential(2);
  return n.toFixed(digits);
}

// ---------- Geometry computations ----------
function projectPointToLine(pointP, linePointA, lineDirV) {
  const ap = sub3(pointP, linePointA);
  const v2 = dot3(lineDirV, lineDirV);
  if (v2 < 1e-12) {
    return {
      t: 0,
      foot: linePointA.slice(),
      distVec: sub3(pointP, linePointA),
    };
  }
  const t = dot3(ap, lineDirV) / v2;
  const foot = add3(linePointA, mul3(lineDirV, t));
  const distVec = sub3(pointP, foot);
  return { t, foot, distVec };
}

function distancePointLine(pointP, linePointA, lineDirV) {
  const ap = sub3(pointP, linePointA);
  const cross = cross3(ap, lineDirV);
  const numerator = len3(cross);
  const denom = len3(lineDirV);
  const d = denom < 1e-12 ? len3(ap) : numerator / denom;
  const proj = projectPointToLine(pointP, linePointA, lineDirV);
  return {
    distance: d,
    cross,
    numerator,
    denom,
    foot: proj.foot,
    t: proj.t,
    distVec: proj.distVec,
  };
}

function distanceParallelLines(a, v, b, w) {
  // Assumes v and w are parallel (or nearly so)
  const diff = sub3(b, a);
  const cross = cross3(diff, v);
  const d = len3(v) < 1e-12 ? len3(diff) : len3(cross) / len3(v);
  // Nearest segment endpoints along each line
  const v2 = dot3(v, v);
  const t = v2 < 1e-12 ? 0 : dot3(sub3(b, a), v) / v2;
  const p1 = add3(a, mul3(v, t));
  // Closest point on L2 to p1
  const s = v2 < 1e-12 ? 0 : dot3(sub3(p1, b), v) / v2;
  const p2 = add3(b, mul3(w, s));
  return { distance: d, p1, p2 };
}

function distanceSkewOrIntersect(a, v, b, w) {
  const r = sub3(a, b);
  const a2 = dot3(v, v);
  const b2 = dot3(w, w);
  const ab = dot3(v, w);
  const ar = dot3(v, r);
  const br = dot3(w, r);
  const det = a2 * b2 - ab * ab;
  if (Math.abs(det) < 1e-12) {
    // Parallel; fallback to parallel handler
    const par = distanceParallelLines(a, v, b, w);
    return { ...par, parallel: true, intersect: false };
  }
  const t = (ab * br - b2 * ar) / det;
  const s = (a2 * br - ab * ar) / det;
  const p1 = add3(a, mul3(v, t));
  const p2 = add3(b, mul3(w, s));
  const dVec = sub3(p1, p2);
  const d = len3(dVec);
  const intersect = d < 1e-9;
  return { distance: d, p1, p2, t, s, intersect, parallel: false };
}

// ---------- Three.js grapher ----------
class ThreeGrapher {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    const w = canvas.clientWidth || 900;
    const h = canvas.clientHeight || 540;
    this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 1000);
    this.camera.position.set(6, 6, 6);
    this.camera.lookAt(0, 0, 0);
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = false;
    this.controls.keyPanSpeed = 20.0;

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(3, 5, 2);
    this.scene.add(ambient, dir);

    // Grid and axes
    const grid = new THREE.GridHelper(20, 20, 0x2f6fff, 0x223048);
    grid.position.y = -0.001;
    this.scene.add(grid, new THREE.AxesHelper(5));

    this.objectsGroup = new THREE.Group();
    this.scene.add(this.objectsGroup);

    this.onResize = () => {
      const width = this.canvas.clientWidth || 900;
      const height = this.canvas.clientHeight || 540;
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height, false);
    };
    window.addEventListener("resize", this.onResize);

    this.animate = this.animate.bind(this);
    this.animId = requestAnimationFrame(this.animate);
  }

  clearGroup() {
    while (this.objectsGroup.children.length) {
      const obj = this.objectsGroup.children.pop();
      obj.traverse?.((child) => {
        if (child.geometry) child.geometry.dispose?.();
        if (child.material) {
          if (Array.isArray(child.material))
            child.material.forEach((m) => m.dispose?.());
          else child.material.dispose?.();
        }
      });
      this.objectsGroup.remove(obj);
    }
  }

  makeLine(point, dir, color = "#d0d8e6") {
    const L = 100;
    const d = norm3(dir);
    const a = add3(point, mul3(d, -L));
    const b = add3(point, mul3(d, L));
    const geom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(a[0], a[1], a[2]),
      new THREE.Vector3(b[0], b[1], b[2]),
    ]);
    const mat = new THREE.LineBasicMaterial({ color });
    return new THREE.Line(geom, mat);
  }

  makeSegment(a, b, color = "#e9eef5") {
    const geom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(a[0], a[1], a[2]),
      new THREE.Vector3(b[0], b[1], b[2]),
    ]);
    const mat = new THREE.LineBasicMaterial({ color });
    return new THREE.Line(geom, mat);
  }

  makePoint(p, color = "#ffd60a", size = 0.08) {
    const geom = new THREE.SphereGeometry(size, 16, 16);
    const mat = new THREE.MeshStandardMaterial({ color });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(p[0], p[1], p[2]);
    return mesh;
  }

  makeArrow(from, dir, color = "#8ab6ff") {
    const len = len3(dir);
    if (len < 1e-9) return null;
    const arrow = new THREE.ArrowHelper(
      new THREE.Vector3(dir[0] / len, dir[1] / len, dir[2] / len),
      new THREE.Vector3(from[0], from[1], from[2]),
      len,
      new THREE.Color(color)
    );
    return arrow;
  }

  setObjects(objects) {
    this.clearGroup();
    for (const obj of objects || []) {
      let mesh = null;
      if (obj.type === "line")
        mesh = this.makeLine(obj.point, obj.dir, obj.color);
      else if (obj.type === "segment")
        mesh = this.makeSegment(obj.a, obj.b, obj.color);
      else if (obj.type === "point")
        mesh = this.makePoint(obj.p, obj.color, (obj.size || 5) / 100);
      else if (obj.type === "vector")
        mesh = this.makeArrow(obj.from, obj.dir, obj.color);
      if (mesh) this.objectsGroup.add(mesh);
    }
  }

  animate() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.animId = requestAnimationFrame(this.animate);
  }

  destroy() {
    if (this.animId) cancelAnimationFrame(this.animId);
    window.removeEventListener("resize", this.onResize);
    this.controls.dispose();
    this.renderer.dispose();
    this.clearGroup();
  }
}

// ---------- UI + Integration ----------
function scenarioDefaults(kind) {
  if (kind === "point-line") {
    return {
      A: [0, 0, 0],
      V: [3, 1, 2],
      P: [2, 4, -1],
    };
  }
  if (kind === "intersect") {
    return {
      A: [1, 2, 3],
      V: [1, 0, -1],
      B: [2, 1, 3],
      W: [0, 1, -1],
    };
  }
  if (kind === "parallel") {
    return {
      A: [0, 0, 0],
      V: [1, 2, 0],
      B: [0, 3, 5],
      W: [2, 4, 0],
    };
  }
  // skew
  return {
    A: [0, 0, 0],
    V: [1, 0, 0],
    B: [0, 1, 1],
    W: [0, 1, 0],
  };
}

function makeNumberInput(id, val) {
  return `<input id="${id}" type="number" step="1" min="-99" max="99" value="${val}">`;
}

function vecFields(prefix, label, v) {
  return `
    <div class="field">
      <label>${label}</label>
      <div class="row three">
        ${makeNumberInput(`${prefix}x`, v[0])}
        ${makeNumberInput(`${prefix}y`, v[1])}
        ${makeNumberInput(`${prefix}z`, v[2])}
      </div>
    </div>
  `;
}

export function mountMVCalc(root) {
  root.innerHTML = `
    <section class="panel narrow">
      <h2 class="section-title">MV Calc: 3D Distance Demonstrator</h2>
      <p class="muted">Interactive 3D grapher for distances in \u211D B3. Drag to orbit, Shift+drag to pan, scroll to zoom. Enter integer coefficients for points and lines.</p>
    </section>
    <section class="panel mvcalc">
      <div class="mvcalc-wrap">
        <div class="mvcalc-left">
          <div class="field">
            <label>Scenario</label>
            <select id="scenario">
              <option value="point-line">Point–Line</option>
              <option value="intersect">Lines: Intersecting</option>
              <option value="parallel">Lines: Parallel</option>
              <option value="skew">Lines: Skew</option>
            </select>
          </div>
          <div id="inputs"></div>
          <div class="controls" style="margin-top:10px;">
            <button id="solve" class="primary">Solve & Show Steps</button>
            <button id="prev">Prev step</button>
            <button id="next">Next step</button>
            <button id="reset" class="danger">Reset</button>
          </div>
          <div class="formula" id="equations" style="margin-top:10px;"></div>
        </div>
        <div class="mvcalc-center">
          <div class="mv3d-wrap">
            <canvas id="mv3d" class="mv3d" width="900" height="540" aria-label="3D grapher" role="img"></canvas>
            <div id="mv3d-overlay" class="mv3d-overlay"></div>
          </div>
        </div>
        <div class="mvcalc-right">
          <h3 style="margin:0 0 8px 0; font-size:15px;">Step-by-step</h3>
          <ol id="steps" class="steps"></ol>
          <div class="muted" style="margin-top:8px; font-size:12px;">Formulas update live as you edit inputs.</div>
        </div>
      </div>
    </section>
  `;

  const refs = {
    canvas: root.querySelector("#mv3d"),
    scenario: root.querySelector("#scenario"),
    inputs: root.querySelector("#inputs"),
    prev: root.querySelector("#prev"),
    next: root.querySelector("#next"),
    reset: root.querySelector("#reset"),
    solve: root.querySelector("#solve"),
    steps: root.querySelector("#steps"),
    equations: root.querySelector("#equations"),
  };

  const graph = new ThreeGrapher(refs.canvas);

  let state = {
    kind: "point-line",
    values: scenarioDefaults("point-line"),
    step: 0,
    maxStep: 0,
  };

  function getInt(id) {
    const el = refs.inputs.querySelector(`#${id}`);
    const v = parseInt(el && el.value, 10);
    return isFinite(v) ? v : 0;
  }

  function readValues() {
    if (state.kind === "point-line") {
      return {
        A: [getInt("ax"), getInt("ay"), getInt("az")],
        V: [getInt("vx"), getInt("vy"), getInt("vz")],
        P: [getInt("px"), getInt("py"), getInt("pz")],
      };
    }
    return {
      A: [getInt("ax"), getInt("ay"), getInt("az")],
      V: [getInt("vx"), getInt("vy"), getInt("vz")],
      B: [getInt("bx"), getInt("by"), getInt("bz")],
      W: [getInt("wx"), getInt("wy"), getInt("wz")],
    };
  }

  function renderInputs() {
    const v = state.values;
    if (state.kind === "point-line") {
      refs.inputs.innerHTML = `
        ${vecFields("a", "Line point A (x,y,z)", v.A)}
        ${vecFields("v", "Line direction v (x,y,z)", v.V)}
        ${vecFields("p", "Point P (x,y,z)", v.P)}
      `;
    } else {
      refs.inputs.innerHTML = `
        ${vecFields("a", "Line 1 point A (x,y,z)", v.A)}
        ${vecFields("v", "Line 1 direction v (x,y,z)", v.V)}
        ${vecFields("b", "Line 2 point B (x,y,z)", v.B)}
        ${vecFields("w", "Line 2 direction w (x,y,z)", v.W)}
      `;
    }
  }

  function updateEquations() {
    const v = state.values;
    if (state.kind === "point-line") {
      const eq = `
        <div><strong>Line</strong>: r(t) = A + t v = ( ${v.A[0]}, ${v.A[1]}, ${v.A[2]} ) + t ( ${v.V[0]}, ${v.V[1]}, ${v.V[2]} )</div>
        <div><strong>Point</strong>: P = ( ${v.P[0]}, ${v.P[1]}, ${v.P[2]} )</div>
        <div style="margin-top:6px;">Distance d = | (P − A) × v | / |v|</div>
      `;
      refs.equations.innerHTML = eq;
    } else if (state.kind === "parallel") {
      const eq = `
        <div><strong>L1</strong>: r₁(t) = A + t v</div>
        <div><strong>L2</strong>: r₂(s) = B + s w, with v ∥ w</div>
        <div style="margin-top:6px;">Distance d = | (B − A) × v | / |v|</div>
      `;
      refs.equations.innerHTML = eq;
    } else if (state.kind === "skew") {
      const eq = `
        <div><strong>L1</strong>: r₁(t) = A + t v</div>
        <div><strong>L2</strong>: r₂(s) = B + s w</div>
        <div style="margin-top:6px;">Distance d = | (B − A) · (v × w) | / | v × w |</div>
      `;
      refs.equations.innerHTML = eq;
    } else {
      const eq = `
        <div><strong>L1</strong>: r₁(t) = A + t v</div>
        <div><strong>L2</strong>: r₂(s) = B + s w</div>
        <div style="margin-top:6px;">If lines intersect: distance d = 0 at A + t* v = B + s* w</div>
      `;
      refs.equations.innerHTML = eq;
    }
  }

  function buildSteps() {
    const v = state.values;
    let html = "";
    if (state.kind === "point-line") {
      const sol = distancePointLine(v.P, v.A, v.V);
      html = `
        <li>Compute u = P − A</li>
        <li>Compute n = u × v</li>
        <li>Compute d = |n| / |v| = ${formatNum(sol.numerator)} / ${formatNum(
        sol.denom
      )} = <strong>${formatNum(sol.distance)}</strong></li>
        <li>Foot F = A + ( (u·v)/|v|² ) v</li>
      `;
      state.maxStep = 3;
    } else if (state.kind === "parallel") {
      const sol = distanceParallelLines(v.A, v.V, v.B, v.W);
      html = `
        <li>Verify v × w = 0 (parallel)</li>
        <li>Compute d = | (B − A) × v | / |v| = <strong>${formatNum(
          sol.distance
        )}</strong></li>
        <li>Draw the perpendicular segment between lines</li>
      `;
      state.maxStep = 2;
    } else if (state.kind === "skew") {
      const cross = cross3(v.V, v.W);
      const numer = Math.abs(dot3(sub3(v.B, v.A), cross));
      const denom = len3(cross);
      const d = denom < 1e-12 ? 0 : numer / denom;
      html = `
        <li>Compute n = v × w</li>
        <li>Compute d = | (B − A) · n | / |n| = ${formatNum(
          numer
        )} / ${formatNum(denom)} = <strong>${formatNum(d)}</strong></li>
        <li>Find closest points by solving 2×2 system</li>
      `;
      state.maxStep = 2;
    } else {
      const sol = distanceSkewOrIntersect(v.A, v.V, v.B, v.W);
      html = `
        <li>Solve for t, s from v·(A + t v − B − s w) = 0 and w·(A + t v − B − s w) = 0</li>
        <li>Check P₁ = A + t v and P₂ = B + s w; distance = |P₁ − P₂| = <strong>${formatNum(
          sol.distance
        )}</strong></li>
        <li>${
          sol.intersect
            ? "Lines intersect (distance 0)"
            : "If distance is 0, lines intersect"
        }</li>
      `;
      state.maxStep = 2;
    }
    refs.steps.innerHTML = html;
  }

  function updateScene() {
    const v = state.values;
    const objs = [];
    const accent = "#ffd60a";
    const cyan = "#5ac8fa";
    const magenta = "#ff7ab6";
    const green = "#34c759";

    if (state.kind === "point-line") {
      const sol = distancePointLine(v.P, v.A, v.V);
      // Base
      objs.push({
        type: "line",
        point: v.A,
        dir: v.V,
        color: "#d0d8e6",
        width: 2,
      });
      objs.push({ type: "point", p: v.P, color: accent, size: 5 });
      if (state.step >= 1) {
        // u = P - A
        objs.push({
          type: "vector",
          from: v.A,
          dir: sub3(v.P, v.A),
          color: "#8ab6ff",
          width: 2,
          dash: [6, 6],
        });
      }
      if (state.step >= 2) {
        // Perpendicular segment PF
        objs.push({
          type: "segment",
          a: sol.foot,
          b: v.P,
          color: cyan,
          width: 3,
        });
      }
      if (state.step >= 3) {
        objs.push({ type: "point", p: sol.foot, color: green, size: 5 });
      }
      const overlay = root.querySelector("#mv3d-overlay");
      if (overlay)
        overlay.textContent = `Point–Line distance d = ${formatNum(
          sol.distance
        )}`;
    } else if (state.kind === "parallel") {
      objs.push({
        type: "line",
        point: v.A,
        dir: v.V,
        color: "#d0d8e6",
        width: 2,
      });
      objs.push({
        type: "line",
        point: v.B,
        dir: v.W,
        color: "#d0d8e6",
        width: 2,
      });
      const sol = distanceParallelLines(v.A, v.V, v.B, v.W);
      if (state.step >= 1) {
        objs.push({
          type: "segment",
          a: sol.p1,
          b: sol.p2,
          color: cyan,
          width: 3,
        });
        objs.push({ type: "point", p: sol.p1, color: green, size: 5 });
        objs.push({ type: "point", p: sol.p2, color: magenta, size: 5 });
      }
      const overlay = root.querySelector("#mv3d-overlay");
      if (overlay)
        overlay.textContent = `Parallel lines distance d = ${formatNum(
          sol.distance
        )}`;
    } else if (state.kind === "skew") {
      objs.push({
        type: "line",
        point: v.A,
        dir: v.V,
        color: "#d0d8e6",
        width: 2,
      });
      objs.push({
        type: "line",
        point: v.B,
        dir: v.W,
        color: "#d0d8e6",
        width: 2,
      });
      const sol = distanceSkewOrIntersect(v.A, v.V, v.B, v.W);
      if (state.step >= 1) {
        objs.push({
          type: "segment",
          a: sol.p1,
          b: sol.p2,
          color: cyan,
          width: 3,
        });
        objs.push({ type: "point", p: sol.p1, color: green, size: 5 });
        objs.push({ type: "point", p: sol.p2, color: magenta, size: 5 });
      }
      const cross = cross3(v.V, v.W);
      const numer = Math.abs(dot3(sub3(v.B, v.A), cross));
      const denom = len3(cross);
      const d = denom < 1e-12 ? 0 : numer / denom;
      const overlay = root.querySelector("#mv3d-overlay");
      if (overlay)
        overlay.textContent = `Skew lines distance d = ${formatNum(d)}`;
    } else {
      objs.push({
        type: "line",
        point: v.A,
        dir: v.V,
        color: "#d0d8e6",
        width: 2,
      });
      objs.push({
        type: "line",
        point: v.B,
        dir: v.W,
        color: "#d0d8e6",
        width: 2,
      });
      const sol = distanceSkewOrIntersect(v.A, v.V, v.B, v.W);
      if (state.step >= 1) {
        objs.push({ type: "point", p: sol.p1, color: green, size: 5 });
        objs.push({ type: "point", p: sol.p2, color: magenta, size: 5 });
      }
      if (state.step >= 2) {
        if (sol.intersect)
          objs.push({ type: "point", p: sol.p1, color: accent, size: 6 });
        else
          objs.push({
            type: "segment",
            a: sol.p1,
            b: sol.p2,
            color: cyan,
            width: 3,
          });
      }
      const overlay = root.querySelector("#mv3d-overlay");
      if (overlay)
        overlay.textContent = `Intersecting lines distance d = ${formatNum(
          sol.distance
        )}`;
    }

    graph.setObjects(objs);
  }

  function onSolve() {
    state.values = readValues();
    state.step = 0;
    updateEquations();
    buildSteps();
    updateScene();
  }

  function go(stepDelta) {
    state.values = readValues();
    state.step = clamp(state.step + stepDelta, 0, state.maxStep);
    buildSteps();
    updateScene();
  }

  refs.scenario.addEventListener("change", (e) => {
    state.kind = e.target.value;
    state.values = scenarioDefaults(state.kind);
    state.step = 0;
    renderInputs();
    updateEquations();
    buildSteps();
    updateScene();
  });
  refs.solve.addEventListener("click", onSolve);
  refs.prev.addEventListener("click", () => go(-1));
  refs.next.addEventListener("click", () => go(1));
  refs.reset.addEventListener("click", () => {
    state.values = scenarioDefaults(state.kind);
    renderInputs();
    onSolve();
  });
  refs.inputs.addEventListener("input", () => {
    state.values = readValues();
    updateEquations();
    buildSteps();
    updateScene();
  });

  // Initial UI
  renderInputs();
  updateEquations();
  buildSteps();
  updateScene();

  // Cleanup when navigating away
  return () => {
    graph.destroy();
  };
}
