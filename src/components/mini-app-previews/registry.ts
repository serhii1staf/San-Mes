/**
 * Mini-app preview backgrounds registry.
 *
 * Six bundled WebP backdrops the user can drop behind the in-app
 * `MiniAppPreviewCard`. All sources are pre-bundled via `require(...)` so
 * Metro statically includes them and tree-shakes anything not referenced
 * elsewhere. WebP is decoded natively on iOS 14+ and Android 4.0+, so
 * consumer code (`expo-image`) does not need any special handling.
 *
 * Total bundled size at the time of writing: ~47 KB across 6 files
 * (preview_4 alone is ~35 KB; the other five sit between 1.4 and 4.3 KB).
 *
 * Stable id format: `preview_<n>` where n is 1..6 — matches the on-disk
 * filename. Persistable: it is safe to write a chosen id into user
 * settings and read it back across rebuilds.
 */

import type { ImageSourcePropType } from 'react-native';

export interface MiniAppPreview {
  /** Stable id, e.g. `preview_3`. Persistable. */
  id: string;
  /** Pre-resolved `require()` source — pass directly to `<Image source>`. */
  source: ImageSourcePropType;
}

/**
 * Ordered list of the 6 bundled previews. Order doubles as the picker
 * grid order — keep it stable so the user's spatial memory still holds
 * after future asset additions.
 */
export const MINI_APP_PREVIEWS: MiniAppPreview[] = [
  { id: 'preview_1', source: require('../../../assets/mini-app-previews/preview_1.webp') },
  { id: 'preview_2', source: require('../../../assets/mini-app-previews/preview_2.webp') },
  { id: 'preview_3', source: require('../../../assets/mini-app-previews/preview_3.webp') },
  { id: 'preview_4', source: require('../../../assets/mini-app-previews/preview_4.webp') },
  { id: 'preview_5', source: require('../../../assets/mini-app-previews/preview_5.webp') },
  { id: 'preview_6', source: require('../../../assets/mini-app-previews/preview_6.webp') },
];

/** Picker-grid display order. Just the ids, in render order. */
export const MINI_APP_PREVIEW_IDS: string[] = MINI_APP_PREVIEWS.map((p) => p.id);

/** Lookup table: id -> entry. Built once at module load. */
const BY_ID: Record<string, MiniAppPreview> = (() => {
  const out: Record<string, MiniAppPreview> = {};
  for (const p of MINI_APP_PREVIEWS) out[p.id] = p;
  return out;
})();

/**
 * Resolve the bundled `require()` source for a given preview id. Returns
 * `null` for an unknown id or an explicit `null` selection — callers
 * branch on `null` to render the card without a background image.
 */
export function getMiniAppPreviewSource(id: string | null): ImageSourcePropType | null {
  if (!id) return null;
  const entry = BY_ID[id];
  return entry ? entry.source : null;
}
