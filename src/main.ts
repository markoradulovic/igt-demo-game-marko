import {
  Application,
  Assets,
  Container,
  Graphics,
  Text,
  Ticker,
} from "pixi.js";
import { MockedServer } from "./server/slotMath";
import { Game } from "./game/Game";
import { SYMBOLS } from "./server/slotMath";

// Internal coordinate system. All gameplay code positions elements against a
// fixed 1280×720 stage; `fitToViewport` applies a single uniform scale so the
// game looks identical at any window size without per-element responsive math.
const STAGE_W = 1280;
const STAGE_H = 720;

// `?seed=N` makes spin sequences reproducible — useful for demos, debugging,
// and the invariant test suite. Without the param, we generate a random seed.
function parseSeed(): number {
  const param = new URLSearchParams(window.location.search).get("seed");
  const parsed = param !== null ? Number(param) : NaN;
  return Number.isFinite(parsed) ? parsed : Math.floor(Math.random() * 2 ** 32);
}

function fitToViewport(app: Application, stage: Container): void {
  const scale = Math.min(
    window.innerWidth / STAGE_W,
    window.innerHeight / STAGE_H
  );
  stage.scale.set(scale);
  stage.x = (window.innerWidth - STAGE_W * scale) / 2;
  stage.y = (window.innerHeight - STAGE_H * scale) / 2;
  app.renderer.resize(window.innerWidth, window.innerHeight);
}

async function init(): Promise<void> {
  const app = new Application();
  await app.init({
    resizeTo: window,
    backgroundColor: 0x1a1a2e,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  const container = document.getElementById("app");
  if (!container) throw new Error("#app element not found");
  container.appendChild(app.canvas);

  const root = new Container();
  app.stage.addChild(root);

  fitToViewport(app, root);
  window.addEventListener("resize", () => fitToViewport(app, root));

  // --- LOADING state: progress bar while assets preload ---
  const loadingContainer = new Container();
  root.addChild(loadingContainer);

  const title = new Text({
    text: "Loading...",
    style: { fill: 0xffffff, fontSize: 36, fontWeight: "bold" },
  });
  title.anchor.set(0.5);
  title.x = STAGE_W / 2;
  title.y = STAGE_H / 2 - 60;
  loadingContainer.addChild(title);

  const BAR_W = 400;
  const BAR_H = 24;
  const barX = (STAGE_W - BAR_W) / 2;
  const barY = STAGE_H / 2;

  const barBg = new Graphics();
  barBg.roundRect(barX, barY, BAR_W, BAR_H, 8);
  barBg.fill({ color: 0x333355 });
  loadingContainer.addChild(barBg);

  const barFill = new Graphics();
  loadingContainer.addChild(barFill);

  function drawBar(fraction: number): void {
    barFill.clear();
    const w = Math.max(0, Math.min(BAR_W, BAR_W * fraction));
    if (w > 0) {
      barFill.roundRect(barX, barY, w, BAR_H, 8);
      barFill.fill({ color: 0x2ecc71 });
    }
  }
  drawBar(0);

  // Register all game assets as a bundle for batch preloading
  const bundleAssets: Record<string, string> = {};
  for (const sym of SYMBOLS) {
    bundleAssets[`symbol-${sym}`] = `assets/symbols/${sym}.svg`;
  }
  bundleAssets["ui-frame"] = `assets/ui/frame.svg`;
  bundleAssets["ui-background"] = `assets/ui/background.svg`;
  // Audio is deliberately NOT loaded here. Chrome's autoplay policy requires
  // the AudioContext to be created inside a user gesture; loading audio at
  // preload time would create the context before any click and log noisy
  // warnings. Audio is lazy-loaded by AudioManager on the first toggle-on
  // gesture instead.
  Assets.addBundle("game", bundleAssets);

  // Animate the bar smoothly over FILL_MS regardless of how fast assets
  // actually load (small SVGs resolve almost instantly from cache). This
  // guarantees the player always sees a satisfying fill animation.
  // Uses performance.now() for wall-clock timing so the animation runs at
  // the correct speed even if Chrome throttles rAF in background tabs.
  const FILL_MS = 1200;
  let assetsReady = false;

  Assets.loadBundle("game").then(() => {
    assetsReady = true;
  });

  const startTime = performance.now();
  await new Promise<void>((resolve) => {
    const tickHandler = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(1, elapsed / FILL_MS);
      // Ease-out curve for a snappy-then-settling feel
      const eased = 1 - (1 - t) ** 3;
      drawBar(eased);

      if (t >= 1 && assetsReady) {
        Ticker.shared.remove(tickHandler);
        resolve();
      }
    };
    Ticker.shared.add(tickHandler);
  });

  // Brief hold at 100% so the full bar registers visually
  await new Promise((r) => setTimeout(r, 150));

  // Remove loading screen, transition to IDLE
  root.removeChild(loadingContainer);
  loadingContainer.destroy({ children: true });

  const STARTING_BALANCE = 1000;
  const server = new MockedServer({
    seed: parseSeed(),
    startingBalance: STARTING_BALANCE,
  });
  const game = new Game(server, STARTING_BALANCE);
  root.addChild(game.view);
}

init().catch(console.error);
