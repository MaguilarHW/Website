/* Minimal, custom SVG molecule renderer for this site
   - Crisp, scalable drawings with layered strokes
   - Built-in specs: glucose (pyranose), fructose (furanose), DMSO, hexane
*/

function cssVar(name, fallback) {
  const cs = getComputedStyle(document.body);
  const v = cs.getPropertyValue(name);
  return v && v.trim().length ? v.trim() : fallback;
}

function colorFor(el) {
  const oxygen = cssVar("--red", "#ff7a7a");
  const sulfur = cssVar("--yellow", "#ffd24d");
  const hydrogen = cssVar("--muted", "#cfd8e3");
  const carbon = cssVar("--panel-2", "#d0d8e6");
  if (el === "O") return oxygen;
  if (el === "S") return sulfur;
  if (el === "H") return hydrogen;
  return carbon;
}

function line(svg, x1, y1, x2, y2, opts = {}) {
  const e = document.createElementNS("http://www.w3.org/2000/svg", "line");
  e.setAttribute("x1", String(x1));
  e.setAttribute("y1", String(y1));
  e.setAttribute("x2", String(x2));
  e.setAttribute("y2", String(y2));
  e.setAttribute("stroke", opts.stroke || "#d0d8e6");
  e.setAttribute("stroke-width", String(opts.width || 3));
  e.setAttribute("stroke-linecap", "round");
  e.setAttribute("opacity", String(opts.opacity ?? 1));
  svg.appendChild(e);
  return e;
}

function circle(svg, cx, cy, r, fill) {
  const e = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  e.setAttribute("cx", String(cx));
  e.setAttribute("cy", String(cy));
  e.setAttribute("r", String(r));
  e.setAttribute("fill", fill);
  svg.appendChild(e);
  return e;
}

function text(svg, x, y, value, opts = {}) {
  const e = document.createElementNS("http://www.w3.org/2000/svg", "text");
  e.setAttribute("x", String(x));
  e.setAttribute("y", String(y));
  e.setAttribute("fill", opts.fill || cssVar("--text", "#e9eef5"));
  e.setAttribute("font-size", String(opts.size || 16));
  e.setAttribute(
    "font-family",
    "Inter, system-ui, -apple-system, Segoe UI, Roboto"
  );
  e.setAttribute("font-weight", String(opts.weight || 700));
  e.textContent = String(value);
  svg.appendChild(e);
  return e;
}

function drawBond(svg, a, b, order = 1, opts = {}) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  const nx = -dy / (L || 1);
  const ny = dx / (L || 1);
  const w = 3;
  const strokeBase = opts.stroke || cssVar("--text", "#0e1116");
  const strokeUnder = opts.strokeUnder || cssVar("--panel-2", "#cbd5e1");
  if (order === 1) {
    line(svg, a.x, a.y, b.x, b.y, {
      stroke: strokeUnder,
      width: w + 1,
      opacity: 0.9,
    });
    line(svg, a.x, a.y, b.x, b.y, { stroke: strokeBase, width: w });
  } else if (order === 2) {
    line(svg, a.x + nx * 3, a.y + ny * 3, b.x + nx * 3, b.y + ny * 3, {
      stroke: strokeBase,
      width: w,
    });
    line(svg, a.x - nx * 3, a.y - ny * 3, b.x - nx * 3, b.y - ny * 3, {
      stroke: strokeBase,
      width: w,
    });
  } else {
    line(svg, a.x, a.y, b.x, b.y, { stroke: strokeBase, width: w });
  }
}

function drawSpec(svg, spec, opts = {}) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const scale = opts.scale || 1.0;
  const ox = opts.ox || 60;
  const oy = opts.oy || 120;
  const atoms = spec.atoms.map((at) => ({
    ...at,
    x: ox + at.x * scale,
    y: oy + at.y * scale,
  }));
  // Bonds first
  (spec.bonds || []).forEach((b) => {
    const a = atoms[b.a];
    const c = atoms[b.b];
    drawBond(svg, a, c, b.order || 1, opts);
  });
  // Atoms
  atoms.forEach((a) => {
    if (a.el !== "C") circle(svg, a.x, a.y, 4.5, colorFor(a.el));
    if (a.label)
      text(svg, a.x + 6, a.y - 6, a.label, {
        size: 13,
        fill: opts.labelColor || colorFor(a.el),
      });
  });
  // Annotations
  (spec.annotations || []).forEach((ann) => {
    if (ann.type === "delta")
      text(svg, ann.x * scale + ox, ann.y * scale + oy, ann.text, {
        size: 14,
        fill: ann.color || cssVar("--yellow", "#ffd60a"),
      });
    if (ann.type === "arrow") {
      const c = ann.color || cssVar("--yellow", "#ffd60a");
      line(
        svg,
        ann.x1 * scale + ox,
        ann.y1 * scale + oy,
        ann.x2 * scale + ox,
        ann.y2 * scale + oy,
        { stroke: c, width: 2 }
      );
      circle(svg, ann.x2 * scale + ox, ann.y2 * scale + oy, 2.4, c);
    }
    if (ann.type === "hbond") {
      line(
        svg,
        ann.x1 * scale + ox,
        ann.y1 * scale + oy,
        ann.x2 * scale + ox,
        ann.y2 * scale + oy,
        {
          stroke: ann.color || cssVar("--accent", "#8ab6ff"),
          width: 2,
          opacity: 0.6,
        }
      );
    }
  });
}

// ---------------- Molecule Specs (schematic, teaching-first) ----------------
// Coordinates are hand-tuned for balance; not stereochemically exhaustive

function dmsoSpec() {
  // S=O with two methyls; show dipole
  // Positions roughly centered
  const atoms = [
    { el: "S", x: 120, y: 110, label: "S" },
    { el: "O", x: 170, y: 80, label: "O" },
    { el: "C", x: 80, y: 70 },
    { el: "C", x: 80, y: 150 },
    // methyl Hs (schematic)
    { el: "H", x: 60, y: 60 },
    { el: "H", x: 60, y: 80 },
    { el: "H", x: 90, y: 50 },
    { el: "H", x: 60, y: 140 },
    { el: "H", x: 60, y: 160 },
    { el: "H", x: 90, y: 170 },
  ];
  const bonds = [
    { a: 0, b: 1, order: 2 }, // S=O
    { a: 0, b: 2, order: 1 },
    { a: 0, b: 3, order: 1 },
    { a: 2, b: 4, order: 1 },
    { a: 2, b: 5, order: 1 },
    { a: 2, b: 6, order: 1 },
    { a: 3, b: 7, order: 1 },
    { a: 3, b: 8, order: 1 },
    { a: 3, b: 9, order: 1 },
  ];
  const annotations = [
    { type: "delta", x: 172, y: 70, text: "δ−" },
    { type: "delta", x: 118, y: 106, text: "δ+" },
    { type: "arrow", x1: 115, y1: 112, x2: 168, y2: 86, color: "#ffd60a" },
  ];
  return { atoms, bonds, annotations };
}

function hexaneSpec() {
  // Simple zig-zag chain C6H14 (skeletal)
  const x0 = 120;
  const y0 = 120;
  const step = 34;
  const atoms = [];
  for (let i = 0; i < 6; i++) {
    const x = x0 + i * step;
    const y = y0 + (i % 2 === 0 ? -16 : 16);
    atoms.push({ el: "C", x, y });
  }
  const bonds = [];
  for (let i = 0; i < 5; i++) bonds.push({ a: i, b: i + 1, order: 1 });
  return { atoms, bonds, annotations: [] };
}

function glucoseSpec() {
  // Chair-like ring (pyranose), annotate a couple of OH donors/acceptors
  const atoms = [
    { el: "C", x: 120, y: 100 }, // 0
    { el: "C", x: 150, y: 80 }, // 1
    { el: "C", x: 190, y: 90 }, // 2
    { el: "C", x: 210, y: 120 }, // 3
    { el: "C", x: 180, y: 140 }, // 4
    { el: "O", x: 140, y: 140, label: "O" }, // 5 (ring O)
    // a couple OH groups (schematic)
    { el: "O", x: 150, y: 56, label: "OH" }, // 6
    { el: "O", x: 205, y: 152, label: "OH" }, // 7
  ];
  const bonds = [
    { a: 0, b: 1, order: 1 },
    { a: 1, b: 2, order: 1 },
    { a: 2, b: 3, order: 1 },
    { a: 3, b: 4, order: 1 },
    { a: 4, b: 5, order: 1 },
    { a: 5, b: 0, order: 1 },
    { a: 1, b: 6, order: 1 },
    { a: 4, b: 7, order: 1 },
  ];
  const annotations = [
    { type: "hbond", x1: 150, y1: 56, x2: 170, y2: 70 },
    { type: "hbond", x1: 205, y1: 152, x2: 185, y2: 130 },
  ];
  return { atoms, bonds, annotations };
}

function fructoseSpec() {
  // Furanose-like 5-membered ring
  const atoms = [
    { el: "C", x: 360, y: 100 }, // 0
    { el: "C", x: 392, y: 82 }, // 1
    { el: "C", x: 430, y: 98 }, // 2
    { el: "C", x: 420, y: 132 }, // 3
    { el: "O", x: 384, y: 132, label: "O" }, // 4
    { el: "O", x: 444, y: 74, label: "OH" }, // 5
    { el: "O", x: 340, y: 124, label: "OH" }, // 6
  ];
  const bonds = [
    { a: 0, b: 1, order: 1 },
    { a: 1, b: 2, order: 1 },
    { a: 2, b: 3, order: 1 },
    { a: 3, b: 4, order: 1 },
    { a: 4, b: 0, order: 1 },
    { a: 2, b: 5, order: 1 },
    { a: 0, b: 6, order: 1 },
  ];
  const annotations = [
    { type: "hbond", x1: 444, y1: 74, x2: 422, y2: 86 },
    { type: "hbond", x1: 340, y1: 124, x2: 360, y2: 112 },
  ];
  return { atoms, bonds, annotations };
}

function honeyDuoSpec() {
  const left = glucoseSpec();
  const right = fructoseSpec();
  // Combine by translating right block in-place (already positioned)
  const atoms = [...left.atoms, ...right.atoms];
  const bonds = [...left.bonds, ...right.bonds];
  const annotations = [...left.annotations, ...right.annotations];
  return { atoms, bonds, annotations };
}

export const molecules = {
  dmso: dmsoSpec,
  hexane: hexaneSpec,
  glucose: glucoseSpec,
  fructose: fructoseSpec,
  honeyDuo: honeyDuoSpec,
};

export function renderMolecule(svgEl, specOrFn, options) {
  const spec = typeof specOrFn === "function" ? specOrFn() : specOrFn;
  drawSpec(svgEl, spec, options || {});
}
