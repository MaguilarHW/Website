/* Main SPA router and page shell */

import { mountBlackjack } from "./blackjack.js";
import { mountHighLow } from "./highlow.js";
import { mountGems } from "./gems.js";
import { mountAPChem } from "./apchem.js";
import { mountIMFs } from "./imfs.js";

const app = document.getElementById("app");
let currentCleanup = null;

function setActiveNav(hash) {
  const links = document.querySelectorAll(".site-nav .nav-link");
  links.forEach((link) => {
    if (link.getAttribute("href") === hash) {
      link.classList.add("active");
    } else {
      link.classList.remove("active");
    }
  });
}

function renderHome() {
  app.innerHTML = `
    <section class="landing">
      <div class="landing-inner">
        <div class="deck" id="deck"></div>
        <div class="deck-hint muted">
          <span class="kbd">←</span> / <span class="kbd">→</span> to leaf • drag to fan • Enter to open
        </div>
      </div>
    </section>
  `;

  const games = [
    {
      id: "blackjack",
      title: "Blackjack",
      subtitle: "Beat the dealer to 21",
      suit: "♠",
      color: "black",
    },
    {
      id: "highlow",
      title: "High–Low",
      subtitle: "Guess the next card",
      suit: "♥",
      color: "red",
    },
    {
      id: "gems",
      title: "Gems",
      subtitle: "Chase rare multipliers",
      suit: "♦",
      color: "red",
    },
    {
      id: "compendium",
      title: "Compendium",
      subtitle: "Rules and histories",
      suit: "♣",
      color: "black",
    },
  ];

  const deckEl = document.getElementById("deck");
  // buttons removed; keep keyboard and drag/open

  let topIndex = 0; // index in games[] that is on top
  let isDragging = false;
  let dragStartX = 0;
  let dragDx = 0;

  function createCard(game, index) {
    const wrap = document.createElement("div");
    wrap.className = "deck-card";

    const card = document.createElement("div");
    card.className = "card game-card" + (game.color === "red" ? " red" : "");

    // Bigger format card face
    card.style.borderRadius = "16px";
    card.style.width = "100%";
    card.style.height = "100%";

    // Front content
    const tl = document.createElement("div");
    tl.className = "corner tl";
    tl.textContent = game.suit;
    const br = document.createElement("div");
    br.className = "corner br";
    br.textContent = game.suit;

    const center = document.createElement("div");
    center.className = "center";
    center.innerHTML = `
      <div>
        <div class="game-title">${game.title}</div>
        <div class="subtitle">${game.subtitle}</div>
      </div>
    `;

    card.appendChild(tl);
    card.appendChild(br);
    card.appendChild(center);

    wrap.appendChild(card);
    wrap.dataset.index = String(index);
    return wrap;
  }

  function layout(fanX = 0) {
    const children = Array.from(deckEl.children);
    const total = children.length;
    children.forEach((el) => {
      const idx = Number(el.dataset.index || 0);
      const pos = (((idx - topIndex) % total) + total) % total; // 0 is top
      const rotate = 0; // default: no askew at rest
      const translateY = pos * -2;
      const scale = 1 - pos * 0.02;
      el.style.zIndex = String(100 + (total - pos));
      el.classList.toggle("is-top", pos === 0);
      el.dataset.pos = String(pos);
      const factor = Math.max(0, 1 - pos * 0.16);
      const fanNorm = Math.max(-1, Math.min(1, fanX / 140));
      const fanAngle = fanNorm * 20 * factor; // degrees
      const fanSpread = fanNorm * 18 * factor; // px lateral
      el.style.transform = `translate(-50%, calc(-50% + ${translateY}px)) rotate(${
        rotate + fanAngle
      }deg) translateX(${fanSpread}px) scale(${scale})`;
      el.classList.toggle("is-hidden", pos > 6);

      // Card faces vs backs: only top card shows face content
      const cardEl = el.firstElementChild;
      if (cardEl) {
        if (pos === 0) {
          cardEl.classList.remove("back");
        } else {
          cardEl.classList.add("back");
        }
      }
    });
  }

  function advance(delta) {
    const total = games.length;
    topIndex = (topIndex + delta + total) % total;
    layout();
  }

  function openTop() {
    const game = games[topIndex % games.length];
    window.location.hash = `#/${game.id}`;
  }

  // Build DOM in stack order: top first so later ones sit underneath
  games.forEach((game, idx) => {
    const el = createCard(game, idx);
    deckEl.appendChild(el);
  });
  // Shuffle animation on load
  (function shuffleIn() {
    const children = Array.from(deckEl.children);
    children.forEach((el, i) => {
      el.style.transition = "none";
      el.style.transform = `translate(-50%, -80%) rotate(${
        (Math.random() - 0.5) * 14
      }deg)`;
      el.style.opacity = "0";
    });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        children.forEach((el, i) => {
          el.style.transition =
            "transform 0.38s ease, filter 0.18s ease, opacity 0.22s ease";
          setTimeout(() => {
            el.style.opacity = "1";
            layout(0);
          }, i * 70);
        });
      });
    });
  })();

  // Controls removed; keyboard and click/drag remain

  // Keyboard
  function onKey(e) {
    if (e.key === "ArrowLeft") {
      advance(-1);
    } else if (e.key === "ArrowRight") {
      advance(1);
    } else if (e.key === "Enter") {
      openTop();
    }
  }
  window.addEventListener("keydown", onKey);

  // Drag/fan interaction
  function onPointerDown(e) {
    isDragging = true;
    dragStartX =
      typeof e.touches?.[0] !== "undefined" ? e.touches[0].clientX : e.clientX;
    dragDx = 0;
    deckEl.setPointerCapture?.(e.pointerId || 1);
  }
  function onPointerMove(e) {
    if (!isDragging) return;
    const x =
      typeof e.touches?.[0] !== "undefined" ? e.touches[0].clientX : e.clientX;
    dragDx = x - dragStartX;
    layout(dragDx);
  }
  function onPointerUp() {
    if (!isDragging) return;
    isDragging = false;
    if (Math.abs(dragDx) > 40) {
      advance(dragDx > 0 ? -1 : 1);
    } else {
      layout();
    }
  }

  deckEl.addEventListener("mousedown", onPointerDown);
  window.addEventListener("mousemove", onPointerMove);
  window.addEventListener("mouseup", onPointerUp);
  deckEl.addEventListener("touchstart", onPointerDown, { passive: true });
  window.addEventListener("touchmove", onPointerMove, { passive: true });
  window.addEventListener("touchend", onPointerUp, { passive: true });

  // Click top card to open
  deckEl.addEventListener("click", (e) => {
    if (isDragging) return; // don't open while dragging
    const targetCard =
      e.target && e.target.closest ? e.target.closest(".deck-card") : null;
    if (targetCard && targetCard.dataset && targetCard.dataset.pos === "0") {
      openTop();
    }
  });

  // 3D tilt on hover for the top card
  const tiltMax = 12; // degrees, slightly more noticeable
  function applyTilt(e) {
    const topEl = Array.from(deckEl.children).find(
      (el) => el.dataset.pos === "0"
    );
    if (!topEl) return;
    const rect = deckEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) / (rect.width / 2);
    const dy = (e.clientY - cy) / (rect.height / 2);
    const rx = Math.max(-1, Math.min(1, dy)) * -tiltMax;
    const ry = Math.max(-1, Math.min(1, dx)) * tiltMax;
    const base = topEl.style.transform || "translate(-50%, -50%)";
    // Recompute transform from layout to keep consistent
    layout(0);
    topEl.style.transform += ` rotateX(${rx}deg) rotateY(${ry}deg)`;
  }
  function resetTilt() {
    layout(0);
  }
  deckEl.addEventListener("mousemove", applyTilt);
  deckEl.addEventListener("mouseleave", resetTilt);

  // Cleanup when navigating away
  currentCleanup = () => {
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("mousemove", onPointerMove);
    window.removeEventListener("mouseup", onPointerUp);
    window.removeEventListener("touchmove", onPointerMove);
    window.removeEventListener("touchend", onPointerUp);
  };
}

function renderCompendium() {
  app.innerHTML = `
    <section class="panel compact">
      <h2 class="section-title">Card Game Compendium</h2>
      <div class="grid">
        <div>
          <h3>Blackjack</h3>
          <p>Players compete against the dealer. Each hand starts with two cards. Number cards are worth their face value, face cards are worth 10, and Aces are worth 1 or 11. Players may <em>hit</em> to take another card or <em>stand</em> to hold. The dealer draws until 17+, hitting on soft 17 in many casinos. Exceeding 21 is a bust. A 2-card 21 is a "blackjack" and typically pays 3:2.</p>
        </div>
        <div>
          <h3>High-Low</h3>
          <p>Reveal a starting card, then guess whether the next card is higher, lower, or equal by rank (A low). Correct guesses extend your streak; wrong guesses end the round.</p>
        </div>
        <div>
          <h3>Poker (Overview)</h3>
          <p>Umbrella term for many games like Texas Hold'em and Five-Card Draw. Players form the best 5-card hand using community and/or hole cards. Betting rounds, blinds/antes, and hand rankings (e.g., pair, straight, flush) define play.</p>
        </div>
        <div>
          <h3>War</h3>
          <p>Two players split the deck. Each reveals top cards; higher rank wins both cards. Ties trigger "war" where more cards are placed face-down then another face-up card resolves the battle.</p>
        </div>
        <div>
          <h3>Go Fish</h3>
          <p>Players ask opponents for ranks they hold to form books (four of a kind). If refused, they "go fish" and draw from the deck. The player with most books wins.</p>
        </div>
      </div>
    </section>
  `;
}

function renderBlackjack() {
  // Mount returns optional cleanup
  currentCleanup = mountBlackjack(app) || null;
}

function renderHighLow() {
  currentCleanup = mountHighLow(app) || null;
}

function renderGems() {
  currentCleanup = mountGems(app) || null;
}

function router() {
  const hash = window.location.hash || "#/";
  setActiveNav(hash);
  if (currentCleanup) {
    try {
      currentCleanup();
    } catch (_) {}
    currentCleanup = null;
  }
  const route = hash.replace("#/", "");
  if (route === "" || route === "/") {
    renderHome();
  } else if (route === "blackjack") {
    renderBlackjack();
  } else if (route === "highlow") {
    renderHighLow();
  } else if (route === "compendium") {
    renderCompendium();
  } else if (route === "gems") {
    renderGems();
  } else if (route === "apchem") {
    currentCleanup = mountAPChem(app) || null;
  } else if (route === "imfs") {
    currentCleanup = mountIMFs(app) || null;
  } else if (route === "mvcalc") {
    import("./mvcalc.js")
      .then((m) => {
        currentCleanup = m.mountMVCalc(app) || null;
      })
      .catch((err) => {
        app.innerHTML = `<section class="panel compact"><h2 class="section-title">MV Calc</h2><p class="message is-danger">Failed to load MV Calc module.</p><pre class="muted" style="white-space: pre-wrap;">${String(
          err
        )}</pre></section>`;
      });
    return;
  } else {
    app.innerHTML = `<section class="panel compact"><h2 class="section-title">Not Found</h2><p>That page does not exist.</p></section>`;
  }
}

window.addEventListener("hashchange", router);
window.addEventListener("DOMContentLoaded", router);
