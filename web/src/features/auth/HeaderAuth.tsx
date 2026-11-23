import { createSignal } from 'solid-js';
import { signOutCleanly } from './api/authActions';

export type HeaderAuthProps = {
	label: string;
};

/**
 * Signed-in header chip with a CSP-safe sign-out button.
 */
export default function HeaderAuth(props: HeaderAuthProps) {
	const [pending, setPending] = createSignal(false);

	async function handleSignOut() {
		if (pending()) return;
		setPending(true);
		try {
			await signOutCleanly();
		} finally {
			window.location.assign('/');
		}
	}

	return (
		<div class="flex items-center gap-3">
			<span class="hidden max-w-[10rem] truncate text-xs text-muted-foreground sm:inline" title={props.label}>
				{props.label}
			</span>
			<button
				type="button"
				disabled={pending()}
				onClick={() => void handleSignOut()}
				class="rounded-sm border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-aka/50 hover:text-aka disabled:opacity-60"
			>
				{pending() ? 'Saliendo…' : 'Salir'}
			</button>
		</div>
	);
}
