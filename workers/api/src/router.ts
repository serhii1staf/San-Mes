// Tiny hand-rolled router state, lifted out of `index.ts` so route
// modules can `import { register }` from here without a circular
// dependency on the entry point. (`index.ts` imports each route module
// at module-init time; if those modules then re-imported `register`
// from `index.ts` itself, the binding wouldn't be available yet under
// the bundler's evaluation order — vitest surfaced this as
// `register is not a function` on test runs.)
//
// Patterns use `:param` placeholders; matched values land on `params`.
// We keep itty-router's footprint out of the bundle by writing this
// ourselves — it's about 30 lines plus a Map.

export type Handler = (
  req: Request,
  env: import('./db').Env,
  ctx: ExecutionContext,
  params: Record<string, string>,
  authedUserId: string | null,
) => Promise<Response> | Response;

export interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
}

function compile(method: string, path: string, handler: Handler): Route {
  const paramNames: string[] = [];
  const regex = path.replace(/:([a-zA-Z0-9_]+)/g, (_, name) => {
    paramNames.push(name);
    return '([^/]+)';
  });
  return { method, pattern: new RegExp(`^${regex}$`), paramNames, handler };
}

export const ROUTES: Route[] = [];

/**
 * Register a route from a route module. Called at import time so the
 * registration finishes before the first request is dispatched. Routes
 * are matched in registration order; for patterns whose lengths differ
 * (e.g. `/v1/profiles/:id` vs `/v1/profiles/:id/posts`) the regex's
 * end anchor naturally disambiguates. For overlapping patterns at the
 * same depth, register the more specific (literal-prefixed) one first.
 */
export function register(method: string, path: string, handler: Handler): void {
  ROUTES.push(compile(method, path, handler));
}
