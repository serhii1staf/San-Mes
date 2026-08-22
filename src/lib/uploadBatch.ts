// All-or-nothing image batch upload, plus the decision of what the caller must do
// when it fails.
//
// This lives outside the create screen on purpose. The logic used to be inline in
// `app/(tabs)/create.tsx`, which meant the only way to test it was to re-implement
// it in the test file — and a re-implementation cannot catch the bug it is meant to
// guard, because it drifts from the real code the moment someone edits the screen.
// The screen now calls these functions, so the tests exercise production code.
//
// THE BUG THIS ENCODES A FIX FOR
//   The old loop called a per-image helper that returned `null` on failure and
//   swallowed it. Publishing continued with an empty URL set, so a post the user
//   had attached a photo to was published as text-only — and then the draft and the
//   file selection were cleared and the screen navigated away. The image, the text
//   and any chance of retrying were all gone, with no error the user could act on.

import { isTransientUploadFailure, type UploadFailureReason } from './uploadFailure';

/** What a single image upload attempt reports back. */
export interface SingleUploadResult {
  url: string | null;
  reason?: UploadFailureReason;
}

export type UploadBatchOutcome =
  /** Every image resolved to a remote URL, in the original order. */
  | { outcome: 'ok'; urls: string[] }
  /** Transient transport failure — the caller should queue the LOCAL uris. */
  | { outcome: 'queue'; reason: UploadFailureReason }
  /** Non-recoverable failure — the caller must stop and preserve the draft. */
  | { outcome: 'aborted'; reason: UploadFailureReason };

/**
 * Is this uri already a hosted image that needs no upload?
 *
 * Edit mode and reposts carry through URLs that are already remote. They cannot
 * fail, so they must not be able to abort a batch.
 */
export function isAlreadyRemote(uri: string): boolean {
  return uri.startsWith('https://');
}

/**
 * Upload every uri, or fail the whole batch.
 *
 * `upload` is injected so this is testable without a network, and so the screen
 * keeps owning which uploader it uses.
 *
 * Partial success is deliberately not a result: half a carousel is not what the
 * user asked for, and silently dropping the images that failed is precisely the
 * behaviour being removed.
 */
export async function uploadImageBatch(
  uris: string[],
  upload: (uri: string) => Promise<SingleUploadResult>,
): Promise<UploadBatchOutcome> {
  const urls: string[] = [];

  for (const uri of uris) {
    if (isAlreadyRemote(uri)) {
      urls.push(uri);
      continue;
    }

    let result: SingleUploadResult;
    try {
      result = await upload(uri);
    } catch {
      // A throw is a transport failure, not a rejection by the server. Calling it
      // `offline` lets the caller queue instead of discarding the user's work.
      result = { url: null, reason: 'offline' };
    }

    if (!result.url) {
      const reason = result.reason ?? 'server_error';
      return isTransientUploadFailure(reason)
        ? { outcome: 'queue', reason }
        : { outcome: 'aborted', reason };
    }
    urls.push(result.url);
  }

  return { outcome: 'ok', urls };
}

/**
 * What the caller is permitted to do for a given batch outcome.
 *
 * Returned as explicit permissions rather than a bare enum so the invariants are
 * stated where they can be asserted. The three `false` flags on `aborted` are the
 * entire fix: each one corresponds to a step the old code performed
 * unconditionally.
 */
export interface PublishPermissions {
  /** May the create/patch request be sent? */
  mayPublish: boolean;
  /** Should this go to the offline queue with local uris instead? */
  shouldQueue: boolean;
  /** May the composer be reset (text + selected images)? */
  mayClearDraft: boolean;
  /** May we navigate away from the composer? */
  mayNavigate: boolean;
  /** Must the user be shown why it stopped? */
  shouldShowError: boolean;
}

export function publishPermissions(outcome: UploadBatchOutcome['outcome']): PublishPermissions {
  switch (outcome) {
    case 'ok':
      return {
        mayPublish: true,
        shouldQueue: false,
        mayClearDraft: true,
        mayNavigate: true,
        shouldShowError: false,
      };
    case 'queue':
      // Queuing IS a successful submission from the user's point of view: the post
      // will go out. Clearing and navigating is correct here and is the existing
      // behaviour that must be preserved.
      return {
        mayPublish: false,
        shouldQueue: true,
        mayClearDraft: true,
        mayNavigate: true,
        shouldShowError: false,
      };
    case 'aborted':
      // Nothing is published, nothing is cleared, nowhere is navigated. The user
      // keeps their text and their images and can retry or fix the cause.
      return {
        mayPublish: false,
        shouldQueue: false,
        mayClearDraft: false,
        mayNavigate: false,
        shouldShowError: true,
      };
  }
}
