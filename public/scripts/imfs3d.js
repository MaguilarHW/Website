// 3D space-filling molecular collisions using Three.js + Rapier (WASM)
// Exports a factory that mounts into a container and returns control methods

import * as THREE from "three";

// ----------------------- Rapier loader (ESM via CDN) -----------------------
async function ensureRapier() {
  if (window.RAPIER && typeof window.RAPIER.init === "function") {
    // Some builds attach RAPIER to window even when using ESM
    if (!window.RAPIER._initialized) await window.RAPIER.init();
    return window.RAPIER;
  }
  let mod = null;
  try {
    // Prefer vendored local build (base64-inlined WASM)
    mod = await import("/vendor/rapier/rapier.es.js");
  } catch (_) {
    try {
      mod = await import(
        "https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.13.1"
      );
    } catch (__) {
      mod = await import(
        "https://unpkg.com/@dimforge/rapier3d-compat@0.13.1?module"
      );
    }
  }
  const RAPIER = (mod && (mod.default || mod)) || null;
  if (!RAPIER || typeof RAPIER.init !== "function") {
    throw new Error("Failed to load Rapier 3D module");
  }
  await RAPIER.init();
  return RAPIER;
}

// ----------------------- Chemistry helpers -----------------------
// Uniform atom radius in Angstroms (flattened space-filling look)
const UNIFORM_RADIUS_ANG = 1.6;
function elementRadius(_) {
  return UNIFORM_RADIUS_ANG;
}

// Parse minimal SDF with counts line and atom lines
function parseSDF(sdfText) {
  const lines = sdfText.split(/\r?\n/);
  // Find counts line: typically line index 3 (0-based), but be tolerant
  let countsIdx = lines.findIndex((l) => /V2000|V3000/.test(l));
  if (countsIdx === -1) countsIdx = 3;
  const counts = lines[countsIdx].trim().split(/\s+/);
  const numAtoms = parseInt(counts[0], 10) || 0;
  const atoms = [];
  for (let i = countsIdx + 1; i < countsIdx + 1 + numAtoms; i++) {
    const parts = lines[i].trim().split(/\s+/);
    if (parts.length < 4) continue;
    const x = parseFloat(parts[0]);
    const y = parseFloat(parts[1]);
    let z = parseFloat(parts[2]);
    const el = parts[3];
    // Flatten to 2D plane
    z = 0;
    atoms.push({ x, y, z, el, r: elementRadius(el) });
  }
  // Center atoms around centroid for body origin
  if (atoms.length) {
    let cx = 0,
      cy = 0,
      cz = 0;
    atoms.forEach((a) => {
      cx += a.x;
      cy += a.y;
      cz += a.z;
    });
    cx /= atoms.length;
    cy /= atoms.length;
    cz /= atoms.length;
    atoms.forEach((a) => {
      a.x -= cx;
      a.y -= cy;
      a.z -= cz;
    });
  }
  return { atoms };
}

async function fetchSDFByCID(cid) {
  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/SDF?record_type=3d`;
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(String(res.status));
    const text = await res.text();
    if (!text || text.length < 10) throw new Error("Empty SDF");
    return text;
  } catch (err) {
    return null;
  }
}

// ----------------------- Factory -----------------------
export async function createIMFs3D(container) {
  const RAPIER = await ensureRapier();

  // Scale: world units per Angstrom
  const SCALE = 0.1; // 1 Å -> 0.1 units
  const ATOM_SCALE = 1.0; // multiplier for VdW radius
  const NON_INTERSECT_MARGIN = 0.4; // extra spacing between molecules (world units)
  let boundsSize = 18; // size of axis-aligned cube bounds (world units)

  // Three.js renderer
  function measuredSize() {
    const rect = container.getBoundingClientRect();
    let w = Math.max(1, Math.floor(rect.width || container.clientWidth || 1));
    let h = Math.max(1, Math.floor(rect.height || container.clientHeight || 1));
    if (h <= 1) {
      const styleH = parseFloat(getComputedStyle(container).height) || 0;
      if (styleH > 1) h = Math.floor(styleH);
    }
    if (h <= 1) h = Math.floor(w * 0.62); // reasonable fallback aspect
    return { w, h };
  }
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  {
    const { w, h } = measuredSize();
    renderer.setSize(w, h, true);
  }
  try {
    renderer.setClearColor(0xf3f4f6, 1);
  } catch (_) {}
  container.innerHTML = "";
  container.appendChild(renderer.domElement);
  // Ensure correct initial sizing after DOM attach
  try {
    const { w, h } = measuredSize();
    renderer.setSize(w, h, true);
  } catch (_) {}
  // Re-evaluate size on next frame in case layout settles after display changes
  // (scheduled after camera creation below)

  const scene = new THREE.Scene();
  const __sz = measuredSize();
  const camera = new THREE.PerspectiveCamera(45, __sz.w / __sz.h, 0.1, 200);
  let camDist = 22;
  const MIN_DIST = 4;
  const MAX_DIST = 80;
  function setCamDist(d) {
    camDist = Math.max(MIN_DIST, Math.min(MAX_DIST, d));
    camera.position.set(0, 0, camDist);
    camera.lookAt(0, 0, 0);
  }
  setCamDist(camDist);
  try {
    console.log("[IMFS3D] camera:", {
      pos: camera.position.toArray(),
      fov: camera.fov,
      aspect: camera.aspect,
      near: camera.near,
      far: camera.far,
    });
  } catch (_) {}
  // Re-evaluate size on next frame in case layout settles after display changes
  try {
    requestAnimationFrame(() => {
      const { w, h } = measuredSize();
      renderer.setSize(w, h, true);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
  } catch (_) {}

  // Debug helpers: axes + cube at origin
  try {
    const axes = new THREE.AxesHelper(2);
    scene.add(axes);
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xff3333 })
    );
    cube.position.set(0, 0, 0);
    scene.add(cube);
  } catch (_) {}

  // Lights
  const amb = new THREE.AmbientLight(0xffffff, 0.65);
  scene.add(amb);
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(2, 3, 5);
  scene.add(dir);

  // Rapier world
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  try {
    console.log("[IMFS3D] world created");
  } catch (_) {}

  // Confine simulation with an axis-aligned bounding cube so molecules collide
  function buildBounds(size = 12) {
    const half = size / 2;
    const thickness = 0.5;
    const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    // +X / -X walls
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(thickness, half, thickness).setTranslation(
        half + thickness,
        0,
        0
      ),
      fixed
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(thickness, half, thickness).setTranslation(
        -half - thickness,
        0,
        0
      ),
      fixed
    );
    // +Y / -Y walls
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(half, thickness, thickness).setTranslation(
        0,
        half + thickness,
        0
      ),
      fixed
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(half, thickness, thickness).setTranslation(
        0,
        -half - thickness,
        0
      ),
      fixed
    );
    // +Z / -Z shallow walls (keep in plane)
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(half, half, thickness).setTranslation(
        0,
        0,
        thickness
      ),
      fixed
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(half, half, thickness).setTranslation(
        0,
        0,
        -thickness
      ),
      fixed
    );
  }
  buildBounds(boundsSize);

  // Rendering data: instanced spheres grouped by element
  const elementToMesh = new Map();
  const spheresGeoCache = new Map();

  function getSphereGeoForRadius(rUnits) {
    const key = rUnits.toFixed(3);
    if (spheresGeoCache.has(key)) return spheresGeoCache.get(key);
    const geo = new THREE.SphereGeometry(rUnits, 16, 12);
    spheresGeoCache.set(key, geo);
    return geo;
  }

  function getInstancedMesh(el, color, capacity = 2000, radiusUnits = 0.5) {
    let rec = elementToMesh.get(el);
    if (rec) return rec;
    const geo = getSphereGeoForRadius(radiusUnits);
    const mat = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.InstancedMesh(geo, mat, capacity);
    mesh.frustumCulled = false; // ensure instances are not culled when far from origin
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    scene.add(mesh);
    rec = { mesh, color, radiusUnits, count: 0 };
    elementToMesh.set(el, rec);
    return rec;
  }

  // Bodies store
  const bodies = []; // { rb, atoms:[{el, x,y,z,r}], colorMap }

  function colorForElement(el) {
    // Simple CPK-inspired palette
    const map = {
      H: 0xffffff,
      C: 0x222222,
      N: 0x3050f8,
      O: 0xff0d0d,
      S: 0xffc832,
      P: 0xff8000,
      F: 0x90e050,
      Cl: 0x1fda1f,
      Br: 0xa62929,
      I: 0x940094,
    };
    return map[el] ?? 0x888888;
  }

  function approxMoleculeRadius(atoms) {
    // Approximate 2D radius in our Z=0 plane; use max distance of any atom center + its radius
    let rMax = 0;
    for (let i = 0; i < atoms.length; i++) {
      const a = atoms[i];
      const d = Math.hypot(a.x, a.y) + a.r * ATOM_SCALE;
      if (d > rMax) rMax = d;
    }
    return rMax * SCALE;
  }

  function addMolecule(atoms) {
    const rb = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setLinearDamping(0.2)
        .setAngularDamping(0.2)
    );
    try {
      rb.setCcdEnabled(true);
    } catch (_) {}
    // Colliders per atom (space-filling)
    atoms.forEach((a) => {
      const r = a.r * ATOM_SCALE * SCALE;
      const colDesc = RAPIER.ColliderDesc.ball(r).setTranslation(
        a.x * SCALE,
        a.y * SCALE,
        a.z * SCALE
      );
      world.createCollider(colDesc, rb);
    });
    const radius = approxMoleculeRadius(atoms);
    bodies.push({ rb, atoms, radius });
    // Give it an initial in-plane velocity (stronger for visible motion)
    const theta = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 4; // 4..8 units/s
    rb.setLinvel(
      { x: Math.cos(theta) * speed, y: Math.sin(theta) * speed, z: 0 },
      true
    );
    rb.setAngvel({ x: 0, y: 0, z: (Math.random() - 0.5) * 2.5 }, true);
    return rb;
  }

  function clearWorld() {
    bodies.splice(0, bodies.length);
    world.forEachCollider((col) => world.removeCollider(col, true));
    world.forEachRigidBody((rb) => world.removeRigidBody(rb));
    // reset render counts
    elementToMesh.forEach((rec) => (rec.mesh.count = 0));
  }

  // Build element meshes on demand per frame before writing instance matrices
  const tmpObj = new THREE.Object3D();
  let debugFrame = 0;
  let debugFirstSphere = null;
  try {
    debugFirstSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x00ff88 })
    );
    scene.add(debugFirstSphere);
  } catch (_) {}
  function renderSpheres() {
    // Reset counts
    elementToMesh.forEach((rec) => (rec.mesh.count = 0));
    // Accumulate matrices
    let wrote = 0;
    bodies.forEach(({ rb, atoms }) => {
      const t = rb.translation();
      const q = rb.rotation();
      const quat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
      atoms.forEach((a) => {
        const el = a.el;
        const color = colorForElement(el);
        const radiusUnits = a.r * ATOM_SCALE * SCALE;
        const rec = getInstancedMesh(el, color, 4000, radiusUnits);
        // local -> world
        const local = new THREE.Vector3(a.x * SCALE, a.y * SCALE, a.z * SCALE);
        local.applyQuaternion(quat);
        tmpObj.position.set(t.x + local.x, t.y + local.y, t.z + local.z);
        tmpObj.quaternion.identity();
        tmpObj.updateMatrix();
        rec.mesh.setMatrixAt(rec.mesh.count++, tmpObj.matrix);
        wrote++;
      });
    });
    elementToMesh.forEach((rec) => {
      rec.mesh.instanceMatrix.needsUpdate = true;
      rec.mesh.count = rec.mesh.count; // ensure count applied
    });
    if (debugFrame < 60) {
      try {
        console.log("[IMFS3D] wrote instances:", wrote);
      } catch (_) {}
    }
    try {
      if (debugFirstSphere && bodies[0] && bodies[0].atoms[0]) {
        const rb = bodies[0].rb;
        const a = bodies[0].atoms[0];
        const t = rb.translation();
        const q = rb.rotation();
        const quat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
        const local = new THREE.Vector3(a.x * SCALE, a.y * SCALE, a.z * SCALE);
        local.applyQuaternion(quat);
        debugFirstSphere.position.set(
          t.x + local.x,
          t.y + local.y,
          t.z + local.z
        );
        debugFirstSphere.visible = true;
      }
    } catch (_) {}
    debugFrame++;
  }

  // Resize
  function resize() {
    const { w, h } = measuredSize();
    renderer.setSize(w, h, true);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  // Basic zoom interactions (wheel + pinch)
  function onWheel(e) {
    try {
      e.preventDefault();
    } catch (_) {}
    const scale = e.ctrlKey ? 0.01 : 0.02; // trackpad ctrl-zoom is finer
    setCamDist(camDist + e.deltaY * scale);
  }
  let pinchPrev = 0;
  function touchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }
  function onTouchStart(e) {
    if (e.touches && e.touches.length === 2) {
      try {
        e.preventDefault();
      } catch (_) {}
      pinchPrev = touchDistance(e.touches);
    }
  }
  function onTouchMove(e) {
    if (e.touches && e.touches.length === 2) {
      try {
        e.preventDefault();
      } catch (_) {}
      const d = touchDistance(e.touches);
      if (pinchPrev > 0) {
        const ratio = d / pinchPrev;
        // Zoom inversely with pinch ratio
        setCamDist(camDist / Math.max(0.5, Math.min(2.0, ratio)));
      }
      pinchPrev = d;
    }
  }
  function onTouchEnd() {
    pinchPrev = 0;
  }
  container.addEventListener("wheel", onWheel, { passive: false });
  container.addEventListener("touchstart", onTouchStart, { passive: false });
  container.addEventListener("touchmove", onTouchMove, { passive: false });
  container.addEventListener("touchend", onTouchEnd, { passive: true });

  // (Removed viewport-matching walls; using fixed-size cube bounds)

  // Loop
  let running = true;
  let last = performance.now();
  function step() {
    if (!running) return;
    const now = performance.now();
    const dt = Math.min(0.033, Math.max(0.001, (now - last) / 1000));
    last = now;
    world.timestep = 1 / 60;
    world.step();
    // Constrain motion to the Z=0 plane
    bodies.forEach(({ rb }) => {
      const t = rb.translation();
      if (t.z !== 0) rb.setTranslation({ x: t.x, y: t.y, z: 0 }, true);
      const v = rb.linvel();
      if (v.z !== 0) rb.setLinvel({ x: v.x, y: v.y, z: 0 }, true);
      const av = rb.angvel();
      // Allow only rotation around Z
      if (av.x !== 0 || av.y !== 0) rb.setAngvel({ x: 0, y: 0, z: av.z }, true);
    });
    renderSpheres();
    renderer.render(scene, camera);
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);

  // -------------- Scenario loading --------------
  let targetCount = 5;
  function setParticleCount(n) {
    targetCount = Math.max(1, Math.floor(n));
  }
  const sdfCache = new Map();
  async function getAtomsForCID(cid) {
    if (!sdfCache.has(cid)) {
      const sdf = await fetchSDFByCID(cid);
      if (sdf) {
        sdfCache.set(cid, parseSDF(sdf));
      } else {
        // Fallback to a single-sphere "particle" if SDF fetch fails
        const r = elementRadius("C");
        sdfCache.set(cid, { atoms: [{ x: 0, y: 0, z: 0, el: "C", r }] });
      }
    }
    return sdfCache.get(cid);
  }

  async function setScenario(kind) {
    clearWorld();
    // Enlarge bounds modestly with particle count to keep things spread out
    boundsSize = Math.max(12, Math.min(30, 14 + targetCount * 0.12));
    buildBounds(boundsSize);
    const spawn = async (cid, count) => {
      const spec = await getAtomsForCID(cid);
      if (!spec) return;
      for (let i = 0; i < count; i++) {
        const atoms = spec.atoms.map((a) => ({ ...a }));
        const rb = addMolecule(atoms);
        // Randomize starting pose in bounds without intersections
        const rNew = approxMoleculeRadius(atoms);
        const half = Math.max(1, boundsSize / 2 - (rNew + 0.6));
        let x = 0,
          y = 0;
        let ok = false;
        const maxAttempts = 300;
        for (let attempt = 0; attempt < maxAttempts && !ok; attempt++) {
          x = (Math.random() * 2 - 1) * half;
          y = (Math.random() * 2 - 1) * half;
          ok = true;
          // Check against previously spawned bodies only (exclude the just-added one at end)
          for (let j = 0; j < bodies.length - 1; j++) {
            const b = bodies[j];
            const bt = b.rb.translation();
            const br =
              typeof b.radius === "number"
                ? b.radius
                : approxMoleculeRadius(b.atoms || []);
            const minDist = rNew + br + NON_INTERSECT_MARGIN;
            const dx = bt.x - x;
            const dy = bt.y - y;
            if (dx * dx + dy * dy < minDist * minDist) {
              ok = false;
              break;
            }
          }
        }
        rb.setTranslation({ x, y, z: 0 }, true);
        const q = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            Math.random() * Math.PI,
            Math.random() * Math.PI,
            Math.random() * Math.PI
          )
        );
        rb.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
      }
    };

    if (kind === "honey") {
      // Distribute across glucose:fructose:water as 35:35:30
      const ratios = [35, 35, 30];
      const ids = [5793, 5984, 962];
      const total = ratios.reduce((a, b) => a + b, 0);
      let remaining = targetCount;
      const counts = ratios.map((r, i) => {
        const c = Math.floor((r / total) * targetCount);
        remaining -= c;
        return c;
      });
      // assign remainders
      let idx = 0;
      while (remaining-- > 0) counts[idx++ % counts.length]++;
      for (let i = 0; i < ids.length; i++) await spawn(ids[i], counts[i]);
    } else if (kind === "dmso") {
      await spawn(679, targetCount);
    } else {
      // hexane
      await spawn(8058, targetCount);
    }
  }

  function destroy() {
    running = false;
    try {
      ro.disconnect();
    } catch (_) {}
    try {
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
    } catch (_) {}
    try {
      renderer.dispose();
    } catch (_) {}
    try {
      elementToMesh.forEach((rec) => rec.mesh.geometry?.dispose());
    } catch (_) {}
    try {
      container.innerHTML = "";
    } catch (_) {}
  }

  return { setScenario, setParticleCount, destroy };
}
