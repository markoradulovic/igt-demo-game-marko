import { describe, it, expect, vi } from "vitest";
import { createSpinController } from "./SpinController";
import type { SpinController, ReelSink } from "./SpinController";
import type {
  SlotServer,
  SpinResponse,
  SpinResult,
  WinLine,
} from "../server/slotMath";

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

const WIN_LINE: WinLine = {
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

function makeReels(): ReelSink {
  return {
    spinReels: vi.fn(),
    landReels: vi.fn().mockResolvedValue(undefined),
    snapReels: vi.fn().mockResolvedValue(undefined),
    clearHighlight: vi.fn(),
  };
}

function makeServer(result?: SpinResult): SlotServer {
  const defaultResult: SpinResult = {
    ok: true,
    data: makeResponse({ totalWin: 0, balanceAfter: 999 }),
  };
  return {
    spin: vi.fn().mockResolvedValue(result ?? defaultResult),
  };
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function setup(
  opts: {
    serverResult?: SpinResult;
    initialBalance?: number;
    initialBet?: number;
  } = {}
) {
  const reels = makeReels();
  const server = makeServer(opts.serverResult);
  const ctrl = createSpinController({
    server,
    reels,
    initialBalance: opts.initialBalance ?? 1000,
    initialBet: opts.initialBet ?? 1,
  });
  return { ctrl, reels, server };
}

describe("SpinController", () => {
  describe("initial state", () => {
    it("starts in idle phase with correct balance", () => {
      const { ctrl } = setup({ initialBalance: 500 });
      const snap = ctrl.tick(0);
      expect(snap.phase).toBe("idle");
      expect(snap.balance).toBe(500);
      expect(snap.canSpin).toBe(true);
      expect(snap.canStop).toBe(false);
      expect(snap.betEnabled).toBe(true);
    });

    it("canSpin is false when balance < bet", () => {
      const { ctrl } = setup({ initialBalance: 0.5, initialBet: 1 });
      expect(ctrl.tick(0).canSpin).toBe(false);
    });
  });

  describe("spin lifecycle", () => {
    it("transitions idle → requesting on pressButton", async () => {
      const { ctrl, reels } = setup();
      ctrl.pressButton();
      const snap = ctrl.tick(0);
      expect(snap.phase).toBe("requesting");
      expect(reels.spinReels).toHaveBeenCalled();
    });

    it("transitions requesting → spinning after server resolves", async () => {
      const { ctrl } = setup();
      ctrl.pressButton();
      await flushPromises();
      const snap = ctrl.tick(0);
      expect(snap.phase).toBe("spinning");
      expect(snap.canStop).toBe(true);
    });

    it("transitions spinning → stopping → idle after MIN_SPIN_MS", async () => {
      const { ctrl, reels } = setup();
      ctrl.pressButton();
      await flushPromises();

      // Advance past MIN_SPIN_MS (500ms)
      for (let i = 0; i < 35; i++) ctrl.tick(16);
      expect(ctrl.tick(0).phase).toBe("stopping");
      expect(reels.landReels).toHaveBeenCalled();

      await flushPromises();
      expect(ctrl.tick(0).phase).toBe("idle");
    });

    it("transitions to presenting when there is a win", async () => {
      const { ctrl } = setup({
        serverResult: {
          ok: true,
          data: makeResponse({
            totalWin: 10,
            balanceAfter: 1009,
            lines: [WIN_LINE],
          }),
        },
      });

      ctrl.pressButton();
      await flushPromises();
      for (let i = 0; i < 35; i++) ctrl.tick(16);
      await flushPromises();

      const snap = ctrl.tick(0);
      expect(snap.phase).toBe("presenting");
      expect(snap.balance).toBe(1009);
    });
  });

  describe("quick-stop", () => {
    it("quick-stop during spinning uses snapReels instead of landReels", async () => {
      const { ctrl, reels } = setup();
      ctrl.pressButton();
      await flushPromises();
      expect(ctrl.tick(0).phase).toBe("spinning");

      // Quick-stop
      ctrl.pressButton();
      ctrl.tick(16); // triggers transitionToStopping with quickStopRequested
      expect(reels.snapReels).toHaveBeenCalled();
      expect(reels.landReels).not.toHaveBeenCalled();
    });

    it("quick-stop during stopping calls snapReels so anticipation-held reels snap", async () => {
      // Block landReels on a manual promise so phase stays in "stopping"
      // while the player presses Stop a second time.
      let resolveLand: () => void = () => {};
      const landPromise = new Promise<void>((res) => {
        resolveLand = res;
      });
      const reels: ReelSink = {
        spinReels: vi.fn(),
        landReels: vi.fn().mockReturnValue(landPromise),
        snapReels: vi.fn().mockResolvedValue(undefined),
        clearHighlight: vi.fn(),
      };
      const server = makeServer();
      const ctrl = createSpinController({
        server,
        reels,
        initialBalance: 1000,
        initialBet: 1,
      });

      ctrl.pressButton();
      await flushPromises();
      expect(ctrl.tick(0).phase).toBe("spinning");

      // Elapse MIN_SPIN_MS so transitionToStopping fires; landReels stays pending.
      for (let i = 0; i < 35; i++) ctrl.tick(16);
      expect(ctrl.tick(0).phase).toBe("stopping");
      expect(reels.landReels).toHaveBeenCalledTimes(1);
      expect(reels.snapReels).not.toHaveBeenCalled();

      // Second press during stopping — should snap remaining reels, not no-op.
      ctrl.pressButton();
      expect(reels.snapReels).toHaveBeenCalledTimes(1);

      resolveLand();
      await flushPromises();
      expect(ctrl.tick(0).phase).toBe("idle");
    });
  });

  describe("insufficient funds", () => {
    it("returns to idle on INSUFFICIENT_FUNDS", async () => {
      const { ctrl } = setup({
        serverResult: { ok: false, error: "INSUFFICIENT_FUNDS", balance: 0 },
      });
      ctrl.pressButton();
      await flushPromises();
      expect(ctrl.tick(0).phase).toBe("idle");
    });
  });

  describe("server error", () => {
    it("returns to idle on server rejection", async () => {
      const reels = makeReels();
      const server: SlotServer = {
        spin: vi.fn().mockRejectedValue(new Error("network")),
      };
      const ctrl = createSpinController({
        server,
        reels,
        initialBalance: 1000,
        initialBet: 1,
      });
      ctrl.pressButton();
      await flushPromises();
      expect(ctrl.tick(0).phase).toBe("idle");
    });
  });

  describe("win presentation (absorbed WinPresenter)", () => {
    function setupPresenting() {
      const response = makeResponse({
        totalWin: 10,
        balanceAfter: 1009,
        lines: [WIN_LINE],
      });
      const result = setup({
        serverResult: { ok: true, data: response },
      });
      return { ...result, response };
    }

    async function advanceToPresenting(ctrl: SpinController) {
      ctrl.pressButton();
      await flushPromises();
      for (let i = 0; i < 35; i++) ctrl.tick(16);
      await flushPromises();
      ctrl.tick(0); // enter presenting
    }

    it("rolls up from 0 to totalWin over ROLLUP_MS (800ms)", async () => {
      const { ctrl } = setupPresenting();
      await advanceToPresenting(ctrl);

      expect(ctrl.tick(0).rollupValue).toBe(0);

      // Mid-rollup
      const mid = ctrl.tick(400);
      expect(mid.rollupValue).toBeGreaterThan(0);
      expect(mid.rollupValue).toBeLessThan(10);

      // Complete rollup
      const done = ctrl.tick(400);
      expect(done.rollupValue).toBe(10);
    });

    it("activeLine is null during rollup, then cycles through lines", async () => {
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
      const { ctrl } = setup({
        serverResult: {
          ok: true,
          data: makeResponse({
            totalWin: 15,
            balanceAfter: 1014,
            lines: [WIN_LINE, l2],
          }),
        },
      });
      await advanceToPresenting(ctrl);

      // During rollup
      expect(ctrl.tick(0).activeLine).toBeNull();

      // Complete rollup
      ctrl.tick(800);
      expect(ctrl.tick(0).activeLine).toBe(WIN_LINE);

      // Next line
      ctrl.tick(900);
      expect(ctrl.tick(0).activeLine).toBe(l2);

      // Wraps back
      ctrl.tick(900);
      expect(ctrl.tick(0).activeLine).toBe(WIN_LINE);
    });

    it("does nothing for a no-win response", async () => {
      const { ctrl } = setup({
        serverResult: {
          ok: true,
          data: makeResponse({ totalWin: 0, balanceAfter: 999 }),
        },
      });
      ctrl.pressButton();
      await flushPromises();
      for (let i = 0; i < 35; i++) ctrl.tick(16);
      await flushPromises();

      const snap = ctrl.tick(0);
      expect(snap.phase).toBe("idle");
      expect(snap.rollupValue).toBe(0);
      expect(snap.activeLine).toBeNull();
    });

    it("pressing spin during presenting stops presentation and starts new spin", async () => {
      const { ctrl, reels } = setupPresenting();
      await advanceToPresenting(ctrl);
      expect(ctrl.tick(0).phase).toBe("presenting");

      ctrl.pressButton();
      expect(reels.clearHighlight).toHaveBeenCalled();
      // Should now be requesting a new spin
      const snap = ctrl.tick(0);
      expect(snap.phase).toBe("requesting");
    });
  });

  describe("setBet", () => {
    it("updates the bet used for canSpin check", () => {
      const { ctrl } = setup({ initialBalance: 5, initialBet: 1 });
      expect(ctrl.tick(0).canSpin).toBe(true);
      ctrl.setBet(10);
      expect(ctrl.tick(0).canSpin).toBe(false);
    });
  });

  describe("anticipation", () => {
    // A grid where reels 0–2 all land on CHERRY on the top row — a high-paying
    // 3-of-a-kind prefix that should slow reels 3–4 to telegraph the chase.
    const antGrid: SpinResponse["grid"] = [
      ["CHERRY", "LEMON", "LEMON"],
      ["CHERRY", "LEMON", "LEMON"],
      ["CHERRY", "LEMON", "LEMON"],
      ["LEMON", "LEMON", "LEMON"],
      ["LEMON", "LEMON", "LEMON"],
    ];

    it("is null on a response with no high-paying prefix", async () => {
      const flatGrid: SpinResponse["grid"] = [
        ["LEMON", "DIAMOND", "SEVEN"],
        ["DIAMOND", "SEVEN", "EMERALD"],
        ["SEVEN", "EMERALD", "LEMON"],
        ["EMERALD", "LEMON", "DIAMOND"],
        ["LEMON", "DIAMOND", "SEVEN"],
      ];
      const { ctrl } = setup({
        serverResult: { ok: true, data: makeResponse({ grid: flatGrid }) },
      });
      ctrl.pressButton();
      await flushPromises();
      expect(ctrl.tick(0).anticipation).toBeNull();
    });

    it("populates anticipation.reels when reels 0–2 telegraph a big win", async () => {
      const { ctrl } = setup({
        serverResult: {
          ok: true,
          data: makeResponse({ grid: antGrid }),
        },
      });
      ctrl.pressButton();
      await flushPromises();
      const snap = ctrl.tick(0);
      expect(snap.anticipation).toEqual({ reels: [3, 4] });
    });

    it("passes anticipation to landReels", async () => {
      const { ctrl, reels } = setup({
        serverResult: {
          ok: true,
          data: makeResponse({ grid: antGrid }),
        },
      });
      ctrl.pressButton();
      await flushPromises();
      for (let i = 0; i < 35; i++) ctrl.tick(16);
      expect(reels.landReels).toHaveBeenCalledWith(expect.anything(), {
        reels: [3, 4],
      });
    });

    it("clears anticipation on return to idle", async () => {
      const { ctrl } = setup({
        serverResult: {
          ok: true,
          data: makeResponse({ grid: antGrid }),
        },
      });
      ctrl.pressButton();
      await flushPromises();
      for (let i = 0; i < 35; i++) ctrl.tick(16);
      await flushPromises();
      expect(ctrl.tick(0).anticipation).toBeNull();
    });
  });
});
