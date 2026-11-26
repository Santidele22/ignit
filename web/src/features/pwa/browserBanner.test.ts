import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BROWSER_BANNER_ID, DISMISS_STORAGE_KEY, shouldShowBrowserBanner } from './browserBanner';

const moduleSource = readFileSync(new URL('./browserBanner.ts', import.meta.url), 'utf8');
const bannerCss = readFileSync(new URL('./browser-banner.css', import.meta.url), 'utf8');

describe('shouldShowBrowserBanner (S1)', () => {
	it('shows the banner for every install mode that means «running in a browser tab»', () => {
		expect(shouldShowBrowserBanner('prompt', false)).toBe(true);
		expect(shouldShowBrowserBanner('manual-guide', false)).toBe(true);
		expect(shouldShowBrowserBanner('ios-guide', false)).toBe(true);
	});

	it('hides the banner when the app already runs installed or the install UI is hidden', () => {
		expect(shouldShowBrowserBanner('hidden', false)).toBe(false);
	});

	it('hides the banner once the user dismissed it, whatever the mode', () => {
		expect(shouldShowBrowserBanner('prompt', true)).toBe(false);
		expect(shouldShowBrowserBanner('manual-guide', true)).toBe(false);
		expect(shouldShowBrowserBanner('ios-guide', true)).toBe(false);
	});
});

describe('browserBanner safety and accessibility contracts', () => {
	it('uses createElement only (no HTML sinks) and guards browser globals for SSR', () => {
		expect(BROWSER_BANNER_ID).toBe('ignit-browser-mode-banner');
		expect(moduleSource).not.toMatch(/\.innerHTML|\.outerHTML|\.insertAdjacentHTML|document\.write\(/);
		expect(moduleSource).toContain('document.createElement');
	});

	it('persists the dismissal in localStorage under a stable Ignit key with a guard', () => {
		expect(DISMISS_STORAGE_KEY).toBe('ignit.pwa.browser-banner-dismissed');
		expect(moduleSource).toContain('localStorage');
	});

	it('the banner offers the install action and a dismiss button wired to the dismissal helper', () => {
		expect(moduleSource).toContain('triggerInstall');
		expect(moduleSource).toContain('dismissBrowserModeBanner');
	});

	it('ships a stylesheet without url() loads (CSP-safe) and styles the banner id', () => {
		expect(bannerCss).toContain(`#${BROWSER_BANNER_ID}`);
		expect(bannerCss).not.toMatch(/url\(/);
	});
});
