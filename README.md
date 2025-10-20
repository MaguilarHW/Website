# Card Games Compendium

Play classic card games in your browser. Includes fully playable Blackjack and a simple High-Low game. Built with vanilla HTML/CSS/JS (no build step).

## Run

Open `index.html` in any modern browser. For module imports to work locally, you may use a simple static server:

```bash
# Python 3
python3 -m http.server 5173
# then visit http://localhost:5173
```

## Features

- Blackjack (player vs dealer)
  - 6-deck shoe, reshuffles when low
  - Betting with bankroll, 3:2 blackjack payout, double-down
  - Dealer reveals, draws to 17 and stands on soft 17
- High-Low
  - Guess higher/lower/equal by rank (A low)
  - Tracks streaks

## Structure

- `index.html`: Shell and navigation
- `styles.css`: Global styling and card visuals
- `scripts/main.js`: Minimal hash-based router
- `scripts/deck.js`: Shared deck + card utilities
- `scripts/blackjack.js`: Blackjack game logic and UI
- `scripts/highlow.js`: High-Low game logic and UI

## Notes

- Cards render as simple styled divs; no images required.
- No analytics or external dependencies.
