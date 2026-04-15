import { Container, Graphics, Text } from "pixi.js";
import type { SlotServer } from "../server/slotMath";
import { ReelBoard } from "./ReelBoard";

const FIXED_BET = 1;
const MIN_SPIN_MS = 500;

type State = "IDLE" | "REQUESTING" | "SPINNING" | "STOPPING";

export class Game {
  readonly view: Container;
  private board: ReelBoard;
  private server: SlotServer;
  private state: State = "IDLE";

  constructor(server: SlotServer) {
    this.server = server;
    this.view = new Container();

    this.board = new ReelBoard();
    this.board.view.x = 140;
    this.board.view.y = 40;
    this.view.addChild(this.board.view);

    const button = new Container();
    button.x = 540;
    button.y = 610;
    button.eventMode = "static";
    button.cursor = "pointer";

    const buttonBg = new Graphics();
    buttonBg.roundRect(0, 0, 200, 72, 12);
    buttonBg.fill({ color: 0x2ecc71 });
    button.addChild(buttonBg);

    const label = new Text({
      text: "SPIN",
      style: { fill: 0xffffff, fontSize: 32, fontWeight: "bold" },
    });
    label.anchor.set(0.5);
    label.x = 100;
    label.y = 36;
    button.addChild(label);

    button.on("pointertap", () => {
      void this.handleSpin();
    });

    this.view.addChild(button);
  }

  private async handleSpin(): Promise<void> {
    if (this.state !== "IDLE") return;
    this.state = "REQUESTING";
    this.board.spin();
    try {
      const result = await this.server.spin(FIXED_BET);
      if (!result.ok) {
        this.state = "IDLE";
        return;
      }
      this.state = "SPINNING";
      await delay(MIN_SPIN_MS);
      this.state = "STOPPING";
      await this.board.land(result.data);
    } catch (err) {
      console.error(err);
    } finally {
      this.state = "IDLE";
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
