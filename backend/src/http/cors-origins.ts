/**
 * Browser origins the API answers with CORS. Local development is same-origin
 * through the Astro Vite proxy, so the defaults cover the direct hits the dev
 * servers make; a cross-site deployment (frontend on Workers, API on
 * Render) lists the frontend origin in `CORS_ORIGINS` (comma-separated).
 *
 * Credentials stay on: the admin session travels in a cookie (or, per issue
 * #43, in an `Authorization` header later), both of which need
 * `Access-Control-Allow-Credentials`.
 */
const DEFAULT_CORS_ORIGINS = ['http://localhost:4321', 'http://localhost:3987'];

export function corsOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  return configured.length > 0 ? configured : DEFAULT_CORS_ORIGINS;
}
