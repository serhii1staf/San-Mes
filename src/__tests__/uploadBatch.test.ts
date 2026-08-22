/**
 * Bug fix: app-wide-degradation-fixes, block H (401 on image upload), task 4.3.
 *
 * Covers `src/lib/uploadBatch.ts` — the code `app/(tabs)/create.tsx` actually calls,
 * not a replica of it.
 *
 * The defect being guarded against was not any single wrong step. It was four steps
 * that were each individually defensible and collectively destructive: publish
 * anyway, clear the text, clear the images, navigate away. Any one of them alone is
 * recoverable; all four together lose the user's work irreversibly. So the central
 * test asserts all four at once.
 */

import fc from 'fast-check';
import {
  isAlreadyRemote,
  publishPermissions,
  uploadImageBatch,
  type SingleUploadResult,
} from '../lib/uploadBatch';
import type { UploadFailureReason } from '../lib/uploadFailure';

const ok = (url: string): SingleUploadResult => ({ url });
const failed = (reason: UploadFailureReason): SingleUploadResult => ({ url: null, reason });

/** Uploader that succeeds for every uri, mapping it to a deterministic URL. */
const alwaysOk = async (uri: string) => ok(`https://media.example/${encodeURIComponent(uri)}`);

const ALL_REASONS: UploadFailureReason[] = [
  'not_signed_in',
  'session_expired',
  'auth_rejected',
  'timeout',
  'offline',
  'storage_not_configured',
  'too_large',
  'bad_image',
  'server_error',
];

/** The reasons that must NOT be retried blindly by the queue. */
const PERMANENT_REASONS = ALL_REASONS.filter((r) => r !== 'offline' && r !== 'timeout');

describe('isAlreadyRemote', () => {
  it('recognises hosted images that need no upload', () => {
    expect(isAlreadyRemote('https://media.example/a.jpg')).toBe(true);
    expect(isAlreadyRemote('file:///tmp/a.jpg')).toBe(false);
    expect(isAlreadyRemote('content://media/1')).toBe(false);
    // Plain http is not treated as remote: ATS is HTTPS-only, so such a uri would
    // not be a URL we ever produced.
    expect(isAlreadyRemote('http://media.example/a.jpg')).toBe(false);
  });
});

describe('uploadImageBatch', () => {
  it('returns every url, in order, when all uploads succeed', async () => {
    const res = await uploadImageBatch(['file://a.jpg', 'file://b.jpg'], alwaysOk);
    expect(res.outcome).toBe('ok');
    if (res.outcome !== 'ok') throw new Error('unreachable');
    expect(res.urls).toEqual([
      'https://media.example/file%3A%2F%2Fa.jpg',
      'https://media.example/file%3A%2F%2Fb.jpg',
    ]);
  });

  it('passes already-remote uris straight through without uploading them', async () => {
    const upload = jest.fn(alwaysOk);
    const res = await uploadImageBatch(['https://media.example/kept.jpg'], upload);
    expect(res.outcome).toBe('ok');
    if (res.outcome !== 'ok') throw new Error('unreachable');
    expect(res.urls).toEqual(['https://media.example/kept.jpg']);
    expect(upload).not.toHaveBeenCalled();
  });

  it('treats an empty selection as a trivially successful batch', async () => {
    const res = await uploadImageBatch([], alwaysOk);
    expect(res).toEqual({ outcome: 'ok', urls: [] });
  });

  it.each(PERMANENT_REASONS)('aborts the whole batch on a %s failure', async (reason) => {
    const res = await uploadImageBatch(['file://a.jpg'], async () => failed(reason));
    expect(res).toEqual({ outcome: 'aborted', reason });
  });

  it.each(['offline', 'timeout'] as const)('routes a %s failure to the queue', async (reason) => {
    const res = await uploadImageBatch(['file://a.jpg'], async () => failed(reason));
    expect(res).toEqual({ outcome: 'queue', reason });
  });

  it('classifies a thrown uploader as offline rather than losing the work', async () => {
    const res = await uploadImageBatch(['file://a.jpg'], async () => {
      throw new Error('socket hung up');
    });
    expect(res).toEqual({ outcome: 'queue', reason: 'offline' });
  });

  it('stops at the first failure instead of uploading the rest', async () => {
    const upload = jest
      .fn<Promise<SingleUploadResult>, [string]>()
      .mockResolvedValueOnce(ok('https://media.example/1.jpg'))
      .mockResolvedValueOnce(failed('auth_rejected'))
      .mockResolvedValueOnce(ok('https://media.example/3.jpg'));

    const res = await uploadImageBatch(['file://1', 'file://2', 'file://3'], upload);

    expect(res.outcome).toBe('aborted');
    // The third image is never attempted — no point burning bandwidth on a batch
    // that cannot be published.
    expect(upload).toHaveBeenCalledTimes(2);
  });

  /**
   * Partial success must never surface as success. This is what allowed a post with
   * an attached photo to be published as text-only.
   */
  it('never reports ok with fewer urls than the user selected', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom('file://a', 'file://b', 'https://media.example/c'), {
          minLength: 1,
          maxLength: 6,
        }),
        fc.constantFrom(...ALL_REASONS),
        fc.nat(),
        async (uris, reason, failAtRaw) => {
          const localIndexes = uris
            .map((u, i) => (isAlreadyRemote(u) ? -1 : i))
            .filter((i) => i >= 0);
          // Nothing can fail if every uri is already remote.
          if (localIndexes.length === 0) return;
          const failAt = localIndexes[failAtRaw % localIndexes.length];

          let seen = -1;
          const res = await uploadImageBatch(uris, async (uri) => {
            seen++;
            void uri;
            return seen === localIndexes.indexOf(failAt) ? failed(reason) : ok('https://m/x.jpg');
          });

          if (res.outcome === 'ok') {
            expect(res.urls).toHaveLength(uris.length);
          } else {
            expect(res).not.toHaveProperty('urls');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('publishPermissions', () => {
  /**
   * THE CORE INVARIANT.
   *
   * Four assertions in one test, because the defect was their simultaneous
   * violation. Splitting them would let a partial regression pass three of four and
   * still lose the user's post.
   */
  it('on abort: does not publish, does not clear the draft, does not navigate, does explain', () => {
    const p = publishPermissions('aborted');
    expect(p.mayPublish).toBe(false);
    expect(p.mayClearDraft).toBe(false);
    expect(p.mayNavigate).toBe(false);
    expect(p.shouldShowError).toBe(true);
    // And it must not be quietly diverted into the queue either, where it would be
    // retried forever without ever succeeding.
    expect(p.shouldQueue).toBe(false);
  });

  it('on ok: publishes, clears and navigates', () => {
    expect(publishPermissions('ok')).toEqual({
      mayPublish: true,
      shouldQueue: false,
      mayClearDraft: true,
      mayNavigate: true,
      shouldShowError: false,
    });
  });

  it('on queue: preserves the existing offline behaviour', () => {
    // Queuing is a successful submission from the user's perspective — the post
    // will go out — so clearing and navigating stays correct here.
    expect(publishPermissions('queue')).toEqual({
      mayPublish: false,
      shouldQueue: true,
      mayClearDraft: true,
      mayNavigate: true,
      shouldShowError: false,
    });
  });

  it('never both publishes and queues the same post', () => {
    for (const outcome of ['ok', 'queue', 'aborted'] as const) {
      const p = publishPermissions(outcome);
      expect(p.mayPublish && p.shouldQueue).toBe(false);
    }
  });

  it('only clears the draft when the post is actually going somewhere', () => {
    for (const outcome of ['ok', 'queue', 'aborted'] as const) {
      const p = publishPermissions(outcome);
      if (p.mayClearDraft) {
        expect(p.mayPublish || p.shouldQueue).toBe(true);
      }
    }
  });

  it('never navigates away while leaving the draft uncleared', () => {
    // Navigating with an uncleared draft would strand the composer in a state the
    // user cannot see they are still in.
    for (const outcome of ['ok', 'queue', 'aborted'] as const) {
      const p = publishPermissions(outcome);
      if (p.mayNavigate) expect(p.mayClearDraft).toBe(true);
    }
  });
});
