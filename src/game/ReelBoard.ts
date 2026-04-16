import { Assets, Container, Graphics, Sprite, Ticker } from "pixi.js";
import type { Symbol, SpinResponse, WinLine } from "../server/slotMath";
import { ReelAnimator } from "./ReelAnimator";

// A purely cosmetic strip used while reels are spinning freely. The "real"
// symbols only matter at the moment reels land — see `land()` below for how
// we bake the server's grid into the strip at the target indices so the
// final symbols are already scrolling in during deceleration.
const BASE_STRIP: Symbol[] = [
  "CHERRY",
  "BELL",
  "LEMON",
  "EMERALD",
  "DIAMOND",
  "SEVEN",
  "WILD",
];
const STRIP_LEN = BASE_STRIP.length;

const CELL_W = 160;
const CELL_H = 160;
const COLS = 5;
const ROWS = 3;
const REEL_GAP = 8;
const OVERSCAN = 1;
const STAGGER_MS = 180;

interface ReelCell {
  sprite: Sprite;
  highlight: Graphics;
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
        const sprite = new Sprite();
        sprite.width = CELL_W;
        sprite.height = CELL_H;
        reelContainer.addChild(sprite);

        const highlight = new Graphics();
        highlight.visible = false;
        reelContainer.addChild(highlight);

        cells.push({ sprite, highlight });
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
      // Offset each reel so the idle grid shows a mix of symbols
      this.renderReel(reel, c * 2);
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

  // Quick-stop: all reels snap to their server-returned stops simultaneously.
  // Unlike `land()` which staggers left-to-right for a natural cascade,
  // quick-stop fires every reel at once — the player asked to skip the show.
  // The response is passed here (not stored earlier) because during normal
  // flow `land()` hasn't been called yet when the player quick-stops; the
  // server response was sitting in `Game` waiting for MIN_SPIN_MS to elapse.
  requestStop(response: SpinResponse): void {
    for (let c = 0; c < COLS; c++) {
      const reel = this.reels[c];
      const targetPos = response.stops[c] % STRIP_LEN;
      for (let r = 0; r < ROWS; r++) {
        reel.strip[(targetPos + r) % STRIP_LEN] = response.grid[c][r];
      }
      reel.settledApplied = false;
      reel.animator.quickStop(targetPos);
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

    await this.waitForSettle();
  }

  async waitForSettle(): Promise<void> {
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

  // Highlight the cells that paid on `line`, dim the rest. The grid is passed
  // in (rather than kept as state) so this stays stateless — `Game` owns the
  // current response and decides when to call. Wild cells that substituted
  // into a non-wild-paying line get a gold border instead of white, so the
  // player can see _why_ the line paid.
  highlightLine(line: WinLine, grid: Symbol[][]): void {
    const winningSet = new Set(line.positions.map(([c, r]) => `${c},${r}`));
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const cell = this.reels[c].cells[OVERSCAN + r];
        const isWinning = winningSet.has(`${c},${r}`);
        cell.sprite.alpha = isWinning ? 1 : 0.3;

        cell.highlight.clear();
        if (isWinning) {
          const isWildSub = grid[c][r] === "WILD" && line.symbol !== "WILD";
          const color = isWildSub ? 0xffd700 : 0xffffff;
          cell.highlight.rect(0, 0, CELL_W, CELL_H);
          cell.highlight.stroke({ width: 6, color });
          cell.highlight.y = cell.sprite.y;
          cell.highlight.visible = true;
        } else {
          cell.highlight.visible = false;
        }
      }
    }
  }

  clearHighlight(): void {
    for (const reel of this.reels) {
      for (const cell of reel.cells) {
        cell.sprite.alpha = 1;
        cell.highlight.visible = false;
      }
    }
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
      cell.sprite.y = y;
      const texture = Assets.get(`symbol-${sym}`);
      if (texture && cell.sprite.texture !== texture) {
        cell.sprite.texture = texture;
        // Pixi resets dimensions when the texture changes; re-apply the
        // cell size so SVGs of varying native resolution all fill the cell.
        cell.sprite.width = CELL_W;
        cell.sprite.height = CELL_H;
      }
    }
  }
}
