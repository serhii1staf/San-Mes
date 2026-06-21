// Generates the chat send/receive sound effects as small mono 16-bit WAV files
// from the SAME synth parameters the (web) reference app used via the Web Audio
// API (which doesn't exist in React Native). We bake the oscillator + envelope
// into a PCM buffer so expo-av can play it natively — zero network, tiny files.
//
// Run: node scripts/gen-message-sounds.mjs
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'assets', 'sounds');
const SR = 44100;

// Exponential ramp value at time t (mirrors WebAudio exponentialRampToValueAtTime).
function expRamp(start, end, t, dur) {
  if (t >= dur) return end;
  if (t <= 0) return start;
  return start * Math.pow(end / start, t / dur);
}

// Render one effect to a Float32 array of samples.
function render({ duration, freqStart, freqEnd, freqDur, gainStart, gainEnd, gainDur }) {
  const n = Math.ceil(SR * duration);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = expRamp(freqStart, freqEnd, t, freqDur);
    const g = expRamp(gainStart, gainEnd, t, gainDur);
    phase += (2 * Math.PI * f) / SR;
    // 2 ms attack + 4 ms release fade to kill clicks at the edges.
    const atk = Math.min(1, t / 0.002);
    const rel = Math.min(1, (duration - t) / 0.004);
    out[i] = Math.sin(phase) * g * atk * rel;
  }
  return out;
}

function toWav(samples) {
  const dataLen = samples.length * 2; // 16-bit
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);          // fmt chunk size
  buf.writeUInt16LE(1, 20);           // PCM
  buf.writeUInt16LE(1, 22);           // mono
  buf.writeUInt32LE(SR, 24);          // sample rate
  buf.writeUInt32LE(SR * 2, 28);      // byte rate
  buf.writeUInt16LE(2, 32);           // block align
  buf.writeUInt16LE(16, 34);          // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < samples.length; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

mkdirSync(OUT_DIR, { recursive: true });

// "swoosh" send: sine 800 -> 1200 Hz, gain 0.08 -> 0.001, 0.10 s.
writeFileSync(
  join(OUT_DIR, 'send.wav'),
  toWav(render({ duration: 0.1, freqStart: 800, freqEnd: 1200, freqDur: 0.06, gainStart: 0.08, gainEnd: 0.001, gainDur: 0.1 })),
);
// soft "pop" receive: sine 600 -> 400 Hz, gain 0.06 -> 0.001, 0.12 s.
writeFileSync(
  join(OUT_DIR, 'receive.wav'),
  toWav(render({ duration: 0.12, freqStart: 600, freqEnd: 400, freqDur: 0.08, gainStart: 0.06, gainEnd: 0.001, gainDur: 0.12 })),
);

console.log('Wrote assets/sounds/send.wav and receive.wav');
