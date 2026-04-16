// Port + adapter for the slot "server". `SlotServer` is the port — the only
// surface `Game` imports. `MockedServer` is the v1 adapter and the only place
// in the codebase that references reel strips, paytable, paylines, PRNG, or
// wallet state. A real HTTP backend would be a drop-in replacement.

export type Symbol =
  | "CHERRY"
  | "BELL"
  | "LEMON"
  | "EMERALD"
  | "DIAMOND"
  | "SEVEN"
  | "WILD";

export interface WinLine {
  lineId: number;
  symbol: Symbol;
  count: 3 | 4 | 5;
  positions: [number, number][];
  win: number;
}

export interface SpinResponse {
  stops: [number, number, number, number, number];
  grid: Symbol[][];
  totalWin: number;
  balanceAfter: number;
  lines: WinLine[];
}

// Expected failures (insufficient funds) come through this Result channel
// rather than a promise rejection. Rejection is reserved for truly exceptional
// cases (network, bugs) so `Game` can treat them differently.
export type SpinResult =
  | { ok: true; data: SpinResponse }
  | { ok: false; error: "INSUFFICIENT_FUNDS"; balance: number };

export interface SlotServer {
  spin(bet: number): Promise<SpinResult>;
}

export interface MockedServerOptions {
  seed: number;
  startingBalance: number;
}

const REEL_STRIPS: Symbol[][] = [
  [
    "CHERRY",
    "BELL",
    "LEMON",
    "EMERALD",
    "DIAMOND",
    "SEVEN",
    "CHERRY",
    "WILD",
    "BELL",
    "LEMON",
    "CHERRY",
    "DIAMOND",
    "SEVEN",
    "CHERRY",
    "BELL",
  ],
  [
    "BELL",
    "LEMON",
    "CHERRY",
    "DIAMOND",
    "SEVEN",
    "CHERRY",
    "BELL",
    "LEMON",
    "WILD",
    "EMERALD",
    "CHERRY",
    "SEVEN",
    "CHERRY",
    "BELL",
    "LEMON",
  ],
  [
    "LEMON",
    "CHERRY",
    "DIAMOND",
    "SEVEN",
    "CHERRY",
    "BELL",
    "LEMON",
    "EMERALD",
    "DIAMOND",
    "WILD",
    "SEVEN",
    "CHERRY",
    "BELL",
    "CHERRY",
    "EMERALD",
  ],
  [
    "EMERALD",
    "DIAMOND",
    "CHERRY",
    "CHERRY",
    "BELL",
    "LEMON",
    "EMERALD",
    "DIAMOND",
    "SEVEN",
    "CHERRY",
    "WILD",
    "BELL",
    "CHERRY",
    "EMERALD",
    "DIAMOND",
  ],
  [
    "DIAMOND",
    "SEVEN",
    "CHERRY",
    "BELL",
    "CHERRY",
    "EMERALD",
    "DIAMOND",
    "SEVEN",
    "CHERRY",
    "BELL",
    "CHERRY",
    "WILD",
    "EMERALD",
    "CHERRY",
    "SEVEN",
  ],
];

const PAYLINES: [number, number][][] = [
  [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
  ],
  [
    [0, 1],
    [1, 1],
    [2, 1],
    [3, 1],
    [4, 1],
  ],
  [
    [0, 2],
    [1, 2],
    [2, 2],
    [3, 2],
    [4, 2],
  ],
  [
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 1],
    [4, 0],
  ],
  [
    [0, 2],
    [1, 1],
    [2, 0],
    [3, 1],
    [4, 2],
  ],
];

const PAYTABLE: Record<Symbol, [number, number, number]> = {
  CHERRY: [5, 20, 100],
  BELL: [3, 10, 50],
  LEMON: [2, 5, 25],
  EMERALD: [1, 3, 15],
  DIAMOND: [1, 2, 10],
  SEVEN: [1, 2, 10],
  WILD: [10, 50, 500],
};

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function evaluateLine(
  grid: Symbol[][],
  line: [number, number][],
  lineId: number,
  bet: number
): WinLine | null {
  const symbols = line.map(([reel, row]) => grid[reel][row]);
  // Wild substitution: the paying symbol is the first non-wild on the line.
  // A line of all wilds pays as WILD at its own (higher) rate.
  const firstNonWild = symbols.find((s) => s !== "WILD");
  const target: Symbol = firstNonWild ?? "WILD";

  let count = 0;
  for (const s of symbols) {
    if (s === target || s === "WILD") count++;
    else break;
  }

  if (count < 3) return null;

  const multiplier = PAYTABLE[target][count - 3];
  return {
    lineId,
    symbol: target,
    count: count as 3 | 4 | 5,
    positions: line.slice(0, count),
    win: bet * multiplier,
  };
}

export class MockedServer implements SlotServer {
  private rand: () => number;
  private balance: number;

  constructor(opts: MockedServerOptions) {
    this.rand = mulberry32(opts.seed);
    this.balance = opts.startingBalance;
  }

  async spin(bet: number): Promise<SpinResult> {
    // Defensive: `Game` already gates Spin at the UI level, but the server is
    // the authority. Balance stays unchanged on this branch.
    if (bet > this.balance) {
      return { ok: false, error: "INSUFFICIENT_FUNDS", balance: this.balance };
    }

    const stops = REEL_STRIPS.map((strip) =>
      Math.floor(this.rand() * strip.length)
    ) as [number, number, number, number, number];

    const grid: Symbol[][] = stops.map((stop, reel) => {
      const strip = REEL_STRIPS[reel];
      return [0, 1, 2].map((row) => strip[(stop + row) % strip.length]);
    });

    const lines: WinLine[] = [];
    PAYLINES.forEach((line, idx) => {
      const w = evaluateLine(grid, line, idx + 1, bet);
      if (w) lines.push(w);
    });

    const totalWin = lines.reduce((a, l) => a + l.win, 0);
    this.balance = this.balance - bet + totalWin;

    return {
      ok: true,
      data: {
        stops,
        grid,
        totalWin,
        balanceAfter: this.balance,
        lines,
      },
    };
  }
}
