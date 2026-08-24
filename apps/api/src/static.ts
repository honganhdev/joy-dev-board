/**
 * Serves the built web app next to `/api/*`, so the container is one process on
 * one port rather than a static server plus an API.
 *
 * Absent in a source checkout — `bun run dev:web` serves the app in dev and
 * proxies `/api` here, so this handler only does anything once `dist/` exists.
 */
import { existsSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';

/**
 * Content-Security-Policy for the board.
 *
 * `script-src 'self'` with no `unsafe-inline` and no `unsafe-eval` is the point
 * of the header: the Vite build emits a single external module, so nothing
 * legitimate needs an inline script, and anything injected into the page cannot
 * run. `style-src` does allow inline, because Radix positions and animates its
 * overlays through the `style` attribute; that is a styling hole, not a code
 * execution one. `connect-src 'self'` keeps any exfiltration attempt on-origin,
 * and `frame-ancestors 'none'` keeps the board out of someone else's iframe.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const DOCUMENT_HEADERS = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};

export type StaticHandler = (pathname: string) => Promise<Response | null>;

/** Never serves anything. Used when there is no build to serve. */
const NO_STATIC: StaticHandler = async () => null;

export function createStaticHandler(distPath: string | null): StaticHandler {
  if (!distPath) return NO_STATIC;

  const indexPath = join(distPath, 'index.html');
  if (!existsSync(indexPath)) return NO_STATIC;

  // Compared against with the separator attached: a bare prefix test would also
  // accept a sibling directory whose name merely starts with dist's.
  const root = distPath.endsWith(sep) ? distPath : distPath + sep;

  async function document(): Promise<Response> {
    return new Response(Bun.file(indexPath), {
      headers: {
        ...DOCUMENT_HEADERS,
        'Content-Type': 'text/html; charset=utf-8',
        // The document names the current hashed bundle, so it must never be the
        // stale copy pointing at assets a deploy has already replaced.
        'Cache-Control': 'no-store',
      },
    });
  }

  return async function serve(pathname: string): Promise<Response | null> {
    if (pathname === '/' || pathname === '/index.html') return document();

    // Resolve, then confirm the result is still inside dist: `..` segments in a
    // request path must not be able to reach the database or the source.
    let candidate: string;
    try {
      candidate = normalize(join(distPath, decodeURIComponent(pathname)));
    } catch {
      // A malformed escape sequence names no file.
      return null;
    }
    if (!candidate.startsWith(root)) return null;

    const file = Bun.file(candidate);
    if (await file.exists()) {
      // Vite fingerprints everything under /assets, so those are safe to pin.
      const immutable = pathname.startsWith('/assets/');
      return new Response(file, {
        headers: {
          ...DOCUMENT_HEADERS,
          'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        },
      });
    }

    // Anything else is a client-side route: hand back the document and let the
    // app work out what it means.
    return document();
  };
}
