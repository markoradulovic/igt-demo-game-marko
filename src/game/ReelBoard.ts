import { Assets, Container, Graphics, Sprite, Ticker } from "pixi.js";
import { SYMBOLS } from "../server/slotMath";
import type { Symbol, SpinResponse, WinLine } from "../server/slotMath";
import { ReelAnimator } from "./ReelAnimator";
import {
  bakeGrid,
  computeCellSymbol,
  computeCellY,
  computeWinHighlight,
} from "./reelMath";

export interface AnticipationHint {
  reels: number[];
}

// A purely cosmetic strip used while reels are spinning freely. The "real"
// symbols only matter at the moment reels land — see `land()` below for how
// we bake the server's grid into the strip at the target indices so the
// final symbols are already scrolling in during deceleration.
const STRIP_LEN = SYMBOLS.length;

const CELL_W = 160;
const CELL_H = 160;
const COLS = 5;
const ROWS = 3;
const REEL_GAP = 8;
const OVERSCAN = 1;
const STAGGER_MS = 180;
// Extra hold on anticipated reels. Sized so the total settle stays within
// ~1.5× the normal stagger window — enough to read the "chase" beat without
// testing the player's patience.
const ANTICIPATION_HOLD_MS = 450;
const ANTICIPATION_PULSE_COLOR = 0xffd27f;
const ANTICIPATION_PULSE_MS = 450;

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
  private anticipatingReels: Set<number> = new Set();
  private anticipationElapsed = 0;

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
        strip: [...SYMBOLS],
        settledApplied: true,
      };
      this.reels.push(reel);
      // Offset each reel so the idle grid shows a mix of symbols
      this.renderReel(reel, c * 2);
    }
  }

  spin(): void {
    for (const reel of this.reels) {
      reel.strip = [...SYMBOLS];
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
      reel.strip = bakeGrid(reel.strip, targetPos, response.grid[c], STRIP_LEN);
      reel.settledApplied = false;
      reel.animator.quickStop(targetPos);
    }
    this.startTicking();
  }

  async land(
    response: SpinResponse,
    anticipation: AnticipationHint | null = null
  ): Promise<void> {
    // Cells on anticipated reels pulse during the extended hold so the player
    // gets a visual cue, not just a timing cue, that reels 4–5 might land a
    // jackpot-tier match. Tint is cleared when reels settle below.
    this.anticipatingReels = new Set(anticipation?.reels ?? []);
    this.anticipationElapsed = 0;

    for (let c = 0; c < COLS; c++) {
      const reel = this.reels[c];
      const targetPos = response.stops[c] % STRIP_LEN;
      // Bake the real grid symbols into this reel's strip at the exact
      // indices the animator will settle on, so the symbols rolling in
      // during deceleration are already the final ones — no jump at land.
      reel.strip = bakeGrid(reel.strip, targetPos, response.grid[c], STRIP_LEN);
      const holdMs = this.anticipatingReels.has(c) ? ANTICIPATION_HOLD_MS : 0;
      const delayMs = STAGGER_MS * c + holdMs;
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
    this.clearAnticipationTint();
    this.anticipatingReels.clear();
    this.stopTicking();
  }

  // Highlight the cells that paid on `line`, dim the rest. The grid is passed
  // in (rather than kept as state) so this stays stateless — `Game` owns the
  // current response and decides when to call. Wild cells that substituted
  // into a non-wild-paying line get a gold border instead of white, so the
  // player can see _why_ the line paid.
  highlightLine(line: WinLine, grid: Symbol[][]): void {
    const cells = computeWinHighlight(line, grid, COLS, ROWS);
    for (const { col, row, isWinning, borderColor } of cells) {
      const cell = this.reels[col].cells[OVERSCAN + row];
      cell.sprite.alpha = isWinning ? 1 : 0.3;

      cell.highlight.clear();
      if (isWinning && borderColor !== null) {
        cell.highlight.rect(0, 0, CELL_W, CELL_H);
        cell.highlight.stroke({ width: 6, color: borderColor });
        cell.highlight.y = cell.sprite.y;
        cell.highlight.visible = true;
      } else {
        cell.highlight.visible = false;
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
    if (this.anticipatingReels.size > 0) {
      this.anticipationElapsed += deltaMs;
      this.applyAnticipationPulse();
    }
  }

  // Sinusoidal alpha dip on anticipated reels. Using alpha (not Pixi tint)
  // keeps the change legible against the mixed-color symbols without
  // swapping any textures, which would force a re-bind.
  private applyAnticipationPulse(): void {
    const t =
      (this.anticipationElapsed % ANTICIPATION_PULSE_MS) /
      ANTICIPATION_PULSE_MS;
    const alpha = 0.7 + 0.3 * Math.sin(t * Math.PI * 2);
    for (const col of this.anticipatingReels) {
      const reel = this.reels[col];
      if (reel.animator.isSettled) continue;
      for (const cell of reel.cells) {
        cell.sprite.alpha = alpha;
        cell.sprite.tint = ANTICIPATION_PULSE_COLOR;
      }
    }
  }

  private clearAnticipationTint(): void {
    for (const col of this.anticipatingReels) {
      const reel = this.reels[col];
      for (const cell of reel.cells) {
        cell.sprite.alpha = 1;
        cell.sprite.tint = 0xffffff;
      }
    }
  }

  private renderReel(reel: Reel, pos: number): void {
    for (let i = 0; i < reel.cells.length; i++) {
      const visualRow = i - OVERSCAN;
      const sym = computeCellSymbol(reel.strip, pos, visualRow, STRIP_LEN);
      const y = computeCellY(pos, visualRow, CELL_H);
      const cell = reel.cells[i];
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
