// Shared deck and card utilities for browser games

const SUITS = [
  { key: "spades", symbol: "♠", colorClass: "" },
  { key: "hearts", symbol: "♥", colorClass: "red" },
  { key: "diamonds", symbol: "♦", colorClass: "red" },
  { key: "clubs", symbol: "♣", colorClass: "" },
];

const RANKS = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
];

function createStandard52() {
  const cards = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push(createCard(rank, suit));
    }
  }
  return cards;
}

function createCard(rank, suit) {
  return {
    rank,
    suit: suit.key,
    suitSymbol: suit.symbol,
    colorClass: suit.colorClass,
    // Rank order for comparisons (A low)
    rankValue: rankToValue(rank),
  };
}

export function createDeck(numDecks = 1) {
  const deck = [];
  for (let i = 0; i < numDecks; i++) {
    deck.push(...createStandard52());
  }
  shuffleInPlace(deck);
  return deck;
}

export function shuffleInPlace(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = deck[i];
    deck[i] = deck[j];
    deck[j] = t;
  }
}

export function drawCard(deck) {
  if (deck.length === 0) return null;
  return deck.pop();
}

export function rankToValue(rank) {
  if (rank === "A") return 1;
  if (rank === "J") return 11;
  if (rank === "Q") return 12;
  if (rank === "K") return 13;
  return Number(rank);
}

export function cardElement(card, { small = false, faceDown = false } = {}) {
  const el = document.createElement("div");
  const rarityClass =
    !faceDown && card && card.rarity
      ? card.rarity === "gold"
        ? " gold"
        : card.rarity === "diamond"
        ? " rare-diamond"
        : ""
      : "";
  el.className = `card${small ? " small" : ""}${faceDown ? " back" : ""}${
    !faceDown && card.colorClass ? " " + card.colorClass : ""
  }${rarityClass}`;
  if (faceDown) return el;

  const tl = document.createElement("div");
  tl.className = "corner tl";
  tl.textContent = `${card.rank}${card.suitSymbol}`;

  const br = document.createElement("div");
  br.className = "corner br";
  br.textContent = `${card.rank}${card.suitSymbol}`;

  const center = document.createElement("div");
  const rankSpan = document.createElement("span");
  rankSpan.className = "rank";
  rankSpan.textContent = card.rank;
  const suitSpan = document.createElement("span");
  suitSpan.className = "suit";
  suitSpan.textContent = card.suitSymbol;
  center.appendChild(rankSpan);
  center.appendChild(suitSpan);

  el.appendChild(tl);
  el.appendChild(center);
  el.appendChild(br);
  return el;
}

// Blackjack scoring utilities
export function blackjackScore(hand) {
  // Count aces as 1, then add 10 if it helps and doesn't bust
  let total = 0;
  let aceCount = 0;
  for (const c of hand) {
    if (c.rank === "A") {
      total += 1;
      aceCount += 1;
    } else if (c.rank === "K" || c.rank === "Q" || c.rank === "J") {
      total += 10;
    } else {
      total += Number(c.rank);
    }
  }
  let bestTotal = total;
  let usedSoft = false;
  if (aceCount > 0 && total + 10 <= 21) {
    bestTotal = total + 10;
    usedSoft = true;
  }
  const isBlackjack = hand.length === 2 && bestTotal === 21;
  const isBust = bestTotal > 21;
  return { total: bestTotal, isSoft: usedSoft, isBlackjack, isBust };
}

export function compareHighLow(a, b) {
  // Returns -1 if a<b, 0 if equal, 1 if a>b by rank (A low)
  const va = a.rankValue;
  const vb = b.rankValue;
  if (va < vb) return -1;
  if (va > vb) return 1;
  return 0;
}
