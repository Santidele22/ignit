import { For, Show, createEffect, createSignal } from 'solid-js';
import { fetchFirewallReport } from '../lib/admin-api';
import {
	firewallCheckLabel,
	firewallTone,
	firewallTierLabel,
	summarizeFirewallReport,
	type FirewallReport,
} from '../lib/admin-firewall';

/**
 * Expandable per-book security pipeline (S4): lazily loads the stored
 * `PdfFirewallReport` sidecar through `GET /admin/books/:id/firewall` the
 * first time the admin opens the row, then renders the three tiers with every
 * check, its `passed` / `violation` / `skipped` state and the raw violation
 * codes. A `404` (pre-sidecar upload or no file) renders a neutral note
 * instead of an error banner.
 */
export function FirewallPipeline(props: { bookId: number; open: boolean }) {
	const [report, setReport] = createSignal<FirewallReport | null>(null);
	const [notFound, setNotFound] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	const [loading, setLoading] = createSignal(false);

	async function load() {
		if (report() || notFound() || loading()) return;
		setLoading(true);
		setError(null);
		try {
			setReport(await fetchFirewallReport(props.bookId));
		} catch (cause) {
			const status = (cause as { status?: number }).status;
			if (status === 404) {
				setNotFound(true);
			} else {
				setError(cause instanceof Error ? cause.message : 'No se pudo cargar el reporte.');
			}
		} finally {
			setLoading(false);
		}
	}

	// Reactive load trigger: the component is created once per row with
	// `open=false`, so the load must fire when the admin expands it (verified:
	// a plain body statement never re-runs after mount).
	createEffect(() => {
		if (props.open) void load();
	});

	const summary = () => summarizeFirewallReport(report());

	return (
		<Show when={props.open}>
			<div class="firewall-panel" role="region" aria-label="Pipeline de seguridad del PDF">
				<Show when={loading() && !report()}>
					<p class="firewall-note">Cargando el pipeline…</p>
				</Show>
				<Show when={error()}>
					<p class="firewall-note firewall-error">{error()}</p>
				</Show>
				<Show when={notFound()}>
					<p class="firewall-note">
						Sin reporte de firewall: subida anterior al pipeline o libro sin archivo.
					</p>
				</Show>
				<Show when={report()}>
					<p class="firewall-summary" data-verdict={summary().verdict}>
						{summary().verdict === 'ok' ? 'PDF aceptado' : 'PDF rechazado'}
						{' · '}
						{summary().pageCount} páginas
						<Show when={summary().failedTier}>
							{' · '}
							rechazo en {summary().failedTier}
						</Show>
					</p>
					<ul class="firewall-tiers">
						<For each={report()!.tiers}>
							{(tier) => (
								<li class="firewall-tier" data-tone={tier.status === 'passed' ? 'ok' : tier.status}>
									<p class="tier-head">
										<span class="tier-name">{firewallTierLabel(tier.name)}</span>
										<span class="tier-status">
											{tier.status === 'passed' ? 'aprobado' : tier.status === 'violation' ? 'rechazo' : 'omitido'}
										</span>
									</p>
									<ul class="tier-checks">
										<For each={tier.checks}>
											{(check) => (
												<li class="tier-check" data-tone={firewallTone(check.status)}>
													<span class="check-name">{firewallCheckLabel(check.id)}</span>
													<span class="check-status">
														{check.status === 'passed'
															? '✓'
															: check.status === 'violation'
																? '✕'
																: '—'}
													</span>
													<Show when={check.violations.length > 0}>
														<span class="check-codes">
															{check.violations
																.map((violation) => (violation.detail ? `${violation.code} ${violation.detail}` : violation.code))
																.join(' · ')}
														</span>
													</Show>
												</li>
											)}
										</For>
									</ul>
								</li>
							)}
						</For>
					</ul>
				</Show>
			</div>
		</Show>
	);
}
