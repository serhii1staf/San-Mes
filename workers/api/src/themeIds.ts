// Shared known-theme-id list for the backend.
//
// The Worker cannot import the React Native theme registry
// (`src/theme/profileThemes.ts`), so it keeps its own copy of the
// Built_In_Theme_Set ids here. The order MUST stay identical to the RN
// registry's `BUILT_IN_THEME_LIST` ids — a lock-step unit test asserts the two
// lists are deep-equal so they never drift apart.
//
// Used by `PATCH /v1/profiles/me` to validate an incoming `theme_id`: an
// unknown id rejects the whole update so the stored value is retained (Req 3.7).

/**
 * The six Built_In_Theme_Set ids, in the same stable order as the RN registry's
 * `BUILT_IN_THEME_LIST`.
 */
export const KNOWN_THEME_IDS = [
  'default-dark',
  'spring',
  'summer-beach',
  'autumn',
  'winter',
  'purple-pixel',
] as const;

export type KnownThemeId = (typeof KNOWN_THEME_IDS)[number];

/** O(1) membership set built from the ordered list. */
const KNOWN_THEME_ID_SET: ReadonlySet<string> = new Set(KNOWN_THEME_IDS);

/**
 * Pure predicate: true only when `value` is a string matching one of the six
 * known Theme_Ids. Any other input (non-string, empty, unknown id) is false.
 */
export function validateThemeId(value: unknown): boolean {
  return typeof value === 'string' && KNOWN_THEME_ID_SET.has(value);
}
