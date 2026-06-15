// Unit tests for the validators in `src/util.ts`. These are the gates
// every route relies on, so a regression here would silently change
// every endpoint's accepted input set — the kind of thing that's only
// caught by querying with a malformed param months later.

import { describe, it, expect } from 'vitest';
import { parseLimit, parseOffset, parseUuid } from '../util';

describe('parseLimit', () => {
  it('returns the default for null/undefined/empty', () => {
    expect(parseLimit(null)).toBe(20);
    expect(parseLimit(undefined)).toBe(20);
    expect(parseLimit('')).toBe(20);
  });
  it('clamps below 1 to 1', () => {
    expect(parseLimit('-5')).toBe(1);
    expect(parseLimit('0')).toBe(1);
  });
  it('clamps above max to max', () => {
    expect(parseLimit('500', 50, 20)).toBe(50);
    expect(parseLimit('999', 200, 20)).toBe(200);
  });
  it('honours mid-range values', () => {
    expect(parseLimit('25', 50, 20)).toBe(25);
  });
  it('falls back to default on garbage', () => {
    expect(parseLimit('hello')).toBe(20);
    expect(parseLimit('NaN')).toBe(20);
  });
});

describe('parseOffset', () => {
  it('defaults to 0', () => {
    expect(parseOffset(null)).toBe(0);
    expect(parseOffset(undefined)).toBe(0);
    expect(parseOffset('')).toBe(0);
  });
  it('clamps negative to 0', () => {
    expect(parseOffset('-1')).toBe(0);
  });
  it('preserves positive integers', () => {
    expect(parseOffset('100')).toBe(100);
  });
  it('falls back to 0 on garbage', () => {
    expect(parseOffset('NaN')).toBe(0);
    expect(parseOffset('abc')).toBe(0);
  });
});

describe('parseUuid', () => {
  it('accepts a canonical lower-case UUID', () => {
    expect(parseUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000',
    );
  });
  it('lowercases mixed-case input', () => {
    expect(parseUuid('550E8400-E29B-41D4-A716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000',
    );
  });
  it('rejects malformed values', () => {
    expect(parseUuid(null)).toBeNull();
    expect(parseUuid('')).toBeNull();
    expect(parseUuid('not-a-uuid')).toBeNull();
    // braces / urn prefix are NOT accepted
    expect(parseUuid('{550e8400-e29b-41d4-a716-446655440000}')).toBeNull();
    expect(parseUuid('urn:uuid:550e8400-e29b-41d4-a716-446655440000')).toBeNull();
    // extra characters
    expect(parseUuid('550e8400-e29b-41d4-a716-446655440000-extra')).toBeNull();
  });
});
