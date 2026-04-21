// Pixi-agnostic audio façade. Starts disabled so the demo is silent until the
// player opts in — `play()` is a no-op until `setEnabled(true)`.
//
// Why dynamic import: Chrome's autoplay policy requires the AudioContext to be
// created inside a user gesture. `@pixi/sound` instantiates its singleton —
// and with it the AudioContext — at module-evaluation time, so even a
// top-level `import { sound } from "@pixi/sound"` emits a noisy
// "AudioContext was not allowed to start" warning at page load. We defer the
// entire module load to the first toggle-on gesture via `await import(...)`,
// which keeps the console clean and means muted sessions never fetch the
// library chunk at all.

export const AUDIO_KEYS = [
  "spin-start",
  "reel-land",
  "win",
  "click",
  "anticipation",
] as const;

export type AudioKey = (typeof AUDIO_KEYS)[number];

export interface AudioManager {
  play(key: AudioKey): void;
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
}

interface SoundBackend {
  load(aliases: readonly string[]): void | Promise<void>;
  play(alias: string): void;
  exists(alias: string): boolean;
}

function createDefaultBackend(): SoundBackend {
  // The @pixi/sound `sound` singleton, captured after dynamic import. Until
  // the first load, all backend methods no-op cleanly.
  type SoundLib = {
    add(alias: string, url: string): unknown;
    play(alias: string): unknown;
    exists(alias: string): boolean;
  };
  let lib: SoundLib | null = null;

  return {
    async load(aliases) {
      if (!lib) {
        const mod = await import("@pixi/sound");
        lib = mod.sound as SoundLib;
      }
      for (const alias of aliases) {
        if (!lib.exists(alias)) {
          lib.add(alias, `assets/audio/${alias}.wav`);
        }
      }
    },
    play(alias) {
      lib?.play(alias);
    },
    exists(alias) {
      return lib?.exists(alias) ?? false;
    },
  };
}

export function createAudioManager(
  backend: SoundBackend = createDefaultBackend()
): AudioManager {
  let enabled = false;
  let loadStarted = false;
  return {
    play(key) {
      if (!enabled) return;
      if (!backend.exists(key)) return;
      backend.play(key);
    },
    setEnabled(next) {
      enabled = next;
      if (next && !loadStarted) {
        // Runs inside the click handler that toggled sound on — a valid user
        // gesture — so the AudioContext can start without warnings. The load
        // is async; `play()` will no-op until `exists()` reports true.
        loadStarted = true;
        void backend.load(AUDIO_KEYS);
      }
    },
    isEnabled() {
      return enabled;
    },
  };
}

export function createNullAudioManager(): AudioManager {
  return {
    play() {},
    setEnabled() {},
    isEnabled() {
      return false;
    },
  };
}
