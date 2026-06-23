/**
 * verify-theme-assets.js — build-time / CI license gate for Seasonal Profile
 * Themes (Apple Developer Program License Agreement §3.3.4; Req 8.3–8.6).
 *
 * Every shipped Background_Illustration and Theme_Font asset MUST have a
 * complete ownership / distribution-license record in
 * `assets/profile-themes/licenses.json`. If any shipped asset lacks a valid
 * record, the build fails (exit 1) naming the offending asset(s). System-emoji
 * accents are OS glyphs, never files, so they are never refs and never require
 * a record (Req 8.3).
 *
 * --- How the shipped asset refs are derived (approach) ---
 * `src/theme/profileThemes.ts` is TypeScript/React-Native and cannot be
 * `require()`d directly from plain Node, and the themes' `backgroundIllustration`
 * / `themeFont.asset` values are `require()`'d numeric module ids that only exist
 * inside the Metro bundler — not enumerable here. Rather than parse TS, we use
 * the fact that ALL bundled theme assets live under `assets/profile-themes/`
 * (illustrations + fonts get dropped there and wired via `require()`). So the
 * set of shipped asset refs is exactly the set of real asset FILES present in
 * that directory (by extension), excluding the manifest itself. This is the
 * simplest robust approach that:
 *   - PASSES with zero asset files present (PLACEHOLDER phase → refs is empty);
 *   - FAILS the moment an unlicensed asset file is dropped in without a record.
 *
 * The core `verifyThemeAssets(manifest, refs)` is a PURE function (no I/O) so it
 * can be unit/property tested in isolation (see Property 14).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const ASSET_DIR_REL = 'assets/profile-themes';
const ASSET_DIR_ABS = path.join(REPO_ROOT, ASSET_DIR_REL);
const MANIFEST_ABS = path.join(ASSET_DIR_ABS, 'licenses.json');

/** File extensions we treat as shippable theme assets, and their ref type. */
const ILLUSTRATION_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);
const FONT_EXTS = new Set(['.ttf', '.otf', '.woff', '.woff2']);

/**
 * License types that explicitly forbid distribution/redistribution within the
 * app. A record carrying one of these does NOT satisfy the gate (Req 8.4).
 */
const DISTRIBUTION_PROHIBITED = new Set([
  'none',
  'no-distribution',
  'no-redistribution',
  'no-redist',
  'all-rights-reserved',
  'proprietary-no-redist',
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** A non-empty license type that is not on the distribution denylist (Req 8.4). */
function licensePermitsDistribution(licenseType) {
  if (!isNonEmptyString(licenseType)) return false;
  return !DISTRIBUTION_PROHIBITED.has(licenseType.trim().toLowerCase());
}

/** A record is complete iff it identifies the asset, a distribution-permitting
 * license type, a source, and an owner (Req 8.1, 8.2). */
function isCompleteRecord(record) {
  return (
    !!record &&
    isNonEmptyString(record.assetPath) &&
    isNonEmptyString(record.licenseType) &&
    licensePermitsDistribution(record.licenseType) &&
    isNonEmptyString(record.source) &&
    isNonEmptyString(record.owner)
  );
}

function normalizePath(p) {
  return String(p).replace(/\\/g, '/');
}

/**
 * PURE: verify that every shipped asset `ref` has a complete, distribution-
 * permitting license record in `manifest`.
 *
 * @param {{records?: Array<object>}} manifest parsed licenses.json
 * @param {Array<{assetPath: string, type: string}>} refs shipped asset references
 * @returns {{ok: boolean, missing: string[]}} ok iff every ref has a valid record;
 *   `missing` names every ref lacking one.
 */
function verifyThemeAssets(manifest, refs) {
  const records =
    manifest && Array.isArray(manifest.records) ? manifest.records : [];
  const safeRefs = Array.isArray(refs) ? refs : [];
  const missing = [];

  for (const ref of safeRefs) {
    if (!ref || !isNonEmptyString(ref.assetPath)) continue;
    const wanted = normalizePath(ref.assetPath);
    const record = records.find(
      (r) => r && isNonEmptyString(r.assetPath) && normalizePath(r.assetPath) === wanted
    );
    if (!isCompleteRecord(record)) {
      missing.push(ref.assetPath);
    }
  }

  return { ok: missing.length === 0, missing };
}

/**
 * Enumerate the shipped theme asset refs by scanning `assets/profile-themes/`
 * for real asset files (illustrations + fonts). Returns [] when the directory
 * holds only the manifest (PLACEHOLDER phase). Emoji glyphs are never files, so
 * they never appear here (Req 8.3).
 */
function enumerateAssetRefs() {
  if (!fs.existsSync(ASSET_DIR_ABS)) return [];
  const refs = [];
  for (const entry of fs.readdirSync(ASSET_DIR_ABS, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name === 'licenses.json') continue;
    const ext = path.extname(entry.name).toLowerCase();
    let type = null;
    if (ILLUSTRATION_EXTS.has(ext)) type = 'illustration';
    else if (FONT_EXTS.has(ext)) type = 'font';
    if (!type) continue; // ignore non-asset files (README, etc.)
    refs.push({
      assetPath: normalizePath(path.join(ASSET_DIR_REL, entry.name)),
      type,
    });
  }
  return refs;
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_ABS)) {
    return { records: [] };
  }
  const raw = fs.readFileSync(MANIFEST_ABS, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Could not parse ${ASSET_DIR_REL}/licenses.json: ${err.message}`);
  }
}

function main() {
  let manifest;
  try {
    manifest = loadManifest();
  } catch (err) {
    console.error(`[verify-theme-assets] ${err.message}`);
    process.exit(1);
    return;
  }

  const refs = enumerateAssetRefs();
  const { ok, missing } = verifyThemeAssets(manifest, refs);

  console.log(
    `[verify-theme-assets] scanned ${ASSET_DIR_REL}: ${refs.length} shipped asset(s), ` +
      `${(manifest.records || []).length} license record(s).`
  );

  if (refs.length === 0) {
    console.log(
      '[verify-theme-assets] PLACEHOLDER phase: no bundled theme assets present — gate passes.'
    );
  }

  if (!ok) {
    console.error(
      '[verify-theme-assets] BUILD FAILED — the following theme asset(s) ship without a ' +
        'complete distribution-license record in assets/profile-themes/licenses.json:'
    );
    for (const assetPath of missing) {
      console.error(`  - ${assetPath}`);
    }
    console.error(
      '[verify-theme-assets] Add a matching record { assetPath, type, licenseType, source, owner } ' +
        'for each asset (Apple Developer Program License Agreement §3.3.4), or remove the asset.'
    );
    process.exit(1);
    return;
  }

  console.log('[verify-theme-assets] OK — every shipped theme asset has a valid license record.');
  process.exit(0);
}

module.exports = {
  verifyThemeAssets,
  isCompleteRecord,
  licensePermitsDistribution,
  enumerateAssetRefs,
  DISTRIBUTION_PROHIBITED,
};

// Run as CLI when invoked directly (not when required by a test).
if (require.main === module) {
  main();
}
