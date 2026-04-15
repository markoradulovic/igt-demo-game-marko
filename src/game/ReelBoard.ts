import { Container, Graphics, Text } from "pixi.js";
import type { Symbol, SpinResponse } from "../server/slotMath";

const SYMBOL_COLORS: Record<Symbol, number> = {
  A: 0xe74c3c,
  B: 0xe67e22,
  C: 0xf1c40f,
  D: 0x2ecc71,
  E: 0x3498db,
  F: 0x9b59b6,
  WILD: 0xecf0f1,
};

const CELL_W = 160;
const CELL_H = 160;
const GAP = 8;
const COLS = 5;
const ROWS = 3;

export class ReelBoard {
  readonly view: Container;
  private cells: Graphics[][] = [];
  private labels: Text[][] = [];

  constructor() {
    this.view = new Container();

    const boardW = COLS * CELL_W + (COLS - 1) * GAP;
    const boardH = ROWS * CELL_H + (ROWS - 1) * GAP;

    const bg = new Graphics();
    bg.rect(-16, -16, boardW + 32, boardH + 32);
    bg.fill({ color: 0x0f0f1a });
    this.view.addChild(bg);

    for (let c = 0; c < COLS; c++) {
      this.cells.push([]);
      this.labels.push([]);
      for (let r = 0; r < ROWS; r++) {
        const cell = new Graphics();
        cell.x = c * (CELL_W + GAP);
        cell.y = r * (CELL_H + GAP);
        cell.rect(0, 0, CELL_W, CELL_H);
        cell.fill({ color: 0x2a2a3e });
        this.view.addChild(cell);

        const label = new Text({
          text: "",
          style: { fill: 0xffffff, fontSize: 48, fontWeight: "bold" },
        });
        label.x = cell.x + CELL_W / 2;
        label.y = cell.y + CELL_H / 2;
        label.anchor.set(0.5);
        this.view.addChild(label);

        this.cells[c].push(cell);
        this.labels[c].push(label);
      }
    }
  }

  land(response: SpinResponse): void {
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const sym = response.grid[c][r];
        const cell = this.cells[c][r];
        cell.clear();
        cell.rect(0, 0, CELL_W, CELL_H);
        cell.fill({ color: SYMBOL_COLORS[sym] });
        this.labels[c][r].text = sym;
      }
    }
  }
}
