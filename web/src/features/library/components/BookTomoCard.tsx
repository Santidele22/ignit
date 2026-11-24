import { Show } from 'solid-js';
import { formatSizeKb, type SalaBook } from '../lib/sala';
import BookCoverSvg from './BookCoverSvg';

/**
 * One `.tomo` card of the Sala de lectura (S5): bespoke 4/5 cover, spine wire,
 * offline/cloud/network badge, category + progress + pages/size metadata, link
 * to `/lecturas/:id` and the real IndexedDB `↓ Descargar` / `Quitar` action.
 * Owned books also expose the discrete `Editar` affordance (S7).
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
}

export default function BookTomoCard(props: BookTomoCardProps) {
	const badgeLabel = () => {
		if (props.book.isOffline) return 'offline ✓';
		return props.appOffline ? 'requiere red' : 'nube';
	};

	const sizeLabel = () => {
		const size = formatSizeKb(props.book.sizeKb);
		return props.book.pdfPages ? `${props.book.pdfPages} p · ${size}` : size;
	};

	const progressSuffix = () => (props.book.progressPct > 0 ? ` · ${props.book.progressPct}%` : '');

	const hasFile = () => props.book.hasFile !== false;

	const downloadDisabled = () => !hasFile() || props.busy === true || (props.appOffline && !props.book.isOffline);

	const downloadLabel = () => {
		if (props.busy) return 'Guardando…';
		return props.book.isOffline ? 'Quitar' : '↓ Descargar';
	};

	return (
		<article class="tomo" data-offline={String(props.book.isOffline)}>
			<a class="tomo-tapa" href={`/lecturas/${props.book.id}`}>
				<BookCoverSvg
					variant={props.book.coverVariant}
					bookId={props.book.id}
					prefix={props.coverPrefix}
				/>
				<div class="tomo-top">
					<span class="tomo-idx">{props.book.idx}</span>
					<span class="tomo-badge">{badgeLabel()}</span>
				</div>
				<div class="tomo-copy">
					<div class="tomo-titulo">{props.book.title}</div>
					<div class="tomo-autor">{props.book.author}</div>
				</div>
			</a>
			<div class="tomo-foot">
				<div class="tomo-meta">
					<span class="cat">
						{props.book.catLabel}
						{progressSuffix()}
					</span>
					<span class="peso">{sizeLabel()}</span>
				</div>
				<div class="tomo-actions">
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
						aria-pressed={props.book.isOffline}
						disabled={downloadDisabled()}
						title={hasFile() ? undefined : 'Sin PDF disponible'}
						onClick={() => props.onToggleOffline(props.book)}
					>
						{downloadLabel()}
					</button>
				</div>
			</div>
		</article>
	);
}
