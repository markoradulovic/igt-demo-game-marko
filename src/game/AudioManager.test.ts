import { describe, it, expect, vi } from "vitest";
import { createAudioManager, createNullAudioManager } from "./AudioManager";
// Note: no vi.mock("@pixi/sound") needed — AudioManager dynamically imports
// the library only when the default backend's `load` is called, and every
// test here injects its own backend.

function makeBackend(existing: string[] = ["click", "win"]) {
  return {
    load: vi.fn(),
    play: vi.fn(),
    exists: vi.fn((alias: string) => existing.includes(alias)),
  };
}

describe("AudioManager", () => {
  it("starts disabled so the demo is silent by default", () => {
    const audio = createAudioManager(makeBackend());
    expect(audio.isEnabled()).toBe(false);
  });

  it("does not play anything while disabled", () => {
    const backend = makeBackend();
    const audio = createAudioManager(backend);
    audio.play("click");
    audio.play("win");
    expect(backend.play).not.toHaveBeenCalled();
  });

  it("plays through the backend after setEnabled(true)", () => {
    const backend = makeBackend();
    const audio = createAudioManager(backend);
    audio.setEnabled(true);
    audio.play("click");
    expect(backend.play).toHaveBeenCalledWith("click");
  });

  it("stops playing after setEnabled(false)", () => {
    const backend = makeBackend();
    const audio = createAudioManager(backend);
    audio.setEnabled(true);
    audio.play("click");
    audio.setEnabled(false);
    audio.play("click");
    expect(backend.play).toHaveBeenCalledTimes(1);
  });

  it("no-ops when the requested alias is not loaded (missing asset is not fatal)", () => {
    const backend = makeBackend(["click"]);
    const audio = createAudioManager(backend);
    audio.setEnabled(true);
    audio.play("anticipation");
    expect(backend.play).not.toHaveBeenCalled();
  });

  it("lazy-loads sounds on the first setEnabled(true), only once", () => {
    const backend = makeBackend();
    const audio = createAudioManager(backend);
    expect(backend.load).not.toHaveBeenCalled();

    audio.setEnabled(true);
    expect(backend.load).toHaveBeenCalledTimes(1);
    expect(backend.load).toHaveBeenCalledWith([
      "spin-start",
      "reel-land",
      "win",
      "click",
      "anticipation",
    ]);

    audio.setEnabled(false);
    audio.setEnabled(true);
    expect(backend.load).toHaveBeenCalledTimes(1);
  });

  it("createNullAudioManager play is always a no-op", () => {
    const audio = createNullAudioManager();
    audio.setEnabled(true);
    audio.play("click");
    expect(audio.isEnabled()).toBe(false);
  });
});
