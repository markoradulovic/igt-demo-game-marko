import { describe, it, expect } from "vitest";
import { MockedServer, type Symbol } from "./slotMath";

describe("MockedServer.spin", () => {
  it("returns ok:true with a conforming SpinResponse shape", async () => {
    const server = new MockedServer({ seed: 1, startingBalance: 1000 });
    const result = await server.spin(1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { data } = result;
    expect(data.stops).toHaveLength(5);
    data.stops.forEach((s) => expect(Number.isInteger(s)).toBe(true));
    expect(data.grid).toHaveLength(5);
    data.grid.forEach((col) => expect(col).toHaveLength(3));
    expect(typeof data.totalWin).toBe("number");
    expect(typeof data.balanceAfter).toBe("number");
    expect(Array.isArray(data.lines)).toBe(true);
  });

  it("produces identical stops across instances when seeded equally", async () => {
    const a = new MockedServer({ seed: 12345, startingBalance: 1000 });
    const b = new MockedServer({ seed: 12345, startingBalance: 1000 });
    const stopsA: number[][] = [];
    const stopsB: number[][] = [];
    for (let i = 0; i < 5; i++) {
      const ra = await a.spin(1);
      const rb = await b.spin(1);
      if (!ra.ok || !rb.ok) throw new Error("unexpected");
      stopsA.push([...ra.data.stops]);
      stopsB.push([...rb.data.stops]);
    }
    expect(stopsA).toEqual(stopsB);
  });

  it("produces different stops across instances with different seeds", async () => {
    const a = new MockedServer({ seed: 1, startingBalance: 1000 });
    const b = new MockedServer({ seed: 2, startingBalance: 1000 });
    const ra = await a.spin(1);
    const rb = await b.spin(1);
    if (!ra.ok || !rb.ok) throw new Error("unexpected");
    expect(ra.data.stops).not.toEqual(rb.data.stops);
  });

  it("grid column is determined by (reelIndex, stop) — same stop on same reel yields same column", async () => {
    const server = new MockedServer({ seed: 99, startingBalance: 1000 });
    const byKey = new Map<string, Symbol[]>();
    for (let i = 0; i < 200; i++) {
      const r = await server.spin(1);
      if (!r.ok) throw new Error("unexpected");
      r.data.stops.forEach((stop, reel) => {
        const key = `${reel}:${stop}`;
        const col = r.data.grid[reel];
        const seen = byKey.get(key);
        if (seen) expect(col).toEqual(seen);
        else byKey.set(key, col);
      });
    }
  });

  it("totalWin equals the sum of per-line wins across many spins", async () => {
    const server = new MockedServer({ seed: 7, startingBalance: 1_000_000 });
    let sawWin = false;
    for (let i = 0; i < 500; i++) {
      const r = await server.spin(1);
      if (!r.ok) throw new Error("unexpected");
      const sum = r.data.lines.reduce((a, l) => a + l.win, 0);
      expect(r.data.totalWin).toBeCloseTo(sum, 10);
      if (r.data.totalWin > 0) sawWin = true;
    }
    expect(sawWin).toBe(true);
  });

  it("balanceAfter equals previousBalance - bet + totalWin across spins", async () => {
    const server = new MockedServer({ seed: 42, startingBalance: 1000 });
    let prev = 1000;
    for (let i = 0; i < 50; i++) {
      const r = await server.spin(1);
      if (!r.ok) throw new Error("unexpected");
      expect(r.data.balanceAfter).toBeCloseTo(prev - 1 + r.data.totalWin, 10);
      prev = r.data.balanceAfter;
    }
  });

  it("reports wild substitution: a winning line pays a non-WILD symbol while containing a WILD in its positions", async () => {
    const server = new MockedServer({ seed: 3, startingBalance: 1_000_000 });
    let sawSubstitution = false;
    for (let i = 0; i < 2000 && !sawSubstitution; i++) {
      const r = await server.spin(1);
      if (!r.ok) throw new Error("unexpected");
      for (const line of r.data.lines) {
        if (line.symbol === "WILD") continue;
        const hasWild = line.positions.some(
          ([reel, row]) => r.data.grid[reel][row] === "WILD"
        );
        if (hasWild) {
          sawSubstitution = true;
          break;
        }
      }
    }
    expect(sawSubstitution).toBe(true);
  });

  it("returns INSUFFICIENT_FUNDS and leaves balance unchanged when bet > balance", async () => {
    const server = new MockedServer({ seed: 1, startingBalance: 5 });
    const r = await server.spin(10);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("INSUFFICIENT_FUNDS");
    expect(r.balance).toBe(5);

    // balance must still be 5 on a subsequent affordable spin's previous-balance
    const r2 = await server.spin(1);
    if (!r2.ok) throw new Error("unexpected");
    expect(r2.data.balanceAfter).toBeCloseTo(5 - 1 + r2.data.totalWin, 10);
  });
});
