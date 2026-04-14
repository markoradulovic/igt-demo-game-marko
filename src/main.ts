import { Application } from 'pixi.js';

/**
 * Entry point — bootstraps the PixiJS Application and mounts the canvas.
 * Components and game logic will be wired in here as the project grows.
 */
async function init(): Promise<void> {
  // Create the PixiJS application
  const app = new Application();

  await app.init({
    width: 1280,
    height: 720,
    backgroundColor: 0x1a1a2e,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  // Mount the canvas into the DOM
  const container = document.getElementById('app');
  if (!container) throw new Error('#app element not found');
  container.appendChild(app.canvas);

  console.log('Slot Demo ready');
}

init().catch(console.error);
