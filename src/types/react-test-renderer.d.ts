// Local declaration shim for `react-test-renderer`.
//
// `react-test-renderer` is a transitive dependency of `react` (peer of
// `jest-expo`) and ships NO bundled declarations. Because `expo/tsconfig.base`
// enables `allowJs`, TypeScript resolves its untyped `index.js` and never falls
// back to `@types/react-test-renderer`, so this ambient shim is the only thing
// that types the test suite.
//
// Two rejected alternatives, for the next person who wonders:
//   - Installing `@types/react-test-renderer`: it is never consulted (the `.js`
//     resolution wins), so it changes nothing on its own.
//   - A tsconfig `paths` remap onto that types package: `jest-expo` mirrors
//     tsconfig `paths` into Jest's `moduleNameMapper`, which redirects the
//     RUNTIME import at a types-only folder and breaks every suite.
//
// Surface covered — exactly what the test files use:
//   - `TestRenderer.create(element, options?)`
//   - `act(cb)` — both `import { act }` and `TestRenderer.act`
//   - `renderer.toJSON()`, `.toTree()`, `.update()`, `.root`, `.unmount()`
//   - `root.find*` / `root.findAll*` for the property tests
//
// SHAPE: a `namespace TestRenderer` merged with a same-named `const` that is
// the default export. That merge is what makes the single imported identifier
// usable as a VALUE (`TestRenderer.create(...)`) *and* as a TYPE namespace
// (`TestRenderer.ReactTestRenderer`) — both spellings appear across the suite.
// The namespace members are ALSO re-exported at module top level so
// `import type { ReactTestInstance } from 'react-test-renderer'` works.
//
// If a future test needs more API, extend this file rather than installing the
// upstream types — keeps devDependencies frozen.

declare module 'react-test-renderer' {
  namespace TestRenderer {
    interface ReactTestInstance {
      type: any;
      props: Record<string, any>;
      parent: ReactTestInstance | null;
      children: Array<ReactTestInstance | string>;
      instance: any;
      findAll(
        predicate: (node: ReactTestInstance) => boolean,
        options?: { deep: boolean },
      ): ReactTestInstance[];
      find(predicate: (node: ReactTestInstance) => boolean): ReactTestInstance;
      findByType(type: any): ReactTestInstance;
      findAllByType(type: any, options?: { deep: boolean }): ReactTestInstance[];
      findByProps(props: Record<string, any>): ReactTestInstance;
      findAllByProps(
        props: Record<string, any>,
        options?: { deep: boolean },
      ): ReactTestInstance[];
    }

    interface ReactTestRendererJSON {
      type: string;
      props: Record<string, any>;
      children: Array<ReactTestRendererJSON | string> | null;
    }

    interface ReactTestRenderer {
      toJSON(): ReactTestRendererJSON | ReactTestRendererJSON[] | null;
      toTree(): any;
      update(element: any): void;
      unmount(): void;
      getInstance(): any;
      root: ReactTestInstance;
    }

    interface TestRendererOptions {
      createNodeMock?: (element: any) => any;
    }
  }

  // Top-level type re-exports — covers
  // `import type { ReactTestInstance } from 'react-test-renderer'`.
  export type ReactTestInstance = TestRenderer.ReactTestInstance;
  export type ReactTestRendererJSON = TestRenderer.ReactTestRendererJSON;
  export type ReactTestRenderer = TestRenderer.ReactTestRenderer;
  export type TestRendererOptions = TestRenderer.TestRendererOptions;

  // Named exports — covers `import { act, create } from 'react-test-renderer'`.
  export function create(
    element: any,
    options?: TestRenderer.TestRendererOptions,
  ): TestRenderer.ReactTestRenderer;

  export function act<T = void>(cb: () => T | Promise<T>): Promise<T>;

  // Default export — covers `import TestRenderer from 'react-test-renderer'`.
  // Shares the namespace's identifier so both meanings travel with the import.
  const TestRenderer: {
    create: typeof create;
    act: typeof act;
  };
  export default TestRenderer;
}
