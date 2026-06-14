// Local declaration shim for `react-test-renderer`.
//
// `react-test-renderer` is pulled in as a transitive dependency of `react`
// (peer of `jest-expo`), but `@types/react-test-renderer` is not installed
// in this project to keep devDependencies minimal. This shim covers the
// narrow surface our test files actually use:
//
//   - `TestRenderer.create(element, options?)`
//   - `act(cb)` — both `import { act }` and `TestRenderer.act`
//   - `renderer.toJSON()`, `renderer.root`, `renderer.unmount()`
//   - `root.findAll(predicate)` / `root.find(predicate)` for property tests
//   - Type references like `TestRenderer.ReactTestRenderer` /
//     `TestRenderer.ReactTestInstance`
//
// Pattern: declare a namespace AND a default const that share the same name.
// This mirrors the historical `@types/react-test-renderer` shape and lets
// the existing test files use both `TestRenderer.X` as a type AND named
// imports (`import TestRenderer, { act } from 'react-test-renderer'`).
//
// If a future test needs more API, extend this file rather than installing
// the upstream types — keeps devDependencies frozen.

declare module 'react-test-renderer' {
  namespace TestRenderer {
    interface ReactTestInstance {
      type: any;
      props: Record<string, any>;
      parent: ReactTestInstance | null;
      children: Array<ReactTestInstance | string>;
      instance: any;
      findAll(predicate: (node: ReactTestInstance) => boolean): ReactTestInstance[];
      find(predicate: (node: ReactTestInstance) => boolean): ReactTestInstance;
      findByType(type: any): ReactTestInstance;
      findAllByType(type: any): ReactTestInstance[];
      findByProps(props: Record<string, any>): ReactTestInstance;
      findAllByProps(props: Record<string, any>): ReactTestInstance[];
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

  // Named exports — covers `import { act, create } from 'react-test-renderer'`.
  export function create(
    element: any,
    options?: TestRenderer.TestRendererOptions
  ): TestRenderer.ReactTestRenderer;

  export function act<T = void>(cb: () => T | Promise<T>): Promise<T>;

  // Default export — covers `import TestRenderer from 'react-test-renderer'`.
  // The const carries the same identifier as the namespace above, so
  // `TestRenderer.ReactTestRenderer` resolves both as a value access and as
  // a type reference (declaration merging).
  const TestRenderer: {
    create: typeof create;
    act: typeof act;
  };
  export default TestRenderer;
}
