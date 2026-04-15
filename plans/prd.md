# PRD — Slot Game Demo (IGT Candidate Test)

## Problem Statement

As a Game Developer candidate applying to IGT, I need to produce a playable 5×3 slot demo that proves my technical skills, design judgement, and independence. The brief is open-ended about _how_, which means wasted motion and scope creep are the real risks — I could over-build visuals, ship fragile architecture, or miss a "green" requirement and fail the bar. I need a resolved spec that pins every ambiguous decision so implementation time goes into clean code, not re-deciding the same questions.

## Solution

A resolved, end-to-end spec for a Vite + TypeScript + PixiJS v8 slot demo, organized around **three deep modules plus a thin orchestrator**. Every open question from the brief — paylines, symbols, win presentation, bet UI, outcome generation, balance, quick-stop, resizing, loading, RNG, audio, and stretch scope — is locked so I can implement without re-litigating choices. The architecture lets the reviewer follow one spin end-to-end through three files and makes the "server" boundary a real port with a mocked adapter behind it.

## Goals

- Produce a playable 5×3 slot demo with bet selection, full spin lifecycle, cycling win presentation, and server-authoritative balance.
- Demonstrate clean separation between a mocked "server" module and the game/presentation layer via ports & adapters.
- Ship with zero console errors, 60 FPS on desktop, and a clean `npm run typecheck` / `npm run build`.
- Use code organization, deep modules, and TypeScript types as the primary signal of engineering quality.

## Non-Goals

- Custom/original artwork or visual polish (graphics sourced online; look-and-feel is not scored).
- Audio of any kind.
- Certifiable RNG, RTP compliance, or real wallet integrity.
- Mobile-first responsive layout; true layout-responsive components.
- Localization, accounts, persistence beyond a single session.

## Users & Use Cases

- **Primary user**: IGT reviewer who will play the demo and read the source.
- **Primary use case**: Open in browser → preload completes → pick a bet → spin (optionally quick-stop) → see reels land → see wins cycle line-by-line → balance updates → repeat.

## User Stories

1. As a reviewer, I want the page to load without console errors, so that I can trust the build is clean.
2. As a reviewer, I want to see a loading screen with a progress bar, so that I know assets are preloading and not hanging.
3. As a player, I want to pick a bet from a fixed list via on-canvas arrow controls, so that I can choose stakes without leaving the Pixi surface.
4. As a player, I want to see my current balance on screen, so that I know what I can afford.
5. As a player, I want the Spin button to disable when my balance is below the selected bet, so that I can't place an invalid bet.
6. As a player, I want to click Spin and see the reels accelerate, spin steadily, decelerate, and bounce on landing, so that the game feels tactile.
7. As an impatient player, I want to click Spin again mid-spin to slam the reels to their stops, so that I don't wait through the full animation.
8. As a player, I want winning symbols highlighted after the reels land, so that I can see exactly what I won on.
9. As a player, I want each winning line to be highlighted one at a time in a cycle, so that I can read each contribution to my total.
10. As a player, I want a roll-up animation on my total win value, so that big wins feel rewarding.
11. As a player, I want Wild symbols to visibly substitute into winning lines, so that I understand why a line paid.
12. As a player, I want my balance to update after each spin to reflect the server's authoritative value, so that wins and losses are immediately visible.
13. As a reviewer reading the source, I want the server logic in its own module behind a clearly typed port, so that I can see the separation the brief requires.
14. As a reviewer, I want one entry point per concept (reels, bets, game orchestration, server) so that I can follow a spin end-to-end without hopping between many tiny files.
15. As a reviewer, I want the spin-outcome types colocated with the server module, so that there's one authoritative definition of the response.
16. As a reviewer debugging or demoing, I want to append `?seed=N` to the URL for reproducible spins, so that I can replay interesting cases.
17. As a reviewer, I want `npm run typecheck`, `npm run build`, and `npm run test` to all succeed, so that I know the code is disciplined.
18. As a reviewer, I want unit tests that pin the server's response invariants under a known seed, so that I can see the candidate tests at the right boundary.
19. As a player on varying window sizes, I want the canvas to scale to my viewport while preserving aspect, so that the game looks intentional instead of clipped or tiny.
20. As the candidate in an interview, I want every deferred feature (anticipation, keyboard controls, real backend) to be trivially addable behind the same interfaces, so that I can credibly defend the design as extensible.

## Design Decisions (resolved)

| Area                 | Decision                                                                                                                                                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paylines             | **Fixed 5 lines** — 3 horizontal rows + 2 diagonals                                                                                                                                                                                                      |
| Symbols              | **6 plain + 1 Wild** (Wild substitutes on lines; no scatter/free-spin)                                                                                                                                                                                   |
| Win presentation     | **Cycle-by-line**: total-win roll-up on entry, then loop through each winning line highlighting its symbols                                                                                                                                              |
| Bet selector surface | **Pixi-rendered** (e.g. `<` / `>` arrows + bet label) — no DOM overlay                                                                                                                                                                                   |
| Outcome generation   | **Strip-driven**: handcrafted reel strips, random stops, evaluate visible grid. Strips tuned wild-heavy for demo-friendly hit rate                                                                                                                       |
| Quick-stop           | **Supported**: click/tap during `SPINNING` triggers `ReelBoard.requestStop()`                                                                                                                                                                            |
| Balance              | **Server-authoritative**: `SpinResponse` carries `balanceAfter`; Spin disabled when last-known balance < bet                                                                                                                                             |
| Canvas sizing        | **Fit-to-viewport scaling** with internal coords locked at 1280×720; one resize handler in bootstrap                                                                                                                                                     |
| Asset loading        | **Pixi `Assets` manifest + loading screen**; state machine includes `LOADING → IDLE`                                                                                                                                                                     |
| RNG                  | **Seeded Mulberry32 PRNG** inside `MockedServer`; default random, `?seed=N` URL param overrides                                                                                                                                                          |
| Audio                | **None**                                                                                                                                                                                                                                                 |
| Stretch shipped      | Unit tests for `slotMath` (seeded boundary tests). Keyboard controls & anticipation deferred.                                                                                                                                                            |
| Payline geometry     | Line 1 = top row; Line 2 = middle row; Line 3 = bottom row; Line 4 = V-shape `[(0,0),(1,1),(2,2),(3,1),(4,0)]`; Line 5 = inverted-V `[(0,2),(1,1),(2,0),(3,1),(4,2)]`                                                                                    |
| Insufficient funds   | `spin` returns `{ ok: false, error: 'INSUFFICIENT_FUNDS', balance }` when `bet > balance`. `Game` gates Spin at the UI level so this branch is defensive. Result type keeps the success shape clean and maps 1:1 to a future HTTP adapter's status/body. |
| Zero balance         | No recovery UX in v1. Spin stays disabled; refreshing the page resets the session to `1000.00`. Documented in README.                                                                                                                                    |
| Promise rejection    | On any rejection from `spin` (truly exceptional — network, bug), `Game` transitions `REQUESTING → IDLE` and logs the error. Expected errors (insufficient funds) come through the Result channel, not rejection. No retry/toast in v1.                   |

## Functional Requirements

### Must-have (brief's "green" items + resolved scope)

1. **Bet selector** — Pixi-rendered component cycling through `[0.10, 0.50, 1.00, 2.00, 5.00]`. Reusable component, emits `betChanged`.
2. **Reels (5×3)** — speed-up → steady → slow-down → bounce/overshoot on stop. Supports `requestStop()` during spin.
3. **Mocked server module** — async `getResponseData(bet)` returning JSON; owns reel strips, paytable, paylines, RNG, wallet.
4. **Win presentation** — total-win roll-up, then cycle-by-line highlighting of winning positions.
5. **Balance display** — Pixi text; drives Spin button enabled state.
6. **Loading screen** — Pixi `Assets` manifest bundle + progress bar before first `IDLE`.
7. **Quality bar** — no console errors; 60 FPS target; clean `npm run typecheck` and `npm run build`.

### Stretch (shipping)

- **Unit tests** for `slotMath` via Vitest, constructed with a fixed seed, asserting response invariants and exact outputs for pinned cases.

### Stretch (deferred, documented in README for interview discussion)

- Anticipation effect on 3rd–5th reels when high-symbol match builds.
- Keyboard controls (Space = spin/quick-stop, Arrows = bet).
- Real backend adapter behind the `SlotServer` port.

## Response Shape

```ts
interface SlotServer {
  spin(bet: number): Promise<SpinResult>;
}

type SpinResult =
  | { ok: true; data: SpinResponse }
  | { ok: false; error: "INSUFFICIENT_FUNDS"; balance: number };

interface SpinResponse {
  stops: [number, number, number, number, number]; // strip index per reel
  grid: Symbol[][]; // 5×3 visible symbols derived from stops
  totalWin: number;
  balanceAfter: number;
  lines: WinLine[];
}
interface WinLine {
  lineId: number; // 1..5
  symbol: Symbol; // the paying symbol (wilds substituted)
  count: 3 | 4 | 5;
  positions: [number, number][]; // [reel, row] tuples, left-to-right
  win: number;
}
type Symbol = "A" | "B" | "C" | "D" | "E" | "F" | "WILD";
```

Invariants (testable at the `slotMath` boundary):

- `grid[reel][row]` reconstructs from `stops[reel]` + the strip for that reel.
- Every `WinLine.positions` lies on its declared `lineId`'s shape.
- `sum(lines[].win) === totalWin`.
- `balanceAfter === previousBalance - bet + totalWin`.

## Architecture & Code Organization

Organized around **deep modules**: small interfaces hiding large implementations, so tests target boundaries rather than internals and readers aren't forced to bounce between many shallow files.

### Three deep modules + one thin orchestrator

1. **`src/server/slotMath.ts` (port + adapter)**
   - Port: `interface SlotServer { spin(bet: number): Promise<SpinResult> }` where `SpinResult` is a discriminated union of `{ ok: true, data: SpinResponse }` and `{ ok: false, error: 'INSUFFICIENT_FUNDS', balance }`.
   - Adapter `MockedServer` implements it, hiding reel strips, paylines, paytable, PRNG, line evaluation, and wallet/balance state.
   - Types `SpinResult`, `SpinResponse`, `WinLine`, `Symbol` are colocated here — the only place outcome shape is defined. No standalone `types/` or `config/` directories.
   - Constructor accepts `{ seed?: number, startingBalance?: number }`. Defaults: random seed, `1000.00` balance. Seed and starting balance are adapter construction concerns, not part of the port — a future HTTP adapter ignores them.

2. **`src/game/ReelBoard.ts`**
   - One concept: the 5×3 board and what it shows.
   - Interface: `spin(): void`, `requestStop(): void`, `land(response: SpinResponse): Promise<void>`, `reset(): void`.
   - Hides sprite pool, per-reel easing/bounce, symbol strip scrolling, winning-symbol highlight cycling, and total-win roll-up. No separate `WinPresenter` — win presentation is part of the board's single lifecycle so the geometry/timing coupling stays internal.

3. **`src/game/BetSelector.ts`**
   - Pixi-rendered control (arrow buttons + bet label) over a fixed bet list. Emits `betChanged(newBet)`. Exposes `setEnabled(bool)` for disabling during spins.

4. **`src/game/Game.ts` (thin orchestrator)**
   - Owns the state machine: `LOADING → IDLE → REQUESTING → SPINNING → STOPPING → PRESENTING_WIN → IDLE`.
   - `SPINNING` accepts a `quickStop` input that transitions directly to `STOPPING` via `ReelBoard.requestStop()`.
   - Receives `SlotServer` via constructor (ports & adapters), so tests and future real backends are drop-in.
   - Contains no outcome math and no animation math — both live behind module boundaries.

### Bootstrap

`src/main.ts` is a ~30-line bootstrap that:

1. Parses `?seed=` from `location.search`.
2. Creates the Pixi `Application` at 1280×720 and attaches a single resize handler that scales the stage to viewport.
3. Preloads the `Assets` manifest, rendering a Pixi-based progress bar.
4. Constructs `MockedServer`, `ReelBoard`, `BetSelector`, `Game` and wires them.

### Why this shape

- **Brief-compliant**: "server logic separated from game, fetched via simple API call" is satisfied by the `SlotServer` port.
- **Testable at the boundary**: fixed seed + bet → pinned response; response-invariant assertions cover everything the private helpers would otherwise need direct tests for.
- **Fewer seams**: merging reels + win presentation removes a fragile coupling where a presenter would need to reach into reel geometry.
- **Reviewer-navigable**: following a spin end-to-end means reading three files — `Game`, `ReelBoard`, `slotMath` — not eight.

## Tech Stack

- TypeScript in strict mode (update `tsconfig.json` if not already).
- PixiJS v8 for rendering (already in `package.json`).
- Vite for dev server / build (already in `package.json`).
- **Vitest** added as a dev dependency for the `slotMath` boundary tests.
- No other runtime dependencies.

## Assets

- Source 7 free symbol sprites (6 plain + Wild) into `public/assets/symbols/`.
- Provide one frame/background image into `public/assets/ui/`.
- Declare everything in a Pixi `Assets` manifest; load via the manifest before entering `IDLE`.

## Verification / Acceptance

A reviewer should be able to:

1. `npm install && npm run dev` → loading screen briefly, then the game at the Vite URL with no console errors.
2. Change bet via the Pixi bet selector; observe Spin button disables if the upcoming bet exceeds balance.
3. Click Spin → reels speed up, spin, slow down, bounce on stop. Click again during spin → reels slam to their stops (quick-stop).
4. On winning responses, total-win roll-up plays, then each winning line is highlighted in turn until next spin.
5. Balance updates after each spin to match `balanceAfter`.
6. Append `?seed=12345` to the URL → spins are reproducible across page reloads.
7. `npm run typecheck`, `npm run build`, and `npm run test` all succeed.
8. Open DevTools Sources → confirm `slotMath.ts` is a separate module invoked via an async call from `Game`.

## Testing Decisions

### What makes a good test (for this project)

- Tests assert **external behavior at a boundary**, never private helpers.
- The `slotMath` boundary is `getResponseData(bet)`; tests feed in a bet and assert shape/invariants/pinned values of the returned `SpinResponse`.
- Tests never import from inside the module (no reel-strip-internal or paytable-internal imports) — if a test needs to reach inside, the interface is wrong.
- Determinism comes from constructing `MockedServer` with a fixed seed, not from mocking `Math.random`.
- A good failure message names a broken invariant ("line win does not sum to total") rather than a diff of opaque numbers.

### Which modules get tests

- **`slotMath` / `MockedServer`** — yes. Suite covers:
  - Response-shape conformance on `ok: true` results (all required fields present, correct types).
  - Invariants across many spins at a fixed seed: `grid` reconstructs from `stops` and strips; each `WinLine.positions` matches its `lineId` geometry; `sum(lines[].win) === totalWin`; `balanceAfter === previousBalance - bet + totalWin`.
  - Wild substitution: pinned spins that force a wild on a paying line, asserting the line still reports the non-wild symbol as `symbol`.
  - Insufficient-funds: calling `spin(bet)` when `bet > balance` resolves to `{ ok: false, error: 'INSUFFICIENT_FUNDS', balance }`; assert the discriminant, the reported `balance`, and that a subsequent `spin` at a valid bet still sees the unchanged balance.
- **`ReelBoard`** — no unit tests. It's presentational; its correctness is visual and covered by manual acceptance.
- **`BetSelector`** — no unit tests. Trivial UI; its behavior is observed by the reviewer.
- **`Game`** — no unit tests in v1. State-machine tests with a fake `SlotServer` are a natural next step and worth mentioning in interview as "this is where I'd add tests next."

### Prior art

- None in this repo — the scaffold has no tests yet. Vitest will be introduced specifically for this purpose and configured per the standard Vite + Vitest setup.

## Out of Scope (explicit, to avoid scope creep)

- Audio, keyboard controls, anticipation effect, turbo toggle, free spins, scatter pays, bonus games, jackpots, settings menu, localization, accessibility audit, mobile touch tuning, real backend, analytics.
- Unit tests for `ReelBoard`, `BetSelector`, or `Game` — deliberately deferred; discussed above.
- Performance benchmarking beyond "feels 60 FPS on reviewer's desktop."

## Further Notes

- The candidate should commit small and often with descriptive messages, so the reviewer can see the implementation order in `git log`.
- A short `README.md` addition is recommended: one paragraph on how to run, a list of the four modules with one-line descriptions, the `?seed=N` trick, and a brief "what I would add next" section to steer interview discussion.
- If implementation time is tight, the safest cut is dropping the cycle-by-line presentation and shipping all-at-once highlighting — the brief's green requirement only demands "some win symbols should be animated, highlighted." Document the cut in the README as a conscious tradeoff.
- The `SlotServer` port is the most important boundary in the project; during interview, lead with it when explaining the architecture.
