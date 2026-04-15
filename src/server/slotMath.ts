export type Symbol = "A" | "B" | "C" | "D" | "E" | "F" | "WILD";

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
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
    "A",
    "WILD",
    "B",
    "C",
    "A",
    "E",
    "F",
    "A",
    "B",
  ],
  [
    "B",
    "C",
    "A",
    "E",
    "F",
    "A",
    "B",
    "C",
    "WILD",
    "D",
    "A",
    "F",
    "A",
    "B",
    "C",
  ],
  [
    "C",
    "A",
    "E",
    "F",
    "A",
    "B",
    "C",
    "D",
    "E",
    "WILD",
    "F",
    "A",
    "B",
    "A",
    "D",
  ],
  [
    "D",
    "E",
    "A",
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
    "A",
    "WILD",
    "B",
    "A",
    "D",
    "E",
  ],
  [
    "E",
    "F",
    "A",
    "B",
    "A",
    "D",
    "E",
    "F",
    "A",
    "B",
    "A",
    "WILD",
    "D",
    "A",
    "F",
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
  A: [5, 20, 100],
  B: [3, 10, 50],
  C: [2, 5, 25],
  D: [1, 3, 15],
  E: [1, 2, 10],
  F: [1, 2, 10],
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
