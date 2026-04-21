# Plan: Slot Game Demo (IGT Candidate Test)

> Source PRD: [`./prd.md`](./prd.md)

## Architectural decisions

Durable decisions that apply across all phases:

- **Modules**: four deep modules + a thin view + pure math helpers
  - `src/server/slotMath.ts` — port `SlotServer` + `MockedServer` adapter; owns reel strips, paytable, paylines, PRNG, wallet/balance, line evaluation; colocates `SpinResponse`, `WinLine`, `Symbol` types and exports the canonical `SYMBOLS` array
  - `src/game/SpinController.ts` — pure-TS state machine + win presentation. Interface `tick(deltaMs): SpinSnapshot`, `pressButton()`, `setBet(bet)`. Owns the phase machine (`idle → requesting → spinning → stopping → presenting → idle`), tick-driven `MIN_SPIN_MS` countdown (replaces `setTimeout`/`cancellableDelay`), quick-stop routing, balance updates, rollup, and line cycling. Drives reel animations through a `ReelSink` callback interface
  - `src/game/ReelBoard.ts` — 5×3 board; interface `spin()`, `requestStop(response)`, `land(response)`, `highlightLine(line, grid)`, `clearHighlight()`, `waitForSettle()`. Internally composes `ReelAnimator` (per-reel tick-driven easing/bounce state machine, unit-tested separately). Math helpers live in `reelMath.ts`
  - `src/game/BetSelector.ts` — Pixi-rendered bet control; emits `betChanged`, exposes `setEnabled`
  - `src/game/Game.ts` — thin Pixi view (~140 lines). Builds UI, wires a `ReelSink` to `ReelBoard`, ticks `SpinController` each frame, and renders the returned `SpinSnapshot` onto Pixi properties (button label, balance text, highlight state). Contains no state-machine logic
  - `src/game/reelMath.ts` — pure functions extracted from ReelBoard: `bakeGrid`, `computeCellSymbol`, `computeCellY`, `computeWinHighlight`. Unit-tested independently of Pixi
  - `src/main.ts` — bootstrap: asset preload with animated loading bar, then game construction
- **State machine** (owned by `SpinController`, phases are lowercase in code): `idle → requesting → spinning → stopping → presenting → idle`; quick-stop routes through `stopping` using `snapReels` instead of `landReels`. The `LOADING` phase lives in `main.ts` and completes before `Game` is constructed
- **Ports & adapters**: `SlotServer` port with `spin(bet: number): Promise<SpinResult>`; `MockedServer` is the only adapter in v1
- **Response shape**:
  ```ts
  type SpinResult =
    | { ok: true; data: SpinResponse }
    | { ok: false; error: "INSUFFICIENT_FUNDS"; balance: number };
  interface SpinResponse {
    stops: [number, number, number, number, number];
    grid: Symbol[][];
    totalWin: number;
    balanceAfter: number;
    lines: WinLine[];
  }
  interface WinLine {
    lineId: number;
    symbol: Symbol;
    count: 3 | 4 | 5;
    positions: [number, number][];
    win: number;
  }
  type Symbol =
    | "CHERRY"
    | "BELL"
    | "LEMON"
    | "EMERALD"
    | "DIAMOND"
    | "SEVEN"
    | "WILD";
  ```
- **Game rules**: 5×3 grid, 5 fixed paylines (6 plain symbols + 1 Wild, left-to-right matching runs of 3/4/5):
  - Line 1 = top row `[(0,0),(1,0),(2,0),(3,0),(4,0)]`
  - Line 2 = middle row `[(0,1),(1,1),(2,1),(3,1),(4,1)]`
  - Line 3 = bottom row `[(0,2),(1,2),(2,2),(3,2),(4,2)]`
  - Line 4 = V-shape `[(0,0),(1,1),(2,2),(3,1),(4,0)]`
  - Line 5 = inverted-V `[(0,2),(1,1),(2,0),(3,1),(4,2)]`
- **Error contract**: `spin` returns `{ ok: false, error: 'INSUFFICIENT_FUNDS', balance }` when `bet > balance`; `Game` gates Spin at the UI level so this branch is defensive. Truly exceptional failures (network, bug) surface as promise rejection and transition `REQUESTING → IDLE` with a `console.error`. No retry/toast in v1.
- **Zero-balance lifecycle**: Spin stays disabled when balance < smallest bet; page refresh resets session to `1000.00`. No in-game reset UI.
- **Canvas**: internal coordinate system locked at 1280×720; fit-to-viewport uniform scaling via a single resize handler in `main.ts`
- **PRNG**: Mulberry32 inside `MockedServer`; seed defaults to random, `?seed=N` URL param overrides
- **Bet list**: `[1.00, 2.00, 5.00, 10.00]`; starting balance `1000.00`
- **Tech stack**: TypeScript strict, PixiJS v8, Vite, Vitest (dev)
- **Assets root**: `public/assets/symbols/`, `public/assets/ui/`, declared in a Pixi `Assets` manifest

---

## Phase 1: Server-driven static grid

**User stories**: 1, 13, 14, 15, 17, 18, 19

### What to build

End-to-end tracer bullet. `MockedServer` implements the `SlotServer` port with the seeded Mulberry32 PRNG, hand-authored reel strips, paytable, payline geometry, and line evaluator. Clicking a Spin button calls `slotMath.spin(bet)` (fixed bet, no UI yet) and `ReelBoard` renders the returned `data.grid` as a static 5×3 display of placeholder colored rectangles keyed by symbol. No animation, no bet selector, no balance display, no win highlighting. `main.ts` parses `?seed=` from the URL, wires a fit-to-viewport resize handler, and constructs the modules. Vitest is introduced; a boundary suite pins response invariants (shape conformance, `grid`/`stops` reconstruction, `sum(lines[].win) === totalWin`, `balanceAfter` arithmetic, wild substitution reporting).

### Acceptance criteria

- [x] Clicking Spin logs nothing to the console and updates the visible 5×3 grid to the server's returned symbols
- [x] `?seed=12345` produces the same grid sequence across reloads
- [x] Canvas scales uniformly to the window while preserving the 1280×720 coordinate system
- [x] `npm run typecheck` and `npm run build` pass
- [x] `npm run test` passes with the seeded invariant suite green
- [x] `slotMath.ts` is the only file that imports or references reel strips, paytable, paylines, or PRNG
- [x] Calling `spin` with a bet exceeding balance resolves to `{ ok: false, error: 'INSUFFICIENT_FUNDS', balance }` and leaves balance unchanged (covered by unit test)

---

## Phase 2: Spin animation lifecycle

**User stories**: 6

### What to build

`ReelBoard.spin()` starts a per-reel animation: brief speed-up, steady high-speed symbol scroll, staggered slow-down, bounce/overshoot on stop. `ReelBoard.land(response)` resolves when every reel has settled on its target symbols. `Game` transitions `IDLE → REQUESTING → SPINNING → STOPPING → IDLE`. Bet is still fixed; no bet UI, no balance, no win presentation. Animation runs on the Pixi ticker.

### Acceptance criteria

- [x] Spinning visibly accelerates, sustains, decelerates, and bounces
- [x] Reels stop staggered left-to-right, each landing on its server-returned stop
- [x] No console errors during 50+ consecutive spins
- [x] Frame rate stays smooth (no visible stutter on reviewer desktop)
- [x] Phase 1 invariant tests still pass unchanged

---

## Phase 3: Bet selector + server-authoritative balance

**User stories**: 3, 4, 5, 12

### What to build

`BetSelector` is a Pixi-rendered control (arrow buttons + current-bet label) that cycles through the fixed bet list and emits `betChanged`. A Pixi balance display reads from the last `SpinResponse.balanceAfter`. `MockedServer` now holds wallet state: every response decrements by the bet and increments by `totalWin`, returning the resulting `balanceAfter`. `Game` disables Spin (via `BetSelector.setEnabled` on the button component or equivalent) whenever the last known balance is below the selected bet, and re-enables after a spin resolves.

### Acceptance criteria

- [x] Bet selector cycles through all five bet values via on-canvas controls
- [x] Balance display updates after every spin to match `balanceAfter`
- [x] Spin is disabled and visually indicates so when balance < selected bet
- [x] When balance reaches 0, Spin stays disabled indefinitely (no reset UI); refreshing the page restores the session
- [x] Changing bet while `IDLE` or `PRESENTING_WIN` works; bet control is disabled during `SPINNING`/`STOPPING`
- [x] Server-wallet arithmetic invariant test (`balanceAfter === previousBalance - bet + totalWin`) still passes

---

## Phase 4: Win presentation

**User stories**: 8, 9, 10, 11

### What to build

On entering `PRESENTING_WIN`, `ReelBoard.land` runs a total-win roll-up counter, then cycles through `response.lines` one at a time: dim non-winning symbols, highlight the current line's `positions`, display its `win` value. Loop indefinitely until the next Spin starts. Wilds that substituted into a line are visually distinguishable from plain matches. On `IDLE` (next spin), reset to neutral state.

### Acceptance criteria

- [x] After a winning spin, total-win value rolls up from 0 to `totalWin`
- [x] Each winning line is highlighted in turn with its own sub-win value visible
- [x] Non-winning symbols dim during line highlight; highlighted symbols stand out
- [x] Wild substitutions on winning lines are visibly marked
- [x] No-win spins skip the cycle and return to `IDLE` without visual noise
- [x] All prior tests still pass

---

## Phase 5: Quick-stop

**User stories**: 7

### What to build

`ReelBoard.requestStop()` cuts the remaining spin animation short — each still-spinning reel snaps to its final stop with a compressed bounce. `Game` listens for a Spin input during `SPINNING` and routes it to `requestStop()`, transitioning the state machine `SPINNING → STOPPING → PRESENTING_WIN` as normal. The server response has already been received before `SPINNING` began, so this is purely a presentation change.

### Acceptance criteria

- [x] Clicking Spin during an active spin lands all reels within ~300ms
- [x] Quick-stopped reels still land on the server's `stops` (no drift)
- [x] Quick-stopping during `STOPPING` is a no-op (doesn't double-trigger)
- [x] Quick-stop during `PRESENTING_WIN` starts the next spin as normal
- [x] All prior tests still pass

---

## Phase 6: Loading screen + real assets

**User stories**: 2

### What to build

Source 6 plain symbol sprites + 1 Wild sprite + a frame/background image into `public/assets/`. Declare a Pixi `Assets` manifest/bundle. `main.ts` preloads the bundle before constructing `Game`, rendering a simple Pixi-based progress bar. The state machine gains a `LOADING` state that precedes `IDLE`. Every placeholder colored rectangle from Phase 1 is replaced with the loaded sprite for its symbol.

### Acceptance criteria

- [x] Reloading the page shows a visible loading bar that fills to 100% before the game appears
- [x] All symbols render as sourced sprites, not colored rectangles
- [x] Loading completes in under 2s on reviewer desktop with warm cache
- [x] No console errors during preload, including the cold-cache first load
- [x] `npm run build` output still succeeds and the dist bundle plays identically to `npm run dev`
- [x] All prior tests still pass

---

## Phase 7: Architectural hardening

**User stories**: 13, 14, 17, 20 (no new player-visible behavior)

### What to build

Post-Phase-6 audit surfaced three untestable seams. This phase restructures the internals without changing behavior:

1. **Extract `SpinController` from `Game`**. The 5-phase state machine, async spin orchestration, and win-presentation timing were entangled with Pixi object creation, making `Game` a ~280-line untestable orchestrator. Extract a pure-TS controller with `tick(deltaMs): SpinSnapshot`, `pressButton()`, `setBet(bet)`. Replace the `setTimeout`-based `MIN_SPIN_MS` hold with a tick-driven countdown — fully deterministic under `vi.fn` mocks, and quick-stop simply zeroes the counter. Reel animation calls go through a `ReelSink` callback interface (one consumer, no event bus needed). `Game` becomes a thin view that ticks the controller and renders the returned snapshot.
2. **Absorb `WinPresenter` into `SpinController`**. At 55 lines and 8 public-API elements, `WinPresenter` was too shallow to justify a separate module boundary — the interface cost exceeded the implementation it hid. Fold its rollup and line-cycling logic into the controller's `presenting` phase.
3. **Extract `reelMath.ts`**. Three pieces of critical math — strip baking (modulo indexing), cell-to-symbol mapping (wrap formula), win-highlight computation (wild-sub border detection) — were buried inside `ReelBoard`'s Pixi-coupled methods. Extract as pure functions with their own unit tests.
4. **Consolidate `SYMBOLS`**. The 7 symbols were duplicated across `slotMath.ts` (type), `ReelBoard.ts` (`BASE_STRIP`), and `main.ts` (asset keys). Export a single `SYMBOLS` const array from `slotMath.ts` and derive `type Symbol = (typeof SYMBOLS)[number]`. Adding a symbol now requires editing one file.

### Acceptance criteria

- [x] `src/game/SpinController.ts` owns the state machine and win presentation; exports `createSpinController`, `SpinSnapshot`, `ReelSink`
- [x] `src/game/SpinController.test.ts` covers: phase transitions, quick-stop uses `snapReels` (not `landReels`), insufficient-funds returns to idle, server rejection returns to idle, rollup timing, line cycling with wrap, spin-during-presenting interrupts
- [x] `src/game/WinPresenter.ts` and `WinPresenter.test.ts` deleted — coverage migrated into `SpinController.test.ts`
- [x] `src/game/Game.ts` is a thin Pixi view with no state-machine logic (constructor wires UI + `ReelSink`; `applySnapshot` writes snapshot fields to Pixi properties)
- [x] `src/game/reelMath.ts` exports `bakeGrid`, `computeCellSymbol`, `computeCellY`, `computeWinHighlight`; `ReelBoard` calls these instead of inlining the math
- [x] `src/game/reelMath.test.ts` covers: bakeGrid wrap-around (targetPos=0 and stripLen-1), computeCellSymbol for integer/fractional/wrapping positions, computeWinHighlight with wild-sub border color
- [x] `slotMath.ts` exports `SYMBOLS` const; `ReelBoard.ts` and `main.ts` import it (no duplicate symbol lists)
- [x] `npm run test` passes all suites (54 tests green post-refactor)
- [x] `npm run build` succeeds with no type errors
- [x] Player-visible behavior is unchanged — spin, quick-stop (both from `spinning` and `stopping`), win presentation, bet gating, insufficient funds all behave identically to Phase 6

---

## Phase 8: Anticipation + keyboard controls

**User stories**: 20 (previously-deferred stretch items, now in scope)

### What to build

Two deferred stretch features the architecture was designed to absorb cleanly. Both are additive; no existing phase behavior changes.

1. **Anticipation effect** — when reels 1–3 all land on the same high-paying symbol (WILD, CHERRY, or any symbol whose 5-of-a-kind multiplier meets a threshold), reels 4 and 5 slow to a reduced steady speed and visually pulse (tint flash or subtle scale) to telegraph a potential big win. The anticipation trigger is computed from the already-received `SpinResponse.grid` at the moment `spinning → stopping` transition begins for reels 1–3, so no new server data is needed. `SpinController` gains an `anticipation` field on `SpinSnapshot` (`null` or `{ reels: number[] }`); `ReelBoard.land` reads it to stretch the stagger delay and apply the tint. Pure-TS decision logic lives in a new helper `shouldAnticipate(grid, paytable)` inside `reelMath.ts` (or a peer `anticipation.ts`) so it's unit-testable without Pixi.
2. **Keyboard controls** — `Space` = press Spin button (spin or quick-stop depending on phase); `←` / `→` = cycle bet down/up. A small `KeyboardInput` module attaches a single `window.addEventListener('keydown')` in `Game`'s constructor and routes to the same `controller.pressButton()` and `betSelector.prev()`/`next()` methods the UI already calls. Respects `betEnabled` / `canSpin` / `canStop` gates by reading the latest snapshot — no keyboard-specific state.

### Acceptance criteria

- [x] Anticipation triggers when reels 1–3 land on matching high-paying symbols; reels 4–5 visibly slow and pulse
- [x] Anticipation does not trigger on non-matching or low-paying landings
- [x] Anticipation never delays the final settle beyond ~1.5× the normal stagger window (no runaway waits)
- [x] `SpinSnapshot` gains an `anticipation` field; `SpinController.test.ts` covers trigger and non-trigger cases
- [x] Pure anticipation-decision helper has its own unit tests in `reelMath.test.ts` (or `anticipation.test.ts`)
- [x] `Space` spins when idle/presenting, quick-stops during spinning/stopping, and is a no-op when `canSpin`/`canStop` are both false
- [x] `←` / `→` cycle the bet; no-op when `betEnabled` is false or at the list boundaries
- [x] Repeated keydown events (holding a key) don't spam spins — either `e.repeat` is ignored or the existing phase gate prevents it
- [x] Keyboard handler is removed on `Game` teardown (no listener leak if the game is re-constructed)
- [x] All prior tests still pass; `npm run typecheck`, `npm run build`, `npm run test` all green
- [x] README's "How to play" section documents the keyboard shortcuts

---

## Phase 9: Audio

**User stories**: ambient/diegetic sound feedback — player-opt-in, silent by default.

### What to build

Introduce a thin audio layer behind a new `AudioManager` façade that starts **disabled on every page load** (no persistence — the demo is silent until the player opts in each session). A speaker icon at the top-right of the stage toggles audio on/off; the `M` key is bound to the same toggle via `KeyboardInput`.

`@pixi/sound` is the backing library. Audio files are **lazy-loaded inside the click handler that first enables sound**, not preloaded with sprites — Chrome's autoplay policy requires the `AudioContext` to be created during a user gesture, and preloading at boot emits a `"AudioContext was not allowed to start"` warning. Deferring the load keeps the console clean and means muted sessions never fetch the audio. Five short placeholder WAV files live in `public/assets/audio/` (generated by `scripts/generate-placeholder-audio.mjs`) to prove the wiring end-to-end; real CC0 assets can drop in later without code changes.

Phase-driven SFX are routed through a new `AudioSink` callback on `SpinControllerDeps` — mirroring the `ReelSink` pattern so the controller stays pure-TS and unit-testable. `ReelBoard` exposes an `onReelLanded` option that fires once per reel at the bounce→settled transition (tracked per-reel via a `landNotified` flag). Button/bet clicks call `audio.play("click")` directly at the input layer in `Game`.

### Acceptance criteria

- [x] Audio is disabled on every page load — icon renders in "off" state, `play()` is a no-op
- [x] Clicking the speaker icon toggles audio; the icon visually reflects state (green + waves vs. grey + slash)
- [x] Pressing `M` toggles audio identically to clicking the icon
- [x] With audio enabled: spin start plays a whoosh; each of the 5 reels plays a thud as it lands; win jingle plays when `totalWin > 0`; anticipation cue plays once when `shouldAnticipate` returns a hint; spin/bet-arrow clicks play a click
- [x] Toggling off while a sound is playing stops further plays but does not stutter the in-flight one (handled naturally by `@pixi/sound`)
- [x] Missing audio aliases no-op safely (`AudioManager` checks `sound.exists(key)` before playing)
- [x] `SpinController` fires `onSpinStart` on press, `onAnticipation` only when `pendingAnticipation !== null`, `onWin` only when `totalWin > 0` — unit-tested with a fake `AudioSink`
- [x] `ReelBoard` calls `onReelLanded` exactly once per reel per spin cycle (reset in both `spin()` and `requestStop()`)
- [x] `KeyboardInput` routes `KeyM` to `onToggleSound` and tolerates its absence
- [x] Audio files lazy-load on the first toggle-on click (not at boot); no `AudioContext was not allowed to start` warnings in the console
- [x] `npm run typecheck`, `npm run test` (84 tests green, +9 new), `npm run build` all pass
- [x] README "How to play" and "Keyboard shortcuts" sections document the sound toggle and `M` key
