import type { SpinResponse, WinLine } from "../server/slotMath";

// Pure timeline/state machine for win presentation. Deliberately has no Pixi
// dependency — `Game` reads `rollupValue` / `activeLine` each tick and drives
// rendering through `ReelBoard` and a total-win `Text`. Keeping the timing
// logic here means it's unit-testable with deterministic tick sizes.
//
// Flow for a winning response:
//   start() → rollupValue rolls 0 → totalWin over ROLLUP_MS
//           → then activeLine cycles through response.lines, LINE_MS each,
//             wrapping indefinitely until stop() is called
// For a zero-win response, rollup stays 0 and activeLine stays null.
export class WinPresenter {
  static readonly ROLLUP_MS = 800;
  static readonly LINE_MS = 900;

  private response: SpinResponse | null = null;
  private elapsed = 0;

  get activeLine(): WinLine | null {
    if (!this.response || this.response.lines.length === 0) return null;
    if (!this.isRollupComplete) return null;
    const sinceRollup = this.elapsed - WinPresenter.ROLLUP_MS;
    const idx = Math.floor(sinceRollup / WinPresenter.LINE_MS);
    return this.response.lines[idx % this.response.lines.length];
  }

  get rollupValue(): number {
    if (!this.response || this.response.totalWin === 0) return 0;
    const t = Math.min(1, this.elapsed / WinPresenter.ROLLUP_MS);
    return this.response.totalWin * t;
  }

  get isRollupComplete(): boolean {
    if (!this.response) return true;
    if (this.response.totalWin === 0) return true;
    return this.elapsed >= WinPresenter.ROLLUP_MS;
  }

  start(response: SpinResponse): void {
    this.response = response;
    this.elapsed = 0;
  }

  stop(): void {
    this.response = null;
    this.elapsed = 0;
  }

  tick(deltaMs: number): void {
    if (!this.response) return;
    this.elapsed += deltaMs;
  }
}
