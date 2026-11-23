import { createSignal, Show } from 'solid-js';
import { signInWithEmail, type AuthActionError } from './api/authActions';
import { safeRedirectTarget } from './paths';

const INVALID_CREDENTIALS = 'El correo o la contraseña no son correctos.';
const TOO_MANY_ATTEMPTS = 'Demasiados intentos seguidos. Esperá un momento antes de volver a probar.';
const GENERIC_ERROR = 'No se pudo iniciar sesión. Inténtalo de nuevo en unos minutos.';
const CONNECTION_ERROR = 'No se pudo conectar con el servidor. Inténtalo de nuevo en unos minutos.';

function signInErrorMessage(error: AuthActionError): string {
	if (error?.status === 401) return INVALID_CREDENTIALS;
	if (error?.status === 429) return TOO_MANY_ATTEMPTS;
	return error?.message || GENERIC_ERROR;
}

export default function LoginForm() {
	const [email, setEmail] = createSignal('');
	const [password, setPassword] = createSignal('');
	const [error, setError] = createSignal('');
	const [pending, setPending] = createSignal(false);

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (pending()) return;

		setPending(true);
		setError('');

		try {
			const { error: authError } = await signInWithEmail(email(), password());
			if (authError) {
				setError(signInErrorMessage(authError));
				setPending(false);
				return;
			}

			const params = new URLSearchParams(window.location.search);
			const requested = params.get('redirect') ?? params.get('next');
			window.location.assign(safeRedirectTarget(requested));
		} catch {
			setError(CONNECTION_ERROR);
			setPending(false);
		}
	}

	return (
		<form onSubmit={handleSubmit} class="mt-6 flex flex-col gap-4">
			<div class="flex flex-col gap-2">
				<label for="login-email" class="text-sm font-medium">Correo electrónico</label>
				<input
					id="login-email"
					name="email"
					type="email"
					required
					autocomplete="email"
					value={email()}
					onInput={(event) => setEmail(event.currentTarget.value)}
					disabled={pending()}
					placeholder="lector@correo.com"
					class="h-11 rounded-md border border-input bg-background px-4 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-aka focus:ring-2 focus:ring-aka/20 disabled:opacity-60"
				/>
			</div>
			<div class="flex flex-col gap-2">
				<label for="login-password" class="text-sm font-medium">Contraseña</label>
				<input
					id="login-password"
					name="password"
					type="password"
					required
					autocomplete="current-password"
					value={password()}
					onInput={(event) => setPassword(event.currentTarget.value)}
					disabled={pending()}
					class="h-11 rounded-md border border-input bg-background px-4 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-aka focus:ring-2 focus:ring-aka/20 disabled:opacity-60"
				/>
			</div>
			<button
				type="submit"
				disabled={pending()}
				class="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-foreground px-6 text-sm font-medium text-background transition-colors hover:bg-aka hover:text-aka-foreground disabled:cursor-wait disabled:opacity-60"
			>
				{pending() ? 'Entrando…' : 'Entrar'}
			</button>
			<Show when={error()}>
				<p role="alert" class="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground">
					{error()}
				</p>
			</Show>
		</form>
	);
}
