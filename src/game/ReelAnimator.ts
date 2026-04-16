// Per-reel tick-driven state machine. Pure TS (no Pixi) so it's unit-testable
// by calling `tick(deltaMs)` directly with fixed step sizes.
//   idle → accel → steady → decel → bounce → settled
// `land(stop)` is the request to stop at a specific strip index; it doesn't
// immediately decelerate — the reel finishes a minimum steady duration first,
// then eases into the target stop, overshoots in `bounce`, and finally snaps
// to the exact stop in `settled` so there's no float drift.
type Phase = "idle" | "accel" | "steady" | "decel" | "bounce" | "settled";

const ACCEL_MS = 200;
const MAX_SPEED = 0.03; // rows per ms (~30 rows/sec)
const MIN_SPIN_MS_AFTER_LAND = 200;
const DECEL_MS = 300;
const BOUNCE_MS = 150;
const BOUNCE_OVERSHOOT = 0.4; // rows
const MIN_DECEL_ROWS = 3;

// Quick-stop uses compressed timings so all reels settle within ~180ms
// (vs ~450ms normal). The bounce is kept to preserve tactile feel even
// when slamming — without it the snap looks broken rather than intentional.
const QUICK_DECEL_MS = 100;
const QUICK_BOUNCE_MS = 80;

export class ReelAnimator {
  private phase: Phase = "idle";
  private _pos = 0;
  private phaseElapsed = 0;
  private landedAtElapsed: number | null = null;
  private steadyElapsed = 0;
  private targetStop = 0;
  private decelStart = 0;
  private decelEnd = 0;
  private decelMs = DECEL_MS;
  private bounceMs = BOUNCE_MS;

  constructor(private readonly stripLength: number) {}

  get position(): number {
    const m = this._pos % this.stripLength;
    return m < 0 ? m + this.stripLength : m;
  }

  get isSettled(): boolean {
    return this.phase === "settled";
  }

  start(): void {
    this.phase = "accel";
    this.phaseElapsed = 0;
    this.steadyElapsed = 0;
    this.landedAtElapsed = null;
    this.decelMs = DECEL_MS;
    this.bounceMs = BOUNCE_MS;
  }

  land(stop: number): void {
    this.targetStop = stop;
    if (this.landedAtElapsed === null) {
      this.landedAtElapsed = this.steadyElapsed;
    }
  }

  // Immediately begin a compressed decel→bounce→settled to the target stop.
  // Called when the player clicks Spin mid-animation ("quick-stop"). No-op if
  // the reel is already decelerating or settled — this makes double-tapping
  // harmless and means `Game` doesn't need to guard against redundant calls.
  quickStop(stop: number): void {
    if (
      this.phase === "decel" ||
      this.phase === "bounce" ||
      this.phase === "settled" ||
      this.phase === "idle"
    ) {
      return;
    }
    this.targetStop = stop;
    this.decelMs = QUICK_DECEL_MS;
    this.bounceMs = QUICK_BOUNCE_MS;
    this.decelStart = this._pos;
    this.decelEnd = this.computeDecelEnd(this._pos, stop);
    this.phase = "decel";
    this.phaseElapsed = 0;
  }

  tick(deltaMs: number): void {
    if (this.phase === "idle" || this.phase === "settled") return;
    this.phaseElapsed += deltaMs;

    if (this.phase === "accel") {
      const t = Math.min(1, this.phaseElapsed / ACCEL_MS);
      const speed = MAX_SPEED * t;
      this._pos += speed * deltaMs;
      if (this.phaseElapsed >= ACCEL_MS) {
        this.phase = "steady";
        this.phaseElapsed = 0;
        this.steadyElapsed = 0;
      }
      return;
    }

    if (this.phase === "steady") {
      this._pos += MAX_SPEED * deltaMs;
      this.steadyElapsed += deltaMs;
      if (
        this.landedAtElapsed !== null &&
        this.steadyElapsed - this.landedAtElapsed >= MIN_SPIN_MS_AFTER_LAND
      ) {
        this.decelStart = this._pos;
        this.decelEnd = this.computeDecelEnd(this._pos, this.targetStop);
        this.phase = "decel";
        this.phaseElapsed = 0;
      }
      return;
    }

    if (this.phase === "decel") {
      const t = Math.min(1, this.phaseElapsed / this.decelMs);
      const eased = 1 - Math.pow(1 - t, 3);
      this._pos = this.decelStart + (this.decelEnd - this.decelStart) * eased;
      if (t >= 1) {
        this._pos = this.decelEnd;
        this.phase = "bounce";
        this.phaseElapsed = 0;
      }
      return;
    }

    if (this.phase === "bounce") {
      const t = Math.min(1, this.phaseElapsed / this.bounceMs);
      const offset = Math.sin(t * Math.PI) * BOUNCE_OVERSHOOT;
      this._pos = this.decelEnd + offset;
      if (t >= 1) {
        this._pos = this.decelEnd;
        this.phase = "settled";
      }
    }
  }

  // Pick the nearest future strip-position whose mod is `stop`, but ensure the
  // reel travels at least MIN_DECEL_ROWS during deceleration. Without the
  // minimum, a target that's already near the current position would cause an
  // abrupt, non-tactile landing.
  private computeDecelEnd(current: number, stop: number): number {
    const base = Math.floor(current / this.stripLength) * this.stripLength;
    let end = base + stop;
    while (end - current < MIN_DECEL_ROWS) end += this.stripLength;
    return end;
  }
}
