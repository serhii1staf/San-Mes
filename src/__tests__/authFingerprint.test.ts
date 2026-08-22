/**
 * @jest-environment node
 *
 * Bug fix: app-wide-degradation-fixes, block H (401 on image upload), task 1.3.
 *
 * Covers `api/_lib/authFingerprint.ts` — the mechanism that lets an operator
 * compare the Vercel and Worker `JWT_SECRET` values without transmitting either.
 *
 * Node environment because the module uses Node's `crypto`, exactly as the Vercel
 * functions do (they run on Node, not in the RN runtime).
 */

import crypto from 'crypto';
import {
  FINGERPRINT_LENGTH,
  FINGERPRINT_MESSAGE,
  secretFingerprint,
} from '../../api/_lib/authFingerprint';

/**
 * The Worker's implementation, transcribed from
 * `workers/api/src/routes/admin.ts`.
 *
 * Deliberately re-stated here rather than imported: importing the route module
 * would drag in the Worker router, D1 bindings and `Request`/`Response` globals.
 * What actually needs guarding is the ALGORITHM agreeing across two different
 * crypto APIs, and that is what this reproduces. If the route ever changes its
 * message or truncation, this test keeps passing while production breaks — so the
 * route carries a comment pointing back here.
 */
async function workerSideFingerprint(secret: string | undefined): Promise<string | null> {
  if (!secret) return null;
  const enc = new TextEncoder();
  const key = await crypto.webcrypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.webcrypto.subtle.sign('HMAC', key, enc.encode(FINGERPRINT_MESSAGE));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.slice(0, FINGERPRINT_LENGTH);
}

describe('secretFingerprint', () => {
  it('is deterministic for the same secret', () => {
    const a = secretFingerprint('super-secret-value');
    const b = secretFingerprint('super-secret-value');
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.configured).toBe(true);
  });

  it('distinguishes different secrets', () => {
    const a = secretFingerprint('secret-one');
    const b = secretFingerprint('secret-two');
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it('reports not-configured for empty and undefined secrets', () => {
    for (const value of [undefined, null, ''] as const) {
      const r = secretFingerprint(value);
      expect(r.configured).toBe(false);
      expect(r.fingerprint).toBeNull();
    }
  });

  it('returns exactly 8 lowercase hex characters', () => {
    const r = secretFingerprint('another-secret');
    expect(r.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(r.fingerprint).toHaveLength(FINGERPRINT_LENGTH);
  });

  it('pins the algorithm and issuer so cross-side drift is visible', () => {
    const r = secretFingerprint('x');
    expect(r.alg).toBe('HS256');
    expect(r.iss).toBe('san-mes-api');
  });

  /**
   * The security property that matters: the response must not contain the secret,
   * nor any prefix of it long enough to be useful. A trailing-newline secret (the
   * classic `echo | wrangler secret put` mistake) is included because that is a
   * realistic value, not a synthetic one.
   */
  it('never echoes the secret or any 4+ char substring of it', () => {
    const secrets = ['hunter2-hunter2-hunter2', 'trailing-newline-secret\n', 'a'.repeat(64)];
    for (const secret of secrets) {
      const serialised = JSON.stringify(secretFingerprint(secret));
      expect(serialised).not.toContain(secret);
      expect(serialised).not.toContain(secret.trim());
      for (let i = 0; i + 4 <= secret.length; i++) {
        expect(serialised).not.toContain(secret.slice(i, i + 4));
      }
    }
  });

  /**
   * Without this, a drift between the two crypto APIs would make every comparison
   * read "secrets differ" and send an operator hunting a mismatch that is not
   * there — turning the diagnostic into a source of false leads.
   */
  it('agrees with the Worker-side Web Crypto implementation', async () => {
    const secrets = ['s', 'san-mes', '0123456789abcdef'.repeat(4), 'ключ-с-юникодом'];
    for (const secret of secrets) {
      const node = secretFingerprint(secret).fingerprint;
      const worker = await workerSideFingerprint(secret);
      expect(node).toBe(worker);
    }
  });

  it('agrees with the Worker on the not-configured case', async () => {
    expect(secretFingerprint(undefined).fingerprint).toBeNull();
    await expect(workerSideFingerprint(undefined)).resolves.toBeNull();
  });
});
