/**
 * Shared response helpers.
 *
 * `Access-Control-Allow-Origin: *` without `Allow-Credentials` is deliberate:
 * a browser will not attach the session cookie to a cross-origin request under
 * those headers, so a third-party page gets a `401` and nothing else. In dev the
 * Vite proxy makes `/api` same-origin, and in the container the API serves the
 * web app itself, so the permissive origin is never actually exercised.
 */
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...CORS_HEADERS, ...headers } });
}
