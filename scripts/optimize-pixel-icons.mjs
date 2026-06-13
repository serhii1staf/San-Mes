#!/usr/bin/env node
/**
 * Pixel-icon optimization pipeline (Node + sharp).
 *
 * Re-extracts the seven `pixel_characters_pack*.zip` archives from the
 * workspace root, normalises each PNG to <=192x192 (preserving aspect)
 * with high-quality Lanczos resampling, runs a corner-seeded BFS
 * flood-fill that strips the off-white halo most generators leave
 * around the subject, and writes the result to
 * `assets/pixel-icons/<pack>/<file>.webp` at quality 85 + alphaQuality
 * 100 + effort 6.
 *
 * Why this replaces the previous PowerShell pipeline:
 *  - Source bundle was 3.6 MB across 70 PNGs at 192x192 max. WebP at
 *    quality 85 typically halves PNG size for pixel-art-style images
 *    with no perceptible quality loss. Target: <2 MB total.
 *  - sharp gives us native WebP encode with full control over quality
 *    /alphaQuality/effort, plus a much faster pipeline than the
 *    System.Drawing path.
 *  - sharp lacks a flood-fill primitive, so we drop down to its raw
 *    pixel buffer (`raw().toBuffer()` -> Uint8 array, 4 bytes/pixel)
 *    and run a queue-based BFS in JS.
 *
 * Run: `npm run optimize:icons`
 *
 * sharp is a devDependency only — it does NOT ship to the runtime
 * bundle and does NOT need a native rebuild for the app. Metro and
 * expo-image both decode WebP natively (iOS 14+, Android 4.0+).
 */

import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// sharp is loaded via createRequire so this script also works under
// older Node ESM resolution where the default-export shape varies.
const sharp = require('sharp');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, '_tmp_pixel_webp');
const OUT = path.join(ROOT, 'assets', 'pixel-icons');
const MAX_DIM = 192;

// Background-color thresholds. Same constants the PowerShell script
// used — preserves the bg-detection behaviour for legitimately-bright
// pixels inside the subject.
const WHITE_R_MIN = 235;
const WHITE_GRAY_TOLERANCE = 16;

const PACKS = {
  'pack-1': 'pixel_characters_pack.zip',
  'pack-3': 'pixel_characters_pack_3.zip',
  'pack-4-memes': 'pixel_characters_pack_4_memes.zip',
  'pack-6-memes': 'pixel_characters_pack_6_memes.zip',
  'pack-7-anime': 'pixel_characters_pack_7_anime.zip',
  'pack-8-kawaii-spooky': 'pixel_characters_pack_8_kawaii_spooky.zip',
  'pack-9-ultra-memes': 'pixel_characters_pack_9_ultra_memes.zip',
};

/**
 * @param {number} R 0-255
 * @param {number} G 0-255
 * @param {number} B 0-255
 * @param {number} A 0-255
 */
function isBackgroundColor(R, G, B, A) {
  if (A < 1) return true; // already transparent
  if (R < WHITE_R_MIN || G < WHITE_R_MIN || B < WHITE_R_MIN) return false;
  const maxC = Math.max(R, G, B);
  const minC = Math.min(R, G, B);
  if (maxC - minC > WHITE_GRAY_TOLERANCE) return false;
  return true;
}

/**
 * Strips the off-white halo from a 4-channel raw RGBA buffer in-place
 * by seeding a BFS at each corner and clearing every connected pixel
 * that satisfies `isBackgroundColor`.
 *
 * @param {Uint8Array | Buffer} buf  4 bytes/pixel, row-major
 * @param {number} width
 * @param {number} height
 */
function stripHalo(buf, width, height) {
  // We use a Uint8Array `visited` mask rather than re-checking alpha
  // === 0 because some seed-corner pixels may legitimately be at A=0
  // already and we don't want them to short-circuit BFS.
  const visited = new Uint8Array(width * height);
  /** @type {number[]} */
  const queue = [];
  // Seed the four corners.
  queue.push(0);
  queue.push(width - 1);
  queue.push((height - 1) * width);
  queue.push((height - 1) * width + (width - 1));
  while (queue.length > 0) {
    const idx = queue.shift();
    if (idx === undefined) break;
    if (visited[idx]) continue;
    visited[idx] = 1;
    const off = idx * 4;
    const R = buf[off];
    const G = buf[off + 1];
    const B = buf[off + 2];
    const A = buf[off + 3];
    if (!isBackgroundColor(R, G, B, A)) continue;
    // Clear pixel.
    buf[off + 3] = 0;
    const x = idx % width;
    const y = Math.floor(idx / width);
    if (x + 1 < width) queue.push(idx + 1);
    if (x - 1 >= 0) queue.push(idx - 1);
    if (y + 1 < height) queue.push(idx + width);
    if (y - 1 >= 0) queue.push(idx - width);
  }
}

/**
 * @param {string} inPath
 * @param {string} outPath
 */
async function optimizeOne(inPath, outPath) {
  // Resize first (Lanczos is sharp's default for downscale). `withoutEnlargement`
  // protects icons that already happen to be smaller than 192.
  const resized = sharp(inPath)
    .resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha();

  const { data, info } = await resized.raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) {
    throw new Error(`Expected 4 channels (RGBA) for ${inPath}, got ${info.channels}`);
  }
  // Make a writable copy so we can run flood-fill in place.
  const buf = Buffer.from(data);
  stripHalo(buf, info.width, info.height);

  // Re-encode the cleaned RGBA buffer as WebP.
  await sharp(buf, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .webp({ quality: 85, alphaQuality: 100, effort: 6 })
    .toFile(outPath);

  // Verify Metro can bundle the result by reading it back via sharp's
  // metadata() and asserting format/size.
  const meta = await sharp(outPath).metadata();
  if (meta.format !== 'webp') throw new Error(`Output ${outPath} is not webp (got ${meta.format})`);
  if (!meta.width || meta.width > MAX_DIM) {
    throw new Error(`Output ${outPath} has invalid width ${meta.width}`);
  }
}

/**
 * Cross-platform zip extraction. Uses the system `unzip` if available,
 * otherwise falls back to PowerShell's Expand-Archive on Windows. We
 * intentionally avoid pulling in a JS-only zip lib to keep
 * devDependencies minimal.
 *
 * @param {string} zipPath
 * @param {string} destDir
 */
function extractZip(zipPath, destDir) {
  if (process.platform === 'win32') {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force`,
      ],
      { stdio: 'inherit' },
    );
  } else {
    execFileSync('unzip', ['-q', '-o', zipPath, '-d', destDir], { stdio: 'inherit' });
  }
}

/**
 * Recursively walk a directory and yield every file matching the
 * predicate. Used to find the actual PNGs inside the zip's top-level
 * folder (each pack zip contains one inner folder).
 *
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function listPngsRecursive(dir) {
  /** @type {string[]} */
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await listPngsRecursive(full)));
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.png')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Removes a directory recursively if it exists. fs.rm with
 * `recursive: true` works on Node 14+ and is a no-op on missing paths.
 *
 * @param {string} dir
 */
async function rmrf(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

async function main() {
  console.log('[optimize-pixel-icons] start');
  await rmrf(TMP);
  await rmrf(OUT);
  await fs.mkdir(TMP, { recursive: true });
  await fs.mkdir(OUT, { recursive: true });

  let processed = 0;
  for (const [packId, zipName] of Object.entries(PACKS)) {
    const zipPath = path.join(ROOT, zipName);
    if (!existsSync(zipPath)) {
      console.warn(`  skip ${packId}: ${zipName} not found`);
      continue;
    }
    const packTmp = path.join(TMP, packId);
    await fs.mkdir(packTmp, { recursive: true });
    extractZip(zipPath, packTmp);

    const outDir = path.join(OUT, packId);
    await fs.mkdir(outDir, { recursive: true });

    const pngs = await listPngsRecursive(packTmp);
    pngs.sort();
    for (const inPng of pngs) {
      const base = path.basename(inPng, path.extname(inPng));
      const outFile = path.join(outDir, `${base}.webp`);
      await optimizeOne(inPng, outFile);
      processed++;
    }
    console.log(`  ${packId}: wrote ${pngs.length} icons`);
  }

  await rmrf(TMP);

  // Report the total bundle size.
  const totalBytes = await dirSize(OUT);
  const mb = (totalBytes / (1024 * 1024)).toFixed(2);
  console.log(`[optimize-pixel-icons] done — ${processed} icons, ${mb} MB total`);
}

/**
 * @param {string} dir
 * @returns {Promise<number>}
 */
async function dirSize(dir) {
  let total = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(full);
    else if (e.isFile()) {
      const st = await fs.stat(full);
      total += st.size;
    }
  }
  return total;
}

main().catch(err => {
  console.error('[optimize-pixel-icons] failed:', err);
  process.exit(1);
});
