import { Show } from 'solid-js';
import type { ContinuityCandidate, StorageMeterView } from '../lib/sala';
import BookCoverSvg from './BookCoverSvg';

/**
 * Top dashboard of the Sala de lectura (S3): the Continuity card (real reading
 * progress/state of the book the user is most likely to resume, with a clean
 * brutalist fallback when their shelf is still empty) beside the local
 * IndexedDB storage card (real cached KB, offline book count and IDB status).
 */
export interface HeroDashProps {
	continuity: ContinuityCandidate | null;
	meter: StorageMeterView;
	storageAvailable: boolean;
	clearing: boolean;
	onClearOffline: () => void;
	onOpenUpload: () => void;
}

export default function HeroDash(props: HeroDashProps) {
	return (
		<section class="hero-dash" aria-label="Lectura actual y almacenamiento">
			<Show
				when={props.continuity}
				fallback={
					<div class="resume-card">
						<div class="resume-cover">
							<BookCoverSvg variant={0} bookId={0} prefix="hero-empty" />
						</div>
						<div class="resume-info">
							<div>
								<div class="kicker">
									<span>tu sala está vacía · empezá por acá</span>
									<span>sin sync local</span>
								</div>
								<h1 class="resume-title">Tu sala de lectura está lista</h1>
								<div class="resume-author">subí tu primer PDF · queda privado hasta que lo publiques</div>
							</div>
							<p class="resume-quote">
								«Todavía no hay una lectura en curso: cuando subas un libro, esta tarjeta te devuelve
								exactamente a la página donde dejaste.»
							</p>
							<div class="resume-bottom">
								<button class="btn-primary" type="button" onClick={() => props.onOpenUpload()}>
									+ Subir primer libro
								</button>
							</div>
						</div>
					</div>
				}
			>
				{(continuity) => (
					<div class="resume-card">
						<div class="resume-cover">
							<BookCoverSvg
								variant={continuity().book.coverVariant}
								bookId={continuity().book.id}
								prefix="hero"
							/>
						</div>
						<div class="resume-info">
							<div>
								<div class="kicker">
									<span>{continuity().kickerLeft}</span>
									<span>{continuity().kickerRight}</span>
								</div>
								<h1 class="resume-title">{continuity().book.title}</h1>
								<div class="resume-author">
									{continuity().book.author} · {continuity().book.catLabel}
								</div>
							</div>
							<p class="resume-quote">{continuity().quote}</p>
							<div class="resume-bottom">
								<div class="prog-wrap">
									<div class="prog-labels">
										<span>{continuity().progressLabel}</span>
										<b>{continuity().progressPct}%</b>
									</div>
									<div class="prog-bar">
										<i style={{ width: `${continuity().progressPct}%` }} />
									</div>
								</div>
								<a class="btn-primary" href={continuity().href}>
									Seguir en Vigilia →
								</a>
							</div>
						</div>
					</div>
				)}
			</Show>

			<aside class="storage-card" aria-label="Almacenamiento local de la app">
				<div>
					<div class="storage-head">
						<span>almacenamiento local (pwa)</span>
						<b>{props.meter.badge}</b>
					</div>
					<div class="storage-big">{props.meter.countLabel}</div>
					<p class="storage-sub">
						Guardás solo los <code>reading.json</code> que querés llevar sin señal. Tu progreso y
						subrayados quedan a salvo en tu cuenta.
					</p>
				</div>
				<div>
					<div class="prog-bar storage-prog">
						<i style={{ width: `${props.meter.barPercent}%` }} />
					</div>
					<div class="storage-foot">
						<button
							class="btn-sec"
							type="button"
							disabled={props.meter.count === 0 || props.clearing}
							onClick={() => props.onClearOffline()}
						>
							{props.clearing ? 'Liberando…' : 'Liberar caché local'}
						</button>
						<span class="storage-status">
							{props.storageAvailable ? 'INDEXEDDB · ACTIVO' : 'INDEXEDDB · NO DISPONIBLE'}
						</span>
					</div>
				</div>
			</aside>
		</section>
	);
}
