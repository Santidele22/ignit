import type { ReadingMood } from '../../entities/book/types';
import { body, toast } from './dom';

// Toasts and the ambient mood that follows the passage being read.
// The mood only sets `data-mood`; each palette paints `--glow` from its own
// tokens (reader-tokens.css), so switching palette re-lights the lamp at once.
const VALID_MOODS: readonly ReadingMood[] = ['espera', 'polvo', 'alerta', 'niebla'];

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

function announce(html: string) {
	const el = toast;
	if (!el) return;
	el.innerHTML = html;
	el.classList.add('on');
	if (toastTimer) clearTimeout(toastTimer);
	toastTimer = setTimeout(() => el.classList.remove('on'), 2600);
}

let lastMoodSwitchAt = 0;
let pendingMoodCandidate: ReadingMood | null = null;
let pendingMoodHits = 0;

function setMood(key: ReadingMood) {
	if (!VALID_MOODS.includes(key) || body.dataset.mood === key) return;
	body.dataset.mood = key;
	lastMoodSwitchAt = Date.now();
}


/**
 * Applies the mood a block asks for, ignoring single-block noise: a mood only
 * takes over after a second consecutive hit, 4.5s of dwelling, or the first
 * switch of the session.
 */

function applyTargetMood(targetMood: ReadingMood) {
	const activeMood = (body.dataset.mood as ReadingMood) || 'espera';

	if (targetMood === activeMood) {
		pendingMoodCandidate = null;
		pendingMoodHits = 0;
	} else {
		if (pendingMoodCandidate === targetMood) {
			pendingMoodHits += 1;
		} else {
			pendingMoodCandidate = targetMood;
			pendingMoodHits = 1;
		}
		const elapsed = Date.now() - lastMoodSwitchAt;
		if (pendingMoodHits >= 2 || elapsed > 4500 || lastMoodSwitchAt === 0) {
			pendingMoodCandidate = null;
			pendingMoodHits = 0;
			setMood(targetMood);
		}
	}
}

export { announce, escapeHtml, setMood, applyTargetMood };
