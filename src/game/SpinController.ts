// Pure-TS state machine for the spin lifecycle and win presentation. Owned by
// `Game` but holds no Pixi dependency — it drives animations through the
// `ReelSink` callback interface and exposes an immutable `SpinSnapshot` for the
// view to render. All time-dependent behavior advances via `tick(deltaMs)` so
// the full lifecycle is deterministic under test without timer plumbing.

import {
  HIGH_PAYING_SYMBOLS,
  PAYLINES,
  type SlotServer,
  type SpinResponse,
  type WinLine,
  type Symbol,
} from "../server/slotMath";
import { shouldAnticipate } from "./reelMath";

export interface AnticipationState {
  reels: number[];
}

// Minimum time reels visibly spin before landing. A tick-decremented counter
// rather than a setTimeout so quick-stop can zero it and tests can advance it
// synchronously — no fake timers needed.
const MIN_SPIN_MS = 500;

// Rollup = one-time 0→totalWin counter animation on entry to `presenting`.
// After rollup completes, `activeLine` cycles through `lines` every LINE_MS
// indefinitely until the next spin.
const ROLLUP_MS = 800;
const LINE_MS = 900;

export type SpinPhase =
  | "idle"
  | "requesting"
  | "spinning"
  | "stopping"
  | "presenting";

export interface SpinSnapshot {
  readonly phase: SpinPhase;
  readonly balance: number;
  readonly canSpin: boolean;
  readonly canStop: boolean;
  readonly betEnabled: boolean;
  readonly rollupValue: number;
  readonly activeLine: WinLine | null;
  readonly grid: Symbol[][] | null;
  readonly anticipation: AnticipationState | null;
}

/** Callbacks the controller fires to drive reel animations. */
export interface ReelSink {
  spinReels(): void;
  landReels(
    response: SpinResponse,
    anticipation: AnticipationState | null
  ): Promise<void>;
  snapReels(response: SpinResponse): Promise<void>;
  clearHighlight(): void;
}

export interface SpinControllerDeps {
  server: SlotServer;
  reels: ReelSink;
  initialBalance: number;
  initialBet: number;
}

export interface SpinController {
  tick(deltaMs: number): SpinSnapshot;
  pressButton(): void;
  setBet(bet: number): void;
}

export function createSpinController(deps: SpinControllerDeps): SpinController {
  return new SpinControllerImpl(deps);
}

class SpinControllerImpl implements SpinController {
  private readonly server: SlotServer;
  private readonly reels: ReelSink;
  private phase: SpinPhase = "idle";
  private balance: number;
  private bet: number;

  private spinHoldRemaining = 0;
  private pendingResponse: SpinResponse | null = null;
  private quickStopRequested = false;
  // Computed once when the server response arrives so the snapshot is stable
  // across ticks; cleared when the spin fully resolves (settle or no-win).
  private pendingAnticipation: AnticipationState | null = null;

  private presentingResponse: SpinResponse | null = null;
  private presentElapsed = 0;
  private lastActiveLine: WinLine | null = null;

  constructor(deps: SpinControllerDeps) {
    this.server = deps.server;
    this.reels = deps.reels;
    this.balance = deps.initialBalance;
    this.bet = deps.initialBet;
  }

  setBet(bet: number): void {
    this.bet = bet;
  }

  pressButton(): void {
    if (this.phase === "spinning" || this.phase === "stopping") {
      this.handleQuickStop();
    } else {
      this.handleSpin();
    }
  }

  tick(deltaMs: number): SpinSnapshot {
    if (this.phase === "spinning") {
      this.spinHoldRemaining -= deltaMs;
      if (this.spinHoldRemaining <= 0) {
        this.transitionToStopping();
      }
    }

    if (this.phase === "presenting" && this.presentingResponse) {
      this.presentElapsed += deltaMs;
      const active = this.computeActiveLine();
      if (active !== this.lastActiveLine) {
        this.lastActiveLine = active;
      }
    }

    return this.snapshot();
  }

  private snapshot(): SpinSnapshot {
    const canSpin =
      (this.phase === "idle" || this.phase === "presenting") &&
      this.balance >= this.bet;
    const canStop = this.phase === "spinning" || this.phase === "stopping";
    const betEnabled = this.phase === "idle" || this.phase === "presenting";

    return {
      phase: this.phase,
      balance: this.balance,
      canSpin,
      canStop,
      betEnabled,
      rollupValue: this.computeRollupValue(),
      activeLine: this.phase === "presenting" ? this.computeActiveLine() : null,
      grid: this.presentingResponse?.grid ?? null,
      anticipation: this.pendingAnticipation,
    };
  }

  // ── Win presentation ───────────────────────────────────────────────

  private computeRollupValue(): number {
    if (!this.presentingResponse || this.presentingResponse.totalWin === 0)
      return 0;
    const t = Math.min(1, this.presentElapsed / ROLLUP_MS);
    return this.presentingResponse.totalWin * t;
  }

  private isRollupComplete(): boolean {
    if (!this.presentingResponse) return true;
    if (this.presentingResponse.totalWin === 0) return true;
    return this.presentElapsed >= ROLLUP_MS;
  }

  private computeActiveLine(): WinLine | null {
    if (!this.presentingResponse || this.presentingResponse.lines.length === 0)
      return null;
    if (!this.isRollupComplete()) return null;
    const sinceRollup = this.presentElapsed - ROLLUP_MS;
    const idx = Math.floor(sinceRollup / LINE_MS);
    return this.presentingResponse.lines[
      idx % this.presentingResponse.lines.length
    ];
  }

  // ── Spin orchestration ─────────────────────────────────────────────

  private handleSpin(): void {
    if (this.phase === "presenting") {
      this.stopPresenting();
    }
    if (this.phase !== "idle") return;
    if (this.balance < this.bet) return;

    // Flip phase synchronously before awaiting the server. A second press
    // while the request is in flight re-enters here and falls out on the
    // `phase !== "idle"` gate above, so we never start a parallel spin.
    this.phase = "requesting";
    this.reels.spinReels();
    this.pendingResponse = null;
    this.quickStopRequested = false;

    this.server.spin(this.bet).then(
      (result) => {
        if (!result.ok) {
          this.phase = "idle";
          return;
        }
        this.pendingResponse = result.data;
        this.pendingAnticipation = shouldAnticipate(
          result.data.grid,
          PAYLINES,
          HIGH_PAYING_SYMBOLS
        );
        this.spinHoldRemaining = MIN_SPIN_MS;
        this.phase = "spinning";
      },
      (err) => {
        console.error(err);
        this.phase = "idle";
      }
    );
  }

  private transitionToStopping(): void {
    if (!this.pendingResponse) return;
    this.phase = "stopping";
    const response = this.pendingResponse;
    // Keep `pendingResponse` populated through `stopping` so a second Stop
    // press (e.g. during the anticipation hold on reels 4–5) can snap the
    // still-unlanded reels. Cleared when reels fully settle below.

    // Quick-stop cancels anticipation: the player asked to skip the drama,
    // so we don't slow reels 3–4 or pulse them. Normal land passes it through.
    const settlePromise = this.quickStopRequested
      ? this.reels.snapReels(response)
      : this.reels.landReels(response, this.pendingAnticipation);

    settlePromise.then(() => {
      this.onReelsSettled(response);
    });
  }

  private onReelsSettled(response: SpinResponse): void {
    this.balance = response.balanceAfter;
    this.pendingResponse = null;
    // Anticipation only telegraphs the in-flight spin — once reels settle the
    // visual cue is done regardless of whether the big win actually paid.
    this.pendingAnticipation = null;
    if (response.totalWin > 0) {
      this.phase = "presenting";
      this.presentingResponse = response;
      this.presentElapsed = 0;
      this.lastActiveLine = null;
    } else {
      this.phase = "idle";
    }
  }

  private handleQuickStop(): void {
    if (this.phase === "spinning") {
      // Cancel the hold countdown — transitionToStopping will use snapReels
      this.quickStopRequested = true;
      this.spinHoldRemaining = 0;
    } else if (this.phase === "stopping" && this.pendingResponse) {
      // land() is already in progress but we can snap remaining reels
      this.reels.snapReels(this.pendingResponse);
    }
  }

  private stopPresenting(): void {
    this.presentingResponse = null;
    this.presentElapsed = 0;
    this.lastActiveLine = null;
    this.reels.clearHighlight();
    this.phase = "idle";
  }
}
