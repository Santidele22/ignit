import { Show, createSignal } from 'solid-js';
import { formatLicenseBadge } from '../../../entities/book/open-licenses';
import { formatSizeKb, type SalaBook } from '../lib/sala';
import BookCoverSvg from './BookCoverSvg';

/**
 * One numbered ficha of the shelf (S2/S5, artboard
 * `design/biblioteca-tecnico-literatura/05-biblioteca-estudio-despeje.html`):
 * `01/02/…` index, cover thumb, domain chip, pages + size metadata line, mini
 * progress bar, and the real actions of the sala — `Leer` (the `/lecturas/:id`
 * reader when the PDF exists), `Ficha`/`Editar` modals and the primary
 * `Añadir`/`Quitar` IndexedDB toggle of `offlineStore.ts`.
 */
export interface BookTomoCardProps {
	book: SalaBook;
	/** `noche-azul`/`original` safe id namespace for the cover `<defs>`. */
	coverPrefix?: string;
	/** The app is in offline test mode (uncached books cannot be downloaded). */
	appOffline: boolean;
	/** This card currently has an IndexedDB write/delete in flight. */
	busy?: boolean;
	onToggleOffline: (book: SalaBook) => void;
	onEdit?: (book: SalaBook) => void;
	onOpenFicha?: (book: SalaBook) => void;
}

export default function BookTomoCard(props: BookTomoCardProps) {
	const hasFile = () => props.book.hasFile !== false;
	const readerHref = () => `/lecturas/${props.book.id}`;

	const badgeLabel = () => {
		if (props.book.isOffline) return 'offline ✓';
		return props.appOffline ? 'requiere red' : 'nube';
	};

	/** `214 p · 566 KB` — pages and local size, the artboard metadata line. */
	const sizeLabel = () => {
		const size = formatSizeKb(props.book.sizeKb);
		return props.book.pdfPages ? `${props.book.pdfPages} p · ${size}` : size;
	};

	const progressLabel = () => {
		if (props.book.progressPct > 0) return `${props.book.progressPct}% avanzado`;
		return props.book.status === 'finished' ? 'Leído' : 'Sin comenzar';
	};

	const licenseBadge = () => formatLicenseBadge(props.book.license);

	const [coverFailed, setCoverFailed] = createSignal(false);

	const downloadDisabled = () => !hasFile() || props.busy === true || (props.appOffline && !props.book.isOffline);

	const downloadLabel = () => {
		if (props.busy) return 'Guardando…';
		return props.book.isOffline ? 'Quitar' : 'Añadir';
	};

	return (
		<article class="tomo" data-offline={String(props.book.isOffline)}>
			<a class="tomo-tapa" href={readerHref()} aria-label={`Abrir «${props.book.title}»`}>
				{props.book.coverUrl && !coverFailed() ? (
					<img
						class="tomo-art tomo-cover-img"
						src={props.book.coverUrl}
						alt={`Portada de ${props.book.title}`}
						loading="lazy"
						onError={() => setCoverFailed(true)}
					/>
				) : (
					<BookCoverSvg
						variant={props.book.coverVariant}
						bookId={props.book.id}
						prefix={props.coverPrefix}
					/>
				)}
				<span class="tomo-idx">{props.book.idx}</span>
			</a>

			<div class="tomo-body">
				<div class="tomo-meta">
					<span class="tomo-tag">{props.book.catLabel}</span>
					<span class="tomo-badge">{badgeLabel()}</span>
					<span class="tomo-datos">{sizeLabel()}</span>
					<Show when={licenseBadge()}>
						{(badge) => (
							<span class="lic" title={`Licencia: ${props.book.license ?? badge()}`}>
								{badge()}
							</span>
						)}
					</Show>
				</div>
				<h3 class="tomo-titulo">{props.book.title}</h3>
				<div class="tomo-autor">{props.book.author}</div>
				<div class="tomo-prog">
					<span class="mini-bar" aria-hidden="true">
						<i style={{ width: `${props.book.progressPct}%` }} />
					</span>
					<span>{progressLabel()}</span>
				</div>
			</div>

			<div class="tomo-actions">
				<Show when={hasFile()}>
					<a class="btn-leer" href={readerHref()} aria-label={`Leer «${props.book.title}»`}>
						Leer
					</a>
				</Show>
				<Show when={props.onOpenFicha}>
					<button
						class="btn-edit-mini"
						type="button"
						aria-label={`Ver ficha de ${props.book.title}`}
						onClick={() => props.onOpenFicha?.(props.book)}
					>
						Ficha
					</button>
				</Show>
				<Show when={props.book.isOwner && props.onEdit}>
					<button
						class="btn-edit-mini"
						type="button"
						aria-label={`Editar ${props.book.title}`}
						onClick={() => props.onEdit?.(props.book)}
					>
						Editar
					</button>
				</Show>
				<button
					class="btn-dl"
					type="button"
					data-tone={props.book.isOffline ? 'quitar' : 'anadir'}
					aria-pressed={props.book.isOffline}
					disabled={downloadDisabled()}
					title={hasFile() ? undefined : 'Sin PDF disponible'}
					onClick={() => props.onToggleOffline(props.book)}
				>
					{downloadLabel()}
				</button>
			</div>
		</article>
	);
}
