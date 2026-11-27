// Lightweight stub to prevent unused @supabase/auth-js (~450 KiB) from being bundled by @neondatabase/auth.
export class AuthError extends Error {}
export class AuthApiError extends AuthError {}
export class AuthClient {}
export function isAuthError(err: unknown): err is AuthError {
	return err instanceof AuthError;
}
export function isAuthApiError(err: unknown): err is AuthApiError {
	return err instanceof AuthApiError;
}
export default {};
