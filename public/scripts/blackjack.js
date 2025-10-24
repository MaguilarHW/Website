import {
  createDeck,
  drawCard,
  cardElement,
  blackjackScore,
  shuffleInPlace,
} from "./deck.js";

// Simple, self-contained Blackjack implementation (player vs dealer)

export function mountBlackjack(app) {
  const state = {
    shoe: createDeck(6),
    discard: [],
    bankroll: 1000,
    baseBet: 25,
    currentBet: 25,
    playerHand: [],
    dealerHand: [],
    inRound: false,
    playerTurn: false,
    canDouble: false,
    dealerHoleRevealed: false,
    message: "",
  };

  app.innerHTML = `
    <section class="blackjack narrow">
      <h2 class="section-title">Blackjack</h2>
      <div class="hud">
        <div><strong>Bankroll:</strong> $<span id="bj-bankroll"></span></div>
        <label>
          Bet
          <input id="bj-bet" type="number" min="1" step="1" />
        </label>
        <div class="controls">
          <button id="bj-deal" class="primary">Deal</button>
          <button id="bj-new">New Round</button>
          <button id="bj-hit">Hit</button>
          <button id="bj-stand">Stand</button>
          <button id="bj-double">Double</button>
          <button id="bj-reset">Reset Bankroll</button>
        </div>
      </div>

      <div class="table">
        <div class="panel hand-panel">
          <div class="hand-header">
            <strong>Dealer</strong>
            <span id="bj-dealer-total" class="totals"></span>
          </div>
          <div id="bj-dealer-cards" class="cards"></div>
          <div id="bj-dealer-msg" class="message"></div>
        </div>

        <div class="panel hand-panel">
          <div class="hand-header">
            <strong>You</strong>
            <span id="bj-player-total" class="totals"></span>
          </div>
          <div id="bj-player-cards" class="cards"></div>
          <div id="bj-round-msg" class="message"></div>
        </div>
      </div>
    </section>
  `;

  // Refs
  const elBankroll = app.querySelector("#bj-bankroll");
  const elBet = app.querySelector("#bj-bet");
  const elDeal = app.querySelector("#bj-deal");
  const elHit = app.querySelector("#bj-hit");
  const elStand = app.querySelector("#bj-stand");
  const elDouble = app.querySelector("#bj-double");
  const elReset = app.querySelector("#bj-reset");
  const elNew = app.querySelector("#bj-new");
  const elDealerCards = app.querySelector("#bj-dealer-cards");
  const elPlayerCards = app.querySelector("#bj-player-cards");
  const elDealerTotal = app.querySelector("#bj-dealer-total");
  const elPlayerTotal = app.querySelector("#bj-player-total");
  const elDealerMsg = app.querySelector("#bj-dealer-msg");
  const elRoundMsg = app.querySelector("#bj-round-msg");

  function updateHud() {
    elBankroll.textContent = state.bankroll.toString();
    elBet.value = String(state.currentBet);
  }

  function clampBet() {
    const minBet = 1;
    const maxBet = Math.max(minBet, state.bankroll);
    if (!Number.isFinite(state.currentBet) || state.currentBet < minBet)
      state.currentBet = minBet;
    if (state.currentBet > maxBet) state.currentBet = maxBet;
  }

  function maybeReshoe() {
    // If shoe is running low, remake and shuffle using discards
    if (state.shoe.length < 40) {
      const combined = [...state.shoe, ...state.discard];
      state.shoe = combined.length > 0 ? combined : createDeck(6);
      state.discard = [];
      shuffleInPlace(state.shoe);
      setRoundMessage("Shuffling…");
    }
  }

  function applyMsgClass(el, type) {
    const t = type || "info";
    el.className = `message is-${t}`;
  }
  function setRoundMessage(msg, type = "info") {
    state.message = msg;
    elRoundMsg.textContent = msg;
    applyMsgClass(elRoundMsg, type);
  }
  function setDealerMessage(msg, type = "info") {
    elDealerMsg.textContent = msg;
    applyMsgClass(elDealerMsg, type);
  }

  function renderHands() {
    // Dealer
    elDealerCards.innerHTML = "";
    state.dealerHand.forEach((card, index) => {
      const isHole = !state.dealerHoleRevealed && index === 1;
      const node = cardElement(card, { faceDown: isHole });
      node.style.setProperty("--i", index);
      elDealerCards.appendChild(node);
    });
    // Totals
    if (state.dealerHoleRevealed) {
      const ds = blackjackScore(state.dealerHand);
      elDealerTotal.textContent = `Total: ${ds.total}${
        ds.isSoft ? " (soft)" : ""
      }`;
    } else {
      const visible = [state.dealerHand[0]].filter(Boolean);
      const ds = visible.length ? blackjackScore(visible) : null;
      elDealerTotal.textContent = visible.length ? `Showing: ${ds.total}` : "";
    }

    // Player
    elPlayerCards.innerHTML = "";
    state.playerHand.forEach((card, index) => {
      const node = cardElement(card);
      node.style.setProperty("--i", index);
      elPlayerCards.appendChild(node);
    });
    const ps = blackjackScore(state.playerHand);
    elPlayerTotal.textContent = `Total: ${ps.total}${
      ps.isSoft ? " (soft)" : ""
    }`;
  }

  function updateControls() {
    elDeal.textContent = state.inRound ? "In Round…" : "Deal";
    elDeal.disabled = state.inRound || state.bankroll <= 0;
    elNew.disabled = state.inRound || state.bankroll <= 0;

    elHit.disabled = !state.playerTurn;
    elStand.disabled = !state.playerTurn;
    elDouble.disabled =
      !state.playerTurn ||
      !state.canDouble ||
      state.bankroll < state.currentBet;

    elBet.disabled = state.inRound;
  }

  function clearHandsToDiscard() {
    state.discard.push(...state.playerHand, ...state.dealerHand);
    state.playerHand = [];
    state.dealerHand = [];
  }

  function startRound() {
    clampBet();
    if (state.currentBet > state.bankroll) {
      setRoundMessage("Insufficient bankroll for that bet.", "danger");
      return;
    }
    maybeReshoe();
    clearHandsToDiscard();
    state.inRound = true;
    state.playerTurn = false;
    state.canDouble = false;
    state.dealerHoleRevealed = false;
    setDealerMessage("", "info");
    setRoundMessage("Dealing…", "info");
    state.bankroll -= state.currentBet;
    updateHud();

    // Initial deal: P, D, P, D
    state.playerHand.push(drawCard(state.shoe));
    state.dealerHand.push(drawCard(state.shoe));
    state.playerHand.push(drawCard(state.shoe));
    state.dealerHand.push(drawCard(state.shoe));
    renderHands();

    // Check blackjacks
    const ps = blackjackScore(state.playerHand);
    const ds = blackjackScore(state.dealerHand);
    if (ps.isBlackjack || ds.isBlackjack) {
      state.dealerHoleRevealed = true;
      renderHands();
      if (ps.isBlackjack && ds.isBlackjack) {
        // Push
        state.bankroll += state.currentBet; // return bet
        setRoundMessage("Push. Both have Blackjack.", "warning");
      } else if (ps.isBlackjack) {
        // 3:2 payout
        const payout = Math.floor(state.currentBet * 2.5);
        state.bankroll += payout;
        setRoundMessage("Blackjack! You win 3:2.", "success");
      } else {
        setRoundMessage("Dealer has Blackjack. You lose.", "danger");
      }
      state.inRound = false;
      updateHud();
      updateControls();
      return;
    }

    state.playerTurn = true;
    state.canDouble = true; // only on first action
    setRoundMessage("Your turn. Hit, Stand, or Double.", "info");
    updateControls();
  }

  function playerHit() {
    if (!state.playerTurn) return;
    state.playerHand.push(drawCard(state.shoe));
    state.canDouble = false;
    renderHands();
    const ps = blackjackScore(state.playerHand);
    if (ps.isBust) {
      state.dealerHoleRevealed = true;
      renderHands();
      setRoundMessage("Bust. You lose.", "danger");
      state.inRound = false;
      state.playerTurn = false;
      updateControls();
    } else {
      setRoundMessage("Your turn.", "info");
      updateControls();
    }
  }

  function playerStand() {
    if (!state.playerTurn) return;
    state.playerTurn = false;
    state.canDouble = false;
    dealerPlayAndSettle();
  }

  function playerDouble() {
    if (!state.playerTurn || !state.canDouble) return;
    if (state.bankroll < state.currentBet) {
      setRoundMessage("Not enough bankroll to double.", "danger");
      return;
    }
    state.bankroll -= state.currentBet; // add second bet
    state.currentBet *= 2;
    updateHud();
    state.canDouble = false;
    // Draw one card and stand automatically
    state.playerHand.push(drawCard(state.shoe));
    renderHands();
    const ps = blackjackScore(state.playerHand);
    if (ps.isBust) {
      state.dealerHoleRevealed = true;
      renderHands();
      setRoundMessage("Bust after double. You lose.", "danger");
      state.inRound = false;
      state.playerTurn = false;
      updateControls();
      return;
    }
    state.playerTurn = false;
    dealerPlayAndSettle();
  }

  function dealerPlayAndSettle() {
    setRoundMessage("Dealer reveals…", "info");
    state.dealerHoleRevealed = true;
    renderHands();

    // Dealer draws to 17+, standing on soft 17
    let ds = blackjackScore(state.dealerHand);
    while (ds.total < 17) {
      state.dealerHand.push(drawCard(state.shoe));
      renderHands();
      ds = blackjackScore(state.dealerHand);
    }
    if (ds.total === 17 && ds.isSoft) {
      setDealerMessage("Dealer stands on soft 17.", "info");
    } else {
      setDealerMessage("", "info");
    }

    settleOutcome();
  }

  function settleOutcome() {
    const ps = blackjackScore(state.playerHand);
    const ds = blackjackScore(state.dealerHand);
    let result = "";
    let type = "info";

    if (ds.isBust) {
      // Dealer busts: player wins
      state.bankroll += state.currentBet * 2;
      result = "Dealer busts. You win!";
      type = "success";
    } else if (ps.total > ds.total) {
      state.bankroll += state.currentBet * 2;
      result = "You win!";
      type = "success";
    } else if (ps.total < ds.total) {
      result = "Dealer wins.";
      type = "danger";
    } else {
      // Push
      state.bankroll += state.currentBet;
      result = "Push.";
      type = "warning";
    }
    setRoundMessage(result + " New round to play again.", type);
    state.inRound = false;
    state.currentBet = Math.max(1, Math.min(state.baseBet, state.bankroll));
    updateHud();
    updateControls();
  }

  function resetBankroll() {
    state.bankroll = 1000;
    state.currentBet = Math.min(state.baseBet, state.bankroll);
    setRoundMessage("Bankroll reset.", "success");
    updateHud();
    updateControls();
  }

  // Event listeners
  elDeal.addEventListener("click", startRound);
  elHit.addEventListener("click", playerHit);
  elStand.addEventListener("click", playerStand);
  elDouble.addEventListener("click", playerDouble);
  elReset.addEventListener("click", resetBankroll);
  elNew.addEventListener("click", () => {
    if (!state.inRound) startRound();
  });
  elBet.addEventListener("change", () => {
    const v = Number(elBet.value);
    state.currentBet = Number.isFinite(v) ? Math.floor(v) : state.currentBet;
    clampBet();
    updateHud();
    updateControls();
  });

  // Initial UI
  updateHud();
  renderHands();
  setRoundMessage("Set your bet and press Deal.", "info");
  updateControls();

  return function cleanup() {
    // Nothing persistent to clean up; container will be replaced by router.
  };
}
