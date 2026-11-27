import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	IOS_GUIDE_DIALOG_ID,
	getInstallMode,
	isIosDevice,
	isStandaloneDisplayMode,
	isTauriDesktop,
	triggerInstall,
} from './installPrompt';

const moduleSource = readFileSync(new URL('./installPrompt.ts', import.meta.url), 'utf8');
const guideCss = readFileSync(new URL('./install-guide.css', import.meta.url), 'utf8');

describe('isStandaloneDisplayMode', () => {
	it('returns true when display-mode is standalone, iOS navigator.standalone, or Tauri desktop', () => {
		expect(isStandaloneDisplayMode({ matchMediaStandalone: true, navigatorStandalone: false })).toBe(true);
		expect(isStandaloneDisplayMode({ matchMediaStandalone: false, navigatorStandalone: true })).toBe(true);
		expect(isStandaloneDisplayMode({ matchMediaStandalone: false, navigatorStandalone: false, tauriDesktop: true })).toBe(true);
		expect(isStandaloneDisplayMode({ matchMediaStandalone: false, navigatorStandalone: false, tauriDesktop: false })).toBe(false);
	});

	it('detects non-Tauri runtime cleanly in Node', () => {
		expect(isTauriDesktop()).toBe(false);
	});
});

describe('isIosDevice', () => {
	it('detects iPhone, iPad, iPod, and iPadOS desktop-class Safari', () => {
		expect(isIosDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15', 5)).toBe(true);
		expect(isIosDevice('Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15', 5)).toBe(true);
		expect(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 5)).toBe(true);
	});

	it('returns false for macOS desktop, Android, Linux, and Windows', () => {
		expect(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 0)).toBe(false);
		expect(isIosDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125.0.0.0 Mobile', 5)).toBe(false);
		expect(isIosDevice('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125.0.0.0', 0)).toBe(false);
	});
});

describe('getInstallMode', () => {
	it('hides install UI when already running in standalone mode', () => {
		expect(getInstallMode({ standalone: true, hasDeferredPrompt: true, isIos: false })).toBe('hidden');
		expect(getInstallMode({ standalone: true, hasDeferredPrompt: false, isIos: true })).toBe('hidden');
	});

	it('prefers native prompt when beforeinstallprompt has been captured', () => {
		expect(getInstallMode({ standalone: false, hasDeferredPrompt: true, isIos: false })).toBe('prompt');
		expect(getInstallMode({ standalone: false, hasDeferredPrompt: true, isIos: true })).toBe('prompt');
	});

	it('falls back to iOS guide on iOS devices outside standalone mode', () => {
		expect(getInstallMode({ standalone: false, hasDeferredPrompt: false, isIos: true })).toBe('ios-guide');
	});

	it('falls back to manual guide on browsers without a deferred prompt outside standalone', () => {
		expect(getInstallMode({ standalone: false, hasDeferredPrompt: false, isIos: false })).toBe('manual-guide');
	});
});

describe('installPrompt safety and accessibility contracts', () => {
	it('uses createElement only (no HTML sinks) and guards browser globals for SSR', () => {
		expect(IOS_GUIDE_DIALOG_ID).toBe('ignit-ios-install-guide');
		expect(moduleSource).not.toMatch(/\.innerHTML|\.outerHTML|\.insertAdjacentHTML|document\.write\(/);
		expect(moduleSource).toContain('document.createElement');
		expect(moduleSource).toContain("role', 'dialog'");
		expect(moduleSource).toContain("aria-modal', 'true'");
	});

	it('keeps accessible touch targets and safe-area insets in install-guide.css', () => {
		expect(guideCss).toContain('min-height: 44px');
		expect(guideCss).toContain('env(safe-area-inset-bottom)');
	});

	it('returns unavailable cleanly outside a browser (SSR / Node)', async () => {
		expect(await triggerInstall()).toBe('unavailable');
	});
});
