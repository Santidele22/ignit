export interface JourneySnippet {
	deskLead: string;
	deskFocus: string;
	deskTail: string;
	phoneFocus: string;
	phoneTail: string;
}

export interface JourneyState {
	offline: boolean;
	phonePage: number;
	deskPage: number;
	pending: number;
	minPage: number;
	totalPages: number;
	phonePct: number;
	deskPct: number;
	phoneSnippetIndex: number;
	deskSnippetIndex: number;
	phonePill: string;
	syncTag: string;
	phoneQueueLabel: string;
	deskStatus: string;
	deskNote: string;
}

export const JOURNEY_SNIPPETS: readonly JourneySnippet[] = [
	{
		deskLead: '…miró hacia el norte, donde la llanura se borraba en la niebla. ',
		deskFocus: 'Nadie encendió otra lámpara:',
		deskTail:
			' la única luz era la del escritorio, y sobre ella las páginas esperaban quietas…',
		phoneFocus: 'Nadie encendió otra lámpara:',
		phoneTail:
			' la única luz era la del escritorio, y sobre ella las páginas esperaban quietas…',
	},
	{
		deskLead: '…el viento golpeaba los postigos de madera seca. ',
		deskFocus: 'Sólo el reflejo del vidrio se movía,',
		deskTail:
			' ligero, cuando la mano se acercaba a girar una hoja hacia el silencio del cuarto…',
		phoneFocus: 'Sólo el reflejo del vidrio se movía,',
		phoneTail:
			' ligero, cuando la mano se acercaba a girar una hoja hacia el silencio…',
	},
	{
		deskLead: '…desde la muralla el camino se abría en dos hacia el desierto. ',
		deskFocus: 'La calma nunca estaba afuera,',
		deskTail:
			' sino en la atención serena con que se sostenía la luz hasta el amanecer…',
		phoneFocus: 'La calma nunca estaba afuera,',
		phoneTail:
			' sino en la atención serena con que se sostenía la luz…',
	},
];

const INITIAL_PAGE = 98;
const MIN_PAGE = 96;
const TOTAL_PAGES = 214;

function deriveState(
	offline: boolean,
	phonePage: number,
	deskPage: number,
	pending: number,
): JourneyState {
	const len = JOURNEY_SNIPPETS.length;
	const phoneSnippetIndex = ((phonePage - INITIAL_PAGE) % len + len) % len;
	const deskSnippetIndex = ((deskPage - INITIAL_PAGE) % len + len) % len;
	const phonePct = Math.round((phonePage / TOTAL_PAGES) * 100);
	const deskPct = Math.round((deskPage / TOTAL_PAGES) * 100);

	if (offline) {
		const pendingLabel =
			pending > 0
				? `${pending} ${pending === 1 ? 'cambio local' : 'cambios locales'}`
				: 'listo offline ✓';
		return {
			offline,
			phonePage,
			deskPage,
			pending,
			minPage: MIN_PAGE,
			totalPages: TOTAL_PAGES,
			phonePct,
			deskPct,
			phoneSnippetIndex,
			deskSnippetIndex,
			phonePill: 'offline',
			syncTag: 'sin red · en cola',
			phoneQueueLabel: pendingLabel,
			deskStatus: pending > 0 ? '○ esperando señal' : '○ desconectado',
			deskNote:
				pending > 0
					? `Ignit Desktop avanzó a pág. ${phonePage} sin señal · sincronizará al reconectar`
					: 'Sin conexión · podés seguir leyendo en Ignit Desktop',
		};
	}

	return {
		offline,
		phonePage,
		deskPage,
		pending: 0,
		minPage: MIN_PAGE,
		totalPages: TOTAL_PAGES,
		phonePct,
		deskPct,
		phoneSnippetIndex,
		deskSnippetIndex,
		phonePill: 'en línea',
		syncTag: 'sync activo',
		phoneQueueLabel: 'al día ✓',
		deskStatus: '● sincronizado',
		deskNote: `Estado: al día en pág. ${deskPage} · sincronizado entre dispositivos`,
	};
}

export function createInitialJourneyState(): JourneyState {
	return deriveState(false, INITIAL_PAGE, INITIAL_PAGE, 0);
}

export function setJourneyOffline(state: JourneyState, offline: boolean): JourneyState {
	if (offline) {
		return deriveState(true, state.phonePage, state.deskPage, state.pending);
	}
	return deriveState(false, state.phonePage, state.phonePage, 0);
}

export function stepJourneyPage(state: JourneyState, delta: -1 | 1): JourneyState {
	const nextPhone = Math.min(state.totalPages, Math.max(state.minPage, state.phonePage + delta));
	if (nextPhone === state.phonePage) {
		return state;
	}
	if (state.offline) {
		return deriveState(true, nextPhone, state.deskPage, state.pending + 1);
	}
	return deriveState(false, nextPhone, nextPhone, 0);
}
