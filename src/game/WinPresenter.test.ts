import { describe, it, expect } from "vitest";
import { WinPresenter } from "./WinPresenter";
import type { SpinResponse, WinLine } from "../server/slotMath";

function makeResponse(partial: Partial<SpinResponse> = {}): SpinResponse {
  return {
    stops: [0, 0, 0, 0, 0],
    grid: [
      ["CHERRY", "CHERRY", "CHERRY"],
      ["CHERRY", "CHERRY", "CHERRY"],
      ["CHERRY", "CHERRY", "CHERRY"],
      ["CHERRY", "CHERRY", "CHERRY"],
      ["CHERRY", "CHERRY", "CHERRY"],
    ],
    totalWin: 0,
    balanceAfter: 1000,
    lines: [],
    ...partial,
  };
}

describe("WinPresenter", () => {
  it("does nothing for a no-win response: activeLine null, rollup zero", () => {
    const p = new WinPresenter();
    p.start(makeResponse({ totalWin: 0, lines: [] }));
    for (let i = 0; i < 200; i++) p.tick(16);
    expect(p.activeLine).toBeNull();
    expect(p.rollupValue).toBe(0);
    expect(p.isRollupComplete).toBe(true);
  });

  it("rolls up from 0 to totalWin over the rollup duration", () => {
    const p = new WinPresenter();
    const win: WinLine = {
      lineId: 1,
      symbol: "CHERRY",
      count: 3,
      positions: [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
      win: 10,
    };
    p.start(makeResponse({ totalWin: 10, lines: [win] }));
    expect(p.rollupValue).toBe(0);
    expect(p.isRollupComplete).toBe(false);
    // mid-rollup: strictly between 0 and totalWin
    p.tick(WinPresenter.ROLLUP_MS / 2);
    expect(p.rollupValue).toBeGreaterThan(0);
    expect(p.rollupValue).toBeLessThan(10);
    // finish rollup
    p.tick(WinPresenter.ROLLUP_MS);
    expect(p.rollupValue).toBe(10);
    expect(p.isRollupComplete).toBe(true);
  });

  it("cycles through lines after rollup completes, wrapping back to the first", () => {
    const l1: WinLine = {
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
    const l2: WinLine = {
      lineId: 2,
      symbol: "BELL",
      count: 3,
      positions: [
        [0, 1],
        [1, 1],
        [2, 1],
      ],
      win: 5,
    };
    const p = new WinPresenter();
    p.start(makeResponse({ totalWin: 10, lines: [l1, l2] }));
    expect(p.activeLine).toBeNull(); // during rollup
    p.tick(WinPresenter.ROLLUP_MS);
    expect(p.activeLine).toBe(l1);
    p.tick(WinPresenter.LINE_MS);
    expect(p.activeLine).toBe(l2);
    p.tick(WinPresenter.LINE_MS);
    expect(p.activeLine).toBe(l1); // wraps
  });

  it("stop() clears state: activeLine null and rollup zero", () => {
    const l: WinLine = {
      lineId: 1,
      symbol: "CHERRY",
      count: 3,
      positions: [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
      win: 7,
    };
    const p = new WinPresenter();
    p.start(makeResponse({ totalWin: 7, lines: [l] }));
    p.tick(WinPresenter.ROLLUP_MS + WinPresenter.LINE_MS / 2);
    expect(p.activeLine).toBe(l);
    p.stop();
    expect(p.activeLine).toBeNull();
    expect(p.rollupValue).toBe(0);
  });
});
