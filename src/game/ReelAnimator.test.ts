import { describe, it, expect } from "vitest";
import { ReelAnimator } from "./ReelAnimator";

function tickUntil(
  anim: ReelAnimator,
  predicate: () => boolean,
  stepMs = 16,
  maxMs = 10_000
): number {
  let elapsed = 0;
  while (!predicate() && elapsed < maxMs) {
    anim.tick(stepMs);
    elapsed += stepMs;
  }
  return elapsed;
}

describe("ReelAnimator", () => {
  it("starts un-settled after start() and stays un-settled while spinning without land()", () => {
    const a = new ReelAnimator(15);
    a.start();
    for (let i = 0; i < 200; i++) a.tick(16);
    expect(a.isSettled).toBe(false);
  });

  it("lands on the requested stop after land() + enough ticks", () => {
    const a = new ReelAnimator(15);
    a.start();
    for (let i = 0; i < 30; i++) a.tick(16);
    a.land(7);
    tickUntil(a, () => a.isSettled);
    expect(a.isSettled).toBe(true);
    expect(a.position).toBe(7);
  });

  it("does not settle earlier than the configured minimum spin duration after land()", () => {
    const a = new ReelAnimator(15);
    a.start();
    a.land(3);
    // Very small number of ticks should not be enough
    for (let i = 0; i < 3; i++) a.tick(16);
    expect(a.isSettled).toBe(false);
  });

  it("advances position monotonically within the strip length while spinning", () => {
    const a = new ReelAnimator(15);
    a.start();
    a.tick(16);
    const p0 = a.position;
    a.tick(16);
    const p1 = a.position;
    expect(p1).not.toBe(p0);
    expect(p0).toBeGreaterThanOrEqual(0);
    expect(p0).toBeLessThan(15);
    expect(p1).toBeGreaterThanOrEqual(0);
    expect(p1).toBeLessThan(15);
  });

  it("ramps speed during acceleration (later ticks advance more than the first tick)", () => {
    const a = new ReelAnimator(1000); // large so no wrapping noise
    a.start();
    a.tick(16);
    const firstStep = a.position;
    // advance into steady phase
    for (let i = 0; i < 30; i++) a.tick(16);
    const before = a.position;
    a.tick(16);
    const steadyStep = a.position - before;
    expect(steadyStep).toBeGreaterThan(firstStep);
  });

  it("overshoots the target during bounce before settling", () => {
    const a = new ReelAnimator(100);
    a.start();
    for (let i = 0; i < 40; i++) a.tick(16);
    a.land(20);
    let sawOvershoot = false;
    const maxMs = 5000;
    let elapsed = 0;
    while (!a.isSettled && elapsed < maxMs) {
      a.tick(8);
      elapsed += 8;
      // position mod 100 can either be just under 20 (approaching) or above 20 (overshot)
      const p = a.position;
      const diff = (p - 20 + 100) % 100;
      if (diff > 0 && diff < 2) sawOvershoot = true;
    }
    expect(a.isSettled).toBe(true);
    expect(sawOvershoot).toBe(true);
    expect(a.position).toBe(20);
  });

  it("reports isSettled false after start() and true only after landing completes", () => {
    const a = new ReelAnimator(15);
    expect(a.isSettled).toBe(false);
    a.start();
    expect(a.isSettled).toBe(false);
    a.land(0);
    expect(a.isSettled).toBe(false);
    tickUntil(a, () => a.isSettled);
    expect(a.isSettled).toBe(true);
  });

  describe("quickStop", () => {
    it("settles on the exact target stop when called during steady phase", () => {
      const a = new ReelAnimator(15);
      a.start();
      // Advance into steady phase
      for (let i = 0; i < 30; i++) a.tick(16);
      a.quickStop(7);
      tickUntil(a, () => a.isSettled);
      expect(a.isSettled).toBe(true);
      expect(a.position).toBe(7);
    });

    it("settles faster than a normal land()", () => {
      const normal = new ReelAnimator(15);
      normal.start();
      for (let i = 0; i < 30; i++) normal.tick(16);
      normal.land(7);
      const normalMs = tickUntil(normal, () => normal.isSettled);

      const quick = new ReelAnimator(15);
      quick.start();
      for (let i = 0; i < 30; i++) quick.tick(16);
      quick.quickStop(7);
      const quickMs = tickUntil(quick, () => quick.isSettled);

      expect(quickMs).toBeLessThan(normalMs);
      // Quick-stop should settle within ~300ms
      expect(quickMs).toBeLessThanOrEqual(300);
    });

    it("settles on the exact target stop when called during accel phase", () => {
      const a = new ReelAnimator(15);
      a.start();
      // Just a couple ticks — still in accel
      a.tick(16);
      a.tick(16);
      a.quickStop(5);
      tickUntil(a, () => a.isSettled);
      expect(a.isSettled).toBe(true);
      expect(a.position).toBe(5);
    });

    it("is a no-op when already in decel phase", () => {
      const a = new ReelAnimator(15);
      a.start();
      for (let i = 0; i < 30; i++) a.tick(16);
      a.land(10);
      // Tick until decel starts (past MIN_SPIN_MS_AFTER_LAND)
      for (let i = 0; i < 20; i++) a.tick(16);
      // Now call quickStop with a DIFFERENT target — should be ignored
      a.quickStop(3);
      tickUntil(a, () => a.isSettled);
      expect(a.position).toBe(10); // Original target, not 3
    });

    it("is a no-op when already settled", () => {
      const a = new ReelAnimator(15);
      a.start();
      for (let i = 0; i < 30; i++) a.tick(16);
      a.land(10);
      tickUntil(a, () => a.isSettled);
      expect(a.position).toBe(10);
      a.quickStop(3);
      expect(a.position).toBe(10);
    });
  });
});
