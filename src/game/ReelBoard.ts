import { Container, Graphics, Text, Ticker } from "pixi.js";
import type { Symbol, SpinResponse } from "../server/slotMath";
import { ReelAnimator } from "./ReelAnimator";

const SYMBOL_COLORS: Record<Symbol, number> = {
  A: 0xe74c3c,
  B: 0xe67e22,
  C: 0xf1c40f,
  D: 0x2ecc71,
  E: 0x3498db,
  F: 0x9b59b6,
  WILD: 0xecf0f1,
};

const BASE_STRIP: Symbol[] = ["A", "B", "C", "D", "E", "F", "WILD"];
const STRIP_LEN = BASE_STRIP.length;

const CELL_W = 160;
const CELL_H = 160;
const COLS = 5;
const ROWS = 3;
const REEL_GAP = 8;
const OVERSCAN = 1;
const STAGGER_MS = 180;

interface ReelCell {
  gfx: Graphics;
  label: Text;
}

interface Reel {
  container: Container;
  animator: ReelAnimator;
  cells: ReelCell[];
  strip: Symbol[];
  settledApplied: boolean;
}

export class ReelBoard {
  readonly view: Container;
  private readonly reels: Reel[] = [];
  private readonly ticker: Ticker;
  private tickHandler: ((t: Ticker) => void) | null = null;

  constructor(ticker: Ticker = Ticker.shared) {
    this.ticker = ticker;
    this.view = new Container();

    const boardW = COLS * CELL_W + (COLS - 1) * REEL_GAP;
    const boardH = ROWS * CELL_H;

    const bg = new Graphics();
    bg.rect(-16, -16, boardW + 32, boardH + 32);
    bg.fill({ color: 0x0f0f1a });
    this.view.addChild(bg);

    for (let c = 0; c < COLS; c++) {
      const reelContainer = new Container();
      reelContainer.x = c * (CELL_W + REEL_GAP);
      reelContainer.y = 0;

      const mask = new Graphics();
      mask.rect(0, 0, CELL_W, ROWS * CELL_H);
      mask.fill({ color: 0xffffff });
      reelContainer.addChild(mask);
      reelContainer.mask = mask;

      const cells: ReelCell[] = [];
      const totalCells = ROWS + OVERSCAN * 2;
      for (let i = 0; i < totalCells; i++) {
        const gfx = new Graphics();
        gfx.rect(0, 0, CELL_W, CELL_H);
        gfx.fill({ color: 0x2a2a3e });
        reelContainer.addChild(gfx);

        const label = new Text({
          text: "",
          style: { fill: 0xffffff, fontSize: 48, fontWeight: "bold" },
        });
        label.anchor.set(0.5);
        label.x = CELL_W / 2;
        reelContainer.addChild(label);

        cells.push({ gfx, label });
      }

      this.view.addChild(reelContainer);

      const reel: Reel = {
        container: reelContainer,
        animator: new ReelAnimator(STRIP_LEN),
        cells,
        strip: [...BASE_STRIP],
        settledApplied: true,
      };
      this.reels.push(reel);
      this.renderReel(reel, 0);
    }
  }

  spin(): void {
    for (const reel of this.reels) {
      reel.strip = [...BASE_STRIP];
      reel.settledApplied = false;
      reel.animator.start();
    }
    this.startTicking();
  }

  async land(response: SpinResponse): Promise<void> {
    for (let c = 0; c < COLS; c++) {
      const reel = this.reels[c];
      const targetPos = response.stops[c] % STRIP_LEN;
      // Bake the real grid symbols into this reel's strip at the exact
      // indices the animator will settle on, so the symbols rolling in
      // during deceleration are already the final ones — no jump at land.
      for (let r = 0; r < ROWS; r++) {
        reel.strip[(targetPos + r) % STRIP_LEN] = response.grid[c][r];
      }
      const delayMs = STAGGER_MS * c;
      if (delayMs > 0) {
        setTimeout(() => reel.animator.land(targetPos), delayMs);
      } else {
        reel.animator.land(targetPos);
      }
    }

    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (this.reels.every((r) => r.animator.isSettled)) {
          clearInterval(interval);
          resolve();
        }
      }, 16);
    });

    for (const reel of this.reels) {
      reel.settledApplied = true;
    }
    this.stopTicking();
  }

  private startTicking(): void {
    if (this.tickHandler) return;
    this.tickHandler = (t: Ticker) => this.onTick(t.deltaMS);
    this.ticker.add(this.tickHandler);
  }

  private stopTicking(): void {
    if (!this.tickHandler) return;
    this.ticker.remove(this.tickHandler);
    this.tickHandler = null;
  }

  private onTick(deltaMs: number): void {
    for (const reel of this.reels) {
      if (reel.settledApplied) continue;
      reel.animator.tick(deltaMs);
      this.renderReel(reel, reel.animator.position);
    }
  }

  private renderReel(reel: Reel, pos: number): void {
    const intPart = Math.floor(pos);
    const frac = pos - intPart;
    for (let i = 0; i < reel.cells.length; i++) {
      const visualRow = i - OVERSCAN;
      const stripIdx = (intPart + visualRow + STRIP_LEN * 1000) % STRIP_LEN;
      const sym = reel.strip[stripIdx];
      const cell = reel.cells[i];
      const y = (visualRow - frac) * CELL_H;
      cell.gfx.y = y;
      cell.gfx.clear();
      cell.gfx.rect(0, 0, CELL_W, CELL_H);
      cell.gfx.fill({ color: SYMBOL_COLORS[sym] });
      cell.label.text = sym;
      cell.label.y = y + CELL_H / 2;
    }
  }
}
