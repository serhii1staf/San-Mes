// Jest setup for per-account-cache property-based tests.
//
// Provides an in-memory mock of @react-native-async-storage/async-storage so
// property-based tests (fast-check) can exercise cacheService / syncThrottle
// cheaply across 100+ iterations without touching a real native module.
//
// Property-test convention (see .kiro/specs/per-account-cache/design.md):
//   - Tag every property test with a comment in the form:
//       // Feature: per-account-cache, Property {N}: {краткий текст свойства}
//   - Run each property with at least 100 iterations: fc.assert(prop, { numRuns: 100 })
//   - One property test per numbered property from the Correctness Properties section.

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Reset the in-memory AsyncStorage store and mock call history between tests so
// each property run starts from a clean, isolated state.
beforeEach(() => {
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  if (AsyncStorage.__INTERNAL_MOCK_STORAGE__) {
    AsyncStorage.__INTERNAL_MOCK_STORAGE__ = {};
  }
  if (typeof jest !== 'undefined' && jest.clearAllMocks) {
    jest.clearAllMocks();
  }
});
