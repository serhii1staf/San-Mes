import AsyncStorage from '@react-native-async-storage/async-storage';
import { t } from '../i18n/store';

const RATE_LIMIT_KEY = '@san:rate_limits';

interface RateLimitEntry {
  action: string;
  timestamps: number[];
}

interface RateLimits {
  [action: string]: RateLimitEntry;
}

// Rate limit configuration
const LIMITS: Record<string, { maxActions: number; windowMs: number; cooldownMs: number }> = {
  post: { maxActions: 10, windowMs: 3600000, cooldownMs: 30000 }, // 10 posts/hour, 30s cooldown
  like: { maxActions: 100, windowMs: 3600000, cooldownMs: 500 }, // 100 likes/hour, 0.5s cooldown
  comment: { maxActions: 30, windowMs: 3600000, cooldownMs: 5000 }, // 30 comments/hour, 5s cooldown
  repost: { maxActions: 20, windowMs: 3600000, cooldownMs: 10000 }, // 20 reposts/hour, 10s cooldown
  follow: { maxActions: 50, windowMs: 3600000, cooldownMs: 2000 }, // 50 follows/hour, 2s cooldown
  message: { maxActions: 60, windowMs: 60000, cooldownMs: 1000 }, // 60 messages/min, 1s cooldown
  report: { maxActions: 5, windowMs: 3600000, cooldownMs: 30000 }, // 5 reports/hour, 30s cooldown
};

let rateLimitsCache: RateLimits = {};

// Load rate limits from storage on init
export async function initRateLimits(): Promise<void> {
  try {
    const data = await AsyncStorage.getItem(RATE_LIMIT_KEY);
    if (data) rateLimitsCache = JSON.parse(data);
  } catch {}
}

// Save rate limits to storage
async function saveRateLimits(): Promise<void> {
  try {
    await AsyncStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(rateLimitsCache));
  } catch {}
}

/**
 * Check if an action is allowed. Returns { allowed, retryAfterMs }
 */
export function checkRateLimit(action: string): { allowed: boolean; retryAfterMs: number; reason?: string } {
  const config = LIMITS[action];
  if (!config) return { allowed: true, retryAfterMs: 0 };

  const now = Date.now();
  const entry = rateLimitsCache[action] || { action, timestamps: [] };

  // Clean old timestamps outside the window
  entry.timestamps = entry.timestamps.filter(t => now - t < config.windowMs);

  // Check cooldown (time since last action)
  if (entry.timestamps.length > 0) {
    const lastAction = entry.timestamps[entry.timestamps.length - 1];
    const timeSinceLast = now - lastAction;
    if (timeSinceLast < config.cooldownMs) {
      return { allowed: false, retryAfterMs: config.cooldownMs - timeSinceLast, reason: 'cooldown' };
    }
  }

  // Check max actions in window
  if (entry.timestamps.length >= config.maxActions) {
    const oldestInWindow = entry.timestamps[0];
    const retryAfter = config.windowMs - (now - oldestInWindow);
    return { allowed: false, retryAfterMs: retryAfter, reason: 'rate_limit' };
  }

  return { allowed: true, retryAfterMs: 0 };
}

/**
 * Record that an action was performed
 */
export function recordAction(action: string): void {
  const now = Date.now();
  const config = LIMITS[action];
  if (!config) return;

  if (!rateLimitsCache[action]) {
    rateLimitsCache[action] = { action, timestamps: [] };
  }

  rateLimitsCache[action].timestamps.push(now);

  // Trim old entries
  rateLimitsCache[action].timestamps = rateLimitsCache[action].timestamps.filter(
    t => now - t < config.windowMs
  );

  // Save async (non-blocking)
  saveRateLimits();
}

/**
 * Phishing/spam link detection
 */
const SUSPICIOUS_PATTERNS = [
  /bit\.ly\//i,
  /tinyurl\.com\//i,
  /goo\.gl\//i,
  /t\.co\//i,
  /rb\.gy\//i,
  /free.*money/i,
  /earn.*fast/i,
  /click.*here.*win/i,
  /congratulations.*won/i,
  /login.*verify.*account/i,
  /password.*reset.*click/i,
  /crypto.*invest.*profit/i,
  /\.xyz\//i,
  /\.tk\//i,
  /\.ml\//i,
];

export function detectSuspiciousContent(text: string): { isSuspicious: boolean; reason?: string } {
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(text)) {
      return { isSuspicious: true, reason: t('rate_limit.suspicious_content') };
    }
  }
  return { isSuspicious: false };
}

/**
 * Device account limit check (max 3 accounts per device)
 */
const DEVICE_ACCOUNTS_KEY = '@san:device_accounts';

export async function checkDeviceAccountLimit(userId: string): Promise<{ allowed: boolean; count: number }> {
  try {
    const data = await AsyncStorage.getItem(DEVICE_ACCOUNTS_KEY);
    const accounts: string[] = data ? JSON.parse(data) : [];
    if (accounts.includes(userId)) return { allowed: true, count: accounts.length };
    if (accounts.length >= 3) return { allowed: false, count: accounts.length };
    return { allowed: true, count: accounts.length };
  } catch {
    return { allowed: true, count: 0 };
  }
}

export async function registerDeviceAccount(userId: string): Promise<void> {
  try {
    const data = await AsyncStorage.getItem(DEVICE_ACCOUNTS_KEY);
    const accounts: string[] = data ? JSON.parse(data) : [];
    if (!accounts.includes(userId)) {
      accounts.push(userId);
      await AsyncStorage.setItem(DEVICE_ACCOUNTS_KEY, JSON.stringify(accounts));
    }
  } catch {}
}
