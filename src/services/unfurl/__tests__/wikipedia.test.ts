// Pure-fn tests for the Wikipedia URL parser. The network paths
// (getWikiPreview) are exercised end-to-end during normal app usage —
// covering the parsers here gives us confidence that the right endpoint
// will be called with the right title regardless of how the URL was typed.

import { isWikiUrl } from '../wikipedia';

describe('isWikiUrl', () => {
  it('accepts language subdomains', () => {
    expect(isWikiUrl('https://en.wikipedia.org/wiki/Cat')).toBe(true);
    expect(isWikiUrl('https://ru.wikipedia.org/wiki/%D0%9A%D0%BE%D1%88%D0%BA%D0%B0')).toBe(true);
    expect(isWikiUrl('https://zh-yue.wikipedia.org/wiki/Foo')).toBe(true);
  });

  it('accepts wikidata.org', () => {
    expect(isWikiUrl('https://www.wikidata.org/wiki/Q146')).toBe(true);
    expect(isWikiUrl('https://wikidata.org/wiki/Q42')).toBe(true);
  });

  it('rejects unrelated domains', () => {
    expect(isWikiUrl('https://example.com/wiki/Cat')).toBe(false);
    expect(isWikiUrl('https://wikipedia.com/wiki/Cat')).toBe(false);
    expect(isWikiUrl('https://fakewikipedia.org/wiki/Cat')).toBe(false);
  });

  it('rejects garbage input without throwing', () => {
    expect(isWikiUrl('not-a-url')).toBe(false);
    expect(isWikiUrl('')).toBe(false);
  });
});
