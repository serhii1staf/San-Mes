// Text normalization for moderation matching.
//
// The goal: defeat common obfuscation tricks (mixed case, leet, Cyrillic↔Latin
// confusables, repeated chars, zero-width inserts) so a single dictionary of
// canonical lowercase Latin tokens covers every realistic variant.
//
// We intentionally produce TWO normalized forms — the runs-of-2 version
// preserves natural words like "book" / "free" while still folding extreme
// stretching ("fuuuuck"→"fuuck"), and the runs-of-1 version collapses every
// repeat ("fuuuuck"→"fuck") so a literal blocklist entry "fuck" still hits.
// First-match-wins across both is enough to cover the common cases without
// blocking benign English.

// Cyrillic letters that are visually identical to Latin in lowercase, mapped
// to their Latin lookalikes. Includes uppercase forms — they get lowercased
// later so the table just needs the visual confusables. Picked deliberately
// narrow: ONLY characters whose lowercase glyph is genuinely indistinguishable
// from a Latin glyph in common fonts. We don't fold Cyrillic letters that
// merely share a sound (е↔ye is intentional; и↔i is NOT, because their
// glyphs are distinct).
const CYRILLIC_TO_LATIN: Record<string, string> = {
  'а': 'a', 'А': 'a',
  'е': 'e', 'Е': 'e',
  'о': 'o', 'О': 'o',
  'р': 'p', 'Р': 'p',
  'с': 'c', 'С': 'c',
  'у': 'y', 'У': 'y',
  'х': 'x', 'Х': 'x',
  'т': 't', 'Т': 't',
  'к': 'k', 'К': 'k',
  'в': 'b', 'В': 'b',
  'н': 'h', 'Н': 'h',
  'м': 'm', 'М': 'm',
  // Lowercase-only Cyrillic glyphs that look like a different Latin letter
  // depending on font. These are deliberately conservative — we'd rather miss
  // a clever bypass than fold a normal Russian word into something else.
  'і': 'i', 'І': 'i', // Ukrainian / Belarusian i
  'ј': 'j', 'Ј': 'j',
  'ѕ': 's', 'Ѕ': 's',
};

// Leet → Latin. Applied AFTER lowercasing so we only need lowercase keys.
const LEET_TO_LATIN: Record<string, string> = {
  '4': 'a', '@': 'a',
  '3': 'e',
  '1': 'i', '!': 'i',
  '0': 'o',
  '5': 's', '$': 's',
  '7': 't',
};

// Regex matching every Unicode combining mark (\p{Mn}) — diacritics, accents,
// zalgo. JS supports \p{...} when the regex is built with the `u` flag.
const COMBINING_MARKS_RE = /\p{Mn}/gu;
// Zero-width characters: ZWSP, ZWNJ, ZWJ, BOM. Used to split visible text
// into pieces a substring scan would miss.
// eslint-disable-next-line no-misleading-character-class
const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\uFEFF]/g;

function mapChars(s: string, table: Record<string, string>): string {
  let out = '';
  for (const ch of s) {
    out += table[ch] ?? ch;
  }
  return out;
}

// Collapse any run of the same character down to at most `maxRun` occurrences.
function collapseRuns(s: string, maxRun: 1 | 2): string {
  let out = '';
  let prev = '';
  let count = 0;
  for (const ch of s) {
    if (ch === prev) {
      count += 1;
      if (count <= maxRun) out += ch;
    } else {
      prev = ch;
      count = 1;
      out += ch;
    }
  }
  return out;
}

export interface NormalizedText {
  /** Runs collapsed to max 2 — preserves natural words. */
  loose: string;
  /** Runs collapsed to max 1 — most aggressive form, used for obfuscation hits. */
  tight: string;
  /** loose with all whitespace removed — catches multi-word entries typed as one run. */
  compactLoose: string;
  /** tight with all whitespace removed — catches multi-word entries with extreme stretching. */
  compactTight: string;
}

/**
 * Normalize text for moderation matching. Always returns BOTH forms so a
 * caller can decide which to scan.
 *
 * Steps (in order):
 *   1. NFKC unicode normalize (e.g. ⁄→/, ﬁ→fi, fullwidth→ASCII).
 *   2. Strip combining marks (\p{Mn}) and zero-width characters.
 *   3. Map Cyrillic confusables (а→a, е→e, …) — case insensitive.
 *   4. Lowercase.
 *   5. Map leet (4→a, $→s, …).
 *   6. Produce four forms (loose, tight, compactLoose, compactTight).
 */
export function normalize(text: string): NormalizedText {
  if (!text) return { loose: '', tight: '', compactLoose: '', compactTight: '' };

  // 1. Unicode normalize. NFKC merges compatibility variants too (so 𝐟 / ｆ
  //    fold to ASCII f).
  let s = text.normalize('NFKC');

  // 2. Strip combining marks + zero-widths.
  s = s.replace(COMBINING_MARKS_RE, '').replace(ZERO_WIDTH_RE, '');

  // 3. Cyrillic → Latin (handles uppercase too; lowercase pass below would
  //    miss e.g. А [Cyrillic] → a if we only mapped lowercase).
  s = mapChars(s, CYRILLIC_TO_LATIN);

  // 4. Lowercase.
  s = s.toLowerCase();

  // 5. Leet → letter.
  s = mapChars(s, LEET_TO_LATIN);

  // 6. Four collapse forms.
  const loose = collapseRuns(s, 2);
  const tight = collapseRuns(s, 1);
  const compactLoose = loose.replace(/\s+/g, '');
  const compactTight = tight.replace(/\s+/g, '');
  return { loose, tight, compactLoose, compactTight };
}
