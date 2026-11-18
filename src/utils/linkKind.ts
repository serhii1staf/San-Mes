/**
 * What service a profile link points at, decided from the link's HOST.
 *
 * ── WHY THE HOST, AND NOT "DOES THE TEXT CONTAIN x.com" ─────────────────────
 *
 * Detection used to be `url.includes('x.com')` and friends. Reported: a Roblox link showed up as
 * Twitter. `roblox.com` contains `x.com`. So does `dropbox.com`, `netflix.com`, `xbox.com` — any
 * domain ending in "x". Substrings anywhere in the URL are worse still: a path or a query parameter
 * can name another site.
 *
 * The rule is now exact: take the host, and a kind matches when the host IS one of its domains or a
 * subdomain of one (`host === d || host.endsWith('.' + d)`). `roblox.com` is not `x.com` and does
 * not end in `.x.com`, so it can no longer be mistaken for it.
 *
 * Parsed by hand rather than with `URL`: React Native's `URL` does not implement `hostname`.
 *
 * ── TRADEMARKS ───────────────────────────────────────────────────────────────
 *
 * Brand glyphs are FontAwesome 5 brand icons, used to label a link to that service. Apple's own
 * services (Apple Music, the App Store) are labelled descriptively but get a generic glyph, not the
 * Apple logo; Google Play and other app stores are treated as ordinary websites. See the
 * apple-compliance steering note (§3.3.6, and App Review 2.3.10).
 */

export type LinkKind =
  | 'github' | 'gitlab' | 'twitter' | 'threads' | 'instagram' | 'youtube' | 'telegram' | 'tiktok'
  | 'vk' | 'odnoklassniki' | 'discord' | 'twitch' | 'spotify' | 'soundcloud' | 'yandexmusic'
  | 'applemusic' | 'deezer' | 'bandcamp' | 'lastfm' | 'steam' | 'roblox' | 'playstation' | 'xbox'
  | 'epicgames' | 'battlenet' | 'itchio' | 'reddit' | 'facebook' | 'whatsapp' | 'snapchat'
  | 'pinterest' | 'linkedin' | 'behance' | 'dribbble' | 'artstation' | 'deviantart' | 'figma'
  | 'medium' | 'tumblr' | 'vimeo' | 'mastodon' | 'patreon' | 'boosty' | 'paypal' | 'stackoverflow'
  | 'email' | 'website';

export interface LinkKindInfo {
  /** Service name shown to the user. Empty for `website`, which shows the domain instead. */
  label: string;
  /** FontAwesome 5 glyph name. */
  icon: string;
  /** `true` for the FontAwesome brands set, `false` for the solid set. */
  brand: boolean;
  /** Tile colour behind the glyph (the service's own colour). */
  color: string;
  /** Glyph colour that reads on `color`. */
  on: string;
  /**
   * Colour for surfaces that need a colour with some life in it (the profile's gel drops). Services
   * whose own colour is black or white get one from the same family instead.
   */
  gel: string;
}

interface KindRule {
  kind: LinkKind;
  /** Registrable domains; a host matches a domain itself or any subdomain of it. */
  domains: string[];
  /** Brand names that match under ANY country domain (`pinterest.de`, `pinterest.co.uk`). */
  anyTld?: string[];
}

// Order matters only where one service's domain is a subdomain of another's rule: the more
// specific rule comes first (`music.yandex.ru` before nothing else claims `yandex.ru`; Apple Music
// is a subdomain rule, so the rest of apple.com stays a website).
const RULES: KindRule[] = [
  { kind: 'github', domains: ['github.com', 'github.io'] },
  { kind: 'gitlab', domains: ['gitlab.com'] },
  { kind: 'twitter', domains: ['twitter.com', 'x.com'] },
  { kind: 'threads', domains: ['threads.net', 'threads.com'] },
  { kind: 'instagram', domains: ['instagram.com', 'instagr.am'] },
  { kind: 'youtube', domains: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'] },
  { kind: 'telegram', domains: ['t.me', 'telegram.me', 'telegram.dog', 'telegram.org', 'telesco.pe'] },
  { kind: 'tiktok', domains: ['tiktok.com'] },
  { kind: 'vk', domains: ['vk.com', 'vk.ru', 'vk.me', 'vkvideo.ru', 'vk.cc'] },
  { kind: 'odnoklassniki', domains: ['ok.ru'] },
  { kind: 'discord', domains: ['discord.gg', 'discord.com', 'discordapp.com', 'discord.me'] },
  { kind: 'twitch', domains: ['twitch.tv'] },
  { kind: 'spotify', domains: ['spotify.com', 'spotify.link'] },
  { kind: 'soundcloud', domains: ['soundcloud.com', 'snd.sc'] },
  { kind: 'yandexmusic', domains: ['music.yandex.ru', 'music.yandex.com', 'music.yandex.by', 'music.yandex.kz'] },
  { kind: 'applemusic', domains: ['music.apple.com'] },
  { kind: 'deezer', domains: ['deezer.com', 'deezer.page.link'] },
  { kind: 'bandcamp', domains: ['bandcamp.com'] },
  { kind: 'lastfm', domains: ['last.fm', 'lastfm.ru'] },
  { kind: 'steam', domains: ['steamcommunity.com', 'steampowered.com', 's.team'] },
  { kind: 'roblox', domains: ['roblox.com', 'ro.blox.com', 'rblx.co'] },
  { kind: 'playstation', domains: ['playstation.com'] },
  { kind: 'xbox', domains: ['xbox.com'] },
  { kind: 'epicgames', domains: ['epicgames.com'] },
  { kind: 'battlenet', domains: ['battle.net'] },
  { kind: 'itchio', domains: ['itch.io'] },
  { kind: 'reddit', domains: ['reddit.com', 'redd.it'] },
  { kind: 'facebook', domains: ['facebook.com', 'fb.com', 'fb.me', 'm.me'] },
  { kind: 'whatsapp', domains: ['whatsapp.com', 'wa.me'] },
  { kind: 'snapchat', domains: ['snapchat.com'] },
  { kind: 'pinterest', domains: ['pinterest.com', 'pin.it'], anyTld: ['pinterest'] },
  { kind: 'linkedin', domains: ['linkedin.com', 'lnkd.in'] },
  { kind: 'behance', domains: ['behance.net'] },
  { kind: 'dribbble', domains: ['dribbble.com'] },
  { kind: 'artstation', domains: ['artstation.com'] },
  { kind: 'deviantart', domains: ['deviantart.com'] },
  { kind: 'figma', domains: ['figma.com'] },
  { kind: 'medium', domains: ['medium.com'] },
  { kind: 'tumblr', domains: ['tumblr.com'] },
  { kind: 'vimeo', domains: ['vimeo.com'] },
  { kind: 'mastodon', domains: ['mastodon.social', 'mastodon.online', 'mstdn.social'] },
  { kind: 'patreon', domains: ['patreon.com'] },
  { kind: 'boosty', domains: ['boosty.to'] },
  { kind: 'paypal', domains: ['paypal.me', 'paypal.com'] },
  { kind: 'stackoverflow', domains: ['stackoverflow.com'] },
];

const INFO: Record<LinkKind, LinkKindInfo> = {
  github: { label: 'GitHub', icon: 'github', brand: true, color: '#24292F', on: '#FFFFFF', gel: '#8A63FF' },
  gitlab: { label: 'GitLab', icon: 'gitlab', brand: true, color: '#FC6D26', on: '#FFFFFF', gel: '#FC6D26' },
  twitter: { label: 'X (Twitter)', icon: 'twitter', brand: true, color: '#1D9BF0', on: '#FFFFFF', gel: '#1DA1F2' },
  threads: { label: 'Threads', icon: 'at', brand: false, color: '#101010', on: '#FFFFFF', gel: '#7C7C8A' },
  instagram: { label: 'Instagram', icon: 'instagram', brand: true, color: '#E4405F', on: '#FFFFFF', gel: '#F2477F' },
  youtube: { label: 'YouTube', icon: 'youtube', brand: true, color: '#FF0000', on: '#FFFFFF', gel: '#FF4040' },
  telegram: { label: 'Telegram', icon: 'telegram-plane', brand: true, color: '#2AABEE', on: '#FFFFFF', gel: '#2AABEE' },
  tiktok: { label: 'TikTok', icon: 'tiktok', brand: true, color: '#010101', on: '#FFFFFF', gel: '#FF3D7F' },
  vk: { label: 'VK', icon: 'vk', brand: true, color: '#0077FF', on: '#FFFFFF', gel: '#2787F5' },
  odnoklassniki: { label: 'Одноклассники', icon: 'odnoklassniki', brand: true, color: '#EE8208', on: '#FFFFFF', gel: '#F7931E' },
  discord: { label: 'Discord', icon: 'discord', brand: true, color: '#5865F2', on: '#FFFFFF', gel: '#6F7BFF' },
  twitch: { label: 'Twitch', icon: 'twitch', brand: true, color: '#9146FF', on: '#FFFFFF', gel: '#A970FF' },
  spotify: { label: 'Spotify', icon: 'spotify', brand: true, color: '#1DB954', on: '#FFFFFF', gel: '#1ED760' },
  soundcloud: { label: 'SoundCloud', icon: 'soundcloud', brand: true, color: '#FF5500', on: '#FFFFFF', gel: '#FF6A1A' },
  yandexmusic: { label: 'Яндекс Музыка', icon: 'yandex', brand: true, color: '#FFCC00', on: '#1C1C1E', gel: '#FFC21A' },
  applemusic: { label: 'Apple Music', icon: 'music', brand: false, color: '#FA243C', on: '#FFFFFF', gel: '#FA3C55' },
  deezer: { label: 'Deezer', icon: 'deezer', brand: true, color: '#A238FF', on: '#FFFFFF', gel: '#A238FF' },
  bandcamp: { label: 'Bandcamp', icon: 'bandcamp', brand: true, color: '#1DA0C3', on: '#FFFFFF', gel: '#1DA0C3' },
  lastfm: { label: 'Last.fm', icon: 'lastfm', brand: true, color: '#D51007', on: '#FFFFFF', gel: '#E8332B' },
  steam: { label: 'Steam', icon: 'steam', brand: true, color: '#1B2838', on: '#FFFFFF', gel: '#4C7AA6' },
  roblox: { label: 'Roblox', icon: 'gamepad', brand: false, color: '#232527', on: '#FFFFFF', gel: '#E2231A' },
  playstation: { label: 'PlayStation', icon: 'playstation', brand: true, color: '#003791', on: '#FFFFFF', gel: '#2E6BD9' },
  xbox: { label: 'Xbox', icon: 'xbox', brand: true, color: '#107C10', on: '#FFFFFF', gel: '#2CA243' },
  epicgames: { label: 'Epic Games', icon: 'gamepad', brand: false, color: '#2F2D2E', on: '#FFFFFF', gel: '#7A7A85' },
  battlenet: { label: 'Battle.net', icon: 'battle-net', brand: true, color: '#148EFF', on: '#FFFFFF', gel: '#148EFF' },
  itchio: { label: 'itch.io', icon: 'itch-io', brand: true, color: '#FA5C5C', on: '#FFFFFF', gel: '#FA5C5C' },
  reddit: { label: 'Reddit', icon: 'reddit-alien', brand: true, color: '#FF4500', on: '#FFFFFF', gel: '#FF5A1F' },
  facebook: { label: 'Facebook', icon: 'facebook-f', brand: true, color: '#1877F2', on: '#FFFFFF', gel: '#3D8BFF' },
  whatsapp: { label: 'WhatsApp', icon: 'whatsapp', brand: true, color: '#25D366', on: '#FFFFFF', gel: '#2BD86E' },
  snapchat: { label: 'Snapchat', icon: 'snapchat-ghost', brand: true, color: '#FFFC00', on: '#1C1C1E', gel: '#FFE31A' },
  pinterest: { label: 'Pinterest', icon: 'pinterest-p', brand: true, color: '#E60023', on: '#FFFFFF', gel: '#F0303F' },
  linkedin: { label: 'LinkedIn', icon: 'linkedin-in', brand: true, color: '#0A66C2', on: '#FFFFFF', gel: '#3D8BFF' },
  behance: { label: 'Behance', icon: 'behance', brand: true, color: '#1769FF', on: '#FFFFFF', gel: '#3D7BFF' },
  dribbble: { label: 'Dribbble', icon: 'dribbble', brand: true, color: '#EA4C89', on: '#FFFFFF', gel: '#F05A96' },
  artstation: { label: 'ArtStation', icon: 'artstation', brand: true, color: '#13AFF0', on: '#FFFFFF', gel: '#13AFF0' },
  deviantart: { label: 'DeviantArt', icon: 'deviantart', brand: true, color: '#05CC47', on: '#FFFFFF', gel: '#18D35A' },
  figma: { label: 'Figma', icon: 'figma', brand: true, color: '#A259FF', on: '#FFFFFF', gel: '#A259FF' },
  medium: { label: 'Medium', icon: 'medium-m', brand: true, color: '#121212', on: '#FFFFFF', gel: '#6E6E7A' },
  tumblr: { label: 'Tumblr', icon: 'tumblr', brand: true, color: '#36465D', on: '#FFFFFF', gel: '#5A7396' },
  vimeo: { label: 'Vimeo', icon: 'vimeo-v', brand: true, color: '#1AB7EA', on: '#FFFFFF', gel: '#1AB7EA' },
  mastodon: { label: 'Mastodon', icon: 'mastodon', brand: true, color: '#6364FF', on: '#FFFFFF', gel: '#6364FF' },
  patreon: { label: 'Patreon', icon: 'patreon', brand: true, color: '#FF424D', on: '#FFFFFF', gel: '#FF424D' },
  boosty: { label: 'Boosty', icon: 'donate', brand: false, color: '#F15F2C', on: '#FFFFFF', gel: '#F2702F' },
  paypal: { label: 'PayPal', icon: 'paypal', brand: true, color: '#003087', on: '#FFFFFF', gel: '#2D6CDF' },
  stackoverflow: { label: 'Stack Overflow', icon: 'stack-overflow', brand: true, color: '#F48024', on: '#FFFFFF', gel: '#F48024' },
  email: { label: '', icon: 'envelope', brand: false, color: '#8E8E93', on: '#FFFFFF', gel: '#5AA7FF' },
  website: { label: '', icon: 'globe', brand: false, color: '#8E8E93', on: '#FFFFFF', gel: '#22C7B8' },
};

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const EMAIL = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;
// A host is labels separated by dots, at least two of them, none empty. Deliberately permissive about
// which characters a label may hold, so Cyrillic and other IDN domains pass (`пример.рф`).
const HOST = /^[^\s./?#:@]+(\.[^\s./?#:@]+)+$/;

/** The lower-cased host of `raw` with scheme, credentials, port and a leading `www.` removed. */
export function hostOf(raw: string): string | null {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  const scheme = s.match(/^[a-z][a-z0-9+.-]*:\/\//);
  if (scheme) s = s.slice(scheme[0].length);
  else if (s.startsWith('//')) s = s.slice(2);
  const end = s.search(/[/?#]/);
  let authority = end === -1 ? s : s.slice(0, end);
  const at = authority.lastIndexOf('@');
  if (at !== -1) authority = authority.slice(at + 1);
  authority = authority.replace(/:\d*$/, '').replace(/\.$/, '');
  if (authority.startsWith('www.')) authority = authority.slice(4);
  return HOST.test(authority) ? authority : null;
}

/**
 * The link as it should be stored and opened: `https://` added when no scheme was typed, an email
 * address turned into `mailto:`. Returns `null` for anything that is not an http(s) or mailto link —
 * a bare word, a handle, or a scheme like `javascript:` that has no business in a profile.
 */
export function normalizeLinkUrl(raw: string): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^mailto:/i.test(s)) {
    const addr = s.slice(7).split('?')[0];
    return EMAIL.test(addr) ? `mailto:${addr}` : null;
  }
  if (!SCHEME.test(s) && EMAIL.test(s)) return `mailto:${s}`;
  if (/^https?:\/\//i.test(s)) return hostOf(s) ? s : null;
  // `example.com:8080` reads as a scheme to the regex above, so only treat a colon as a scheme when
  // nothing in front of it could be a host.
  if (SCHEME.test(s) && !/^[^:/]+\.[^:/]+:\d/.test(s)) return null;
  const withScheme = `https://${s.replace(/^\/\//, '')}`;
  return hostOf(withScheme) ? withScheme : null;
}

function matchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function matchesAnyTld(host: string, name: string): boolean {
  // `name.<tld>` or `name.<sld>.<cc>` (pinterest.de, pinterest.co.uk), optionally under a subdomain.
  return new RegExp(`(^|\\.)${name}\\.[a-z]{2,3}(\\.[a-z]{2})?$`).test(host);
}

/** Which service `url` points at. Anything unrecognised is a `website`. */
export function detectLinkKind(url: string): LinkKind {
  const s = String(url || '').trim();
  if (/^mailto:/i.test(s) || (!SCHEME.test(s) && EMAIL.test(s))) return 'email';
  const host = hostOf(s);
  if (!host) return 'website';
  for (const rule of RULES) {
    if (rule.domains.some((d) => matchesDomain(host, d))) return rule.kind;
    if (rule.anyTld && rule.anyTld.some((n) => matchesAnyTld(host, n))) return rule.kind;
  }
  return 'website';
}

export function linkKindInfo(kind: string | undefined | null): LinkKindInfo {
  return (kind && (INFO as Record<string, LinkKindInfo>)[kind]) || INFO.website;
}

/** What to call the link: the service's name, or for a website the domain, or for email the address. */
export function linkDisplayName(url: string, kind: LinkKind = detectLinkKind(url)): string {
  if (kind === 'email') return String(url || '').replace(/^mailto:/i, '').split('?')[0];
  const info = INFO[kind];
  if (info.label) return info.label;
  return hostOf(url) || String(url || '').trim();
}

/** The link without its scheme and trailing slash, for a compact secondary line. */
export function linkShortText(url: string): string {
  return String(url || '')
    .trim()
    .replace(/^mailto:/i, '')
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/$/, '');
}
