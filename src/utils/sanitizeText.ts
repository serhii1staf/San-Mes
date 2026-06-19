// ─── User-text sanitizer ────────────────────────────────────────────────
//
// Goal (per product decision): ALLOW decorative Unicode — stylish "fonts"
// from the Mathematical Alphanumeric block (𝕬𝖇𝖈 / 𝐀𝐁𝐂 / 🅐🅑🅒), accented
// letters, non-Latin scripts and emoji — while STRIPPING the invisible /
// control characters that are only ever used to break layout, spoof
// identities, or smuggle hidden text.
//
// Why this matters (security):
//   • Bidi overrides (U+202A–202E, U+2066–2069, LRM/RLM) enable "Trojan
//     Source" / RTL spoofing where a name renders differently than it is
//     stored — classic impersonation vector.
//   • Zero-width chars (U+200B, U+2060, U+FEFF, soft hyphen) let two
//     visually identical usernames differ byte-for-byte, and can pad text
//     to dodge moderation or break our `numberOfLines` clamps.
//   • Unicode TAG characters (U+E0000–E007F) are fully invisible and are the
//     modern way to hide a payload inside otherwise-clean text.
//   • C0/C1 control chars and DEL have no business in display text.
//   • "Zalgo" — long runs of stacked combining marks — visually overflows
//     rows and tanks text-layout perf on weak devices. We cap the run
//     length rather than removing accents outright (normal diacritics stay).
//
// What we deliberately KEEP so decoration still works:
//   • Zero-Width Joiner (U+200D) and Variation Selectors (U+FE0E/U+FE0F):
//     required for multi-codepoint emoji (👨‍👩‍👧, ❤️). Removing them would
//     corrupt legitimate emoji.
//   • Zero-Width Non-Joiner (U+200C): needed by Persian/Indic scripts.
//   • Everything in the printable/Mathematical-Alphanumeric ranges.
//
// Implementation is a small set of precompiled regexes + one linear pass for
// the Zalgo cap — cheap enough to run on every keystroke-debounced save with
// no measurable cost on weak Android.

// Invisible / formatting characters that carry no legitimate display intent
// in our app. NOTE: U+200D (ZWJ), U+200C (ZWNJ), U+FE0E/FE0F (variation
// selectors) are intentionally absent — they are required for emoji/scripts.
const INVISIBLE_RE =
  /[\u00AD\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B\u200E\u200F\u2028\u2029\u202A\u202B\u202C\u202D\u202E\u2060\u2061\u2062\u2063\u2064\u2066\u2067\u2068\u2069\u206A\u206B\u206C\u206D\u206E\u206F\u3164\uFEFF\uFFA0]/g;

// C0 control chars (except TAB \u0009, LF \u000A, CR \u000D) + C1 controls + DEL.
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

// Unicode TAG block (U+E0000–U+E007F) — invisible text smuggling.
const TAG_RE = /[\u{E0000}-\u{E007F}]/gu;

// Combining marks (Mn/Me) — used for accents AND for "Zalgo" stacking.
const COMBINING_RE = /[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/;

// Max combining marks allowed in a row before we treat it as Zalgo abuse.
const MAX_COMBINING_RUN = 3;

/**
 * Collapse runs of combining marks longer than MAX_COMBINING_RUN. Keeps
 * normal accented text (é, ñ, ü, Arabic harakat) intact while neutralising
 * Zalgo stacks that overflow rows.
 */
function capCombiningRuns(input: string): string {
  let out = '';
  let run = 0;
  for (const ch of input) {
    if (COMBINING_RE.test(ch)) {
      run += 1;
      if (run <= MAX_COMBINING_RUN) out += ch;
      // else: drop the excess mark
    } else {
      run = 0;
      out += ch;
    }
  }
  return out;
}

export interface SanitizeOptions {
  // Collapse all internal whitespace runs to single spaces and trim. Use for
  // single-line fields (username, display name, tab labels). Default false.
  singleLine?: boolean;
  // Hard cap on output length (after sanitising). Optional.
  maxLength?: number;
}

/**
 * Sanitize arbitrary user-entered text. Removes dangerous invisible/control
 * characters and caps Zalgo, while preserving decorative Unicode and emoji.
 * Safe to call on every save — returns '' for nullish input.
 */
export function sanitizeUserText(input: string | null | undefined, opts: SanitizeOptions = {}): string {
  if (!input) return '';
  let s = String(input);

  s = s.replace(TAG_RE, '');
  s = s.replace(INVISIBLE_RE, '');
  s = s.replace(CONTROL_RE, '');
  s = capCombiningRuns(s);

  if (opts.singleLine) {
    // Newlines/tabs become spaces, runs collapse, then trim.
    s = s.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  } else {
    // Multi-line: keep newlines but drop trailing space on each line and
    // collapse 3+ blank lines to 2.
    s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  if (opts.maxLength && s.length > opts.maxLength) {
    s = s.slice(0, opts.maxLength);
  }
  return s;
}

/**
 * True if the text contains characters we would strip — useful for showing a
 * "we cleaned up hidden characters" hint, or for moderation flags.
 */
export function hasUnsafeChars(input: string | null | undefined): boolean {
  if (!input) return false;
  const s = String(input);
  // Global regexes keep `lastIndex` between `.test()` calls — reset first.
  INVISIBLE_RE.lastIndex = 0;
  CONTROL_RE.lastIndex = 0;
  TAG_RE.lastIndex = 0;
  return INVISIBLE_RE.test(s) || CONTROL_RE.test(s) || TAG_RE.test(s);
}
