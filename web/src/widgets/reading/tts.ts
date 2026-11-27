import { announce } from './feedback';
import { scrollElementToFocalBand } from './scroll';

// Built-in Web Speech API read-aloud for blind and screen-reader users.
const SPEEDS = [1, 1.25, 1.5, 0.85] as const;
let speedIdx = 0;
let isPlaying = false;
let activeBlock: HTMLElement | null = null;

function getReadableBlocks(): HTMLElement[] {
	return Array.from(
		document.querySelectorAll<HTMLElement>(
			'#readerArticle p[data-chunk-id], #readerArticle h2, #readerArticle h3, #readerArticle h4, #readerArticle blockquote[data-chunk-id]',
		),
	);
}

function getCurrentActiveBlock(blocks: HTMLElement[]): HTMLElement | null {
	if (activeBlock && document.body.contains(activeBlock)) return activeBlock;
	const reading = blocks.find((b) => b.classList.contains('reading'));
	if (reading) return reading;
	const midY = window.innerHeight * 0.4;
	return (
		blocks.find((b) => {
			const r = b.getBoundingClientRect();
			return r.bottom >= midY && r.top <= window.innerHeight;
		}) ??
		blocks[0] ??
		null
	);
}

function announceSr(text: string): void {
	const sr = document.getElementById('srLive');
	if (!sr) return;
	sr.textContent = '';
	window.setTimeout(() => {
		sr.textContent = text;
	}, 20);
}

function syncTtsUi(): void {
	const playBtn = document.getElementById('ttsPlayBtn');
	const speedBtn = document.getElementById('ttsSpeedBtn');
	if (playBtn) {
		playBtn.setAttribute('aria-pressed', String(isPlaying));
		const lbl = playBtn.querySelector('span');
		if (lbl) lbl.textContent = isPlaying ? 'Pausar voz' : 'Escuchar';
	}
	if (speedBtn) {
		speedBtn.textContent = `${SPEEDS[speedIdx]}×`;
	}
}

function stopSpeech(): void {
	isPlaying = false;
	if ('speechSynthesis' in window) {
		window.speechSynthesis.cancel();
	}
	syncTtsUi();
}

function speakBlock(block: HTMLElement): void {
	if (!('speechSynthesis' in window)) {
		announce('Lectura en voz alta no disponible en este navegador');
		stopSpeech();
		return;
	}
	window.speechSynthesis.cancel();

	const blocks = getReadableBlocks();
	blocks.forEach((b) => {
		b.classList.remove('reading');
		b.removeAttribute('aria-current');
	});
	block.classList.add('reading');
	block.setAttribute('aria-current', 'location');
	activeBlock = block;
	scrollElementToFocalBand(block);

	const text = (block.textContent ?? '').replace(/\s+/g, ' ').trim();
	if (!text) return;

	const utter = new SpeechSynthesisUtterance(text);
	utter.lang = 'es-ES';
	utter.rate = SPEEDS[speedIdx];
	utter.onend = () => {
		if (!isPlaying) return;
		const currentBlocks = getReadableBlocks();
		const idx = currentBlocks.indexOf(block);
		const next = idx >= 0 ? currentBlocks[idx + 1] : null;
		if (next) {
			speakBlock(next);
		} else {
			stopSpeech();
			announceSr('Fin de la sección cargada');
		}
	};
	utter.onerror = () => {
		if (isPlaying) stopSpeech();
	};
	window.speechSynthesis.speak(utter);
}

export function toggleTtsPlayback(): void {
	if (isPlaying) {
		stopSpeech();
		announce('Voz pausada');
		announceSr('Lectura en voz alta pausada');
		return;
	}
	const blocks = getReadableBlocks();
	const target = getCurrentActiveBlock(blocks);
	if (!target) return;
	isPlaying = true;
	syncTtsUi();
	announce('Leyendo en voz alta');
	speakBlock(target);
}

export function initTts(): void {
	document.getElementById('ttsPlayBtn')?.addEventListener('click', toggleTtsPlayback);
	document.getElementById('ttsSpeedBtn')?.addEventListener('click', () => {
		speedIdx = (speedIdx + 1) % SPEEDS.length;
		syncTtsUi();
		announce(`Velocidad ${SPEEDS[speedIdx]}×`);
		announceSr(`Velocidad de voz ${SPEEDS[speedIdx]} por`);
		if (isPlaying && activeBlock) {
			speakBlock(activeBlock);
		}
	});
	window.addEventListener('pagehide', stopSpeech);
}

export { announceSr };
