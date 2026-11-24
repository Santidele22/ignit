import { For, Show, createSignal, onMount } from 'solid-js';
import { fetchStyleReference, type StyleReference } from '../lib/admin-api';

/**
 * /admin section showing the editorial design/style reference the analysis
 * LLM applies (S6). Data comes from `GET /admin/ai/style-reference`, the same
 * single source that builds the system prompt, so the panel can never drift
 * from what the model actually uses.
 */
export function StyleReferenceSection() {
	const [reference, setReference] = createSignal<StyleReference | null>(null);
	const [error, setError] = createSignal<string | null>(null);
	const [open, setOpen] = createSignal(false);

	onMount(async () => {
		try {
			setReference(await fetchStyleReference());
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'No se pudo cargar la referencia.');
		}
	});

	return (
		<section class="style-reference" aria-label="Referencia de diseño del LLM">
			<button
				class="style-toggle"
				type="button"
				aria-expanded={open()}
				onClick={() => setOpen(!open())}
			>
				Referencia de diseño del LLM
				<span class="style-caret" aria-hidden="true">
					{open() ? '−' : '+'}
				</span>
			</button>
			<Show when={open()}>
				<Show when={error()}>
					<p class="firewall-note firewall-error">{error()}</p>
				</Show>
				<Show when={reference()}>
					{(ref) => (
						<div class="style-body">
							<p class="style-role">{ref().role}</p>
							<p class="style-boundary">{ref().securityBoundary}</p>
							<p class="style-label">
								{ref().qualityLabel} — el modelo ve {ref().inputs.readingText} (hasta{' '}
								{ref().inputs.maxCharacters.toLocaleString('es-AR')} caracteres).
							</p>
							<ol class="style-rubric">
								<For each={ref().qualityRubric}>
									{(level) => (
										<li>
											<span class="rubric-score">{level.score}</span> {level.description}
										</li>
									)}
								</For>
							</ol>
							<p class="style-safety">
								<strong>Safety:</strong> {ref().safetyRule}
							</p>
							<div class="style-never">
								<p class="style-never-title">El modelo no juzga:</p>
								<ul>
									<For each={ref().neverJudges}>
										{(item) => <li>{item}</li>}
									</For>
								</ul>
							</div>
						</div>
					)}
				</Show>
			</Show>
		</section>
	);
}
