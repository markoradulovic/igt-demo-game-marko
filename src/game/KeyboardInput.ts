// Thin adapter that maps keyboard events to the same controller/bet-selector
// methods the on-canvas UI calls. No keyboard-specific state: gating
// (canSpin/canStop/betEnabled) is already enforced inside the target methods.
//
// `target` is injected so tests can supply a mock EventTarget without jsdom;
// production passes `window`. The returned teardown closes over the exact
// listener reference so Game can detach cleanly on destruction.

export interface KeyboardHandlers {
  onSpin(): void;
  onBetPrev(): void;
  onBetNext(): void;
}

// A structural subset of EventTarget so callers can pass `window`, a DOM
// element, or a test mock. KeyboardEvent isn't in Node's lib.dom fallback, so
// we describe only the fields we touch.
export interface KeyboardInputTarget {
  addEventListener(
    type: "keydown",
    listener: (e: {
      code: string;
      repeat: boolean;
      preventDefault: () => void;
    }) => void
  ): void;
  removeEventListener(
    type: "keydown",
    listener: (e: {
      code: string;
      repeat: boolean;
      preventDefault: () => void;
    }) => void
  ): void;
}

export function attachKeyboardInput(
  target: KeyboardInputTarget,
  handlers: KeyboardHandlers
): () => void {
  const listener = (e: {
    code: string;
    repeat: boolean;
    preventDefault: () => void;
  }): void => {
    // Holding a key fires keydown repeatedly. Ignore repeats so a sticky
    // Space doesn't spam pressButton — the phase gate would eventually
    // reject duplicates, but we'd still queue a storm of no-op calls.
    if (e.repeat) return;
    if (e.code === "Space") {
      // Prevent the browser from scrolling the page when the canvas has focus.
      e.preventDefault();
      handlers.onSpin();
    } else if (e.code === "ArrowLeft") {
      handlers.onBetPrev();
    } else if (e.code === "ArrowRight") {
      handlers.onBetNext();
    }
  };
  target.addEventListener("keydown", listener);
  return () => target.removeEventListener("keydown", listener);
}
