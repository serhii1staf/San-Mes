// Public moderation API.
//
// Three validators with different strictness:
//   - validateName  : strictest, blocks every category. Used on usernames /
//                     display names where the surface is permanent and public.
//   - validateBio   : strict, blocks every category. Bios show on every post.
//   - validatePost  : soft, blocks ONLY the zero-tolerance categories
//                     (csam + extremeViolence). Slurs / explicit sexual are
//                     surfaced as a warning category so the UI can show a
//                     toast without preventing the post.
//
// Every check runs the same normalization pipeline so obfuscation tricks
// (Cyrillic confusables, leet, repeated letters, zero-width inserts) are
// defeated before any string compare.

import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity';
import { normalize } from './normalize';
import { blocklist, matchesCategory, matchesCategoryCompact } from './blocklist';

// Single shared matcher built once on first import. Matcher construction is
// non-trivial, but checks themselves are cheap.
let cachedMatcher: RegExpMatcher | null = null;
function getMatcher(): RegExpMatcher {
  if (!cachedMatcher) {
    cachedMatcher = new RegExpMatcher({
      ...englishDataset.build(),
      ...englishRecommendedTransformers,
    });
  }
  return cachedMatcher;
}

export type ModerationCategory =
  | 'csam'
  | 'extremeViolence'
  | 'slurs'
  | 'explicitSexual'
  | 'profanity';

export interface ValidationResult {
  ok: boolean;
  /** Set when ok=false — the category that triggered the block. */
  category?: ModerationCategory;
  /** i18n key the UI should render. */
  reasonKey?: string;
}

const REASON_KEYS: Record<ModerationCategory, string> = {
  csam: 'moderation.reason.csam',
  extremeViolence: 'moderation.reason.violence',
  slurs: 'moderation.reason.slurs',
  explicitSexual: 'moderation.reason.sexual',
  profanity: 'moderation.reason.profanity',
};

// Detect the worst category present in the (already-normalized) text.
// Returns null when nothing matches. Order is severity-descending so the
// first hit is the worst.
function detectWorstCategory(
  loose: string,
  tight: string,
  compactLoose: string,
  compactTight: string,
): ModerationCategory | null {
  // Each category's substring/regex list is scanned against four normalized
  // forms — multi-word entries (e.g. "kill all jews") match the spaced text,
  // single-token forms ("nigger") match in compact (no-space) text where
  // the user typed them as a single run. Both loose+tight collapsed forms
  // are checked so doubled letters in entries (e.g. "kill") still hit.
  const all = (list: (string | RegExp)[]) =>
    matchesCategory(loose, list) ||
    matchesCategory(tight, list) ||
    matchesCategoryCompact(compactLoose, list) ||
    matchesCategoryCompact(compactTight, list);
  if (all(blocklist.csam)) return 'csam';
  if (all(blocklist.extremeViolence)) return 'extremeViolence';
  if (all(blocklist.slurs)) return 'slurs';
  if (all(blocklist.explicitSexual)) return 'explicitSexual';
  // obscenity matches against the loose-normalized text — that's enough
  // because its built-in transformers already handle leet / repeats. We pass
  // the loose form (which still keeps doubled letters like "book") so we
  // don't double-fold and produce false positives.
  try {
    if (getMatcher().hasMatch(loose)) return 'profanity';
  } catch {
    // matcher init failed — silently fall through; custom blocklist still ran
  }
  return null;
}

function buildReject(category: ModerationCategory): ValidationResult {
  return { ok: false, category, reasonKey: REASON_KEYS[category] };
}

/**
 * Strict validator for usernames + display names. Empty input is OK (the form
 * is responsible for required-field handling, not moderation).
 */
export function validateName(text: string): ValidationResult {
  if (!text || !text.trim()) return { ok: true };
  const { loose, tight, compactLoose, compactTight } = normalize(text);
  const cat = detectWorstCategory(loose, tight, compactLoose, compactTight);
  if (!cat) return { ok: true };
  return buildReject(cat);
}

/** Strict validator for profile bios. */
export function validateBio(text: string): ValidationResult {
  if (!text || !text.trim()) return { ok: true };
  const { loose, tight, compactLoose, compactTight } = normalize(text);
  const cat = detectWorstCategory(loose, tight, compactLoose, compactTight);
  if (!cat) return { ok: true };
  return buildReject(cat);
}

/**
 * Soft validator for posts. Only the zero-tolerance categories (csam,
 * extremeViolence) actually block. Other categories return ok=true with a
 * `category` set so the caller can surface a one-time toast warning.
 */
export function validatePost(text: string): ValidationResult & {
  /** True when the text is allowed but contains a category worth warning about. */
  warn?: boolean;
} {
  if (!text || !text.trim()) return { ok: true };
  const { loose, tight, compactLoose, compactTight } = normalize(text);
  const cat = detectWorstCategory(loose, tight, compactLoose, compactTight);
  if (!cat) return { ok: true };
  if (cat === 'csam' || cat === 'extremeViolence') return buildReject(cat);
  // Soft path — return ok=true but include the category so the UI can warn.
  return { ok: true, warn: true, category: cat, reasonKey: REASON_KEYS[cat] };
}

// Re-export low-level helpers so unit tests / debug screens can poke at the
// pipeline without importing from a deep path.
export { normalize } from './normalize';
export { blocklist } from './blocklist';
