/**
 * QR codes, made on the device.
 *
 * ── WHY NOT THE IMAGE SERVICE ANY MORE ───────────────────────────────────────
 *
 * Reported: the QR code "всё время перезагружается", and asked whether it could be made once instead
 * of hitting a server every time. It was an `<Image>` of
 * `https://api.qrserver.com/v1/create-qr-code/?data=<profile link>`: a network round trip per open
 * (and per open of the profile menu, which showed a thumbnail), a blank square until it answered, and
 * the profile link sent to a third party each time.
 *
 * `qrcode-generator` (MIT, no dependencies) builds the module matrix in a few milliseconds; the
 * matrix and the SVG path drawn from it are cached per text for the session, so a reopen does no work.
 */
import qrcode from 'qrcode-generator';
import { kvGetJSONSync, kvGetStringSync, kvSetJSON, kvSetString, kvDelete } from '../services/kvStore';

export type QrLevel = 'L' | 'M' | 'Q' | 'H';

export interface QrMatrix {
  /** Modules per side. */
  size: number;
  /** Row-major, `size * size`; true is a dark module. */
  dark: boolean[];
}

const matrixCache = new Map<string, QrMatrix>();
const pathCache = new Map<string, QrPaths>();

// ── KEPT ON DISK TOO ────────────────────────────────────────────────────────
// Encoding is the expensive part, not drawing: measured on the emulator, 110 ms to encode a profile
// link at level H (the encoder builds the code once per mask pattern, eight times, to pick the best),
// 7-11 ms to build the paths. So the matrix of the last few links is stored (account-scoped, a few
// hundred bytes each as hex) and a reopen after a restart skips the encoder entirely.
const DISK_PREFIX = 'qr1:';
const DISK_INDEX = 'qr1:index';
const DISK_MAX = 24;

function readDisk(key: string): QrMatrix | null {
  try {
    const raw = kvGetStringSync(DISK_PREFIX + key);
    if (!raw) return null;
    const colon = raw.indexOf(':');
    const size = Number(raw.slice(0, colon));
    const hex = raw.slice(colon + 1);
    if (!Number.isInteger(size) || size < 21 || hex.length !== Math.ceil((size * size) / 4)) return null;
    const dark = new Array<boolean>(size * size);
    for (let i = 0; i < hex.length; i++) {
      const nibble = parseInt(hex[i], 16);
      for (let b = 0; b < 4; b++) {
        const idx = i * 4 + b;
        if (idx < dark.length) dark[idx] = ((nibble >> (3 - b)) & 1) === 1;
      }
    }
    return { size, dark };
  } catch {
    return null;
  }
}

function writeDisk(key: string, m: QrMatrix): void {
  try {
    let hex = '';
    for (let i = 0; i < m.dark.length; i += 4) {
      let nibble = 0;
      for (let b = 0; b < 4; b++) nibble = (nibble << 1) | (m.dark[i + b] ? 1 : 0);
      hex += nibble.toString(16);
    }
    kvSetString(DISK_PREFIX + key, `${m.size}:${hex}`);
    const index = kvGetJSONSync<string[]>(DISK_INDEX, []).filter((k) => k !== key);
    index.unshift(key);
    for (const evicted of index.splice(DISK_MAX)) kvDelete(DISK_PREFIX + evicted);
    kvSetJSON(DISK_INDEX, index);
  } catch {
    // A cache that cannot be written only costs the next open an encode.
  }
}

/**
 * Whether `text` can be drawn without running the encoder (its matrix is in memory or on disk). A
 * caller on an opening frame can draw the rest first and encode a frame later when this is false.
 */
export function isQrCached(text: string, level: QrLevel = 'H'): boolean {
  const key = `${level}|${text}`;
  if (matrixCache.has(key)) return true;
  const disk = readDisk(key);
  if (disk) matrixCache.set(key, disk);
  return !!disk;
}

/** The module matrix for `text`. Byte mode, smallest version that fits. */
export function qrMatrix(text: string, level: QrLevel = 'H'): QrMatrix {
  const key = `${level}|${text}`;
  const hit = matrixCache.get(key) ?? readDisk(key);
  if (hit) {
    matrixCache.set(key, hit);
    return hit;
  }
  const qr = qrcode(0, level);
  qr.addData(text, 'Byte');
  qr.make();
  const size = qr.getModuleCount();
  const dark = new Array<boolean>(size * size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) dark[r * size + c] = qr.isDark(r, c);
  }
  const m = { size, dark };
  matrixCache.set(key, m);
  writeDisk(key, m);
  return m;
}

export interface QrPaths {
  size: number;
  /** Every data module as a rounded square, in module units (viewBox `0 0 size size`). */
  dots: string;
  /** The three finder patterns: rounded rings plus their centres, drawn with the even-odd rule. */
  finders: string;
  /** Side of the empty square left in the middle, in modules (0 when none). */
  clear: number;
}

/** A rounded rectangle as a closed subpath, in module units. */
function roundRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2);
  const f = (n: number) => (Math.round(n * 1000) / 1000).toString();
  return (
    `M${f(x + rr)} ${f(y)}H${f(x + w - rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(x + w)} ${f(y + rr)}` +
    `V${f(y + h - rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(x + w - rr)} ${f(y + h)}` +
    `H${f(x + rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(x)} ${f(y + h - rr)}` +
    `V${f(y + rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(x + rr)} ${f(y)}Z`
  );
}

/** Whether (r, c) is inside one of the three 7x7 finder patterns. */
function inFinder(r: number, c: number, size: number): boolean {
  const near = (v: number) => v < 7;
  const far = (v: number) => v >= size - 7;
  return (near(r) && near(c)) || (near(r) && far(c)) || (far(r) && near(c));
}

/**
 * Alignment-pattern centre coordinates per version (index = version - 1), from the QR specification;
 * identical to `PATTERN_POSITION_TABLE` inside qrcode-generator, which does not export it.
 */
const ALIGNMENT_POSITIONS: readonly (readonly number[])[] = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
  [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74],
  [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90], [6, 28, 50, 72, 94],
  [6, 26, 50, 74, 98], [6, 30, 54, 78, 102], [6, 28, 54, 80, 106], [6, 32, 58, 84, 110],
  [6, 30, 58, 86, 114], [6, 34, 62, 90, 118], [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126],
  [6, 26, 52, 78, 104, 130], [6, 30, 56, 82, 108, 134], [6, 34, 60, 86, 112, 138],
  [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146], [6, 30, 54, 78, 102, 126, 150],
  [6, 24, 50, 76, 102, 128, 154], [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162],
  [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170],
];

/** Centres of the alignment patterns of a code `size` modules wide (none overlap a finder). */
function alignmentCentres(size: number): [number, number][] {
  const positions = ALIGNMENT_POSITIONS[(size - 17) / 4 - 1] ?? [];
  const out: [number, number][] = [];
  for (const r of positions) {
    for (const c of positions) {
      if ((r < 9 && c < 9) || (r < 9 && c > size - 10) || (r > size - 10 && c < 9)) continue;
      out.push([r, c]);
    }
  }
  return out;
}

/**
 * SVG paths for `text`, cached. Data modules are separate round dots, the way Telegram's codes look;
 * the finder patterns are drawn as rounded rings, which every scanner still locates, because the
 * finder is found by its 1:1:3:1:1 run ratio, not by its corners.
 *
 * `clearFraction` leaves an empty square in the middle for a logo, as a fraction of the side (an odd
 * number of modules, so it sits exactly in the centre). Only with level 'H' (30 % recovery), and keep
 * it at or under 0.24: that clears under 6 % of the modules.
 */
export function qrPaths(text: string, level: QrLevel = 'H', clearFraction = 0): QrPaths {
  const key = `${level}|${clearFraction}|${text}`;
  const hit = pathCache.get(key);
  if (hit) return hit;
  const { size, dark } = qrMatrix(text, level);
  let clearCenter = 0;
  if (clearFraction > 0) {
    clearCenter = Math.round(size * Math.min(clearFraction, 0.24));
    // `size` is always odd (4 * version + 17); an odd hole keeps both margins whole modules.
    if (clearCenter > 0 && clearCenter % 2 === 0) clearCenter -= 1;
    if (clearCenter < 0) clearCenter = 0;
  }
  const lo = clearCenter > 0 ? (size - clearCenter) / 2 : -1;
  const hi = clearCenter > 0 ? (size + clearCenter) / 2 : -1;
  // Each data module is a circle of 0.84 modules, as two arcs from its left edge. A circle is the
  // shortest subpath that reads as a dot (about 55 characters), which matters: a version-8 code has
  // around a thousand of them, and the whole string is parsed by the native SVG view.
  const radius = 0.42;
  const arcs = `a${radius} ${radius} 0 1 0 ${radius * 2} 0a${radius} ${radius} 0 1 0 ${-radius * 2} 0`;
  const startX = 0.5 - radius;
  // ── THE ALIGNMENT PATTERNS STAY SOLID ──────────────────────────────────────
  // Checked by rasterising this exact drawing and decoding it with jsQR (3 profile links x with and
  // without the centre hole x 3, 4 and 6 px per module x 3 colours): with the small 5x5 alignment
  // patterns drawn as dots like the data, 18 of 54 decoded; drawn as rounded rings, 54 of 54. A
  // decoder locates them by their dark-light-dark runs, and dots break those runs up.
  const aligns = alignmentCentres(size);
  const inAlign = (r: number, c: number) => aligns.some(([ar, ac]) => Math.abs(r - ar) <= 2 && Math.abs(c - ac) <= 2);
  let dots = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!dark[r * size + c] || inFinder(r, c, size) || inAlign(r, c)) continue;
      if (clearCenter > 0 && r + 1 > lo && r < hi && c + 1 > lo && c < hi) continue;
      dots += `M${Math.round((c + startX) * 100) / 100} ${r + 0.5}${arcs}`;
    }
  }
  let finders = '';
  for (const [fr, fc] of [[0, 0], [0, size - 7], [size - 7, 0]] as const) {
    // Outer ring: a 7x7 rounded square minus a 5x5 one (even-odd), then the 3x3 centre.
    finders += roundRect(fc, fr, 7, 7, 2.1);
    finders += roundRect(fc + 1, fr + 1, 5, 5, 1.35);
    finders += roundRect(fc + 2, fr + 2, 3, 3, 0.95);
  }
  for (const [ar, ac] of aligns) {
    // The one in the middle of a version 7+ code is under the logo when there is a hole.
    if (clearCenter > 0 && ar + 1 > lo && ar < hi && ac + 1 > lo && ac < hi) continue;
    // Same construction at 5x5: ring, hole, centre module.
    finders += roundRect(ac - 2, ar - 2, 5, 5, 1.5);
    finders += roundRect(ac - 1, ar - 1, 3, 3, 0.9);
    finders += roundRect(ac, ar, 1, 1, 0.5);
  }
  const out = { size, dots, finders, clear: clearCenter };
  pathCache.set(key, out);
  return out;
}
