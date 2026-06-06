/**
 * cacheAccount — single source of truth for the active account namespace.
 *
 * Extracted into its own module so both cacheService.ts and kvStore.ts can
 * import the namespacing helpers without creating a circular dependency.
 *
 * Every account-scoped storage key is prefixed with `@acc:${activeAccountId}:`.
 * Switching accounts is non-destructive — each account keeps its own namespace,
 * so returning to a previous account is instant.
 */

let activeAccountId = 'anon';

/** Set the active account whose cache namespace should be used. Call on login/startup. */
export function setCacheAccount(accountId: string | null | undefined): void {
  activeAccountId = accountId || 'anon';
}

export function getCacheAccount(): string {
  return activeAccountId;
}

/** Build a per-account storage key for raw storage usage outside cacheService. */
export function accountKey(baseKey: string): string {
  return `@acc:${activeAccountId}:${baseKey}`;
}

// Keys that hold the same data for every account (no need to duplicate per account).
export const GLOBAL_KEY_PREFIXES = ['@san:profile:', '@san:all_profiles'];

/** Apply the active account namespace, leaving global/shared keys untouched. */
export function namespaced(key: string): string {
  if (GLOBAL_KEY_PREFIXES.some((p) => key.startsWith(p))) return key;
  return `@acc:${activeAccountId}:${key}`;
}
