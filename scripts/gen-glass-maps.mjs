// Generates the liquid-glass light maps in assets/glass/ (@1x, @2x, @3x).
//
//   node scripts/gen-glass-maps.mjs
//
// The formulas are glisse 0.6.0's (https://glisse.kelvinzhang.ca), ported unchanged: `rimMap` (the
// lit band inside a glass edge), the highlight half of `selectionMaps` (the lifted tab-bar lens's
// rainbow rim) and the lifted bar's radial glow. glisse draws them on a canvas at runtime; here they are
// drawn once, at build time, because every size they are used at is a constant in CustomTabBar and
// computing them in Hermes cost about 300 ms of JS on first launch (measured on the emulator).
//
// Re-run after changing any of the sizes below or the matching constants in
// src/components/navigation/CustomTabBar.tsx (MAIN_CAPSULE_WIDTH, TAB_BAR_INNER_HEIGHT,
// BAR_BORDER_RADIUS, PROFILE_CAPSULE_WIDTH, DIAL_BUTTON, the pill size).
//
// glisse is MIT licensed:
//
//   MIT License
//   Copyright (c) 2026 Kelvin Zhang
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
//   associated documentation files (the "Software"), to deal in the Software without restriction,
//   including without limitation the rights to use, copy, modify, merge, publish, distribute,
//   sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in all copies or
//   substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
//   NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
//   NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
//   OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
//   CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'glass');

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Signed distance to a rounded rectangle centred on the origin, negative inside (glisse `distance`). */
function distance(x, y, halfWidth, halfHeight, radius) {
  const qx = Math.abs(x) - halfWidth + radius;
  const qy = Math.abs(y) - halfHeight + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

const RIM_WIDTH = 1.22;
const EDGE_WIDTH = 0.5;

/** glisse `rimMap`: white light along the rim over a half-pixel edge line in `edge` ([r, g, b, a 0..1]). */
function rimMap(width, height, radius, shine, density, edge = [0, 0, 0, 0]) {
  const columns = Math.max(1, Math.round(width * density));
  const rows = Math.max(1, Math.round(height * density));
  const data = new Uint8Array(columns * rows * 4);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const corner = clamp(radius, 0, Math.min(halfWidth, halfHeight));
  const half = 0.5 / density;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = ((column + 0.5) / columns) * width - halfWidth;
      const y = ((row + 0.5) / rows) * height - halfHeight;
      const depth = -distance(x, y, halfWidth, halfHeight, corner);
      if (depth < -half || depth > 2 * RIM_WIDTH) continue;
      const qx = Math.abs(x) - halfWidth + corner;
      const qy = Math.abs(y) - halfHeight + corner;
      let nx = 0;
      let ny = 0;
      if (qx > 0 && qy > 0) {
        const length = Math.hypot(qx, qy);
        nx = (Math.sign(x) * qx) / length;
        ny = (Math.sign(y) * qy) / length;
      } else if (qx > qy) nx = Math.sign(x);
      else ny = Math.sign(y);
      const facing = Math.abs(nx + ny);
      const along = Math.max(0, depth) / (RIM_WIDTH * Math.sqrt(Math.max(1, facing)));
      const cover = clamp((depth + half) * density, 0, 1);
      const lined = clamp((Math.min(EDGE_WIDTH, depth + half) - Math.max(0, depth - half)) * density, 0, 1);
      const light = along < 1 ? shine * Math.min(1, facing) ** 1.5 * (1 - along ** 1.5) * cover : 0;
      const line = edge[3] * lined * (1 - light);
      const alpha = light + line;
      if (alpha <= 0) continue;
      const i = (row * columns + column) * 4;
      for (let channel = 0; channel < 3; channel++) data[i + channel] = Math.round((255 * light + edge[channel] * line) / alpha);
      data[i + 3] = Math.round(255 * Math.min(1, alpha));
    }
  }
  return { columns, rows, data };
}

/** The highlight half of glisse `selectionMaps`: `shine` for a dark page, `bright` for a light one. */
function lensShineMap(width, height, radius, density, bright) {
  const columns = Math.ceil(width * density);
  const rows = Math.ceil(height * density);
  const data = new Uint8Array(columns * rows * 4);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const px = ((x + 0.5) * width) / columns - width / 2;
      const py = ((y + 0.5) * height) / rows - height / 2;
      const qx = Math.abs(px) - (width / 2 - radius);
      const qy = Math.abs(py) - (height / 2 - radius);
      const ox = Math.max(qx, 0);
      const oy = Math.max(qy, 0);
      const length = Math.hypot(ox, oy);
      const inside = radius - (length + Math.min(Math.max(qx, qy), 0));
      if (inside < 0) continue;
      const nx = length > 0 ? (ox / length) * Math.sign(px) : qx > qy ? Math.sign(px) : 0;
      const ny = length > 0 ? (oy / length) * Math.sign(py) : qx > qy ? 0 : Math.sign(py);
      const light = -(nx + ny) * Math.SQRT1_2;
      const glint = Math.max(light, 0) ** 3;
      const reflected = Math.max(-light, 0) ** 3;
      const i = (y * columns + x) * 4;
      if (bright) {
        const wide = [0.4, 0.5, 0.6].map((centre) => Math.exp(-(((inside - centre) / 0.4) ** 2)));
        const top = Math.max(...wide);
        for (let channel = 0; channel < 3; channel++) data[i + channel] = Math.round(255 * (0.85 + 0.15 * (top ? wide[channel] / top : 0)));
        data[i + 3] = Math.round(clamp(top * (0.55 + 0.3 * glint + 0.15 * reflected), 0, 1) * 255);
      } else {
        const bands = [0.18, 0.42, 0.66].map((centre) => Math.exp(-(((inside - centre) / 0.22) ** 2)));
        const peak = Math.max(...bands);
        for (let channel = 0; channel < 3; channel++) data[i + channel] = Math.round(255 * (0.65 + 0.35 * (peak ? bands[channel] / peak : 0)));
        data[i + 3] = Math.round(clamp(peak * (0.06 + 0.8 * glint + 0.35 * reflected) * 0.85, 0, 1) * 255);
      }
    }
  }
  return { columns, rows, data };
}

/** `radial-gradient(circle, #ffffff17, #ffffff0b 60%, transparent)`, the lifted bar's glow. */
function glowMap(size) {
  const data = new Uint8Array(size * size * 4);
  const centre = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = Math.hypot(x + 0.5 - centre, y + 0.5 - centre) / centre;
      if (t >= 1) continue;
      const inner = 0x17 / 255;
      const middle = 0x0b / 255;
      const alpha = t <= 0.6 ? inner + (middle - inner) * (t / 0.6) : middle * (1 - (t - 0.6) / 0.4);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(alpha * 255);
    }
  }
  return { columns: size, rows: size, data };
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}
function png({ columns, rows, data }) {
  const raw = Buffer.alloc((columns * 4 + 1) * rows);
  for (let y = 0; y < rows; y++) {
    raw[y * (columns * 4 + 1)] = 0;
    Buffer.from(data.buffer, y * columns * 4, columns * 4).copy(raw, y * (columns * 4 + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(columns, 0);
  header.writeUInt32BE(rows, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA, straight alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Shapes are the boxes the images fill. The bar, the profile capsule and the dial buttons have a
// 0.5 pt border, and an absolutely positioned child fills the box inside it. The bar is 172 wide and
// sized by its 60 pt row, so inside its border it is 171 x 60 (a capsule: its radius 32 is clamped to
// 30). The capsule (60 x 60) and the dial buttons (50 x 50) have fixed sizes, so they lose 1 pt each
// way. glisse's rim shine is 0.13 on a dark page and 0.3 on a light one; its edge line is left out
// because those views already draw a hairline border.
//
// The rims use the settings of glisse's clear `<Glass>` that was asked for (bend 1, dispersion 2,
// frost 0.5px, rim 1): `--lg-rim-shine: 1`, set on the element, so it is the same on both themes.
const RIM_SHINE = 1;
const rims = {
  'rim-bar': { width: 171, height: 60, radius: 30 },
  'rim-capsule': { width: 59, height: 59, radius: 29.5 },
  'rim-dial': { width: 49, height: 49, radius: 24.5 },
};
const LENS = { width: 76, height: 46, radius: 23 };

mkdirSync(OUT, { recursive: true });
const written = [];
const save = (name, scale, map) => {
  const file = join(OUT, scale === 1 ? `${name}.png` : `${name}@${scale}x.png`);
  const bytes = png(map);
  writeFileSync(file, bytes);
  written.push(`${file.split(/[\\/]/).slice(-2).join('/')} ${map.columns}x${map.rows} ${bytes.length} B`);
};
for (const scale of [1, 2, 3]) {
  for (const [name, { width, height, radius }] of Object.entries(rims)) {
    save(name, scale, rimMap(width, height, radius, RIM_SHINE, scale));
  }
  save('lens-shine-dark', scale, lensShineMap(LENS.width, LENS.height, LENS.radius, scale, false));
  save('lens-shine-light', scale, lensShineMap(LENS.width, LENS.height, LENS.radius, scale, true));
}
// A smooth gradient: drawn small and stretched by the GPU.
save('glow', 1, glowMap(32));
console.log(written.join('\n'));
