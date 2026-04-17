import type { Symbol, WinLine } from "../server/slotMath";

/**
 * Bake a server-returned grid column into a strip at the target position.
 * Returns a new array — does not mutate the input.
 */
export function bakeGrid(
  strip: readonly Symbol[],
  targetPos: number,
  column: readonly Symbol[],
  stripLen: number
): Symbol[] {
  const result = [...strip];
  for (let r = 0; r < column.length; r++) {
    result[(targetPos + r) % stripLen] = column[r];
  }
  return result;
}

/**
 * Compute which symbol is visible at a cell position given the animator's
 * current position. Handles negative-safe modulo wrapping.
 */
export function computeCellSymbol(
  strip: readonly Symbol[],
  animatorPos: number,
  visualRow: number,
  stripLen: number
): Symbol {
  const intPart = Math.floor(animatorPos);
  // JS `%` keeps the sign of the dividend, so `(-1) % 15 === -1` — invalid as
  // an array index. Adding a large positive multiple of `stripLen` shifts the
  // value safely positive before the modulo without changing the result.
  const stripIdx = (intPart + visualRow + stripLen * 1000) % stripLen;
  return strip[stripIdx];
}

/**
 * Compute the pixel Y offset for a cell given the animator's fractional
 * position.
 */
export function computeCellY(
  animatorPos: number,
  visualRow: number,
  cellHeight: number
): number {
  const frac = animatorPos - Math.floor(animatorPos);
  return (visualRow - frac) * cellHeight;
}

export interface HighlightCell {
  col: number;
  row: number;
  isWinning: boolean;
  /** Border color for winning cells (gold for wild-sub, white otherwise). null if not winning. */
  borderColor: number | null;
}

/**
 * Compute highlight state for each cell given a win line.
 * Wild cells that substituted into a non-wild-paying line get a gold border.
 */
/**
 * Anticipation: do reels 0–2 already telegraph a potential big win?
 *
 * Returns the reels that should play the "slow + pulse" presentation (reels
 * 3–4) when the first three reels all show the same high-paying symbol along
 * a payline prefix. Pure function so the trigger logic is unit-testable
 * without a Pixi harness or a spin in flight.
 *
 * Checks only the first three positions of each payline because a four-of-a-
 * kind that starts on reel 4 can't benefit from slowing reels 3–4.
 */
export function shouldAnticipate(
  grid: Symbol[][],
  paylines: readonly (readonly (readonly [number, number])[])[],
  highPayingSymbols: ReadonlySet<Symbol>
): { reels: number[] } | null {
  for (const line of paylines) {
    const [a, b, c] = line;
    const s0 = grid[a[0]][a[1]];
    const s1 = grid[b[0]][b[1]];
    const s2 = grid[c[0]][c[1]];
    if (s0 === s1 && s1 === s2 && highPayingSymbols.has(s0)) {
      return { reels: [3, 4] };
    }
  }
  return null;
}

export function computeWinHighlight(
  line: WinLine,
  grid: Symbol[][],
  cols: number,
  rows: number
): HighlightCell[] {
  const winningSet = new Set(line.positions.map(([c, r]) => `${c},${r}`));
  const result: HighlightCell[] = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const isWinning = winningSet.has(`${c},${r}`);
      let borderColor: number | null = null;
      if (isWinning) {
        const isWildSub = grid[c][r] === "WILD" && line.symbol !== "WILD";
        borderColor = isWildSub ? 0xffd700 : 0xffffff;
      }
      result.push({ col: c, row: r, isWinning, borderColor });
    }
  }
  return result;
}
