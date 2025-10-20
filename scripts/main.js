/* Main SPA router and page shell */

import { mountBlackjack } from "./blackjack.js";
import { mountHighLow } from "./highlow.js";
import { mountGems } from "./gems.js";

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
    <section class="panel compact">
      <h2 class="section-title">Welcome</h2>
      <p class="muted">Explore classic card games and play right in your browser.</p>
    </section>
    <section class="grid cols-2 narrow">
      <div class="panel">
        <h3 class="section-title">Blackjack</h3>
        <p>Try to beat the dealer by getting as close to 21 as possible without going over.</p>
        <p><a class="btn primary" href="#/blackjack">Play Blackjack</a></p>
      </div>
      <div class="panel">
        <h3 class="section-title">High-Low</h3>
        <p>Guess if the next card will be higher, lower, or equal to the current one.</p>
        <p><a class="btn" href="#/highlow">Play High-Low</a></p>
      </div>
      <div class="panel">
        <h3 class="section-title">Gems</h3>
        <p>Draw cards to score points. Rare Gold and Diamond cards multiply your score.</p>
        <p><a class="btn" href="#/gems">Play Gems</a></p>
      </div>
    </section>
    <section class="panel compact" style="margin-top:16px;">
      <h3 class="section-title">Compendium</h3>
      <p>Read rules and histories for popular card games.</p>
      <p><a class="btn" href="#/compendium">Open Compendium</a></p>
    </section>
  `;
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
  } else {
    app.innerHTML = `<section class="panel compact"><h2 class="section-title">Not Found</h2><p>That page does not exist.</p></section>`;
  }
}

window.addEventListener("hashchange", router);
window.addEventListener("DOMContentLoaded", router);
