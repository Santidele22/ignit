import { createSignal, Show } from 'solid-js';
import { signUpWithEmail, type AuthActionError } from './api/authActions';
import { safeRedirectTarget } from './paths';

const TOO_MANY_ATTEMPTS = 'Demasiados intentos seguidos. Esperá un momento antes de volver a probar.';
const GENERIC_ERROR = 'No se pudo crear la cuenta. Revisá los datos e intentá de nuevo.';
const CONNECTION_ERROR = 'No se pudo conectar con el servidor. Inténtalo de nuevo en unos minutos.';

function signUpErrorMessage(error: AuthActionError): string {
	if (error?.status === 429) return TOO_MANY_ATTEMPTS;
	if (error?.status === 409) {
		return error?.message || 'Ya existe una cuenta registrada con ese correo.';
	}
	if (error?.status === 422 || error?.status === 400) {
		return error?.message || 'El correo ya está registrado o la contraseña no cumple el mínimo (8 caracteres).';
	}
	return error?.message || GENERIC_ERROR;
}

export default function RegisterForm() {
	const [name, setName] = createSignal('');
	const [email, setEmail] = createSignal('');
	const [password, setPassword] = createSignal('');
	const [error, setError] = createSignal('');
	const [pending, setPending] = createSignal(false);

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (pending()) return;

		if (password().length < 8) {
			setError('La contraseña necesita al menos 8 caracteres.');
			return;
		}

		setPending(true);
		setError('');

		try {
			const { error: authError } = await signUpWithEmail(name(), email(), password());
			if (authError) {
				setError(signUpErrorMessage(authError));
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
				<label for="register-name" class="text-sm font-medium">Nombre</label>
				<input
					id="register-name"
					name="name"
					type="text"
					required
					autocomplete="name"
					value={name()}
					onInput={(event) => setName(event.currentTarget.value)}
					disabled={pending()}
					placeholder="Tu nombre"
					class="h-11 rounded-md border border-input bg-background px-4 text-base outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-aka focus:ring-2 focus:ring-aka/20 disabled:opacity-60 sm:text-sm"
				/>
			</div>
			<div class="flex flex-col gap-2">
				<label for="register-email" class="text-sm font-medium">Correo electrónico</label>
				<input
					id="register-email"
					name="email"
					type="email"
					required
					autocomplete="email"
					value={email()}
					onInput={(event) => setEmail(event.currentTarget.value)}
					disabled={pending()}
					placeholder="lector@correo.com"
					class="h-11 rounded-md border border-input bg-background px-4 text-base outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-aka focus:ring-2 focus:ring-aka/20 disabled:opacity-60 sm:text-sm"
				/>
			</div>
			<div class="flex flex-col gap-2">
				<label for="register-password" class="text-sm font-medium">Contraseña</label>
				<input
					id="register-password"
					name="password"
					type="password"
					required
					minlength={8}
					autocomplete="new-password"
					value={password()}
					onInput={(event) => setPassword(event.currentTarget.value)}
					disabled={pending()}
					placeholder="Mínimo 8 caracteres"
					class="h-11 rounded-md border border-input bg-background px-4 text-base outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-aka focus:ring-2 focus:ring-aka/20 disabled:opacity-60 sm:text-sm"
				/>
			</div>
			<button
				type="submit"
				disabled={pending()}
				class="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-foreground px-6 text-sm font-medium text-background transition-colors hover:bg-aka hover:text-aka-foreground disabled:cursor-wait disabled:opacity-60"
			>
				{pending() ? 'Creando cuenta…' : 'Crear cuenta'}
			</button>
			<Show when={error()}>
				<p role="alert" class="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground">
					{error()}
				</p>
			</Show>
		</form>
	);
}
