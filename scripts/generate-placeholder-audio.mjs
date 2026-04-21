// Generates placeholder WAV files for Phase 9 audio until real CC0 assets are
// dropped in. Each effect is a short synthesized tone/sweep/click — distinct
// enough to verify audio wiring end-to-end without external downloads.
//
// Usage: `node scripts/generate-placeholder-audio.mjs`
// Outputs to public/assets/audio/.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../public/assets/audio");
mkdirSync(outDir, { recursive: true });

const SAMPLE_RATE = 44100;

/**
 * @param {Float32Array} samples mono PCM in range [-1, 1]
 * @returns {Buffer}
 */
function encodeWav(samples) {
  const dataLen = samples.length * 2;
  const buf = Buffer.alloc(44 + dataLen);
  // RIFF header
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write("WAVE", 8);
  // fmt chunk
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // PCM format
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  // data chunk
  buf.write("data", 36);
  buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE((s * 0x7fff) | 0, 44 + i * 2);
  }
  return buf;
}

function envelope(i, len, attack = 0.01, release = 0.2) {
  const t = i / len;
  const a = Math.min(1, t / attack);
  const r = t > 1 - release ? (1 - t) / release : 1;
  return Math.max(0, Math.min(a, r));
}

function tone(durationSec, freqFn, volume = 0.3, attack = 0.01, release = 0.2) {
  const len = Math.floor(durationSec * SAMPLE_RATE);
  const samples = new Float32Array(len);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SAMPLE_RATE;
    const f = typeof freqFn === "function" ? freqFn(t) : freqFn;
    phase += (2 * Math.PI * f) / SAMPLE_RATE;
    const env = envelope(i, len, attack, release);
    samples[i] = Math.sin(phase) * env * volume;
  }
  return samples;
}

function noise(durationSec, volume = 0.2, attack = 0.005, release = 0.1) {
  const len = Math.floor(durationSec * SAMPLE_RATE);
  const samples = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const env = envelope(i, len, attack, release);
    samples[i] = (Math.random() * 2 - 1) * env * volume;
  }
  return samples;
}

function mix(...tracks) {
  const len = Math.max(...tracks.map((t) => t.length));
  const out = new Float32Array(len);
  for (const track of tracks) {
    for (let i = 0; i < track.length; i++) out[i] += track[i];
  }
  return out;
}

// ── Sound definitions ────────────────────────────────────────────────

// Whoosh — rising noise burst
const spinStart = noise(0.35, 0.25, 0.02, 0.25);
for (let i = 0; i < spinStart.length; i++) {
  const t = i / spinStart.length;
  spinStart[i] *= 0.5 + t * 0.8; // rising
}

// Reel land — short thud: low tone + click
const reelLand = mix(
  tone(0.12, 180, 0.4, 0.005, 0.6),
  noise(0.04, 0.3, 0.001, 0.8)
);

// Win jingle — ascending arpeggio
const winNotes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
const winLen = Math.floor(0.7 * SAMPLE_RATE);
const win = new Float32Array(winLen);
for (let n = 0; n < winNotes.length; n++) {
  const note = tone(0.25, winNotes[n], 0.25, 0.01, 0.3);
  const start = Math.floor(n * 0.12 * SAMPLE_RATE);
  for (let i = 0; i < note.length && start + i < winLen; i++) {
    win[start + i] += note[i];
  }
}

// Click — very short noise blip
const click = noise(0.05, 0.35, 0.001, 0.4);

// Anticipation — ascending sine sweep
const anticipation = tone(0.6, (t) => 220 + t * 440, 0.25, 0.02, 0.3);

// ── Write files ──────────────────────────────────────────────────────

const files = [
  ["spin-start.wav", spinStart],
  ["reel-land.wav", reelLand],
  ["win.wav", win],
  ["click.wav", click],
  ["anticipation.wav", anticipation],
];

for (const [name, samples] of files) {
  const path = resolve(outDir, name);
  writeFileSync(path, encodeWav(samples));
  console.log(`wrote ${path} (${samples.length} samples)`);
}
