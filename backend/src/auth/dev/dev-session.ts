/**
 * Public surface of the interim `AUTH_MODE=dev` session. The rest of the dev
 * auth stack (and the e2e suites) import every helper from this path, so the
 * implementation lives in the focused modules below and is re-exported here:
 * the token codec and HMAC (`dev-session-token`), its payload shape and
 * lifetime (`dev-session-payload`), the cookie (`dev-session-cookie`) and the
 * constant-time credential check (`dev-session-credential`).
 */
export { matchesCredential } from './dev-session-credential.js';
export {
  DEV_SESSION_COOKIE,
  devSessionCookie,
  readCookie,
} from './dev-session-cookie.js';
export {
  DEFAULT_DEV_SESSION_TTL,
  readDevSessionTtl,
  type DevSessionPayload,
} from './dev-session-payload.js';
export { signDevSession, verifyDevSession } from './dev-session-token.js';
