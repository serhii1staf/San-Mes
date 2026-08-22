/**
 * Bug fix: app-wide-degradation-fixes, block I (admin panel), tasks 7.2 and 10.
 *
 * Covers `src/lib/adminFailure.ts` — the code `app/settings/admin.tsx` calls.
 *
 * The defect was not a wrong message; it was ONE message for several unrelated
 * server states. So the assertions here are mostly about distinctness: the same
 * input must not collapse causes that need different remedies.
 */

import {
  adminFailureMessageKey,
  classifyAdminFailure,
  configWarningKeys,
  shouldDiscardStoredKey,
  type AdminFailureReason,
  type AdminStatusConfig,
} from '../lib/adminFailure';

const ALL_REASONS: AdminFailureReason[] = [
  'not_configured',
  'service_unavailable',
  'wrong_password',
  'timeout',
  'unreachable',
  'server_error',
];

describe('classifyAdminFailure', () => {
  it('separates a missing ADMIN_KEY from a downed service, though both are 503', () => {
    // This is the distinction the panel previously could not make. `not_configured`
    // is the operator's own fix; `service_unavailable` is an outage they can only
    // wait out. Reporting them identically is what made a missing env var read as
    // "something is wrong with the hosting".
    expect(classifyAdminFailure({ status: 503, bodyError: 'admin_not_configured' })).toBe(
      'not_configured',
    );
    expect(classifyAdminFailure({ status: 503, bodyError: null })).toBe('service_unavailable');
    expect(classifyAdminFailure({ status: 503 })).toBe('service_unavailable');
    // An unrelated 503 body must not be mistaken for our marker.
    expect(classifyAdminFailure({ status: 503, bodyError: 'r2_not_configured' })).toBe(
      'service_unavailable',
    );
  });

  it('maps 401 and 403 to wrong_password', () => {
    expect(classifyAdminFailure({ status: 401, bodyError: 'Unauthorized' })).toBe('wrong_password');
    expect(classifyAdminFailure({ status: 403 })).toBe('wrong_password');
  });

  it('maps our own abort to timeout, not to a server response', () => {
    // Previously an AbortError fell through to the generic catch and surfaced as a
    // raw `e?.message`, which read as though the server had said something.
    expect(classifyAdminFailure({ status: null, transportError: 'abort' })).toBe('timeout');
  });

  it('maps a transport failure to unreachable', () => {
    expect(classifyAdminFailure({ status: null, transportError: 'network' })).toBe('unreachable');
  });

  it('lets a transport outcome win over any status', () => {
    // A request that never completed has no meaningful status; trusting a stale one
    // would misreport the cause.
    expect(classifyAdminFailure({ status: 503, transportError: 'abort' })).toBe('timeout');
    expect(classifyAdminFailure({ status: 401, transportError: 'network' })).toBe('unreachable');
  });

  it('is total across every status code', () => {
    for (let status = 100; status <= 599; status++) {
      const reason = classifyAdminFailure({ status });
      expect(ALL_REASONS).toContain(reason);
      expect(adminFailureMessageKey(reason)).toBeTruthy();
    }
  });

  /**
   * Task 10: the three responses the design calls out must yield three DIFFERENT
   * messages. Distinctness is asserted rather than the literal strings, because the
   * strings go through i18n and would make this a translation test.
   */
  it('yields three distinct messages for 503-not-configured, 401 and abort', () => {
    const reasons = [
      classifyAdminFailure({ status: 503, bodyError: 'admin_not_configured' }),
      classifyAdminFailure({ status: 401, bodyError: 'Unauthorized' }),
      classifyAdminFailure({ status: null, transportError: 'abort' }),
    ];
    expect(new Set(reasons).size).toBe(3);
    expect(new Set(reasons.map(adminFailureMessageKey)).size).toBe(3);
  });

  it('gives every reason its own message key', () => {
    const keys = ALL_REASONS.map(adminFailureMessageKey);
    expect(new Set(keys).size).toBe(ALL_REASONS.length);
  });
});

describe('shouldDiscardStoredKey', () => {
  it('discards only on an actual rejection', () => {
    expect(ALL_REASONS.filter(shouldDiscardStoredKey)).toEqual(['wrong_password']);
  });

  it('does not log the operator out over a flaky network', () => {
    // Discarding on a timeout would mean a brief connectivity blip forces the
    // operator to re-enter the key, which trains them to distrust the panel.
    expect(shouldDiscardStoredKey('timeout')).toBe(false);
    expect(shouldDiscardStoredKey('unreachable')).toBe(false);
    expect(shouldDiscardStoredKey('service_unavailable')).toBe(false);
  });

  it('does not discard when the server simply lacks its env var', () => {
    // The stored key may be perfectly correct — the server has nothing to compare
    // it against yet.
    expect(shouldDiscardStoredKey('not_configured')).toBe(false);
  });
});

describe('configWarningKeys', () => {
  const healthy: AdminStatusConfig = {
    r2Measured: true,
    r2Debug: null,
    workerAdminKeyOk: true,
    jwtSecretsMatch: true,
    jwtConfiguredHere: true,
  };

  it('is silent when everything agrees', () => {
    expect(configWarningKeys(healthy)).toEqual([]);
  });

  it('is silent for an older deployment that sends no config', () => {
    expect(configWarningKeys(undefined)).toEqual([]);
  });

  it('warns that JWT_SECRET is missing — the direct cause of upload 401s', () => {
    const keys = configWarningKeys({ ...healthy, jwtConfiguredHere: false, jwtSecretsMatch: false });
    expect(keys).toContain('admin.error.jwt_missing');
    // Not both: a missing secret and a mismatched secret are one cause here, and
    // two warnings for one cause trains the operator to skim past them.
    expect(keys).not.toContain('admin.error.jwt_mismatch');
  });

  it('warns about a mismatch only when the secret is actually set here', () => {
    const keys = configWarningKeys({ ...healthy, jwtSecretsMatch: false });
    expect(keys).toEqual(['admin.error.jwt_mismatch']);
  });

  /**
   * An unknown must never render as a pass. But it must not invent a warning
   * either — a warning the operator cannot act on is worse than silence, because it
   * devalues the ones that matter.
   */
  it('stays silent when the comparison could not be made', () => {
    expect(configWarningKeys({ ...healthy, jwtSecretsMatch: null })).toEqual([]);
  });

  it('warns when the Worker rejected the forwarded admin key', () => {
    // Without this the panel opens, every count reads zero and the D1 row shows
    // `degraded` — which is indistinguishable from the database being down.
    const keys = configWarningKeys({ ...healthy, workerAdminKeyOk: false });
    expect(keys).toEqual(['admin.error.worker_key_mismatch']);
  });

  it('reports independent problems independently', () => {
    const keys = configWarningKeys({
      ...healthy,
      jwtConfiguredHere: false,
      jwtSecretsMatch: false,
      workerAdminKeyOk: false,
    });
    expect(keys).toEqual(['admin.error.jwt_missing', 'admin.error.worker_key_mismatch']);
  });

  it('does not treat an unmeasured storage bar as a configuration warning', () => {
    // An estimate is surfaced on the bar itself, not as an alarm — it is a degraded
    // measurement, not a broken deployment.
    expect(configWarningKeys({ ...healthy, r2Measured: false, r2Debug: 'r2_not_configured' })).toEqual(
      [],
    );
  });
});
