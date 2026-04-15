import { describe, it, expect } from "vitest";
import { BetSelector } from "./BetSelector";

describe("BetSelector", () => {
  it("defaults to a bet of 1.00", () => {
    const b = new BetSelector();
    expect(b.bet).toBe(1.0);
  });

  it("next() advances to the next bet in the fixed list [0.10, 0.50, 1.00, 2.00, 5.00]", () => {
    const b = new BetSelector();
    b.next();
    expect(b.bet).toBe(2.0);
    b.next();
    expect(b.bet).toBe(5.0);
  });

  it("next() clamps at the maximum bet of 5.00", () => {
    const b = new BetSelector();
    for (let i = 0; i < 10; i++) b.next();
    expect(b.bet).toBe(5.0);
  });

  it("prev() steps backwards and clamps at the minimum bet of 0.10", () => {
    const b = new BetSelector();
    b.prev();
    expect(b.bet).toBe(0.5);
    for (let i = 0; i < 10; i++) b.prev();
    expect(b.bet).toBe(0.1);
  });

  it("fires betChanged with the new bet when the value changes", () => {
    const b = new BetSelector();
    const seen: number[] = [];
    b.onBetChanged((v) => seen.push(v));
    b.next();
    b.prev();
    expect(seen).toEqual([2.0, 1.0]);
  });

  it("does not fire betChanged at the clamped endpoints", () => {
    const b = new BetSelector();
    b.next();
    b.next(); // at 5.0
    const seen: number[] = [];
    b.onBetChanged((v) => seen.push(v));
    b.next();
    expect(seen).toEqual([]);
  });

  it("setEnabled(false) makes next() and prev() no-ops", () => {
    const b = new BetSelector();
    const seen: number[] = [];
    b.onBetChanged((v) => seen.push(v));
    b.setEnabled(false);
    b.next();
    b.prev();
    expect(b.bet).toBe(1.0);
    expect(seen).toEqual([]);
  });

  it("setEnabled(true) restores interaction", () => {
    const b = new BetSelector();
    b.setEnabled(false);
    b.next();
    b.setEnabled(true);
    b.next();
    expect(b.bet).toBe(2.0);
  });
});
