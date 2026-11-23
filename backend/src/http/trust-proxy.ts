/** Express `trust proxy` configuration shared by the app bootstrap (issue 38). */

/**
 * How many trusted proxy hops sit in front of the backend.
 *
 * The download rate limit keys on `req.ip`, which is the socket address unless
 * the proxy is trusted: every visitor behind the Astro proxy would share the
 * proxy's own address, so the "10 downloads per day per IP" limit becomes one
 * global counter for the whole world.
 *
 * The setting stays a fixed hop count — never `true`, because a `trust proxy`
 * of `true` lets a client spoof its address with its own `x-forwarded-for`.
 * Today's architecture is exactly one hop (the Astro SSR proxy); a reverse
 * proxy counts as one more hop with `TRUST_PROXY_HOPS`, and `0` keeps the raw
 * socket address for direct clients.
 */
export function trustProxyHops(env: NodeJS.ProcessEnv = process.env): number {
  // An empty variable is `Number('') === 0`, which would silently disable the
  // trust: treat unset and blank as the default instead.
  const raw = env.TRUST_PROXY_HOPS?.trim();
  const hops = Number(raw ?? 1);

  return raw && Number.isInteger(hops) && hops >= 0 && hops <= 2 ? hops : 1;
}
