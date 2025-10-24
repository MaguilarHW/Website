import { createDeck, drawCard, cardElement, compareHighLow } from "./deck.js";

export function mountHighLow(app) {
  const state = {
    deck: createDeck(1),
    current: null,
    next: null,
    streak: 0,
    message: "",
  };

  app.innerHTML = `
    <section class="highlow narrow">
      <h2 class="section-title">High-Low</h2>
      <div class="board">
        <div class="panel centered">
          <div id="hl-current" class="cards"></div>
          <div class="controls">
            <button id="hl-higher" class="primary">Higher</button>
            <button id="hl-equal">Equal</button>
            <button id="hl-lower">Lower</button>
            <button id="hl-new">New Round</button>
          </div>
        </div>
        <div class="panel centered">
          <div>
            <div>Streak: <strong id="hl-streak">0</strong></div>
            <div id="hl-msg" class="message"></div>
          </div>
        </div>
      </div>
    </section>
  `;

  const elCurrent = app.querySelector("#hl-current");
  const elStreak = app.querySelector("#hl-streak");
  const elMsg = app.querySelector("#hl-msg");
  const elHigher = app.querySelector("#hl-higher");
  const elEqual = app.querySelector("#hl-equal");
  const elLower = app.querySelector("#hl-lower");
  const elNew = app.querySelector("#hl-new");

  function setMessage(msg, type = "info") {
    state.message = msg;
    elMsg.textContent = msg;
    elMsg.className = `message is-${type}`;
  }

  function render() {
    elCurrent.innerHTML = "";
    if (state.current) {
      const node = cardElement(state.current);
      node.style.setProperty("--i", 0);
      elCurrent.appendChild(node);
    }
    elStreak.textContent = String(state.streak);
  }

  function ensureCurrent() {
    if (!state.current) {
      state.current = drawCard(state.deck);
    }
  }

  function guess(dir) {
    ensureCurrent();
    if (!state.current) return;
    if (!state.next) state.next = drawCard(state.deck);
    const cmp = compareHighLow(state.current, state.next);
    let correct = false;
    if (dir === "higher") correct = cmp < 0;
    if (dir === "lower") correct = cmp > 0;
    if (dir === "equal") correct = cmp === 0;

    // Show both cards side-by-side for feedback
    elCurrent.innerHTML = "";
    const first = cardElement(state.current);
    first.style.setProperty("--i", 0);
    const second = cardElement(state.next);
    second.style.setProperty("--i", 1);
    elCurrent.appendChild(first);
    elCurrent.appendChild(second);

    if (correct) {
      state.streak += 1;
      setMessage("Correct! Guess again or start a new round.", "success");
      state.current = state.next; // continue from revealed
      state.next = null;
    } else {
      setMessage("Wrong guess. Streak reset.", "danger");
      state.streak = 0;
      state.current = state.next; // show the next card as the new current for continuity
      state.next = null;
    }
    elStreak.textContent = String(state.streak);
  }

  function newRound() {
    state.deck = createDeck(1);
    state.current = drawCard(state.deck);
    state.next = null;
    setMessage("New round started. Guess higher, lower, or equal.", "info");
    render();
  }

  elHigher.addEventListener("click", () => guess("higher"));
  elEqual.addEventListener("click", () => guess("equal"));
  elLower.addEventListener("click", () => guess("lower"));
  elNew.addEventListener("click", newRound);

  // Initial state
  newRound();

  return function cleanup() {};
}
