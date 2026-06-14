// Optimize mini-app preview backgrounds.
//
// Source: PNGs in scripts/.tmp_previews/ (downloaded by hand-pasted URLs).
// Output: WebP at assets/mini-app-previews/preview_N.webp, max 600 px on the
// long edge, quality 70. Goal: < 30 KB each so the bundle stays small.
//
// Run with `npm run optimize:previews`. Idempotent — overwrites the output
// folder cleanly each run.
//
// Why WebP at 600 px:
//   The card preview is rendered behind a 320×140 dp container. On a 3x
//   device that's ~960×420 actual pixels, but we cap at 600 because the
//   image is heavily blurred / dimmed in the card UI (no one will see
//   pixel-level detail), and 600 keeps the encoded size below 30 KB even
//   on busy photographs.

import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
import { mkdir, readdir, rm, stat, writeFile } from 'fs/promises';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, '.tmp_previews');
const OUT_DIR = join(__dirname, '..', 'assets', 'mini-app-previews');
const MAX_EDGE = 600;
const WEBP_QUALITY = 70;

async function main() {
  // Wipe + recreate output folder so leftovers from previous runs don't
  // ship in the bundle. The pixel-icons pipeline does the same.
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const files = (await readdir(SRC_DIR))
    .filter((f) => f.endsWith('.png'))
    .sort((a, b) => {
      // Numeric sort by trailing index — preview_10 must come AFTER
      // preview_2, not after preview_1 like a string sort would put it.
      const na = parseInt(a.match(/(\d+)/)?.[1] || '0', 10);
      const nb = parseInt(b.match(/(\d+)/)?.[1] || '0', 10);
      return na - nb;
    });

  let total = 0;
  for (const file of files) {
    const inPath = join(SRC_DIR, file);
    const outName = basename(file, '.png') + '.webp';
    const outPath = join(OUT_DIR, outName);

    const buffer = await sharp(inPath)
      // `inside` keeps aspect ratio — never upscales, never crops.
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY, effort: 6 })
      // Drop EXIF / ICC / etc. — we own the photos and don't need any of it.
      .withMetadata({})
      .toBuffer();

    await writeFile(outPath, buffer);
    const inSize = (await stat(inPath)).size;
    const outSize = buffer.length;
    total += outSize;
    console.log(
      `${file} → ${outName}  ${(inSize / 1024).toFixed(1)} KB → ${(outSize / 1024).toFixed(1)} KB  (-${Math.round(
        (1 - outSize / inSize) * 100,
      )}%)`,
    );
  }
  console.log(`\nTotal output: ${(total / 1024).toFixed(1)} KB across ${files.length} files`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
