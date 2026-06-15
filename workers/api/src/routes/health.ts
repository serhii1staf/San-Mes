// GET /v1/health — proves routing + D1 binding work end-to-end.
//
// The OTA pipeline and the admin "service status" page hit this to
// distinguish "Worker reachable but DB sick" from "Worker unreachable"
// — which is why we report `dbHealthy` separately from the response
// status. The HTTP 200 means the Worker is alive; the JSON `dbHealthy`
// flag tells the caller whether D1 answered.

import { jsonResponse } from '../http';
import { register } from '../router';
import { queryOne } from '../db';

register('GET', '/v1/health', async (req, env) => {
  let dbHealthy = false;
  try {
    const row = await queryOne<{ ok: number }>(env, 'SELECT 1 AS ok', []);
    dbHealthy = row?.ok === 1;
  } catch {
    dbHealthy = false;
  }
  return jsonResponse(req, {
    ok: true,
    db: 'san-mes',
    dbHealthy,
    ts: new Date().toISOString(),
  });
});
