// GET /api/admin/auth-fingerprint
//
// Reports which `JWT_SECRET` this Vercel deployment holds — as a truncated HMAC
// over a public constant, never as the secret itself. See
// `api/_lib/authFingerprint.ts` for why that does not leak the key.
//
// PURPOSE
//   `api/r2-upload.ts` rejects every upload with `401 {"error":"unauthorised"}`
//   when `process.env.JWT_SECRET` is missing or differs from the Worker's secret,
//   because `verifyWorkerToken` is fail-closed. From the client that is
//   indistinguishable from a bad token. Comparing this endpoint's fingerprint
//   against the Worker's `GET /v1/admin/auth-fingerprint` tells an operator which
//   of the two it is, in one request each:
//
//     configured: false        → the secret is not set here.       (primary cause)
//     fingerprints differ      → the two sides hold different secrets.
//     fingerprints match       → configuration is fine; look at the token
//                                (30-day TTL) or at whether Vercel was redeployed
//                                after the env var was set.
//
//   That last case is worth calling out: Vercel applies environment variables to
//   NEW deployments. Setting the variable without redeploying leaves the running
//   functions on the old value, which is the most common "I set it and it still
//   doesn't work".
//
// AUTHORISATION
//   Admin-key gated. `configured` is the only fact about the environment this
//   returns, and it is returned only AFTER the key check passes — an
//   unauthenticated caller learns nothing about the configuration.
//
// Required env vars (Vercel project settings, never in the repo):
//   ADMIN_KEY   — shared secret for /api/admin/*
//   JWT_SECRET  — must be byte-identical to the Worker's JWT_SECRET

import type { IncomingMessage, ServerResponse } from 'http';
import { checkAdminKey } from '../_lib/adminAuth';
import { secretFingerprint } from '../_lib/authFingerprint';

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'x-admin-key');
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    return send(res, 405, { error: 'method_not_allowed' });
  }

  const gate = checkAdminKey(req);
  if (gate.kind === 'not_configured') {
    return send(res, 503, { error: 'admin_not_configured' });
  }
  if (gate.kind === 'wrong_key') {
    return send(res, 401, { error: 'Unauthorized' });
  }

  // Past the gate: safe to describe our own configuration.
  const jwt = secretFingerprint(process.env.JWT_SECRET);

  return send(res, 200, {
    side: 'vercel',
    jwt,
    // Sanity signals for the operator that cost nothing to include and are not
    // secrets: whether the R2 write path and the storage-measurement path have
    // their variables at all. Booleans only — no values, no names beyond these.
    r2: {
      accountConfigured: Boolean(process.env.R2_ACCOUNT_ID),
      bucketConfigured: Boolean(process.env.R2_BUCKET),
      writeTokenConfigured: Boolean(process.env.R2_API_TOKEN),
      publicBaseConfigured: Boolean(process.env.R2_PUBLIC_BASE),
      s3KeypairConfigured: Boolean(
        process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY,
      ),
    },
  });
}
