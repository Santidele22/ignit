/**
 * Shape of the session Better Auth returns from `get-session`. Only the fields
 * the panel renders are declared: `role` comes from the `admin` plugin and the
 * profile fields from `user.additionalFields` in the backend config.
 */
export type AuthUser = {
	id?: string;
	name?: string;
	email: string;
	role?: string;
};

export type AuthSession = {
	/** Better Auth session record; the interim dev snapshot only carries the user. */
	session?: {
		id: string;
		expiresAt: Date | string;
	};
	user: AuthUser;
};

export type AuthSessionStatus = 'loading' | 'authenticated' | 'anonymous';

/** Auth stack the API reports on its public mode endpoint. */
export type { AuthMode } from '../../shared/api/sessionMode';

/** Snapshot the interim dev API returns from `/auth/dev-session`. */
export type DevSessionSnapshot = {
	user: {
		id?: string;
		email: string;
		name?: string;
		role: string;
	};
};
