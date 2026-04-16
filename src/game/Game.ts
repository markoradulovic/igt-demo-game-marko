import { Container, Graphics, Text, Ticker } from "pixi.js";
import type { SlotServer, SpinResponse, WinLine } from "../server/slotMath";
import { ReelBoard } from "./ReelBoard";
import { BetSelector } from "./BetSelector";
import { WinPresenter } from "./WinPresenter";

// Minimum time reels visibly spin before we ask them to land. The server
// resolves faster than the animation is entertaining; this floor enforces a
// "felt" spin duration regardless of server latency.
const MIN_SPIN_MS = 500;

// Game state machine. `Game` is a thin orchestrator — it owns no outcome
// math (that's `slotMath`) and no animation math (that's `ReelAnimator` and
// `WinPresenter`). It sequences these states and wires modules together.
//   IDLE → REQUESTING → SPINNING → STOPPING → PRESENTING_WIN → IDLE
// Clicking Spin during PRESENTING_WIN interrupts the cycle and starts the
// next spin (see `handleSpin`).
type State = "IDLE" | "REQUESTING" | "SPINNING" | "STOPPING" | "PRESENTING_WIN";

export class Game {
  readonly view: Container;
  private board: ReelBoard;
  private server: SlotServer;
  private betSelector: BetSelector;
  private state: State = "IDLE";
  private balance: number;
  private balanceLabel: Text;
  private spinButton: Container;
  private spinButtonBg: Graphics;
  private spinLabel: Text;
  private winPresenter: WinPresenter;
  private winLabel: Text;
  private presenterTickHandler: ((t: Ticker) => void) | null = null;
  private presenterTicker: Ticker;
  private currentResponse: SpinResponse | null = null;
  private lastShownLine: WinLine | null = null;
  private cancelSpinDelay: (() => void) | null = null;
  private stoppingResponse: SpinResponse | null = null;

  constructor(
    server: SlotServer,
    initialBalance: number,
    ticker: Ticker = Ticker.shared
  ) {
    this.server = server;
    this.balance = initialBalance;
    this.presenterTicker = ticker;
    this.view = new Container();
    this.winPresenter = new WinPresenter();

    this.board = new ReelBoard();
    this.board.view.x = 140;
    this.board.view.y = 40;
    this.view.addChild(this.board.view);

    this.balanceLabel = new Text({
      text: this.formatBalance(),
      style: { fill: 0xffffff, fontSize: 28, fontWeight: "bold" },
    });
    this.balanceLabel.x = 140;
    this.balanceLabel.y = 625;
    this.view.addChild(this.balanceLabel);

    this.winLabel = new Text({
      text: "",
      style: { fill: 0xffd700, fontSize: 32, fontWeight: "bold" },
    });
    this.winLabel.x = 560;
    this.winLabel.y = 625;
    this.view.addChild(this.winLabel);

    this.betSelector = new BetSelector();
    this.betSelector.view.x = 140;
    this.betSelector.view.y = 660;
    this.view.addChild(this.betSelector.view);
    this.betSelector.onBetChanged(() => this.refreshSpinButton());

    this.spinButton = new Container();
    this.spinButton.x = 940;
    this.spinButton.y = 640;
    this.spinButton.eventMode = "static";
    this.spinButton.cursor = "pointer";

    this.spinButtonBg = new Graphics();
    this.spinButton.addChild(this.spinButtonBg);

    this.spinLabel = new Text({
      text: "SPIN",
      style: { fill: 0xffffff, fontSize: 32, fontWeight: "bold" },
    });
    this.spinLabel.anchor.set(0.5);
    this.spinLabel.x = 100;
    this.spinLabel.y = 36;
    this.spinButton.addChild(this.spinLabel);

    // The Spin button serves double duty: during SPINNING or STOPPING it
    // becomes a quick-stop trigger ("STOP"). This reuses the same hit target
    // so the player can mash one spot to spin-then-stop without moving the
    // cursor. STOPPING also needs it because `land()` staggers reel-by-reel
    // — the right-side reels are still visibly spinning while earlier ones
    // decelerate, and the player naturally wants to slam them all down.
    this.spinButton.on("pointertap", () => {
      if (this.state === "SPINNING" || this.state === "STOPPING") {
        this.handleQuickStop();
        return;
      }
      void this.handleSpin();
    });

    this.view.addChild(this.spinButton);
    this.refreshSpinButton();
  }

  private canSpin(): boolean {
    const spinnable = this.state === "IDLE" || this.state === "PRESENTING_WIN";
    return spinnable && this.balance >= this.betSelector.bet;
  }

  private refreshSpinButton(): void {
    const isStoppable = this.state === "SPINNING" || this.state === "STOPPING";
    const enabled = this.canSpin() || isStoppable;
    this.spinButtonBg.clear();
    this.spinButtonBg.roundRect(0, 0, 200, 72, 12);
    this.spinButtonBg.fill({ color: enabled ? 0x2ecc71 : 0x4a4a5e });
    this.spinButton.eventMode = enabled ? "static" : "none";
    this.spinButton.cursor = enabled ? "pointer" : "default";
    this.spinLabel.alpha = enabled ? 1 : 0.5;
    this.spinLabel.text = isStoppable ? "STOP" : "SPIN";
  }

  private setState(next: State): void {
    this.state = next;
    this.betSelector.setEnabled(next === "IDLE" || next === "PRESENTING_WIN");
    this.refreshSpinButton();
  }

  private async handleSpin(): Promise<void> {
    if (!this.canSpin()) return;
    if (this.state === "PRESENTING_WIN") {
      this.stopPresenting();
    }
    const bet = this.betSelector.bet;
    this.setState("REQUESTING");
    this.board.spin();
    try {
      // Kick off the request and the spin animation concurrently: reels
      // start spinning immediately (REQUESTING), then transition to
      // SPINNING once we have a response.
      const result = await this.server.spin(bet);
      if (!result.ok) {
        this.setState("IDLE");
        return;
      }
      // SPINNING state: reels spin freely for MIN_SPIN_MS before landing.
      // The delay is cancellable — if the player clicks during this window,
      // `handleQuickStop` fires the cancel callback, the await resolves
      // immediately with `wasCancelled = true`, and we route to
      // `requestStop` (all reels snap at once) instead of `land` (staggered).
      // Either path ends at the same STOPPING → PRESENTING_WIN transition.
      this.setState("SPINNING");
      const wasCancelled = await cancellableDelay(MIN_SPIN_MS, (cancel) => {
        this.cancelSpinDelay = cancel;
      });
      this.cancelSpinDelay = null;
      this.setState("STOPPING");
      this.stoppingResponse = result.data;
      if (wasCancelled) {
        this.board.requestStop(result.data);
        await this.board.waitForSettle();
      } else {
        await this.board.land(result.data);
      }
      this.stoppingResponse = null;
      this.balance = result.data.balanceAfter;
      this.balanceLabel.text = this.formatBalance();
      if (result.data.totalWin > 0) {
        this.setState("PRESENTING_WIN");
        this.startPresenting(result.data);
      } else {
        this.setState("IDLE");
      }
    } catch (err) {
      console.error(err);
      this.setState("IDLE");
    }
  }

  // Quick-stop is purely a presentation shortcut — the server response is
  // already in hand (it was awaited before entering SPINNING). During
  // SPINNING we cancel the cosmetic delay so `handleSpin` routes to
  // `requestStop`. During STOPPING the staggered `land()` is already
  // underway, so we call `requestStop` directly to snap any reels that
  // haven't begun decelerating yet — `quickStop` is a no-op on reels
  // already in decel/bounce/settled, so this is always safe.
  private handleQuickStop(): void {
    if (this.state === "SPINNING" && this.cancelSpinDelay) {
      this.cancelSpinDelay();
    } else if (this.state === "STOPPING" && this.stoppingResponse) {
      this.board.requestStop(this.stoppingResponse);
    }
  }

  private startPresenting(response: SpinResponse): void {
    this.currentResponse = response;
    this.lastShownLine = null;
    this.winLabel.text = "Win: 0.00";
    this.winPresenter.start(response);
    this.presenterTickHandler = (t: Ticker) => this.onPresenterTick(t.deltaMS);
    this.presenterTicker.add(this.presenterTickHandler);
  }

  private stopPresenting(): void {
    if (this.presenterTickHandler) {
      this.presenterTicker.remove(this.presenterTickHandler);
      this.presenterTickHandler = null;
    }
    this.winPresenter.stop();
    this.board.clearHighlight();
    this.winLabel.text = "";
    this.currentResponse = null;
    this.lastShownLine = null;
  }

  // Pull state from `WinPresenter` each frame and reflect it to Pixi.
  // `activeLine` changes discretely (once per LINE_MS), so we only repaint
  // the board highlight when it actually changes — not every tick.
  private onPresenterTick(deltaMs: number): void {
    this.winPresenter.tick(deltaMs);
    if (!this.currentResponse) return;
    this.winLabel.text = `Win: ${this.winPresenter.rollupValue.toFixed(2)}`;
    const active = this.winPresenter.activeLine;
    if (active !== this.lastShownLine) {
      this.lastShownLine = active;
      if (active) {
        this.board.highlightLine(active, this.currentResponse.grid);
      } else {
        this.board.clearHighlight();
      }
    }
  }

  private formatBalance(): string {
    return `Balance: ${this.balance.toFixed(2)}`;
  }
}

// A delay that can be cut short from outside. Used for the SPINNING hold:
// the player sees reels spin for at least MIN_SPIN_MS, but a quick-stop
// click cancels the wait and lets `handleSpin` proceed immediately.
// Returns true if cancelled, false if the delay completed naturally.
function cancellableDelay(
  ms: number,
  onCancel: (cancel: () => void) => void
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    onCancel(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}
