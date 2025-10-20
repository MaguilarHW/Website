/* Pong game: rendering, input, physics, scoring, pause/reset */

const canvas = document.getElementById("pong");
const ctx = canvas.getContext("2d");

const scoreEl = document.getElementById("score");
const messageEl = document.getElementById("message");
const btnStart = document.getElementById("btn-start");
const btnPause = document.getElementById("btn-pause");
const btnReset = document.getElementById("btn-reset");

const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

// Game constants
const FIELD = { width: 800, height: 500, wall: 12 };
const BALL_RADIUS = 8;
const PADDLE = { width: 12, height: 80, speed: 380 };
const AI = { trackSpeed: 320, error: 0.12 };
const MAX_SCORE = 7;

/** Utility to scale canvas for HiDPI displays while keeping CSS pixel size */
function setupHiDPI() {
  const cssW = canvas.getAttribute("width");
  const cssH = canvas.getAttribute("height");
  const w = Number(cssW);
  const h = Number(cssH);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  canvas.width = Math.floor(w * DPR);
  canvas.height = Math.floor(h * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

setupHiDPI();

/** Game state */
const state = {
  running: false,
  paused: false,
  lastTime: 0,
  left: { x: 24, y: FIELD.height / 2 - PADDLE.height / 2, vy: 0, score: 0 },
  right: {
    x: FIELD.width - 24 - PADDLE.width,
    y: FIELD.height / 2 - PADDLE.height / 2,
    vy: 0,
    score: 0,
  },
  ball: { x: FIELD.width / 2, y: FIELD.height / 2, vx: 0, vy: 0 },
};

function randSign() {
  return Math.random() < 0.5 ? -1 : 1;
}

function serveBall(toLeft = false) {
  const angle = (Math.random() * 0.6 - 0.3) * Math.PI; // slight vertical angle
  const speed = 360 + Math.random() * 80;
  const dirX = toLeft ? -1 : 1;
  state.ball.x = FIELD.width / 2;
  state.ball.y = FIELD.height / 2;
  state.ball.vx = Math.cos(angle) * speed * dirX;
  state.ball.vy = Math.sin(angle) * speed * randSign();
}

function resetGame() {
  state.left.y = FIELD.height / 2 - PADDLE.height / 2;
  state.right.y = FIELD.height / 2 - PADDLE.height / 2;
  state.left.score = 0;
  state.right.score = 0;
  state.running = false;
  state.paused = false;
  messageEl.textContent = "";
  updateScore();
  render(0);
}

function updateScore() {
  scoreEl.textContent = `${state.left.score} — ${state.right.score}`;
}

// Input handling
const keys = new Set();
window.addEventListener("keydown", (e) => {
  if (["ArrowUp", "ArrowDown", " ", "Space"].includes(e.key))
    e.preventDefault();
  keys.add(e.key);
  if (e.key === " ") togglePause();
});
window.addEventListener("keyup", (e) => {
  keys.delete(e.key);
});

btnStart.addEventListener("click", () => startMatch());
btnPause.addEventListener("click", () => togglePause());
btnReset.addEventListener("click", () => resetGame());

function startMatch() {
  if (!state.running) {
    serveBall(Math.random() < 0.5);
    state.running = true;
    state.paused = false;
    state.lastTime = performance.now();
    messageEl.textContent = "";
    requestAnimationFrame(loop);
  }
}

function togglePause() {
  if (!state.running) return;
  state.paused = !state.paused;
  messageEl.textContent = state.paused ? "Paused" : "";
  if (!state.paused) {
    state.lastTime = performance.now();
    requestAnimationFrame(loop);
  }
}

function loop(now) {
  if (!state.running || state.paused) return;
  const dt = Math.min(0.033, (now - state.lastTime) / 1000);
  state.lastTime = now;
  update(dt);
  render(dt);
  requestAnimationFrame(loop);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function update(dt) {
  // Player input: left paddle W/S; right paddle arrows
  const upL = keys.has("w") || keys.has("W");
  const dnL = keys.has("s") || keys.has("S");
  const upR = keys.has("ArrowUp");
  const dnR = keys.has("ArrowDown");

  state.left.vy = (upL ? -1 : 0) + (dnL ? 1 : 0);
  state.right.vy = (upR ? -1 : 0) + (dnR ? 1 : 0);

  // If right paddle not controlled, use simple AI assist when no arrow keys pressed
  if (!upR && !dnR) {
    const target =
      state.ball.y -
      PADDLE.height / 2 +
      (Math.random() - 0.5) * PADDLE.height * AI.error;
    const dir = Math.sign(target - state.right.y);
    state.right.vy = dir * (AI.trackSpeed / PADDLE.speed);
  }

  state.left.y += state.left.vy * PADDLE.speed * dt;
  state.right.y += state.right.vy * PADDLE.speed * dt;

  state.left.y = clamp(
    state.left.y,
    FIELD.wall,
    FIELD.height - FIELD.wall - PADDLE.height
  );
  state.right.y = clamp(
    state.right.y,
    FIELD.wall,
    FIELD.height - FIELD.wall - PADDLE.height
  );

  // Ball physics
  state.ball.x += state.ball.vx * dt;
  state.ball.y += state.ball.vy * dt;

  // Collide with top/bottom walls
  if (state.ball.y - BALL_RADIUS < FIELD.wall) {
    state.ball.y = FIELD.wall + BALL_RADIUS;
    state.ball.vy = Math.abs(state.ball.vy);
  } else if (state.ball.y + BALL_RADIUS > FIELD.height - FIELD.wall) {
    state.ball.y = FIELD.height - FIELD.wall - BALL_RADIUS;
    state.ball.vy = -Math.abs(state.ball.vy);
  }

  // Paddle rectangles
  const leftRect = {
    x: state.left.x,
    y: state.left.y,
    w: PADDLE.width,
    h: PADDLE.height,
  };
  const rightRect = {
    x: state.right.x,
    y: state.right.y,
    w: PADDLE.width,
    h: PADDLE.height,
  };

  // Ball-rectangle collision helper
  function collideWith(rect, fromLeft) {
    const bx = state.ball.x;
    const by = state.ball.y;
    const nx = clamp(bx, rect.x, rect.x + rect.w);
    const ny = clamp(by, rect.y, rect.y + rect.h);
    const dx = bx - nx;
    const dy = by - ny;
    if (dx * dx + dy * dy <= BALL_RADIUS * BALL_RADIUS) {
      // Reflect X velocity, add spin based on hit position
      const hitPos = (by - (rect.y + rect.h / 2)) / (rect.h / 2);
      const speed = Math.hypot(state.ball.vx, state.ball.vy) * 1.04; // small acceleration per hit
      const angle = hitPos * 0.6; // max ~34° off horizontal
      const dirX = fromLeft ? 1 : -1;
      state.ball.vx = Math.cos(angle) * speed * dirX;
      state.ball.vy = Math.sin(angle) * speed;
      // Nudge ball out of paddle to avoid sticking
      state.ball.x = fromLeft
        ? rect.x + rect.w + BALL_RADIUS
        : rect.x - BALL_RADIUS;
    }
  }

  if (
    state.ball.x - BALL_RADIUS <= leftRect.x + leftRect.w &&
    state.ball.vx < 0
  ) {
    collideWith(leftRect, true);
  }
  if (state.ball.x + BALL_RADIUS >= rightRect.x && state.ball.vx > 0) {
    collideWith(rightRect, false);
  }

  // Scoring
  if (state.ball.x < -40) {
    state.right.score += 1;
    updateScore();
    checkWin();
    if (state.running) serveBall(false);
  } else if (state.ball.x > FIELD.width + 40) {
    state.left.score += 1;
    updateScore();
    checkWin();
    if (state.running) serveBall(true);
  }
}

function checkWin() {
  if (state.left.score >= MAX_SCORE || state.right.score >= MAX_SCORE) {
    state.running = false;
    const winner = state.left.score > state.right.score ? "Left" : "Right";
    messageEl.textContent = `${winner} wins! Click Start to play again.`;
  }
}

function drawNet() {
  ctx.save();
  ctx.strokeStyle = "#2a3241";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(FIELD.width / 2, FIELD.wall);
  ctx.lineTo(FIELD.width / 2, FIELD.height - FIELD.wall);
  ctx.stroke();
  ctx.restore();
}

function render() {
  // Clear
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Field background is provided by CSS. Draw walls.
  ctx.fillStyle = "#0f1520";
  ctx.fillRect(0, 0, FIELD.width, FIELD.wall); // top
  ctx.fillRect(0, FIELD.height - FIELD.wall, FIELD.width, FIELD.wall); // bottom

  drawNet();

  // Paddles
  ctx.fillStyle = "#d8f1ff";
  ctx.fillRect(state.left.x, state.left.y, PADDLE.width, PADDLE.height);
  ctx.fillRect(state.right.x, state.right.y, PADDLE.width, PADDLE.height);

  // Ball
  ctx.beginPath();
  ctx.arc(state.ball.x, state.ball.y, BALL_RADIUS, 0, Math.PI * 2);
  ctx.fill();
}

// Responsive canvas: keep aspect but fit narrow screens
function resizeCanvasToContainer() {
  const container = canvas.parentElement;
  const maxWidth = Math.min(container.clientWidth - 2, 1000);
  const aspect = FIELD.width / FIELD.height;
  let w = Math.min(FIELD.width, maxWidth);
  let h = Math.round(w / aspect);
  // Apply CSS size only; internal buffer is DPR-scaled
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
}

window.addEventListener("resize", resizeCanvasToContainer);
resizeCanvasToContainer();

// Initial frame
resetGame();
