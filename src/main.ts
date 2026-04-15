import { Application, Container } from "pixi.js";
import { MockedServer } from "./server/slotMath";
import { Game } from "./game/Game";

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

  const STARTING_BALANCE = 1000;
  const server = new MockedServer({
    seed: parseSeed(),
    startingBalance: STARTING_BALANCE,
  });
  const game = new Game(server, STARTING_BALANCE);
  root.addChild(game.view);

  fitToViewport(app, root);
  window.addEventListener("resize", () => fitToViewport(app, root));
}

init().catch(console.error);
