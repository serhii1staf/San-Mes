// Custom blocklist used in addition to obscenity's English preset.
//
// Entries are compared against the NORMALIZED text (see normalize.ts), so
// every entry below MUST already be lowercase Latin with leet expanded —
// "ниггер" should be entered as "nigger" (the Cyrillic input gets confusable-
// folded to Latin first), "5h1t" as "shit", and so on.
//
// Categories follow severity tiers used by the public API:
//   - csam              : zero-tolerance, blocks every surface
//   - extremeViolence   : blocks every surface
//   - slurs             : blocks register / profile, soft-warns posts
//   - explicitSexual    : blocks register / profile, soft-warns posts
//
// We deliberately do NOT include broad political or religious vocabulary —
// the user explicitly called it out as too noisy. The list is meant to catch
// hate speech, sexual abuse, and explicit incitement to violence, NOT
// political or ideological speech.

// Russian / English / Ukrainian transliterations are in the same array per
// category. After normalization the language barrier disappears (Cyrillic
// confusables fold to Latin, leet expands), so a single Latin token covers
// every script the user typed it in.

export interface Blocklist {
  /** Child sexual abuse material — zero tolerance. RegExp allowed for stems. */
  csam: (string | RegExp)[];
  /** Extreme violence / direct incitement to harm. */
  extremeViolence: string[];
  /** Slurs targeting people for who they are. */
  slurs: string[];
  /** Graphic sexual content not safe for a public timeline. */
  explicitSexual: string[];
  /** Common profanity / strong swears. Soft category — warns on posts only. */
  profanity: string[];
}

// CSAM keyword stems. RegExp form catches common compound forms without
// listing every variant manually. Substrings are matched case-insensitively
// against the normalized text. Entries here are intentionally narrow stems
// describing the abuse, NOT generic adult terms.
const csam: (string | RegExp)[] = [
  'cp pic', 'cp pics', 'child porn', 'childporn', 'kiddie porn', 'kiddieporn',
  'kid porn', 'kidporn', 'preteen porn', 'pre teen porn', 'pre-teen porn',
  'lolicon', 'shotacon', 'jailbait', 'jail bait',
  'pedoporn', 'pedo porn', 'pedo pic', 'pedo pics', 'pedophilia',
  'underage porn', 'underage nude', 'underage nudes',
  'minor porn', 'minor nude', 'minor nudes',
  'cub porn', 'kiddy porn',
  'детское порно', // Cyrillic gets folded to Latin in normalize, so we add the
  // already-folded version below. The original Cyrillic is kept here for
  // search/grep in code review only — it is never matched directly.
  // Ukrainian variant follows the same approach.
  /\bp[e3]d[o0]ph[i1]l/i,
  /\bped[o0]ph[i1]le/i,
  // Folded forms (post-confusable, post-leet). These are what actually match.
  'detskoe porno', 'detskaya porno', 'detskaja porno',
  'malolet porn', 'malolet nude',
  'dityache porno', 'dytyache porno',
];

// Direct incitement to extreme violence or terrorism. Politics / war debate
// stays OUT — only the most direct calls. We match on the action verb +
// target patterns the user is most likely typing in anger.
const extremeViolence: string[] = [
  'kill yourself', 'kys',
  'kill all jews', 'gas the jews', 'gas all jews',
  'kill all muslims', 'kill all christians', 'kill all whites', 'kill all blacks',
  'kill all gays', 'kill all trans',
  'i will kill you', 'imma kill you', 'im gonna kill you',
  'i will rape you', 'imma rape you', 'im gonna rape you',
  'school shooting', 'school shoot', 'shoot up the school', 'shoot up school',
  'mass shooting', 'mass murder',
  'how to make bomb', 'how to build bomb', 'pipe bomb recipe',
  'die in fire', 'burn in fire',
  'lynch', 'lynching',
  'genocide of', 'ethnic cleansing',
  // Russian
  'ubey sebya', 'ubej sebya',
  'sdohni', 'sdokhni',
  'ya tebya ubyu', 'ya ubyu tebya',
  'ya tebya iznasiluyu',
  'massovyy rasstrel', 'massovyj rasstrel',
  'kak sdelat bombu', 'kak sobrat bombu',
  // Ukrainian
  'vbyvai sebe', 'vbyvaj sebe',
  'zdyhny', 'zdokhny',
  'ya tebe vbyu', 'ya tebe znevazhu',
  'masove vbyvstvo',
];

// Slurs (English + Russian + Ukrainian + common transliterations). Keep this
// to the slurs themselves; the surrounding context (e.g. quoting a slur in
// a discussion) is necessarily caught here too — that's an accepted false
// positive on profile / register but only a soft warning on posts.
const slurs: string[] = [
  // Anti-Black
  'nigger', 'niggers', 'nigga', 'niggas', 'niggr', 'niglet', 'porchmonkey',
  'porch monkey', 'jungle bunny',
  // Anti-Asian
  'chink', 'chinks', 'gook', 'gooks', 'jap', 'japs', 'slant eye', 'slanteye',
  // Anti-Latino
  'spic', 'spics', 'wetback', 'wetbacks', 'beaner', 'beaners',
  // Anti-Arab / Muslim
  'sandnigger', 'sand nigger', 'towelhead', 'towel head', 'raghead', 'rag head',
  'camel jockey', 'cameljockey', 'mudslime',
  // Anti-Jewish
  'kike', 'kikes', 'heeb', 'heebs', 'yid', 'yids', 'zhid',
  // Anti-LGBTQ
  'faggot', 'faggots', 'fag', 'fags', 'tranny', 'trannies', 'shemale', 'shemales',
  'dyke', 'dykes', 'pedohomo',
  // Anti-disabled
  'retard', 'retards', 'retarded', 'mongoloid', 'spastic', 'spaz',
  // Russian (already in folded Latin form)
  'pidor', 'pidoras', 'pidorasy', 'pidorashka', 'pederast',
  'zhopolyz', 'zhid', 'zhidy', 'zhidovka',
  'churka', 'churki', 'khach', 'khachi', 'hachi',
  'negr porno', 'negritos',
  'tsygan', 'tsyganshchina',
  'daun', 'daunyo', 'olygofren', 'oligofren',
  'pedik', 'pediki', 'gomik', 'gomiki',
  // Ukrainian transliterations
  'moskal', 'moskali', 'kacap', 'katsap', 'katsapy',
  'zhydovka',
];

// Graphic sexual content — the kind that doesn't belong on a username, profile
// bio, or public post. Soft-warn on posts (the user might be in NSFW context),
// hard-block on register / profile.
const explicitSexual: string[] = [
  // English
  'porn', 'porno', 'pornhub', 'xvideos', 'xnxx', 'redtube',
  'cum on', 'cumshot', 'creampie', 'gangbang', 'bukkake',
  'blowjob', 'blow job', 'handjob', 'hand job', 'rimjob', 'rim job',
  'deepthroat', 'deep throat', 'facefuck', 'face fuck',
  'anal sex', 'anal porn', 'anal fuck',
  'incest porn', 'rape porn', 'forced sex',
  'milf porn', 'teen porn', 'amateur porn',
  'sexcam', 'sex cam', 'cam girl', 'camgirl',
  'escort service', 'sell my body', 'onlyfans porn',
  'dick pic', 'dickpic', 'send nudes', 'sendnudes',
  // Russian (folded)
  'porno', 'pornushka', 'pornuxa', 'pornucha',
  'minet', 'minjet', 'otsosi', 'otcosi', 'soset huy', 'sosi huy',
  'iznasilovanie', 'iznasilovat',
  'goluyu trah', 'trahnu tebya', 'trahay menya',
  'shluha', 'shlyukha', 'prostitutka', 'prosti tutka',
  'analnyy seks', 'analnyj seks',
  'orgazm video', 'porno video', 'porno foto',
  'sosi clen', 'sosi xuy',
  // Ukrainian (folded)
  'porno video', 'porno foto', 'shliukha', 'shliuxa',
  'znasiluvannia', 'znasiluvaty', 'mynet',
];

// Common English / Russian / Ukrainian profanity. Soft category — used only
// to soft-warn on post composition, hard-block on register / profile.
//
// The list replaces what `obscenity`'s English preset used to provide. We
// keep it minimal but comprehensive enough for the most common swears that
// don't belong in a username / display name. Entries are normalized form.
const profanity: string[] = [
  // English — strong swears
  'fuck', 'fucker', 'fucking', 'motherfucker', 'fuckface', 'fuckwit',
  'fucked up', 'shitfuck', 'clusterfuck',
  'shit', 'shithead', 'shitter', 'bullshit', 'horseshit', 'shitshow',
  'asshole', 'assholes', 'asshat',
  'bitch', 'bitches', 'bitching', 'son of a bitch', 'sob',
  'bastard', 'bastards',
  'cunt', 'cunts',
  'cock', 'cocks', 'cocksucker', 'dickhead', 'dickheads',
  'pussy ass', 'pissoff', 'piss off',
  'twat', 'wanker', 'wankers', 'wank',
  'douche', 'douchebag', 'douche bag',
  // Russian (already in folded Latin form — see normalize.ts confusable map)
  'huy', 'huya', 'huyu', 'huyov', 'pohuy', 'nahuy', 'nahyu', 'pizdec',
  'pizda', 'pizde', 'pizdy', 'pizduy',
  'blyad', 'blyat', 'blya', 'blyadi', 'blyadina',
  'ebat', 'ebal', 'ebalo', 'ebanyy', 'ebanaya', 'ebanutyy',
  'ebanyj', 'ebanaja', 'ebanutyj',
  'ebis', 'ebisya', 'idi nahuy', 'idi v pizdu',
  'mudak', 'mudilo', 'mudaki',
  'suka', 'sukin syn', 'sukin', 'suki blya',
  'govno', 'govnyuk', 'govnyukov',
  'zalupa', 'zalupy',
  'manda', 'mandavoshka',
  // Ukrainian (folded Latin)
  'huyovyj', 'huyovo', 'pizdeczzz',
  'eb tvoyu mat', 'yob tvoyu mat',
  'sraka', 'srav', 'srany',
  'kurva', 'kurvy',
];

export const blocklist: Blocklist = {
  csam,
  extremeViolence,
  slurs,
  explicitSexual,
  profanity,
};

/** Test whether a normalized text contains any entry from a category list. */
export function matchesCategory(normalized: string, list: (string | RegExp)[]): boolean {
  if (!normalized) return false;
  for (const entry of list) {
    if (typeof entry === 'string') {
      if (entry && normalized.includes(entry)) return true;
    } else {
      if (entry.test(normalized)) return true;
    }
  }
  return false;
}

/**
 * Like matchesCategory, but compares against the no-whitespace form of each
 * entry too. Lets a multi-word blocklist entry "kill all jews" still match a
 * compact-normalized input "killalljews". RegExp entries are tested as-is —
 * authors can already write \s* in their patterns if they need it.
 */
export function matchesCategoryCompact(compact: string, list: (string | RegExp)[]): boolean {
  if (!compact) return false;
  for (const entry of list) {
    if (typeof entry === 'string') {
      const stripped = entry.replace(/\s+/g, '');
      if (stripped && compact.includes(stripped)) return true;
    } else {
      if (entry.test(compact)) return true;
    }
  }
  return false;
}
