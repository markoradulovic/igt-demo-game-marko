# Plan: Slot Game Demo (IGT Candidate Test)

> Source PRD: [`./prd.md`](./prd.md)

## Architectural decisions

Durable decisions that apply across all phases:

- **Modules**: four deep modules + one thin orchestrator
  - `src/server/slotMath.ts` — port `SlotServer` + `MockedServer` adapter; owns reel strips, paytable, paylines, PRNG, wallet/balance, line evaluation; colocates `SpinResponse`, `WinLine`, `Symbol` types
  - `src/game/ReelBoard.ts` — 5×3 board; interface `spin()`, `requestStop()`, `land(response)`, `highlightLine(line, grid)`, `clearHighlight()`. Internally composes `ReelAnimator` (per-reel tick-driven easing/bounce state machine, unit-tested separately)
  - `src/game/BetSelector.ts` — Pixi-rendered bet control; emits `betChanged`, exposes `setEnabled`
  - `src/game/WinPresenter.ts` — pure-TS timeline state machine for win presentation: `start(response)`, `stop()`, `tick(deltaMs)`, getters `rollupValue`, `activeLine`, `isRollupComplete`. No Pixi dependency; `Game` reads state each tick and delegates rendering
  - `src/game/Game.ts` — thin orchestrator; receives `SlotServer` via constructor
  - `src/main.ts` — ~30-line bootstrap
- **State machine**: `LOADING → IDLE → REQUESTING → SPINNING → STOPPING → PRESENTING_WIN → IDLE`; quick-stop transitions `SPINNING → STOPPING`
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
  type Symbol = "A" | "B" | "C" | "D" | "E" | "F" | "WILD";
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
- **Bet list**: `[0.10, 0.50, 1.00, 2.00, 5.00]`; starting balance `1000.00`
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

- [ ] Reloading the page shows a visible loading bar that fills to 100% before the game appears
- [ ] All symbols render as sourced sprites, not colored rectangles
- [ ] Loading completes in under 2s on reviewer desktop with warm cache
- [ ] No console errors during preload, including the cold-cache first load
- [ ] `npm run build` output still succeeds and the dist bundle plays identically to `npm run dev`
- [ ] All prior tests still pass
