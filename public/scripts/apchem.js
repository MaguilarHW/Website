/* AP Chemistry: Weak Acid–Strong Base Titration learning widget
   - Self-contained Web Component with Shadow DOM
   - Particle-level visualization of HA, A-, H+, OH-
   - Live chart of pH or [H+] vs added base volume/time
   - Highlights: initial pH, buffer region, half-equivalence (pH≈pKa), equivalence point
   - Practice problems generator with worked solutions
*/

const KW = 1e-14;

function log10(x) {
  return Math.log(x) / Math.LN10;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatNumber(value, digits = 2) {
  if (!isFinite(value)) return "—";
  if (
    Math.abs(value) >= 1000 ||
    (Math.abs(value) > 0 && Math.abs(value) < 0.01)
  ) {
    return value.toExponential(digits);
  }
  return value.toFixed(digits);
}

function computeHplusFromWeakAcid(ka, c) {
  if (c <= 0) return Math.sqrt(KW);
  const a = 1;
  const b = ka;
  const cc = -ka * c;
  const disc = Math.max(0, b * b - 4 * a * cc);
  const x = (-b + Math.sqrt(disc)) / (2 * a);
  return Math.max(x, 0);
}

function computePHFromHydrolysisAminus(ka, cAminus) {
  if (cAminus <= 0) return 7;
  const kb = KW / ka;
  const x = Math.sqrt(Math.max(0, kb * cAminus));
  const oh = x;
  const poh = -log10(Math.max(oh, 1e-16));
  return 14 - poh;
}

function computeTitrationPoint(params, addedBaseMl) {
  const { acidM, acidMl, baseM, pKa } = params;
  const ka = Math.pow(10, -pKa);
  const vaL = acidMl / 1000;
  const vbL = addedBaseMl / 1000;
  const nHA0 = acidM * vaL;
  const nBase = baseM * vbL;
  const vTotalL = vaL + vbL;
  const vEqL = nHA0 / baseM;
  const vEqMl = vEqL * 1000;

  if (nBase <= 0) {
    const cHaEff = nHA0 / vTotalL;
    const h = computeHplusFromWeakAcid(ka, cHaEff);
    const pH = -log10(Math.max(h, 1e-16));
    return {
      stage: "initial",
      pH,
      hPlus: h,
      nHA: nHA0,
      nA: 0,
      vTotalL,
      vEqMl,
      ratio: 0,
    };
  }

  if (nBase < nHA0) {
    // Buffer region: use Henderson–Hasselbalch
    const nA = nBase;
    const nHA = nHA0 - nBase;
    const ratio = nA / nHA;
    const pH = pKa + log10(Math.max(ratio, 1e-16));
    const h = Math.pow(10, -pH);
    return {
      stage: "buffer",
      pH,
      hPlus: h,
      nHA,
      nA,
      vTotalL,
      vEqMl,
      ratio,
    };
  }

  if (Math.abs(nBase - nHA0) < 1e-12) {
    // Equivalence: solution of A- (weak base)
    const cAminus = nHA0 / vTotalL;
    const pH = computePHFromHydrolysisAminus(ka, cAminus);
    const h = Math.pow(10, -pH);
    return {
      stage: "equivalence",
      pH,
      hPlus: h,
      nHA: 0,
      nA: nHA0,
      vTotalL,
      vEqMl,
      ratio: 1,
    };
  }

  // Excess base
  const nExcessBase = nBase - nHA0;
  const oh = nExcessBase / vTotalL;
  const poh = -log10(Math.max(oh, 1e-16));
  const pH = 14 - poh;
  const h = Math.pow(10, -pH);
  return {
    stage: "excess",
    pH,
    hPlus: h,
    nHA: 0,
    nA: nHA0,
    vTotalL,
    vEqMl,
    ratio: Infinity,
  };
}

class APChemTitrationElement extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.params = {
      acidM: 0.1,
      acidMl: 50.0,
      pKa: 4.76, // acetic acid default
      baseM: 0.1,
    };
    this.state = {
      addedBaseMl: 0,
      running: false,
      autoFlow: false,
      autoRateMlPerSec: 0.5,
      startTimeMs: 0,
      elapsedSec: 0,
      dataPoints: [], // {t, vMl, pH, h}
      analysisShown: false,
    };
    this.rafId = null;
    this.lastTickMs = 0;
  }

  connectedCallback() {
    this.render();
    this.updateAll();
  }

  disconnectedCallback() {
    this.stop();
  }

  stop() {
    this.state.autoFlow = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  setStyles(root) {
    const style = document.createElement("style");
    style.textContent = `
      :host { display: block; }
      .wrap { display: grid; gap: 16px; }
      @media (min-width: 960px) {
        .wrap { grid-template-columns: 380px 1fr; align-items: start; }
      }
      .card { background: #0f1420; border: 1px solid #202838; border-radius: 14px; padding: 14px; box-shadow: 0 8px 28px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04); }
      .card h3 { margin: 0 0 10px 0; font-size: 15px; color: #e9eef5; }
      .row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .field { display: grid; gap: 6px; }
      label { color: #a9b4c2; font-size: 12px; }
      input[type="number"], select { background:#0b101a; border:1px solid #263247; color:#e9eef5; border-radius:10px; padding:10px 12px; font-size:14px; }
      .controls { display: flex; flex-wrap: wrap; gap: 8px; }
      button { appearance:none; border:1px solid #2a3241; background:#152030; color:#e9eef5; border-radius:10px; padding:10px 12px; font-size:14px; cursor:pointer; transition: background .2s ease, transform .06s ease; }
      button:hover { background:#1a283d; }
      button:active { transform: translateY(1px); }
      button.primary { background:#123042; border-color:#28465a; color:#d8f1ff; }
      button.success { background:#0e2e1a; border-color:#1c4a2b; color:#dbffe6; }
      button.danger { background:#3a1518; border-color:#562229; color:#ffd7dc; }
      .muted { color:#a9b4c2; }
      .stats { display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap:10px; }
      .stat { background:#0c121d; border:1px solid #1f2a3d; border-radius:10px; padding:10px; }
      .stat .k { color:#a9b4c2; font-size:12px; }
      .stat .v { font-size:16px; font-weight:700; }
      .chart-wrap { position: relative; }
      canvas.chart { width: 100%; height: 320px; display:block; background: linear-gradient(180deg, #0c121c 0%, #0a0f19 100%); border:1px solid #1e2738; border-radius: 12px; }
      .legend { display:flex; gap: 12px; align-items: center; margin-top: 8px; flex-wrap: wrap; }
      .dot { width:10px; height:10px; border-radius:50%; display:inline-block; }
      .dot.ph { background:#5ac8fa; }
      .dot.h { background:#ffd60a; }
      .markers { display:flex; gap:10px; flex-wrap:wrap; }
      .marker { background:#111827; border:1px solid #263247; color:#cfe6ff; border-radius:8px; padding:6px 8px; font-size:12px; }
      canvas.particles { width: 100%; height: 220px; display:block; background: radial-gradient(900px 200px at 50% -20%, rgba(90,200,250,.06), transparent), linear-gradient(180deg, #0c121d 0%, #0a0f19 100%); border:1px solid #1e2738; border-radius:12px; }
      .progress { height: 8px; background:#0b1018; border:1px solid #223047; border-radius: 999px; overflow:hidden; }
      .progress > i { display:block; height:100%; width:0; background: linear-gradient(90deg, #5ac8fa, #34c759); }
      .explain { font-size: 14px; line-height: 1.5; color: #dbe6f5; }
      .explain .key { color: #5ac8fa; font-weight: 700; }
      details { background:#0c121d; border:1px solid #213047; border-radius:10px; padding:10px 12px; }
      summary { cursor: pointer; }
      .practice li { margin: 8px 0; }
      .kbd { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; background:#0f1520; padding:2px 6px; border:1px solid #253045; border-radius:6px; font-size:12px; }
    `;
    root.appendChild(style);
  }

  render() {
    const root = this.shadowRoot;
    root.innerHTML = "";
    this.setStyles(root);

    const wrap = document.createElement("div");
    wrap.className = "wrap";

    // Left: Controls and stats
    const controlsCard = document.createElement("div");
    controlsCard.className = "card";
    controlsCard.innerHTML = `
      <h3>Weak Acid – Strong Base Titration</h3>
      <div class="row">
        <div class="field"><label>Acid concentration (M)</label><input id="acidM" type="number" step="0.01" min="0.001" max="5" value="${this.params.acidM}"></div>
        <div class="field"><label>Acid volume (mL)</label><input id="acidMl" type="number" step="1" min="1" max="500" value="${this.params.acidMl}"></div>
      </div>
      <div class="row">
        <div class="field"><label>pKa (acid)</label><input id="pKa" type="number" step="0.01" min="-1" max="14" value="${this.params.pKa}"></div>
        <div class="field"><label>Base concentration (M)</label><input id="baseM" type="number" step="0.01" min="0.001" max="5" value="${this.params.baseM}"></div>
      </div>
      <div class="field"><label>Auto flow rate (mL/s)</label><input id="rate" type="range" min="0.1" max="5" step="0.1" value="${this.state.autoRateMlPerSec}"><span class="muted">Rate: <span id="rateVal"></span> mL/s</span></div>
      <div class="controls" style="margin-top:10px;">
        <button id="start" class="primary">Start</button>
        <button id="stepSmall">+0.10 mL</button>
        <button id="stepBig">+1.00 mL</button>
        <button id="auto" class="success">Auto flow</button>
        <button id="stop">Stop</button>
        <button id="reset" class="danger">Reset</button>
      </div>
      <div style="margin-top:10px;" class="controls">
        <button id="togglePlot">Plot: pH</button>
        <button id="toggleParticles">Particles: On</button>
        <button id="analyze">Analyze curve</button>
      </div>
      <div style="margin-top:10px;" class="progress"><i id="prog"></i></div>
      <div class="stats" style="margin-top:10px;">
        <div class="stat"><div class="k">Added base</div><div class="v"><span id="vAdded"></span> mL</div></div>
        <div class="stat"><div class="k">Equivalence at</div><div class="v"><span id="vEq"></span> mL</div></div>
        <div class="stat"><div class="k">pH</div><div class="v"><span id="pH"></span></div></div>
        <div class="stat"><div class="k">[H<sup>+</sup>]</div><div class="v"><span id="h"></span> M</div></div>
      </div>
    `;

    // Right: Chart and markers
    const chartCard = document.createElement("div");
    chartCard.className = "card";
    chartCard.innerHTML = `
      <h3>Titration Curve</h3>
      <div class="chart-wrap">
        <canvas class="chart" id="chart" width="900" height="480" aria-label="Titration chart" role="img"></canvas>
      </div>
      <div class="legend">
        <span class="dot ph"></span><span class="muted">pH</span>
        <span class="dot h"></span><span class="muted">[H<sup>+</sup>]</span>
        <div style="flex:1"></div>
        <div class="markers" id="markers"></div>
      </div>
    `;

    // Full width: particles and explanations
    const vizCard = document.createElement("div");
    vizCard.className = "card";
    vizCard.innerHTML = `
      <h3>Particle View</h3>
      <canvas class="particles" id="particles" width="900" height="360" aria-label="Particle simulation" role="img"></canvas>
      <p class="muted" style="margin-top:8px;">Colored dots indicate species: <span style="color:#5ac8fa;">HA</span>, <span style="color:#8ab6ff;">A<sup>-</sup></span>, <span style="color:#ffd60a;">H<sup>+</sup></span>, <span style="color:#34c759;">OH<sup>-</sup></span>. Counts are scaled for visualization.</p>
    `;

    const explainCard = document.createElement("div");
    explainCard.className = "card";
    explainCard.innerHTML = `
      <h3>Concept Builder</h3>
      <div class="explain" id="explain"></div>
      <details style="margin-top:10px;">
        <summary>Generate practice problems</summary>
        <div class="controls" style="margin:10px 0;">
          <button id="genPractice" class="primary">New set</button>
        </div>
        <ol class="practice" id="practice"></ol>
      </details>
    `;

    wrap.appendChild(controlsCard);
    wrap.appendChild(chartCard);
    wrap.appendChild(vizCard);
    wrap.appendChild(explainCard);
    root.appendChild(wrap);

    // Cache refs
    this.refs = {
      chart: chartCard.querySelector("#chart"),
      markers: chartCard.querySelector("#markers"),
      particles: vizCard.querySelector("#particles"),
      vAdded: controlsCard.querySelector("#vAdded"),
      vEq: controlsCard.querySelector("#vEq"),
      pH: controlsCard.querySelector("#pH"),
      h: controlsCard.querySelector("#h"),
      prog: controlsCard.querySelector("#prog"),
      rate: controlsCard.querySelector("#rate"),
      rateVal: controlsCard.querySelector("#rateVal"),
      explain: explainCard.querySelector("#explain"),
      practice: explainCard.querySelector("#practice"),
    };

    // Events
    const qs = (sel) => controlsCard.querySelector(sel);
    qs("#acidM").addEventListener("change", (e) => {
      this.params.acidM = clamp(Number(e.target.value) || 0.1, 0.001, 5);
      this.reset(false);
    });
    qs("#acidMl").addEventListener("change", (e) => {
      this.params.acidMl = clamp(Number(e.target.value) || 50, 1, 500);
      this.reset(false);
    });
    qs("#pKa").addEventListener("change", (e) => {
      this.params.pKa = clamp(Number(e.target.value) || 4.76, -1, 14);
      this.reset(false);
    });
    qs("#baseM").addEventListener("change", (e) => {
      this.params.baseM = clamp(Number(e.target.value) || 0.1, 0.001, 5);
      this.reset(false);
    });
    this.refs.rate.addEventListener("input", (e) => {
      this.state.autoRateMlPerSec = Number(e.target.value);
      this.refs.rateVal.textContent = this.state.autoRateMlPerSec.toFixed(2);
    });
    this.refs.rateVal.textContent = this.state.autoRateMlPerSec.toFixed(2);

    qs("#start").addEventListener("click", () => this.start());
    qs("#auto").addEventListener("click", () => this.startAuto());
    qs("#stop").addEventListener("click", () => this.stop());
    qs("#reset").addEventListener("click", () => this.reset(true));
    qs("#stepSmall").addEventListener("click", () => this.stepAdd(0.1));
    qs("#stepBig").addEventListener("click", () => this.stepAdd(1.0));
    qs("#togglePlot").addEventListener("click", (e) =>
      this.togglePlot(e.target)
    );
    qs("#toggleParticles").addEventListener("click", (e) =>
      this.toggleParticles(e.target)
    );
    qs("#analyze").addEventListener("click", () => this.showAnalysis());

    explainCard
      .querySelector("#genPractice")
      .addEventListener("click", () => this.generatePractice());

    // Initial paint
    this.drawChart();
    this.drawParticles();
    this.updateExplainer();
  }

  reset(clearData) {
    this.stop();
    if (clearData) {
      this.state.dataPoints = [];
    }
    this.state.addedBaseMl = 0;
    this.state.elapsedSec = 0;
    this.state.analysisShown = false;
    this.updateAll();
  }

  start() {
    this.stop();
    this.state.running = true;
    this.state.autoFlow = false;
    this.state.startTimeMs = performance.now();
    this.state.elapsedSec = 0;
    this.lastTickMs = performance.now();
    this.rafId = requestAnimationFrame((t) => this.loop(t));
  }

  startAuto() {
    if (this.state.autoFlow) return;
    this.state.autoFlow = true;
    if (!this.state.running) {
      this.start();
      return;
    }
    this.rafId = requestAnimationFrame((t) => this.loop(t));
  }

  loop(now) {
    if (!this.state.running) return;
    const dt = clamp((now - this.lastTickMs) / 1000, 0, 0.05);
    this.lastTickMs = now;
    if (this.state.autoFlow) {
      const dv = this.state.autoRateMlPerSec * dt;
      this.state.addedBaseMl += dv;
    }
    this.state.elapsedSec = (now - this.state.startTimeMs) / 1000;
    this.recordPoint();
    this.updateAll();

    // Auto-stop after 1.6× equivalence volume to show full curve
    const eqMl =
      ((this.params.acidM * (this.params.acidMl / 1000)) / this.params.baseM) *
      1000;
    if (this.state.addedBaseMl >= 1.6 * eqMl) {
      this.stop();
      this.showAnalysis();
      return;
    }

    this.rafId = requestAnimationFrame((t) => this.loop(t));
  }

  stepAdd(ml) {
    this.state.addedBaseMl += ml;
    this.recordPoint();
    this.updateAll();
  }

  recordPoint() {
    const point = computeTitrationPoint(this.params, this.state.addedBaseMl);
    this.state.dataPoints.push({
      t: this.state.elapsedSec,
      vMl: this.state.addedBaseMl,
      pH: point.pH,
      h: point.hPlus,
    });
  }

  togglePlot(btn) {
    this.plotMode =
      this.plotMode === "h"
        ? "ph"
        : (this.plotMode || "ph") === "ph"
        ? "h"
        : "ph";
    btn.textContent = this.plotMode === "h" ? "Plot: [H+]" : "Plot: pH";
    this.drawChart();
  }

  toggleParticles(btn) {
    this.particlesOn =
      this.particlesOn === false
        ? true
        : this.particlesOn === true
        ? false
        : false;
    btn.textContent = this.particlesOn ? "Particles: On" : "Particles: Off";
    this.drawParticles();
  }

  updateAll() {
    const point = computeTitrationPoint(this.params, this.state.addedBaseMl);
    const eqMl = point.vEqMl;

    // Stats
    this.refs.vAdded.textContent = formatNumber(this.state.addedBaseMl, 2);
    this.refs.vEq.textContent = formatNumber(eqMl, 2);
    this.refs.pH.textContent = formatNumber(point.pH, 2);
    this.refs.h.textContent = formatNumber(point.hPlus, 2);
    const prog = clamp(this.state.addedBaseMl / (1.6 * eqMl), 0, 1);
    this.refs.prog.style.width = (prog * 100).toFixed(1) + "%";

    this.drawChart();
    this.drawParticles();
    this.updateExplainer(point);
  }

  drawChart() {
    const canvas = this.refs.chart;
    const ctx = canvas.getContext("2d");
    const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const cssW = canvas.clientWidth || 900;
    const cssH = canvas.clientHeight || 480;
    canvas.width = Math.floor(cssW * DPR);
    canvas.height = Math.floor(cssH * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const padding = { l: 48, r: 12, t: 18, b: 36 };
    const w = cssW - padding.l - padding.r;
    const h = cssH - padding.t - padding.b;
    ctx.save();
    ctx.translate(padding.l, padding.t);

    // Axes and grid
    ctx.fillStyle = "#0a0f19";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#223047";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const y = (h / 6) * i;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();

    const points = this.state.dataPoints;
    if (points.length === 0) {
      ctx.restore();
      this.refs.markers.innerHTML = "";
      return;
    }

    const maxVmL = Math.max(...points.map((p) => p.vMl));
    const eqMl =
      ((this.params.acidM * (this.params.acidMl / 1000)) / this.params.baseM) *
      1000;
    const xMax = Math.max(maxVmL, eqMl * 1.6);

    // y-scale
    const mode = this.plotMode === "h" ? "h" : "ph";
    let yMin, yMax;
    if (mode === "ph") {
      yMin = 0;
      yMax = 14;
    } else {
      // [H+] from 1e-14 to 1
      yMin = 1e-14;
      yMax = 1;
    }

    // Axis labels
    ctx.fillStyle = "#a9b4c2";
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto";
    ctx.textAlign = "center";
    ctx.fillText("Added base (mL)", w / 2, h + 26);
    ctx.save();
    ctx.translate(-36, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(mode === "ph" ? "pH" : "[H+] (M)", 0, 0);
    ctx.restore();

    function xScale(v) {
      return (v / xMax) * w;
    }
    function yScale(y) {
      if (mode === "ph") return h - ((y - yMin) / (yMax - yMin)) * h;
      // log scale for [H+]
      const ly =
        (log10(yMax) - log10(Math.max(y, 1e-16))) / (log10(yMax) - log10(yMin));
      return clamp(ly * h, 0, h);
    }

    // Shade buffer region roughly 0.1 to 0.9 × eq
    ctx.fillStyle = "rgba(90,200,250,0.08)";
    const bufStart = xScale(eqMl * 0.1);
    const bufEnd = xScale(eqMl * 0.9);
    ctx.fillRect(bufStart, 0, Math.max(0, bufEnd - bufStart), h);

    // Vertical line: equivalence
    ctx.strokeStyle = "#345a7a";
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(xScale(eqMl), 0);
    ctx.lineTo(xScale(eqMl), h);
    ctx.stroke();
    ctx.setLineDash([]);

    // Curve
    ctx.strokeStyle = mode === "ph" ? "#5ac8fa" : "#ffd60a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = xScale(p.vMl);
      const y = yScale(mode === "ph" ? p.pH : p.h);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Markers UI (HTML)
    const markers = [];
    const halfEq = eqMl / 2;
    const pAtHalfEq = computeTitrationPoint(this.params, halfEq).pH;
    markers.push(
      `<span class="marker">Half-eq: ${formatNumber(
        halfEq,
        2
      )} mL (pH ≈ pKa)</span>`
    );
    markers.push(
      `<span class="marker">Equivalence: ${formatNumber(eqMl, 2)} mL</span>`
    );
    this.refs.markers.innerHTML = markers.join("");

    // Dots for half-eq and eq
    function drawMarkerDot(vol, color) {
      const p = computeTitrationPoint({ ...this.params }, vol);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(
        xScale(vol),
        yScale(mode === "ph" ? p.pH : p.hPlus),
        4,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    drawMarkerDot.call(this, halfEq, "#8ab6ff");
    drawMarkerDot.call(this, eqMl, "#ff7a7a");

    ctx.restore();
  }

  drawParticles() {
    const canvas = this.refs.particles;
    const ctx = canvas.getContext("2d");
    const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const cssW = canvas.clientWidth || 900;
    const cssH = canvas.clientHeight || 360;
    canvas.width = Math.floor(cssW * DPR);
    canvas.height = Math.floor(cssH * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    if (this.particlesOn === false) {
      ctx.fillStyle = "#0c121d";
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.fillStyle = "#a9b4c2";
      ctx.font = "14px system-ui, -apple-system, Segoe UI, Roboto";
      ctx.fillText("Particles disabled", 16, 24);
      return;
    }

    const point = computeTitrationPoint(this.params, this.state.addedBaseMl);
    const vL = point.vTotalL;
    const concScale = 400; // approx max total particles
    const cHA = point.nHA / vL;
    const cA = point.nA / vL;
    let cH = point.hPlus;
    let cOH = KW / Math.max(cH, 1e-16);

    const nHA = Math.round(clamp(cHA * concScale, 0, 240));
    const nA = Math.round(clamp(cA * concScale, 0, 240));
    const nH = Math.round(clamp(cH * concScale * 100, 0, 120));
    const nOH = Math.round(clamp(cOH * concScale * 100, 0, 120));

    // Random layout grid
    function drawSet(count, color) {
      ctx.fillStyle = color;
      for (let i = 0; i < count; i++) {
        const x = 12 + Math.random() * (cssW - 24);
        const y = 12 + Math.random() * (cssH - 24);
        ctx.beginPath();
        ctx.arc(x, y, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = "#0c121d";
    ctx.fillRect(0, 0, cssW, cssH);
    drawSet(nHA, "#5ac8fa"); // HA
    drawSet(nA, "#8ab6ff"); // A-
    drawSet(nH, "#ffd60a"); // H+
    drawSet(nOH, "#34c759"); // OH-
  }

  updateExplainer(point) {
    const p =
      point || computeTitrationPoint(this.params, this.state.addedBaseMl);
    const eqMl = p.vEqMl;
    const halfEq = eqMl / 2;
    const phase = p.stage;
    const msgs = [];
    msgs.push(
      `<div>You're ${formatNumber(
        this.state.addedBaseMl,
        2
      )} mL into the titration. Equivalence is at <span class="key">${formatNumber(
        eqMl,
        2
      )} mL</span>.</div>`
    );
    if (phase === "initial") {
      msgs.push(
        `<div>Initial pH is governed by weak acid dissociation. For a weak acid, [H<sup>+</sup>] ≈ √(K<sub>a</sub>C<sub>HA</sub>).</div>`
      );
    } else if (phase === "buffer") {
      msgs.push(
        `<div>You're in the <span class="key">buffer region</span>. The Henderson–Hasselbalch equation applies: pH = pK<sub>a</sub> + log([A<sup>-</sup>]/[HA]).</div>`
      );
      if (Math.abs(this.state.addedBaseMl - halfEq) < 0.3) {
        msgs.push(
          `<div>At half-equivalence, pH ≈ pK<sub>a</sub>. Here pH = ${formatNumber(
            this.params.pKa,
            2
          )}.</div>`
        );
      }
    } else if (phase === "equivalence") {
      msgs.push(
        `<div>At equivalence, all HA has converted to A<sup>-</sup>. The solution is basic due to A<sup>-</sup> hydrolysis.</div>`
      );
    } else {
      msgs.push(
        `<div>Beyond equivalence, excess strong base controls pH: pOH = -log([OH<sup>-</sup>]).</div>`
      );
    }
    this.refs.explain.innerHTML = msgs.join("");
  }

  showAnalysis() {
    if (this.state.analysisShown) return;
    this.state.analysisShown = true;
    const eqMl =
      ((this.params.acidM * (this.params.acidMl / 1000)) / this.params.baseM) *
      1000;
    const halfEq = eqMl / 2;
    const pHalf = computeTitrationPoint(this.params, halfEq).pH;
    const pEq = computeTitrationPoint(this.params, eqMl).pH;
    const notes = [
      `Initial pH from weak acid dissociation`,
      `Buffer region (≈ 10%–90% of V_eq): pH follows Henderson–Hasselbalch`,
      `Half-equivalence at ${formatNumber(
        halfEq,
        2
      )} mL: pH ≈ pK_a = ${formatNumber(
        this.params.pKa,
        2
      )} (here ${formatNumber(pHalf, 2)})`,
      `Equivalence at ${formatNumber(eqMl, 2)} mL: pH = ${formatNumber(
        pEq,
        2
      )} (basic due to A⁻)`,
    ];
    const html = `
      <ul>
        ${notes.map((n) => `<li>${n}</li>`).join("")}
      </ul>
      <p class="muted">Tip: Changing pK<sub>a</sub> shifts the buffer plateau vertically without moving V<sub>eq</sub>. Changing concentrations scales the x-axis.</p>
    `;
    this.refs.explain.insertAdjacentHTML("beforeend", html);
  }

  generatePractice() {
    const rng = (min, max, step) => {
      const n = Math.round((min + Math.random() * (max - min)) / step) * step;
      return Number(n.toFixed(2));
    };
    const items = [];
    for (let i = 0; i < 5; i++) {
      const acidM = rng(0.05, 0.3, 0.01);
      const acidMl = rng(25, 75, 1);
      const pKa = rng(3.2, 5.2, 0.01);
      const baseM = rng(0.05, 0.3, 0.01);
      const vEqMl = ((acidM * (acidMl / 1000)) / baseM) * 1000;
      const halfEq = vEqMl / 2;
      const v1 = rng(0, Math.max(0.1, halfEq - 5), 0.1);
      const v2 = halfEq;
      const v3 = vEqMl;
      const v4 = rng(vEqMl + 2, vEqMl + 15, 0.1);
      const p1 = computeTitrationPoint({ acidM, acidMl, baseM, pKa }, v1).pH;
      const p2 = computeTitrationPoint({ acidM, acidMl, baseM, pKa }, v2).pH;
      const p3 = computeTitrationPoint({ acidM, acidMl, baseM, pKa }, v3).pH;
      const p4 = computeTitrationPoint({ acidM, acidMl, baseM, pKa }, v4).pH;
      const text = `A ${acidM} M weak acid (pK_a=${pKa}) sample of ${acidMl} mL is titrated with ${baseM} M NaOH. Find the pH at (i) ${formatNumber(
        v1,
        2
      )} mL, (ii) half-equivalence, (iii) equivalence, (iv) ${formatNumber(
        v4,
        2
      )} mL.`;
      const sol = `i) ${formatNumber(p1, 2)}, ii) ${formatNumber(
        p2,
        2
      )} (≈ pK_a), iii) ${formatNumber(p3, 2)}, iv) ${formatNumber(p4, 2)}.`;
      items.push({ text, sol });
    }
    this.refs.practice.innerHTML = items
      .map(
        (it, idx) =>
          `<li><div>${idx + 1}. ${
            it.text
          }</div><div class="muted" style="margin-top:4px;">Solution: ${
            it.sol
          }</div></li>`
      )
      .join("");
  }
}

customElements.define("ap-chem-titration", APChemTitrationElement);

export function mountAPChem(root) {
  root.innerHTML = `
    <section class="panel narrow">
      <h2 class="section-title">AP Chem: Acid–Base Buffers & Titration Curve</h2>
      <p class="muted">Explore a weak acid–strong base titration. Add base manually or with auto flow to build the titration curve in real-time, watch particles react, and analyze key features.</p>
    </section>
    <section class="panel">
      <ap-chem-titration></ap-chem-titration>
    </section>
  `;

  // No global listeners; return cleanup to stop animations if needed
  const el = root.querySelector("ap-chem-titration");
  return () => {
    if (el && el.stop) el.stop();
  };
}
