import { describe, it, expect } from "vitest";
import {
  bakeGrid,
  computeCellSymbol,
  computeCellY,
  computeWinHighlight,
  shouldAnticipate,
} from "./reelMath";
import { HIGH_PAYING_SYMBOLS, PAYLINES } from "../server/slotMath";
import type { Symbol, WinLine } from "../server/slotMath";

const STRIP: Symbol[] = [
  "CHERRY",
  "BELL",
  "LEMON",
  "EMERALD",
  "DIAMOND",
  "SEVEN",
  "WILD",
];
const STRIP_LEN = STRIP.length;

describe("bakeGrid", () => {
  it("places column symbols at targetPos without mutating input", () => {
    const column: Symbol[] = ["WILD", "WILD", "WILD"];
    const result = bakeGrid(STRIP, 0, column, STRIP_LEN);
    expect(result[0]).toBe("WILD");
    expect(result[1]).toBe("WILD");
    expect(result[2]).toBe("WILD");
    // original unchanged
    expect(STRIP[0]).toBe("CHERRY");
  });

  it("wraps around when targetPos is near end of strip", () => {
    const column: Symbol[] = ["DIAMOND", "SEVEN", "CHERRY"];
    const result = bakeGrid(STRIP, STRIP_LEN - 1, column, STRIP_LEN);
    expect(result[STRIP_LEN - 1]).toBe("DIAMOND");
    expect(result[0]).toBe("SEVEN");
    expect(result[1]).toBe("CHERRY");
  });

  it("handles targetPos = 0", () => {
    const column: Symbol[] = ["LEMON", "EMERALD", "DIAMOND"];
    const result = bakeGrid(STRIP, 0, column, STRIP_LEN);
    expect(result[0]).toBe("LEMON");
    expect(result[1]).toBe("EMERALD");
    expect(result[2]).toBe("DIAMOND");
    expect(result[3]).toBe(STRIP[3]);
  });
});

describe("computeCellSymbol", () => {
  it("returns correct symbol for integer position", () => {
    expect(computeCellSymbol(STRIP, 0, 0, STRIP_LEN)).toBe("CHERRY");
    expect(computeCellSymbol(STRIP, 0, 1, STRIP_LEN)).toBe("BELL");
    expect(computeCellSymbol(STRIP, 3, 0, STRIP_LEN)).toBe("EMERALD");
  });

  it("returns correct symbol for fractional position (uses floor)", () => {
    expect(computeCellSymbol(STRIP, 2.7, 0, STRIP_LEN)).toBe("LEMON");
    expect(computeCellSymbol(STRIP, 2.7, 1, STRIP_LEN)).toBe("EMERALD");
  });

  it("wraps around the strip correctly", () => {
    expect(computeCellSymbol(STRIP, STRIP_LEN - 1, 2, STRIP_LEN)).toBe("BELL");
  });

  it("handles negative visualRow via safe modulo", () => {
    // visualRow = -1 (overscan above), position 0 → strip index -1 → wraps to last
    expect(computeCellSymbol(STRIP, 0, -1, STRIP_LEN)).toBe("WILD");
  });
});

describe("computeCellY", () => {
  it("returns correct pixel offset with no fractional position", () => {
    expect(computeCellY(3, 0, 160)).toBe(0);
    expect(computeCellY(3, 1, 160)).toBe(160);
    expect(computeCellY(3, -1, 160)).toBe(-160);
  });

  it("shifts by fractional amount", () => {
    expect(computeCellY(2.5, 0, 160)).toBe(-80);
    expect(computeCellY(2.5, 1, 160)).toBe(80);
  });
});

describe("computeWinHighlight", () => {
  const grid: Symbol[][] = [
    ["CHERRY", "BELL", "LEMON"],
    ["CHERRY", "WILD", "EMERALD"],
    ["CHERRY", "DIAMOND", "SEVEN"],
  ];

  it("marks winning positions and dims the rest", () => {
    const line: WinLine = {
      lineId: 1,
      symbol: "CHERRY",
      count: 3,
      positions: [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
      win: 5,
    };
    const cells = computeWinHighlight(line, grid, 3, 3);
    const winning = cells.filter((c) => c.isWinning);
    const losing = cells.filter((c) => !c.isWinning);
    expect(winning).toHaveLength(3);
    expect(losing).toHaveLength(6);
    expect(winning.every((c) => c.borderColor === 0xffffff)).toBe(true);
    expect(losing.every((c) => c.borderColor === null)).toBe(true);
  });

  it("uses gold border for wild-substituted cells", () => {
    const line: WinLine = {
      lineId: 2,
      symbol: "CHERRY",
      count: 3,
      positions: [
        [0, 1],
        [1, 1],
        [2, 1],
      ],
      win: 5,
    };
    // grid[1][1] is "WILD" substituting for CHERRY → gold
    const cells = computeWinHighlight(line, grid, 3, 3);
    const wildCell = cells.find((c) => c.col === 1 && c.row === 1)!;
    expect(wildCell.isWinning).toBe(true);
    expect(wildCell.borderColor).toBe(0xffd700);

    const normalCell = cells.find((c) => c.col === 0 && c.row === 1)!;
    expect(normalCell.borderColor).toBe(0xffffff);
  });

  it("uses white border when line symbol IS wild", () => {
    const line: WinLine = {
      lineId: 1,
      symbol: "WILD",
      count: 3,
      positions: [
        [0, 1],
        [1, 1],
        [2, 1],
      ],
      win: 50,
    };
    const cells = computeWinHighlight(line, grid, 3, 3);
    const wildCell = cells.find((c) => c.col === 1 && c.row === 1)!;
    expect(wildCell.borderColor).toBe(0xffffff);
  });
});

describe("shouldAnticipate", () => {
  // Build a 5-column grid where reels 0..2 hold specific top-row symbols; the
  // rest of each column and reels 3–4 are filled with LEMON so only the
  // prefix-row match can trigger.
  function gridWithTopRow(r0: Symbol, r1: Symbol, r2: Symbol): Symbol[][] {
    const filler: Symbol = "LEMON";
    return [
      [r0, filler, filler],
      [r1, filler, filler],
      [r2, filler, filler],
      [filler, filler, filler],
      [filler, filler, filler],
    ];
  }

  it("triggers when reels 0–2 share a high-paying symbol on a payline prefix", () => {
    const grid = gridWithTopRow("CHERRY", "CHERRY", "CHERRY");
    const result = shouldAnticipate(grid, PAYLINES, HIGH_PAYING_SYMBOLS);
    expect(result).not.toBeNull();
    expect(result?.reels).toEqual([3, 4]);
  });

  it("triggers on WILD-aligned prefix", () => {
    const grid = gridWithTopRow("WILD", "WILD", "WILD");
    expect(
      shouldAnticipate(grid, PAYLINES, HIGH_PAYING_SYMBOLS)
    ).not.toBeNull();
  });

  it("does not trigger for a low-paying matching prefix", () => {
    // EMERALD is not high-paying (5-of-a-kind pays 15x, below the 50x threshold)
    const grid = gridWithTopRow("EMERALD", "EMERALD", "EMERALD");
    expect(shouldAnticipate(grid, PAYLINES, HIGH_PAYING_SYMBOLS)).toBeNull();
  });

  it("does not trigger when reels 0–2 don't align on a payline", () => {
    // Cherries in the prefix, but not sharing any single payline shape
    const grid: Symbol[][] = [
      ["CHERRY", "LEMON", "LEMON"],
      ["LEMON", "LEMON", "CHERRY"],
      ["CHERRY", "LEMON", "LEMON"],
      ["LEMON", "LEMON", "LEMON"],
      ["LEMON", "LEMON", "LEMON"],
    ];
    expect(shouldAnticipate(grid, PAYLINES, HIGH_PAYING_SYMBOLS)).toBeNull();
  });

  it("triggers on the V-shape payline prefix (0,0)(1,1)(2,2)", () => {
    const filler: Symbol = "LEMON";
    const grid: Symbol[][] = [
      ["WILD", filler, filler],
      [filler, "WILD", filler],
      [filler, filler, "WILD"],
      [filler, filler, filler],
      [filler, filler, filler],
    ];
    expect(
      shouldAnticipate(grid, PAYLINES, HIGH_PAYING_SYMBOLS)
    ).not.toBeNull();
  });
});
