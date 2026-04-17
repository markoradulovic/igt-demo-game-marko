import { Assets, Container, Graphics, Sprite, Text, Ticker } from "pixi.js";
import type { SlotServer } from "../server/slotMath";
import { ReelBoard } from "./ReelBoard";
import { BetSelector } from "./BetSelector";
import { createSpinController } from "./SpinController";
import type { SpinController, SpinSnapshot } from "./SpinController";
import { attachKeyboardInput } from "./KeyboardInput";

export class Game {
  readonly view: Container;
  private controller: SpinController;
  private board: ReelBoard;
  private betSelector: BetSelector;
  private balanceLabel: Text;
  private winLabel: Text;
  private spinButton: Container;
  private spinButtonBg: Graphics;
  private spinLabel: Text;
  private lastActiveLine: unknown = null;
  private detachKeyboard: (() => void) | null = null;

  constructor(
    server: SlotServer,
    initialBalance: number,
    ticker: Ticker = Ticker.shared
  ) {
    this.view = new Container();

    // Background fills the entire stage
    const bgTexture = Assets.get("ui-background");
    if (bgTexture) {
      const bg = new Sprite(bgTexture);
      bg.width = 1280;
      bg.height = 720;
      this.view.addChild(bg);
    }

    // Decorative frame behind the reel board
    const frameTexture = Assets.get("ui-frame");
    if (frameTexture) {
      const frame = new Sprite(frameTexture);
      frame.x = 110;
      frame.y = 10;
      frame.width = 892;
      frame.height = 540;
      this.view.addChild(frame);
    }

    this.board = new ReelBoard();
    this.board.view.x = 140;
    this.board.view.y = 40;
    this.view.addChild(this.board.view);

    this.balanceLabel = new Text({
      text: `Balance: ${initialBalance.toFixed(2)}`,
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
    this.betSelector.onBetChanged((bet) => {
      this.controller.setBet(bet);
      this.applySnapshot(this.controller.tick(0));
    });

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

    this.spinButton.on("pointertap", () => this.controller.pressButton());
    this.view.addChild(this.spinButton);

    this.controller = createSpinController({
      server,
      initialBalance,
      initialBet: this.betSelector.bet,
      reels: {
        spinReels: () => this.board.spin(),
        landReels: (r, ant) => this.board.land(r, ant),
        snapReels: (r) => {
          this.board.requestStop(r);
          return this.board.waitForSettle();
        },
        clearHighlight: () => this.board.clearHighlight(),
      },
    });

    ticker.add((t: Ticker) =>
      this.applySnapshot(this.controller.tick(t.deltaMS))
    );
    this.applySnapshot(this.controller.tick(0));

    if (typeof window !== "undefined") {
      this.detachKeyboard = attachKeyboardInput(window, {
        onSpin: () => this.controller.pressButton(),
        onBetPrev: () => this.betSelector.prev(),
        onBetNext: () => this.betSelector.next(),
      });
    }
  }

  destroy(): void {
    this.detachKeyboard?.();
    this.detachKeyboard = null;
  }

  private applySnapshot(snap: SpinSnapshot): void {
    this.balanceLabel.text = `Balance: ${snap.balance.toFixed(2)}`;
    this.winLabel.text =
      snap.rollupValue > 0 ? `Win: ${snap.rollupValue.toFixed(2)}` : "";

    this.spinLabel.text = snap.canStop ? "STOP" : "SPIN";
    const enabled = snap.canSpin || snap.canStop;
    this.spinButtonBg.clear();
    this.spinButtonBg.roundRect(0, 0, 200, 72, 12);
    this.spinButtonBg.fill({ color: enabled ? 0x2ecc71 : 0x4a4a5e });
    this.spinButton.eventMode = enabled ? "static" : "none";
    this.spinButton.cursor = enabled ? "pointer" : "default";
    this.spinLabel.alpha = enabled ? 1 : 0.5;

    this.betSelector.setEnabled(snap.betEnabled);

    // Only repaint highlight when the active line changes
    if (snap.activeLine !== this.lastActiveLine) {
      this.lastActiveLine = snap.activeLine;
      if (snap.activeLine && snap.grid) {
        this.board.highlightLine(snap.activeLine, snap.grid);
      } else {
        this.board.clearHighlight();
      }
    }
  }
}
