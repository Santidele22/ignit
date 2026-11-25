import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { BOOK_KIND_OPTIONS, parseBookKind, type Book } from '../../../entities/book/types';
import { fetchBookClientReading, fetchBooks, recordBookMetric, safeExternalUrl } from '../../book/api/books';
import { fetchMyBooks } from '../../book/api/books-admin';
import type { AdminBookRow } from '../../book/api/books-admin';
import { bookStatusLabel } from '../../book/bookForm';
import { parseFileSizeBytes, type CatalogKindFilter } from '../../landing/lib/catalog';
import {
	clearOfflineBooks,
	isOfflineStorageAvailable,
	listOfflineBooks,
	putOfflineBook,
	removeOfflineBook,
	type OfflineBookRecord,
} from '../lib/offlineStore';
import {
	computeStorageMeter,
	deriveAporteRows,
	filterSalaCatalog,
	mergeSalaBooks,
	readLocalReadingSnapshots,
	selectContinuityBook,
	type LocalReadingSnapshot,
	type SalaBook,
	type SalaTabId,
} from '../lib/sala';
import { registerServiceWorker } from '../../pwa/registerSW';
import AportesList from './AportesList';
import BookFichaModal from './BookFichaModal';
import BookTomoCard from './BookTomoCard';
import EditBookModal, { type EditBookResult } from './EditBookModal';
import HeroDash from './HeroDash';
import SalaTopbar from './SalaTopbar';
import UploadBookModal, { type UploadOutcome } from './UploadBookModal';

/**
 * Interactive shell of the Sala de lectura (`/biblioteca`, T3).
 *
 * Owns the real state of the page: the user's books (`fetchMyBooks`), the
 * public catalog (`fetchBooks`), the IndexedDB offline records
 * (`offlineStore.ts`), the localStorage reading snapshots used as progress,
 * the active tab / catalog filter / search, the online–offline indicator and
 * the modal + `aria-live` feedback. SSR provides `initialOwnedBooks` /
 * `initialCatalogBooks` and the app refreshes them when they were empty.
 */
export interface BibliotecaAppProps {
	userId: string;
	userLabel: string;
	isAdmin?: boolean;
	initialOwnedBooks: Book[];
	initialCatalogBooks: Book[];
	ssrOwnedLoaded?: boolean;
	ssrCatalogLoaded?: boolean;
}

const CATALOG_CHIPS: ReadonlyArray<{ value: CatalogKindFilter; label: string }> = [
	{ value: '*', label: 'Todos' },
	...BOOK_KIND_OPTIONS,
];

/** `AdminBookRow` (real `GET /books?mine=true`) → the UI `Book` shape. */
function rowToBook(row: AdminBookRow): Book {
	const status = row.status === 'finished' || row.status === 'queued' ? row.status : 'reading';
	const kind = parseBookKind(row.kind);
	const fileSizeBytes = parseFileSizeBytes(row.fileSize);

	return {
		id: row.id,
		title: row.title,
		author: row.author,
		description: row.description,
		status,
		statusLabel: bookStatusLabel(status),
		kind,
		...(row.review ? { review: row.review } : {}),
		published: row.published === true,
		...(row.coverUrl ? { coverUrl: row.coverUrl } : {}),
		...(row.publisher ? { publisher: row.publisher } : {}),
		...(row.translator ? { translator: row.translator } : {}),
		...(row.illustrator ? { illustrator: row.illustrator } : {}),
		...(row.isbn ? { isbn: row.isbn } : {}),
		...(row.license ? { license: row.license } : {}),
		...(row.ctaLabel ? { ctaLabel: row.ctaLabel } : {}),
		...(safeExternalUrl(row.ctaUrl) ? { ctaUrl: safeExternalUrl(row.ctaUrl) } : {}),
		hasFile: Boolean(row.filePath || row.originalName),
		...(fileSizeBytes !== undefined ? { fileSizeBytes } : {}),
		isOwner: true,
	};
}

export default function BibliotecaApp(props: BibliotecaAppProps) {
	const [ownedBooks, setOwnedBooks] = createSignal<Book[]>(props.initialOwnedBooks);
	const [catalogBooks, setCatalogBooks] = createSignal<Book[]>(props.initialCatalogBooks);
	const [offlineRecords, setOfflineRecords] = createSignal<OfflineBookRecord[]>([]);
	const [localSnapshots, setLocalSnapshots] = createSignal<ReadonlyMap<number, LocalReadingSnapshot>>(
		new Map(),
	);
	const [storageAvailable, setStorageAvailable] = createSignal(false);

	const [activeTab, setActiveTab] = createSignal<SalaTabId>('device');
	const [catFilter, setCatFilter] = createSignal<CatalogKindFilter>('*');
	const [searchQuery, setSearchQuery] = createSignal('');

	// Offline state = real `navigator` state OR the manual test toggle.
	const [navigatorOffline, setNavigatorOffline] = createSignal(false);
	const [testOffline, setTestOffline] = createSignal(false);
	const isOffline = () => testOffline() || navigatorOffline();

	const [busyBookIds, setBusyBookIds] = createSignal<ReadonlySet<number>>(new Set());
	const [clearingCache, setClearingCache] = createSignal(false);
	const [uploadOpen, setUploadOpen] = createSignal(false);
	const [editingBook, setEditingBook] = createSignal<Book | null>(null);
	const [fichaBook, setFichaBook] = createSignal<Book | null>(null);
	const [liveMessage, setLiveMessage] = createSignal('');
	const [actionError, setActionError] = createSignal<string | null>(null);

	const salaBooks = createMemo(() =>
		mergeSalaBooks({
			ownedBooks: ownedBooks(),
			catalogBooks: catalogBooks(),
			offlineRecords: offlineRecords(),
			localSnapshots: localSnapshots(),
		}),
	);
	const deviceBooks = createMemo(() => salaBooks().filter((book) => book.isOffline));
	const libraryBooks = createMemo(() => salaBooks().filter((book) => book.inLibrary || book.isOffline));
	const publicCatalogBooks = createMemo(() => salaBooks().filter((book) => book.published));
	const catalogView = createMemo(() =>
		filterSalaCatalog(publicCatalogBooks(), catFilter(), searchQuery()),
	);
	const aporteRows = createMemo(() => deriveAporteRows(salaBooks()));
	// Continuity only considers the user's own shelf (owned, downloaded or read),
	// so a fresh account gets the empty card instead of a random catalog book.
	const continuity = createMemo(() => selectContinuityBook(libraryBooks()));
	const meter = createMemo(() => computeStorageMeter(offlineRecords()));

	const counts = createMemo<Record<SalaTabId, number>>(() => ({
		device: deviceBooks().length,
		library: libraryBooks().length,
		catalog: publicCatalogBooks().length,
		submissions: aporteRows().length,
	}));

	function announce(message: string) {
		setLiveMessage(message);
	}

	function fail(message: string) {
		setActionError(message);
		setLiveMessage(message);
	}

	function markBusy(bookId: number, busy: boolean) {
		setBusyBookIds((current) => {
			const next = new Set(current);
			if (busy) next.add(bookId);
			else next.delete(bookId);
			return next;
		});
	}

	async function refreshLists() {
		const [mine, catalog] = await Promise.all([fetchMyBooks().catch(() => null), fetchBooks()]);
		if (mine) setOwnedBooks(mine.map(rowToBook));
		if (catalog) setCatalogBooks(catalog);
	}

	async function hydrate() {
		setLocalSnapshots(
			readLocalReadingSnapshots(typeof localStorage === 'undefined' ? null : localStorage, props.userId),
		);

		const available = isOfflineStorageAvailable();
		setStorageAvailable(available);
		if (available) {
			try {
				setOfflineRecords(await listOfflineBooks());
			} catch {
				fail('No se pudo leer el almacenamiento local de este dispositivo.');
			}
		}

		const needsOwnedRefresh = !(props.ssrOwnedLoaded ?? props.initialOwnedBooks.length > 0);
		const needsCatalogRefresh = !(props.ssrCatalogLoaded ?? props.initialCatalogBooks.length > 0);
		if (
			(needsOwnedRefresh || needsCatalogRefresh) &&
			(typeof navigator === 'undefined' || navigator.onLine !== false)
		) {
			await refreshLists();
		}
	}

	async function handleToggleOffline(book: SalaBook) {
		if (busyBookIds().has(book.id)) return;

		if (!book.isOffline && !book.hasFile) {
			fail(`«${book.title}» todavía no tiene un PDF disponible para descargar.`);
			return;
		}

		setActionError(null);
		markBusy(book.id, true);
		try {
			if (book.isOffline) {
				await removeOfflineBook(book.id);
				setOfflineRecords((current) => current.filter((record) => record.bookId !== book.id));
				announce(`«${book.title}» quitado del dispositivo`);
				return;
			}

			const reading = await fetchBookClientReading(book.id, true);
			const record = await putOfflineBook({ book, reading });
			recordBookMetric(book.id, 'offline_download');
			setOfflineRecords((current) => [
				record,
				...current.filter((entry) => entry.bookId !== record.bookId),
			]);
			announce(`«${book.title}» descargado para lectura offline`);
		} catch (cause) {
			const message = cause instanceof Error ? cause.message : 'Error inesperado.';
			fail(
				`No se pudo ${book.isOffline ? 'quitar' : 'descargar'} «${book.title}»: ${message}`,
			);
		} finally {
			markBusy(book.id, false);
		}
	}

	async function handleClearOffline() {
		if (clearingCache()) return;
		setClearingCache(true);
		setActionError(null);
		try {
			await clearOfflineBooks();
			setOfflineRecords([]);
			announce('Caché local liberada');
		} catch (cause) {
			const message = cause instanceof Error ? cause.message : 'Error inesperado.';
			fail(`No se pudo liberar la caché local: ${message}`);
		} finally {
			setClearingCache(false);
		}
	}

	function handleUploadCreated(created: AdminBookRow, outcome: UploadOutcome) {
		setActiveTab('submissions');
		setActionError(null);
		setOwnedBooks((current) =>
			current.some((book) => book.id === created.id) ? current : [...current, rowToBook(created)],
		);
		void refreshLists();
		announce(
			outcome === 'created'
				? `«${created.title}» enviado a Mis aportes.`
				: `«${created.title}» creado. El PDF quedó pendiente: reintentalo desde Editar.`,
		);
	}

	function handleEditSaved(result: EditBookResult) {
		setActionError(null);
		announce(result.message);
		void refreshLists();
		if (result.close) setEditingBook(null);
	}

	async function handleEditDeleted(result: EditBookResult) {
		const target = editingBook();
		setActionError(null);
		announce(result.message);
		if (result.close) setEditingBook(null);

		if (!target) return;
		setOwnedBooks((current) => current.filter((book) => book.id !== target.id));
		setCatalogBooks((current) => current.filter((book) => book.id !== target.id));
		if (offlineRecords().some((record) => record.bookId === target.id)) {
			try {
				await removeOfflineBook(target.id);
				setOfflineRecords((current) => current.filter((record) => record.bookId !== target.id));
			} catch {
				fail(`«${target.title}» se eliminó, pero su copia offline sigue en este dispositivo.`);
			}
		}
		void refreshLists();
	}

	function handleOpenUpload() {
		setActionError(null);
		setUploadOpen(true);
	}

	createEffect(() => {
		if (typeof document === 'undefined') return;
		document.body.dataset.offline = String(isOffline());
	});

	onMount(() => {
		// PWA (S2): registra `/sw.js` sólo en producción (`registerSW.ts` decide:
		// PROD + `serviceWorker` en `navigator`); en dev no hace nada.
		registerServiceWorker();

		setNavigatorOffline(typeof navigator !== 'undefined' && navigator.onLine === false);

		const handleOnline = () => setNavigatorOffline(false);
		const handleOffline = () => setNavigatorOffline(true);
		window.addEventListener('online', handleOnline);
		window.addEventListener('offline', handleOffline);
		onCleanup(() => {
			window.removeEventListener('online', handleOnline);
			window.removeEventListener('offline', handleOffline);
		});

		void hydrate();
	});

	return (
		<div class="sala-root" data-offline={String(isOffline())}>
			<SalaTopbar
				activeTab={activeTab()}
				counts={counts()}
				isOffline={isOffline()}
				userLabel={props.userLabel}
				isAdmin={props.isAdmin === true}
				onTabChange={(tab) => setActiveTab(tab)}
				onToggleOffline={() => {
					if (navigatorOffline()) {
						announce('Sin conexión de red en el navegador');
						return;
					}
					const next = !testOffline();
					setTestOffline(next);
					setActionError(null);
					announce(next ? 'Modo sin conexión activado' : 'Modo en línea activado');
				}}
				onOpenUpload={() => handleOpenUpload()}
			/>

			<main class="shell" id="main-content">
				<div class="sr-only" aria-live="polite">
					{liveMessage()}
				</div>

				<Show when={actionError()}>
					<p class="pipe-notice" role="alert">
						{actionError()}
					</p>
				</Show>

				<HeroDash
					continuity={continuity()}
					meter={meter()}
					storageAvailable={storageAvailable()}
					clearing={clearingCache()}
					onClearOffline={() => void handleClearOffline()}
					onOpenUpload={() => handleOpenUpload()}
				/>

				<section
					class="view-panel"
					id="view-device"
					role="tabpanel"
					aria-labelledby="tab-device"
					data-visible={String(activeTab() === 'device')}
					hidden={activeTab() !== 'device'}
				>
					<div class="section-bar">
						<span class="section-title">Listos para leer sin internet</span>
						<span class="section-hint">Estos libros abren en Vigilia aunque cortes la señal</span>
					</div>
					<div class="rejilla">
						<Show
							when={deviceBooks().length > 0}
							fallback={
								<p class="empty-box">
									No tenés libros descargados en este dispositivo. Podés bajar cualquiera desde Mi
									biblioteca o Catálogo.
								</p>
							}
						>
							<For each={deviceBooks()}>
								{(book) => (
									<BookTomoCard
										book={book}
										coverPrefix="dev"
										appOffline={isOffline()}
										busy={busyBookIds().has(book.id)}
										onToggleOffline={(target) => void handleToggleOffline(target)}
										onEdit={(target) => setEditingBook(target)}
										onOpenFicha={(target) => setFichaBook(target)}
									/>
								)}
							</For>
						</Show>
					</div>
				</section>

				<section
					class="view-panel"
					id="view-library"
					role="tabpanel"
					aria-labelledby="tab-library"
					data-visible={String(activeTab() === 'library')}
					hidden={activeTab() !== 'library'}
				>
					<div class="section-bar">
						<span class="section-title">Tu estante guardado en la nube</span>
						<span class="section-hint">
							Sincronizado entre tu PC y tu celular · elegí cuáles bajar
						</span>
					</div>
					<div class="rejilla">
						<Show
							when={libraryBooks().length > 0}
							fallback={
								<p class="empty-box">
									Tu estante en la nube está vacío. Subí un PDF con <b>+ Subir libro</b> o descargá
									algo del catálogo para empezar tu biblioteca.
								</p>
							}
						>
							<For each={libraryBooks()}>
								{(book) => (
									<BookTomoCard
										book={book}
										coverPrefix="lib"
										appOffline={isOffline()}
										busy={busyBookIds().has(book.id)}
										onToggleOffline={(target) => void handleToggleOffline(target)}
										onEdit={(target) => setEditingBook(target)}
										onOpenFicha={(target) => setFichaBook(target)}
									/>
								)}
							</For>
						</Show>
					</div>
				</section>

				<section
					class="view-panel"
					id="view-catalog"
					role="tabpanel"
					aria-labelledby="tab-catalog"
					data-visible={String(activeTab() === 'catalog')}
					hidden={activeTab() !== 'catalog'}
				>
					<div class="section-bar">
						<div class="filtros" role="group" aria-label="Categorías">
							<For each={CATALOG_CHIPS}>
								{(chip) => (
									<button
										class="chip"
										type="button"
										data-filtro={chip.value}
										data-activa={String(catFilter() === chip.value)}
										aria-pressed={catFilter() === chip.value}
										onClick={() => setCatFilter(chip.value)}
									>
										{chip.label}
									</button>
								)}
							</For>
						</div>
						<input
							class="search-input"
							id="catSearch"
							type="search"
							placeholder="Buscar título o autor…"
							aria-label="Buscar en el catálogo"
							value={searchQuery()}
							onInput={(event) => setSearchQuery(event.currentTarget.value)}
						/>
					</div>
					<div class="rejilla">
						<Show
							when={catalogView().length > 0}
							fallback={
								<p class="empty-box">
									No encontramos libros con ese filtro. Probá con otra categoría o borrá la búsqueda.
								</p>
							}
						>
							<For each={catalogView()}>
								{(book) => (
									<BookTomoCard
										book={book}
										coverPrefix="cat"
										appOffline={isOffline()}
										busy={busyBookIds().has(book.id)}
										onToggleOffline={(target) => void handleToggleOffline(target)}
										onEdit={(target) => setEditingBook(target)}
										onOpenFicha={(target) => setFichaBook(target)}
									/>
								)}
							</For>
						</Show>
					</div>
				</section>

				<section
					class="view-panel"
					id="view-submissions"
					role="tabpanel"
					aria-labelledby="tab-submissions"
					data-visible={String(activeTab() === 'submissions')}
					hidden={activeTab() !== 'submissions'}
				>
					<div class="section-bar">
						<span class="section-title">Seguimiento de tus libros enviados al catálogo</span>
						<button class="btn-sec" type="button" onClick={() => handleOpenUpload()}>
							+ Nuevo aporte
						</button>
					</div>
					<AportesList
						rows={aporteRows()}
						onEdit={(target) => setEditingBook(target)}
						onOpenUpload={() => handleOpenUpload()}
					/>
				</section>
			</main>

			<UploadBookModal
				open={uploadOpen()}
				onClose={() => setUploadOpen(false)}
				onCreated={(created, outcome) => handleUploadCreated(created, outcome)}
			/>

			<EditBookModal
				book={editingBook()}
				isAdmin={props.isAdmin === true}
				onClose={() => setEditingBook(null)}
				onSaved={(result) => handleEditSaved(result)}
				onDeleted={(result) => void handleEditDeleted(result)}
			/>

			<BookFichaModal
				book={fichaBook()}
				onClose={() => setFichaBook(null)}
			/>
		</div>
	);
}
