import { createDeck, drawCard, cardElement } from "./deck.js";

// Gems: Push-your-luck points game with rare Gold/Diamond cards
// - Draw cards to accumulate points this round
// - Face cards are 10, A is 11, numbers are face value
// - Gold cards (rare) x2 the drawn card's points
// - Diamond cards (rarer) x3 the drawn card's points
// - Stop anytime to bank your round score into high score

export function mountGems(app) {
  const state = {
    deck: createDeck(1),
    roundPoints: 0,
    highScore: 0,
    drawsThisRound: 0,
    maxDraws: 10,
    cards: [],
  };

  app.innerHTML = `
    <section class="panel narrow">
      <h2 class="section-title">Gems</h2>
      <div class="grid">
        <div class="panel">
          <div class="hud">
            <div><strong>Round:</strong> <span id="g-round">0</span> pts</div>
            <div><strong>High Score:</strong> <span id="g-high">0</span> pts</div>
            <div class="muted">Draws: <span id="g-draws">0</span>/<span id="g-max">10</span></div>
          </div>
          <div class="controls" style="margin-top:8px;">
            <button id="g-draw" class="primary">Draw</button>
            <button id="g-stop">Stop & Bank</button>
            <button id="g-new">New Round</button>
          </div>
        </div>
        <div class="panel">
          <h3 class="section-title">Your Cards</h3>
          <div id="g-cards" class="cards"></div>
          <div id="g-msg" class="message is-info"></div>
        </div>
      </div>
    </section>
  `;

  const elRound = app.querySelector("#g-round");
  const elHigh = app.querySelector("#g-high");
  const elDraws = app.querySelector("#g-draws");
  const elMax = app.querySelector("#g-max");
  const elDraw = app.querySelector("#g-draw");
  const elStop = app.querySelector("#g-stop");
  const elNew = app.querySelector("#g-new");
  const elCards = app.querySelector("#g-cards");
  const elMsg = app.querySelector("#g-msg");
  elMax.textContent = String(state.maxDraws);

  function setMsg(text, type = "info") {
    elMsg.textContent = text;
    elMsg.className = `message is-${type}`;
  }

  function basePointsFor(rank) {
    if (rank === "A") return 11;
    if (rank === "K" || rank === "Q" || rank === "J") return 10;
    return Number(rank);
  }

  function maybeApplyRarity(card) {
    // ~7% gold, ~3% diamond; mutually exclusive
    const r = Math.random();
    if (r < 0.03) card.rarity = "diamond";
    else if (r < 0.1) card.rarity = "gold";
  }

  function draw() {
    if (state.drawsThisRound >= state.maxDraws) {
      setMsg("No draws left this round.", "warning");
      return;
    }
    let c = drawCard(state.deck);
    if (!c) {
      // reset deck implicitly
      state.deck = createDeck(1);
      c = drawCard(state.deck);
    }
    maybeApplyRarity(c);
    state.cards.push(c);
    const base = basePointsFor(c.rank);
    const mult = c.rarity === "diamond" ? 3 : c.rarity === "gold" ? 2 : 1;
    const gain = base * mult;
    state.roundPoints += gain;
    state.drawsThisRound += 1;
    renderCards();
    updateHud();
    setMsg(
      `${c.rank}${c.suitSymbol} for ${gain} pts${
        mult > 1 ? ` (x${mult})` : ""
      }.`,
      mult > 1 ? "success" : "info"
    );
    if (state.drawsThisRound === state.maxDraws) {
      setMsg("Max draws reached. Consider banking your score.", "warning");
    }
  }

  function stopAndBank() {
    if (state.roundPoints > state.highScore) {
      state.highScore = state.roundPoints;
      setMsg("New high score! Round reset.", "success");
    } else {
      setMsg("Round banked. Try for a higher score!", "info");
    }
    newRound();
  }

  function newRound() {
    state.deck = createDeck(1);
    state.roundPoints = 0;
    state.drawsThisRound = 0;
    state.cards = [];
    renderCards();
    updateHud();
  }

  function renderCards() {
    elCards.innerHTML = "";
    state.cards.forEach((card, idx) => {
      const node = cardElement(card);
      node.style.setProperty("--i", idx);
      elCards.appendChild(node);
    });
  }

  function updateHud() {
    elRound.textContent = String(state.roundPoints);
    elHigh.textContent = String(state.highScore);
    elDraws.textContent = String(state.drawsThisRound);
  }

  elDraw.addEventListener("click", draw);
  elStop.addEventListener("click", stopAndBank);
  elNew.addEventListener("click", newRound);

  newRound();

  return function cleanup() {};
}
