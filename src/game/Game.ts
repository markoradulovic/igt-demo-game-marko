import { Container, Graphics, Text } from "pixi.js";
import type { SlotServer } from "../server/slotMath";
import { ReelBoard } from "./ReelBoard";
import { BetSelector } from "./BetSelector";

const MIN_SPIN_MS = 500;

type State = "IDLE" | "REQUESTING" | "SPINNING" | "STOPPING";

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

  constructor(server: SlotServer, initialBalance: number) {
    this.server = server;
    this.balance = initialBalance;
    this.view = new Container();

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

    this.spinButton.on("pointertap", () => {
      void this.handleSpin();
    });

    this.view.addChild(this.spinButton);
    this.refreshSpinButton();
  }

  private canSpin(): boolean {
    return this.state === "IDLE" && this.balance >= this.betSelector.bet;
  }

  private refreshSpinButton(): void {
    const enabled = this.canSpin();
    this.spinButtonBg.clear();
    this.spinButtonBg.roundRect(0, 0, 200, 72, 12);
    this.spinButtonBg.fill({ color: enabled ? 0x2ecc71 : 0x4a4a5e });
    this.spinButton.eventMode = enabled ? "static" : "none";
    this.spinButton.cursor = enabled ? "pointer" : "default";
    this.spinLabel.alpha = enabled ? 1 : 0.5;
  }

  private setState(next: State): void {
    this.state = next;
    this.betSelector.setEnabled(next === "IDLE");
    this.refreshSpinButton();
  }

  private async handleSpin(): Promise<void> {
    if (!this.canSpin()) return;
    const bet = this.betSelector.bet;
    this.setState("REQUESTING");
    this.board.spin();
    try {
      const result = await this.server.spin(bet);
      if (!result.ok) {
        this.setState("IDLE");
        return;
      }
      this.setState("SPINNING");
      await delay(MIN_SPIN_MS);
      this.setState("STOPPING");
      await this.board.land(result.data);
      this.balance = result.data.balanceAfter;
      this.balanceLabel.text = this.formatBalance();
    } catch (err) {
      console.error(err);
    } finally {
      this.setState("IDLE");
    }
  }

  private formatBalance(): string {
    return `Balance: ${this.balance.toFixed(2)}`;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
