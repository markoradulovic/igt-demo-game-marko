import { describe, it, expect, vi } from "vitest";
import { attachKeyboardInput } from "./KeyboardInput";

type KeyListener = (e: {
  code: string;
  repeat: boolean;
  preventDefault: () => void;
}) => void;

function mockTarget() {
  let listener: KeyListener | null = null;
  return {
    addEventListener: vi.fn((_: string, l: KeyListener) => {
      listener = l;
    }),
    removeEventListener: vi.fn(),
    dispatch(code: string, repeat = false) {
      if (!listener) throw new Error("no listener attached");
      listener({ code, repeat, preventDefault: () => {} });
    },
  };
}

function makeHandlers() {
  return {
    onSpin: vi.fn(),
    onBetPrev: vi.fn(),
    onBetNext: vi.fn(),
  };
}

describe("attachKeyboardInput", () => {
  it("routes Space to onSpin", () => {
    const target = mockTarget();
    const handlers = makeHandlers();
    attachKeyboardInput(target, handlers);
    target.dispatch("Space");
    expect(handlers.onSpin).toHaveBeenCalledTimes(1);
    expect(handlers.onBetPrev).not.toHaveBeenCalled();
    expect(handlers.onBetNext).not.toHaveBeenCalled();
  });

  it("routes ArrowLeft to onBetPrev and ArrowRight to onBetNext", () => {
    const target = mockTarget();
    const handlers = makeHandlers();
    attachKeyboardInput(target, handlers);
    target.dispatch("ArrowLeft");
    target.dispatch("ArrowRight");
    expect(handlers.onBetPrev).toHaveBeenCalledTimes(1);
    expect(handlers.onBetNext).toHaveBeenCalledTimes(1);
  });

  it("ignores repeated keydown events (key held down)", () => {
    const target = mockTarget();
    const handlers = makeHandlers();
    attachKeyboardInput(target, handlers);
    target.dispatch("Space", true);
    target.dispatch("ArrowLeft", true);
    expect(handlers.onSpin).not.toHaveBeenCalled();
    expect(handlers.onBetPrev).not.toHaveBeenCalled();
  });

  it("ignores unrelated keys", () => {
    const target = mockTarget();
    const handlers = makeHandlers();
    attachKeyboardInput(target, handlers);
    target.dispatch("Enter");
    target.dispatch("KeyA");
    expect(handlers.onSpin).not.toHaveBeenCalled();
    expect(handlers.onBetPrev).not.toHaveBeenCalled();
    expect(handlers.onBetNext).not.toHaveBeenCalled();
  });

  it("returns a teardown that removes the listener", () => {
    const target = mockTarget();
    const handlers = makeHandlers();
    const detach = attachKeyboardInput(target, handlers);
    detach();
    expect(target.removeEventListener).toHaveBeenCalledTimes(1);
    expect(target.removeEventListener.mock.calls[0][0]).toBe("keydown");
    expect(target.addEventListener.mock.calls[0][1]).toBe(
      target.removeEventListener.mock.calls[0][1]
    );
  });
});
