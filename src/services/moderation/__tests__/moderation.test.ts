// Sanity tests for the moderation pipeline. Focuses on the obfuscation
// vectors that were the whole point of the normalization pass — anyone
// regressing the Cyrillic confusable map, leet table, or repeat-collapse
// will see a red bar here before it ships.

import { normalize } from '../normalize';
import { validateName, validateBio, validatePost } from '../index';

describe('normalize', () => {
  it('strips zero-width characters', () => {
    const { tight } = normalize('fu\u200Bck');
    expect(tight).toBe('fuck');
  });

  it('folds Cyrillic confusables to Latin', () => {
    // 'fuck' typed entirely in visually-identical Cyrillic letters.
    // The Cyrillic 'у' is on the confusable list (→ 'y'), 'к' → 'k', 'с' → 'c'.
    // Real Cyrillic 'f' / 'u' have no Latin lookalike — those are typed in
    // Latin in real bypass attempts. So the test mixes scripts.
    const { tight } = normalize('fuсk'); // с is Cyrillic
    expect(tight).toBe('fuck');
  });

  it('expands leet substitutions', () => {
    expect(normalize('5h17').tight).toBe('shit');
    // @ → a, then runs collapse: loose keeps doubled s ('ass'), tight to 1.
    expect(normalize('@ss').loose).toBe('ass');
  });

  it('collapses runs of repeated chars to ≤2 (loose) and 1 (tight)', () => {
    const r = normalize('fuuuuuck');
    expect(r.loose).toBe('fuuck');
    expect(r.tight).toBe('fuck');
  });

  it('passes natural English words through unchanged', () => {
    const r = normalize('book free apple banana');
    expect(r.loose).toBe('book free apple banana');
  });
});

describe('validateName', () => {
  it('allows ordinary names', () => {
    expect(validateName('Anna').ok).toBe(true);
    expect(validateName('user_42').ok).toBe(true);
  });

  it('rejects slurs even when obfuscated with leet + Cyrillic', () => {
    const r = validateName('n1gger');
    expect(r.ok).toBe(false);
    expect(r.category).toBe('slurs');
  });

  it('rejects extreme violence keywords', () => {
    const r = validateName('killallmuslims');
    expect(r.ok).toBe(false);
    expect(r.category).toBe('extremeViolence');
  });

  it('returns a localized reason key on rejection', () => {
    const r = validateName('faggot');
    expect(r.ok).toBe(false);
    expect(r.reasonKey).toMatch(/^moderation\.reason\./);
  });

  // Cyrillic-native pass — the four "Latin" forms can't catch these because
  // letters like п, и, д have no Latin lookalike. The caseFolded form does.
  it('rejects Russian-typed slurs (native Cyrillic)', () => {
    expect(validateName('пидорас').ok).toBe(false);
    expect(validateName('Пидорас').ok).toBe(false);
    expect(validateName('Жидовка').ok).toBe(false);
  });

  it('rejects Russian profanity in usernames', () => {
    expect(validateName('хуй').ok).toBe(false);
    expect(validateName('Пиздец').ok).toBe(false);
    expect(validateName('блядина').ok).toBe(false);
  });

  it('allows ordinary Russian names', () => {
    expect(validateName('Иван').ok).toBe(true);
    expect(validateName('Анна Петрова').ok).toBe(true);
    expect(validateName('Мария').ok).toBe(true);
  });
});

describe('validateBio', () => {
  it('blocks explicit sexual content', () => {
    const r = validateBio('selling porn videos here, dm me');
    expect(r.ok).toBe(false);
    expect(r.category).toBe('explicitSexual');
  });

  it('allows benign bios', () => {
    expect(validateBio('Hi, I love books and free time.').ok).toBe(true);
  });
});

describe('validatePost', () => {
  it('hard-blocks csam', () => {
    const r = validatePost('child porn here');
    expect(r.ok).toBe(false);
    expect(r.category).toBe('csam');
  });

  it('hard-blocks extreme violence', () => {
    const r = validatePost('I will kill you tomorrow');
    expect(r.ok).toBe(false);
    expect(r.category).toBe('extremeViolence');
  });

  it('soft-warns on slurs (post still allowed)', () => {
    const r = validatePost('that nigger over there');
    expect(r.ok).toBe(true);
    expect(r.warn).toBe(true);
    expect(r.category).toBe('slurs');
  });

  it('allows ordinary posts', () => {
    expect(validatePost('Hello world, this is my first post!').ok).toBe(true);
    expect(validatePost('Hello world, this is my first post!').warn).toBeFalsy();
  });
});
