/** Name of the cookie that carries the interim dev session. */
export const DEV_SESSION_COOKIE = 'dev_session';

/** Reads one cookie value out of a `Cookie` header. */
export function readCookie(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');

    if (separator === -1) {
      continue;
    }

    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }

  return undefined;
}

/**
 * Serialises the session cookie. `maxAgeSeconds` of `0` yields the expiring,
 * empty cookie the logout route answers with. `secure` mirrors the request's
 * transport security: the browser only sends the cookie back over HTTPS when
 * it was set, so it must only be on when the request itself is secure
 * (`req.secure`, including `x-forwarded-proto` when the proxy is trusted).
 */
export function devSessionCookie(
  value: string,
  maxAgeSeconds: number,
  secure = false,
): string {
  return [
    `${DEV_SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}
