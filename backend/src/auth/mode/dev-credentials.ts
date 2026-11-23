/**
 * Whether the interim dev account is complete enough to sign in. Pure: it only
 * reads the env it is given, so it stays safe while modules are imported.
 */
export function hasDevCredentials(env: NodeJS.ProcessEnv): boolean {
  return (
    Boolean(env.ADMIN_EMAIL?.trim()) &&
    Boolean(env.ADMIN_PASSWORD) &&
    // Required too: signing with an empty HMAC key would make the session
    // cookie forgeable by anyone who knows ADMIN_EMAIL.
    Boolean(env.DEV_SESSION_SECRET?.trim())
  );
}
