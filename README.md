# IGT Demo Slot Game

A 5×3 slot game demo built with TypeScript + PixiJS v8 + Vite, submitted as the IGT Game Developer candidate test.

## Run

```bash
npm install
npm run dev        # local dev server
npm run build      # production build
npm run typecheck  # tsc --noEmit
npm run test       # vitest
```

Open the printed URL. A loading screen fills, then the game enters its idle state.

## How to play

- Use the `◀` / `▶` arrows to cycle the bet through `1.00 → 2.00 → 5.00 → 10.00`.
- Click **SPIN** to deduct the bet and start the reels; reels speed up, run steady, decelerate with an overshoot bounce, and settle on the server's stops.
- Click **STOP** (the Spin button re-labels mid-spin) to quick-stop — all reels snap to their final positions.
- When reels 1–3 all land on the same high-paying symbol (WILD, CHERRY, BELL), reels 4–5 slow and pulse to telegraph the chase for a bigger win.
- On a win: the total rolls up, then each winning line highlights in turn (gold border on wild substitutions, white on direct matches). Non-winning cells dim so the line reads clearly.
- Balance updates from the server's `balanceAfter` after every spin.
- The speaker icon at the top-right of the stage toggles sound. Audio is **off by default on every page load** — click the icon (or press `M`) to opt in.

### Keyboard shortcuts

- `Space` — spin (or quick-stop during an active spin).
- `←` / `→` — cycle the bet down / up.
- `M` — toggle sound on/off.

## Reproducible spins

Append `?seed=N` to the URL (e.g. `http://localhost:5173/?seed=12345`) to make the PRNG deterministic — handy for demos, debugging, and reviewing the invariant test suite.

## Architecture

Four deep modules behind a thin Pixi view. Following a spin end-to-end means reading four files:

- **`src/server/slotMath.ts`** — The `SlotServer` port plus the `MockedServer` adapter. Owns reel strips, paylines, paytable, seeded PRNG, wallet, and wild-substitution line evaluation. The `SpinResponse` JSON shape is the only type the rest of the codebase depends on.
- **`src/game/SpinController.ts`** — Pure-TS state machine for the spin lifecycle (`idle → requesting → spinning → stopping → presenting`). Owns timing (`MIN_SPIN_MS` hold, rollup, per-line cycling), quick-stop routing, and balance tracking. Drives reels through a `ReelSink` callback interface — no Pixi dependency, fully unit-testable.
- **`src/game/ReelBoard.ts`** — The 5×3 reel surface. Hides the sprite pool, per-reel easing/bounce (`ReelAnimator`), strip baking, and the highlight/dim geometry. Strip arithmetic and highlight rules live as pure functions in `reelMath.ts`.
- **`src/game/BetSelector.ts`** — Pixi-rendered bet cycler with arrow controls and enabled-state visuals. Emits `betChanged`.

**Thin view** — `src/game/Game.ts` wires the modules together, ticks the controller each frame, and writes the returned `SpinSnapshot` onto Pixi properties. No state-machine logic lives here.

**Bootstrap** — `src/main.ts` parses `?seed=`, sets up 1280×720 fit-to-viewport scaling, preloads the `Assets` bundle behind a progress bar, then constructs `MockedServer` and `Game`.

## Tests

`npm run test` runs 84 tests across seven files:

- `slotMath.test.ts` — response shape, cross-spin invariants, wild substitution, insufficient-funds.
- `SpinController.test.ts` — phase lifecycle, quick-stop routing, rollup interpolation, line cycling, server rejection, anticipation, audio-event dispatch.
- `ReelAnimator.test.ts` — per-reel easing/bounce state machine under fixed ticks.
- `reelMath.test.ts` — strip baking, cell wrapping, wild-sub highlight rules, anticipation decision.
- `BetSelector.test.ts` — bet cycling and enable/disable behavior.
- `KeyboardInput.test.ts` — key routing, repeat suppression, teardown.
- `AudioManager.test.ts` — disabled-by-default, missing-alias safety, toggle semantics.

No Pixi or DOM harness is needed — the orchestration layer is pure TypeScript.
