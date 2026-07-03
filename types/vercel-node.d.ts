// Minimal ambient type shim for `@vercel/node`.
//
// The `api/**` routes are Vercel serverless functions that are deployed and
// type-checked by Vercel's own toolchain (which provides `@vercel/node`).
// They are NOT part of the Expo/Metro app bundle, so we don't ship the
// `@vercel/node` runtime package as an app dependency. This shim mirrors the
// subset of the real `@vercel/node` public types that the routes actually use
// (`VercelRequest` extends Node's `IncomingMessage`; `VercelResponse` extends
// `ServerResponse` plus the Express-style `status()/json()/send()/redirect()`
// helpers), so `tsc --noEmit` stays clean locally without a heavy dev dep.

declare module '@vercel/node' {
  import type { IncomingMessage, ServerResponse } from 'http';

  export interface VercelRequestCookies {
    [key: string]: string;
  }

  export interface VercelRequestQuery {
    [key: string]: string | string[];
  }

  export type VercelRequestBody = any;

  export interface VercelRequest extends IncomingMessage {
    query: VercelRequestQuery;
    cookies: VercelRequestCookies;
    body: VercelRequestBody;
  }

  export interface VercelResponse extends ServerResponse {
    send: (body: any) => VercelResponse;
    json: (jsonBody: any) => VercelResponse;
    status: (statusCode: number) => VercelResponse;
    redirect: (statusOrUrl: string | number, url?: string) => VercelResponse;
  }

  export type VercelApiHandler = (
    req: VercelRequest,
    res: VercelResponse,
  ) => void | Promise<void>;
}
