import { Assets, Container, Graphics, Sprite, Text, Ticker } from "pixi.js";
import type { SlotServer } from "../server/slotMath";
import { ReelBoard } from "./ReelBoard";
import { BetSelector } from "./BetSelector";
import { createSpinController } from "./SpinController";
import type { SpinController, SpinSnapshot } from "./SpinController";
import { attachKeyboardInput } from "./KeyboardInput";
import { createAudioManager } from "./AudioManager";
import type { AudioManager } from "./AudioManager";

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
  private audio: AudioManager;
  private soundButton: Container;
  private soundIcon: Graphics;

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

    this.audio = createAudioManager();

    this.board = new ReelBoard({
      onReelLanded: () => this.audio.play("reel-land"),
    });
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
      this.audio.play("click");
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

    this.spinButton.on("pointertap", () => {
      this.audio.play("click");
      this.controller.pressButton();
    });
    this.view.addChild(this.spinButton);

    // Sound toggle — top-right corner, intentionally separated from the
    // gameplay cluster at the bottom of the stage so the player doesn't
    // toggle audio by accident while aiming for Spin.
    this.soundButton = new Container();
    this.soundButton.x = 1200;
    this.soundButton.y = 20;
    this.soundButton.eventMode = "static";
    this.soundButton.cursor = "pointer";
    this.soundIcon = new Graphics();
    this.soundButton.addChild(this.soundIcon);
    this.soundButton.on("pointertap", () => this.toggleSound());
    this.drawSoundIcon();
    this.view.addChild(this.soundButton);

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
      audio: {
        onSpinStart: () => this.audio.play("spin-start"),
        onAnticipation: () => this.audio.play("anticipation"),
        onWin: () => this.audio.play("win"),
      },
    });

    ticker.add((t: Ticker) =>
      this.applySnapshot(this.controller.tick(t.deltaMS))
    );
    this.applySnapshot(this.controller.tick(0));

    if (typeof window !== "undefined") {
      this.detachKeyboard = attachKeyboardInput(window, {
        onSpin: () => {
          this.audio.play("click");
          this.controller.pressButton();
        },
        onBetPrev: () => this.betSelector.prev(),
        onBetNext: () => this.betSelector.next(),
        onToggleSound: () => this.toggleSound(),
      });
    }
  }

  private toggleSound(): void {
    const next = !this.audio.isEnabled();
    this.audio.setEnabled(next);
    this.drawSoundIcon();
    // Play the click feedback *after* enabling so the toggle itself is
    // audible confirmation; when muting, stay silent (a click on disable
    // would contradict the user's intent).
    if (next) this.audio.play("click");
  }

  // Speaker silhouette + optional slash for the muted state. Drawn in pure
  // Pixi Graphics so the icon stays crisp at any scale and doesn't require
  // a new sprite asset. Sized at 48×48 with the speaker occupying the left
  // half and the cone flaring to the right.
  private drawSoundIcon(): void {
    const enabled = this.audio.isEnabled();
    const g = this.soundIcon;
    g.clear();

    // Rounded square button background
    g.roundRect(0, 0, 48, 48, 8);
    g.fill({ color: enabled ? 0x2ecc71 : 0x4a4a5e });

    // Speaker body (rectangle) + cone (triangle) in white
    g.rect(12, 20, 6, 8);
    g.moveTo(18, 20);
    g.lineTo(28, 12);
    g.lineTo(28, 36);
    g.lineTo(18, 28);
    g.lineTo(18, 20);
    g.fill({ color: 0xffffff });

    if (enabled) {
      // Sound waves to the right of the cone
      g.moveTo(32, 18);
      g.lineTo(36, 22);
      g.lineTo(36, 26);
      g.lineTo(32, 30);
      g.stroke({ width: 2, color: 0xffffff });
    } else {
      // Diagonal slash indicating muted
      g.moveTo(10, 10);
      g.lineTo(38, 38);
      g.stroke({ width: 3, color: 0xff6666 });
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
