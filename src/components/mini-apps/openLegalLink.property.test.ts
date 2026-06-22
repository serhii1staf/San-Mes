import fc from 'fast-check';
import { Linking } from 'react-native';
import { openLegalLink } from './openLegalLink';

// Property-based tests for the HTTPS-only legal-link opener
// (mini-app-content-policy-consent spec).
//
// `openLegalLink(url, onError)` must call `Linking.openURL` IF AND ONLY IF the
// url scheme is `https`. For any non-https scheme (http, ftp, file, javascript,
// relative, empty) it must return false, must NOT call `Linking.openURL`, and
// must invoke `onError`. For https it returns true and calls `Linking.openURL`
// exactly once.
//
// We spy on `Linking.openURL` (resolving) so no real navigation happens, and
// reset the spy between iterations to keep call counts isolated.

describe('openLegalLink HTTPS-only properties', () => {
  let openURLSpy: jest.SpyInstance;

  beforeEach(() => {
    openURLSpy = jest
      .spyOn(Linking, 'openURL')
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    openURLSpy.mockRestore();
  });

  // Generator producing URLs with a varied scheme, plus relative/empty strings
  // and genuinely random strings, so both the https and non-https branches are
  // exercised across the input space.
  const httpsUrl = fc
    .webPath()
    .map((path) => `https://host.example.com${path}`);

  const nonHttpsUrl = fc
    .oneof(
      // Explicit non-https schemes built as `${scheme}://host/path`.
      fc
        .tuple(
          fc.constantFrom('http', 'ftp', 'file', 'javascript', 'HTTP', 'ws'),
          fc.webPath(),
        )
        .map(([scheme, path]) => `${scheme}://host.example.com${path}`),
      // Relative paths (no scheme).
      fc.webPath().map((path) => path || '/'),
      // Empty / whitespace.
      fc.constantFrom('', '   ', '\n'),
      // Genuinely random strings.
      fc.string(),
    )
    // Guard: never let a randomly generated value sneak into the https branch.
    .filter((url) => !/^https:\/\//i.test(url));

  // Feature: mini-app-content-policy-consent, Property 6: Открытие юридических ссылок строго по HTTPS
  it('Property 6: opens via Linking.openURL iff the scheme is https', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Randomly pick an https or a non-https url for each iteration.
        fc.oneof(
          httpsUrl.map((url) => ({ url, isHttps: true })),
          nonHttpsUrl.map((url) => ({ url, isHttps: false })),
        ),
        async ({ url, isHttps }) => {
          // Reset call counts inside the property so each input is isolated.
          openURLSpy.mockClear();
          const onError = jest.fn();

          const result = await openLegalLink(url, onError);

          if (isHttps) {
            // https → returns true, opens exactly once, no error callback.
            expect(result).toBe(true);
            expect(openURLSpy).toHaveBeenCalledTimes(1);
            expect(openURLSpy).toHaveBeenCalledWith(url);
            expect(onError).not.toHaveBeenCalled();
          } else {
            // non-https → returns false, never opens, error callback fires.
            expect(result).toBe(false);
            expect(openURLSpy).not.toHaveBeenCalled();
            expect(onError).toHaveBeenCalledTimes(1);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
