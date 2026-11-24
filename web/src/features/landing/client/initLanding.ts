// Bundled client runtime for the «Lámpara brutalista» landing (S2/S3/S4/S5/S6/S7/S8).
//
// Loaded from `index.astro` as an ES module `<script>` (`script-src 'self'`):
// there is no inline script and no external animation library. Every surface
// that involves state (catálogo, pipeline, embed, viaje) delegates to the pure,
// unit-tested helpers in `../lib/*` and only mutates the DOM declared by the
// section components.
//
// `initLanding()` is idempotent and returns a cleanup: it aborts every bound
// listener, cancels the RAF loops and can be called again afterwards (useful
// for Astro view transitions / hot reload).

import type { ShelfHudInfo, ShelfLayout } from '../lib/catalog';
import { computeOfflineMeter, normalizeSearchText } from '../lib/catalog';
import { resolveSafeReaderEmbedPath } from '../lib/embed';
import {
	JOURNEY_SNIPPETS,
	createInitialJourneyState,
	setJourneyOffline,
	stepJourneyPage,
	type JourneyState,
} from '../lib/journey';
import { pipelineCaptionForStep } from '../lib/pipeline';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MOTE_COUNT = 120;
/** Artboard mote tints per palette. `noche-azul` is cold light, `original` is warm ink. */
const MOTE_RGB: Record<string, string> = {
	'noche-azul': '159,192,238',
	original: '199,62,58',
};

let activeCleanup: (() => void) | null = null;

function byId<T extends Element = HTMLElement>(id: string, root: ParentNode = document): T | null {
	return root.querySelector<T>(`#${id}`);
}

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

function currentMoteRgb(): string {
	const palette = document.documentElement.dataset.palette ?? '';
	return MOTE_RGB[palette] ?? MOTE_RGB['noche-azul']!;
}

function createSvgNode<K extends keyof SVGElementTagNameMap>(
	tag: K,
	attrs: Record<string, string | number> = {},
	parent?: Element,
): SVGElementTagNameMap[K] {
	const node = document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
	for (const [name, value] of Object.entries(attrs)) {
		node.setAttribute(name, String(value));
	}
	if (parent) parent.appendChild(node);
	return node;
}

interface Mote {
	x: number;
	y: number;
	r: number;
	phase: number;
	vx: number;
	vy: number;
}

interface SpineEdge {
	element: Element;
	cx: number;
	cy: number;
	baseOpacity: number;
}

function isKeyboardActivation(event: KeyboardEvent): boolean {
	return event.key === 'Enter' || event.key === ' ';
}

export function initLanding(): () => void {
	if (typeof window === 'undefined' || typeof document === 'undefined') {
		return () => {};
	}
	if (activeCleanup) return activeCleanup;

	const controller = new AbortController();
	const { signal } = controller;
	const frames = new Set<number>();
	let disposed = false;

	const requestFrame = (loop: () => void): void => {
		const id = window.requestAnimationFrame(() => {
			frames.delete(id);
			loop();
		});
		frames.add(id);
	};

	const cleanup = () => {
		if (disposed) return;
		disposed = true;
		controller.abort();
		for (const id of frames) window.cancelAnimationFrame(id);
		frames.clear();
		if (activeCleanup === cleanup) activeCleanup = null;
	};

	const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	/* ---------------------------------------------------------------------
	 * a0) Mobile header menu (S3) — `<= 860px` only.
	 *
	 * One `<nav id="landing-mobile-nav">` is both the desktop anchor row and the
	 * mobile dropdown panel; this block only flips its `data-open` attribute and
	 * the toggle's `aria-expanded`, and closes it on `Escape` (returning focus to
	 * the toggle), on an outside pointer press and on any link click.
	 * ------------------------------------------------------------------ */

	const menuToggle = byId<HTMLButtonElement>('landing-menu-toggle');
	const mobileNav = byId<HTMLElement>('landing-mobile-nav');

	if (menuToggle && mobileNav) {
		const menuGlyph = menuToggle.querySelector<HTMLElement>('[aria-hidden="true"]');

		const isMenuOpen = () => mobileNav.dataset.open === 'true';

		const setMenuOpen = (open: boolean) => {
			mobileNav.dataset.open = open ? 'true' : 'false';
			menuToggle.setAttribute('aria-expanded', String(open));
			if (menuGlyph) menuGlyph.textContent = open ? '✕' : '☰';
		};

		const closeMenu = (restoreFocus = false) => {
			if (!isMenuOpen()) return;
			setMenuOpen(false);
			if (restoreFocus) menuToggle.focus();
		};

		setMenuOpen(isMenuOpen());

		menuToggle.addEventListener('click', () => setMenuOpen(!isMenuOpen()), { signal });

		document.addEventListener(
			'keydown',
			(event) => {
				if (event.key !== 'Escape' || !isMenuOpen()) return;
				event.preventDefault();
				closeMenu(true);
			},
			{ signal },
		);

		document.addEventListener(
			'pointerdown',
			(event) => {
				if (!isMenuOpen()) return;
				const target = event.target;
				if (!(target instanceof Node)) return;
				if (mobileNav.contains(target) || menuToggle.contains(target)) return;
				closeMenu();
			},
			{ signal },
		);

		// Any anchor inside the panel (section jump or session link) dismisses it.
		mobileNav.addEventListener(
			'click',
			(event) => {
				const target = event.target;
				if (!(target instanceof Element)) return;
				if (!target.closest('a')) return;
				closeMenu();
			},
			{ signal },
		);
	}

	/* ---------------------------------------------------------------------
	 * a) Chrome & motion — lamp, scroll thread, section reveal, needle and the
	 *    Canvas 2D mote field reacting to the pointer.
	 * ------------------------------------------------------------------ */

	const lamp = byId<HTMLElement>('lampara');
	const scrollThread = byId<HTMLElement>('hilo');
	const stationNeedle = byId<HTMLElement>('mecha-aguja');
	const capas = Array.from(document.querySelectorAll<HTMLElement>('[data-capa]'));
	const focusPool = byId<SVGEllipseElement>('eco-foco');
	const spineEdges: SpineEdge[] = [];

	let targetX = window.innerWidth * 0.65;
	let targetY = window.innerHeight * 0.32;
	let lampX = targetX;
	let lampY = targetY;

	window.addEventListener(
		'pointermove',
		(event) => {
			targetX = event.clientX;
			targetY = event.clientY;
		},
		{ passive: true, signal },
	);

	const syncChrome = () => {
		if (scrollThread) {
			const max = document.documentElement.scrollHeight - window.innerHeight;
			const progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
			scrollThread.style.width = `${(progress * 100).toFixed(1)}%`;
		}

		const revealLine = window.innerHeight * 0.92;
		capas.forEach((section, index) => {
			const box = section.getBoundingClientRect();
			// With reduced motion every section is revealed up-front and stays lit.
			if (reduceMotion || (box.top < revealLine && box.bottom > 80)) {
				section.classList.add('alumbrada');
			}
			if (
				stationNeedle &&
				box.top < window.innerHeight * 0.55 &&
				box.bottom > window.innerHeight * 0.25
			) {
				stationNeedle.style.top = `${round1(index * (84 / Math.max(1, capas.length - 1)))}%`;
			}
		});
	};

	window.addEventListener('scroll', syncChrome, { passive: true, signal });
	window.addEventListener('resize', syncChrome, { passive: true, signal });
	syncChrome();

	if (lamp) {
		if (reduceMotion) {
			// Match landing.css and the artboard: hide reactive lamp under reduced motion.
			lamp.style.opacity = '0';
		} else {
			const followLamp = () => {
				if (disposed) return;
				lampX += (targetX - lampX) * 0.12;
				lampY += (targetY - lampY) * 0.12;
				lamp.style.left = `${lampX}px`;
				lamp.style.top = `${lampY}px`;
				requestFrame(followLamp);
			};
			requestFrame(followLamp);
		}
	}

	/* ---------------------------------------------------------------------
	 * b) Hero SVG shelf — spines, faded slots and the `aria-live` micro-HUD.
	 * ------------------------------------------------------------------ */

	const shelfSvg = byId<SVGSVGElement>('shelfSvg');
	const spinesGroup = byId<SVGGElement>('estante-spines');
	const slotsGroup = byId<SVGGElement>('eco-rendijas');
	const hudKicker = byId<HTMLElement>('hudKicker');
	const hudTitle = byId<HTMLElement>('hudTitle');
	const hudMeta = byId<HTMLElement>('hudMeta');

	const readShelfLayout = (svg: SVGSVGElement): ShelfLayout | null => {
		const raw = svg.dataset.shelfLayout;
		if (!raw) return null;
		try {
			const parsed = JSON.parse(raw) as ShelfLayout;
			return Array.isArray(parsed.shelves) && parsed.defaultHud ? parsed : null;
		} catch {
			return null;
		}
	};

	if (shelfSvg && spinesGroup && slotsGroup) {
		const layout = readShelfLayout(shelfSvg);

		if (layout) {
			const setHud = (info: ShelfHudInfo) => {
				if (hudKicker) hudKicker.textContent = info.kicker;
				if (hudTitle) hudTitle.textContent = info.title;
				if (hudMeta) hudMeta.textContent = info.meta;
			};

			for (const shelf of layout.shelves) {
				let cursor = 22;

				for (const item of shelf.items) {
					if ('gap' in item) {
						createSvgNode(
							'rect',
							{
								x: round1(cursor + 2),
								y: round1(shelf.base - 108),
								width: round1(item.gap - 4),
								height: 108,
								class: 'cv-accent-bright',
								opacity: 0.08,
							},
							slotsGroup,
						);
						cursor += item.gap;
						continue;
					}

					if ('stack' in item) {
						let stackY = shelf.base;
						item.stack.forEach((volume, index) => {
							stackY -= volume.h;
							const x = cursor + index * 6;
							createSvgNode(
								'rect',
								{
									x: round1(x),
									y: round1(stackY),
									width: volume.w,
									height: volume.h,
									rx: 1.5,
									fill: 'url(#g-eco-silueta)',
									class: 'cv-st-line',
									'stroke-width': 1,
								},
								spinesGroup,
							);
							const top = createSvgNode(
								'rect',
								{
									x: round1(x + 3),
									y: round1(stackY + 1),
									width: volume.w - 6,
									height: 2,
									class: 'cv-accent-bright',
									opacity: 0.32,
								},
								spinesGroup,
							);
							spineEdges.push({
								element: top,
								cx: x + volume.w / 2,
								cy: stackY,
								baseOpacity: 0.32,
							});
						});
						cursor += 124;
						continue;
					}

					const width = item.w;
					const height = item.h;
					const x = cursor;
					const y = shelf.base - height - (item.featured ? 10 : 0);
					const book = item.book;
					const spine = createSvgNode('g', {}, spinesGroup);

					if (item.tilt) {
						spine.setAttribute(
							'transform',
							`rotate(${item.tilt} ${round1(x + width / 2)} ${shelf.base})`,
						);
					}
					if (book) {
						spine.setAttribute('class', 'lomo-real');
						if (item.featured) spine.setAttribute('data-featured', 'true');
						spine.setAttribute('tabindex', '0');
						spine.setAttribute('role', 'button');
						spine.setAttribute('aria-label', `${book.title} — ${book.author}`);
					}

					const fill = item.featured
						? 'url(#g-eco-featured)'
						: book
							? 'url(#g-eco-real)'
							: 'url(#g-eco-silueta)';
					const strokeClass = item.featured
						? 'cv-st-accent-bright'
						: book
							? 'cv-st-accent-soft'
							: 'cv-st-line';
					createSvgNode(
						'rect',
						{
							x: round1(x),
							y: round1(y),
							width: round1(width),
							height: round1(height),
							rx: 1.5,
							fill,
							class: strokeClass,
							'stroke-width': item.featured ? 1.3 : 1,
						},
						spine,
					);

					// Editorial bands (nervios) on the spine.
					if (width >= 18) {
						createSvgNode(
							'line',
							{
								x1: round1(x + 3.5),
								y1: round1(y + 10),
								x2: round1(x + width - 3.5),
								y2: round1(y + 10),
								class: book ? 'cv-st-accent' : 'cv-st-line-strong',
								'stroke-width': 1,
								opacity: book ? 0.75 : 0.45,
							},
							spine,
						);
						createSvgNode(
							'line',
							{
								x1: round1(x + 3.5),
								y1: round1(y + height - 12),
								x2: round1(x + width - 3.5),
								y2: round1(y + height - 12),
								class: book ? 'cv-st-accent' : 'cv-st-line',
								'stroke-width': 1,
								opacity: 0.5,
							},
							spine,
						);
					}

					if (book) {
						const label = createSvgNode(
							'text',
							{
								x: round1(x + width / 2),
								y: round1(y + 23),
								'font-family': 'ui-monospace, monospace',
								'font-size': 7,
								'letter-spacing': 1,
								class: item.featured ? 'cv-fg' : 'cv-accent-bright',
								'text-anchor': 'middle',
								opacity: item.featured ? 0.95 : 0.78,
							},
							spine,
						);
						label.textContent = book.idx;
					}

					const baseOpacity = item.featured ? 0.92 : book ? 0.52 : 0.2;
					const edge = createSvgNode(
						'rect',
						{
							class: book ? 'canto-real cv-accent-bright' : 'cv-accent-bright',
							x: round1(x + width - 2.4),
							y: round1(y + 3),
							width: 2.4,
							height: round1(height - 6),
							rx: 1,
							opacity: baseOpacity,
						},
						spine,
					);
					spineEdges.push({ element: edge, cx: x + width - 1.2, cy: y + height / 2, baseOpacity });

					if (book) {
						const floats = !item.featured && !item.tilt;
						const onEnter = () => {
							if (floats) spine.style.transform = 'translateY(-9px)';
							setHud({
								kicker: `${book.idx} · ${book.catLabel}`,
								title: `${book.title} — ${book.author}`,
								meta: book.meta,
							});
						};
						const onLeave = () => {
							if (floats) spine.style.transform = '';
							setHud(layout.defaultHud);
						};
						const openBook = () => {
							const chip = document.querySelector<HTMLButtonElement>(
								`.chip[data-filtro="${book.kind}"]`,
							);
							chip?.click();
							byId<HTMLElement>('s2')?.scrollIntoView({
								behavior: reduceMotion ? 'auto' : 'smooth',
							});
						};

						spine.addEventListener('mouseenter', onEnter, { signal });
						spine.addEventListener('focus', onEnter, { signal });
						spine.addEventListener('mouseleave', onLeave, { signal });
						spine.addEventListener('blur', onLeave, { signal });
						spine.addEventListener('click', openBook, { signal });
						spine.addEventListener(
							'keydown',
							(event) => {
								if (!isKeyboardActivation(event)) return;
								event.preventDefault();
								openBook();
							},
							{ signal },
						);
					}

					cursor += width + (item.tilt ? 7 : 3);
				}
			}
		}
	}

	/* ---------------------------------------------------------------------
	 * Canvas 2D dust field (120 motes) + lamp pool / spine-edge reaction.
	 * ------------------------------------------------------------------ */

	const scene = byId<HTMLCanvasElement>('escena');
	const context2d = scene?.getContext('2d') ?? null;

	if (scene && context2d) {
		const ctx = context2d;
		const canvas = scene;

		const sizeCanvas = () => {
			canvas.width = window.innerWidth;
			canvas.height = window.innerHeight;
		};
		sizeCanvas();
		window.addEventListener('resize', sizeCanvas, { passive: true, signal });

		const motes: Mote[] = [];
		for (let index = 0; index < MOTE_COUNT; index += 1) {
			motes.push({
				x: Math.random(),
				y: Math.random(),
				r: 0.5 + Math.random() * 1.7,
				phase: Math.random() * 6.28,
				vx: 0,
				vy: 0,
			});
		}

		if (reduceMotion) {
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			if (focusPool) focusPool.setAttribute('opacity', '.35');
		} else {
			const drawField = () => {
				if (disposed) return;
				const now = Date.now() * 0.001;
				const rgb = currentMoteRgb();
				ctx.clearRect(0, 0, canvas.width, canvas.height);

				for (const mote of motes) {
					const px = mote.x * canvas.width;
					const py = mote.y * canvas.height;
					const dx = lampX - px;
					const dy = lampY - py;
					const distance = Math.hypot(dx, dy);

					if (distance < 250 && distance > 1) {
						const pull = 0.01 * (1 - distance / 250);
						mote.vx += (dx / distance) * pull;
						mote.vy += (dy / distance) * pull;
					}

					mote.vx *= 0.94;
					mote.vy *= 0.94;
					mote.x += mote.vx * 0.002 + 0.00005;
					mote.y += mote.vy * 0.002;
					if (mote.x > 1) mote.x -= 1;
					if (mote.x < 0) mote.x += 1;
					if (mote.y > 1) mote.y -= 1;
					if (mote.y < 0) mote.y += 1;

					const alpha =
						0.04 + 0.04 * Math.sin(now + mote.phase) + (distance < 250 ? (1 - distance / 250) * 0.3 : 0);

					ctx.beginPath();
					ctx.arc(mote.x * canvas.width, mote.y * canvas.height, mote.r, 0, Math.PI * 2);
					ctx.fillStyle = `rgba(${rgb},${Math.min(0.45, alpha).toFixed(3)})`;
					ctx.fill();
				}

				// Focus pool and spine edges follow the lamp inside the shelf SVG.
				if (focusPool && focusPool.ownerSVGElement) {
					const box = focusPool.ownerSVGElement.getBoundingClientRect();
					if (box.width > 0) {
						const inside =
							lampX > box.left - 30 &&
							lampX < box.right + 30 &&
							lampY > box.top - 20 &&
							lampY < box.bottom + 20;
						const cx = inside ? ((lampX - box.left) / box.width) * 600 : 300 + Math.sin(now * 0.42) * 170;
						const cy = inside ? ((lampY - box.top) / box.height) * 540 : 210 + Math.cos(now * 0.31) * 95;
						focusPool.setAttribute('cx', Math.max(40, Math.min(560, cx)).toFixed(1));
						focusPool.setAttribute('cy', Math.max(60, Math.min(460, cy)).toFixed(1));
						focusPool.setAttribute('opacity', inside ? '0.88' : '0.52');

						for (const edge of spineEdges) {
							const edgeDx = cx - edge.cx;
							const edgeDy = cy - edge.cy;
							const pulse = Math.exp(
								-(edgeDx * edgeDx + edgeDy * edgeDy * 0.45) / (inside ? 11_000 : 16_000),
							);
							edge.element.setAttribute(
								'opacity',
								Math.min(0.98, edge.baseOpacity + pulse * (inside ? 0.55 : 0.32)).toFixed(3),
							);
						}
					}
				}

				requestFrame(drawField);
			};

			requestFrame(drawField);
		}
	}

	/* ---------------------------------------------------------------------
	 * c) Catálogo — chip filters, instant search and the offline preview.
	 * ------------------------------------------------------------------ */

	const chips = Array.from(document.querySelectorAll<HTMLButtonElement>('.chip[data-filtro]'));
	const tomos = Array.from(document.querySelectorAll<HTMLElement>('.tomo'));
	const catalogSearch = byId<HTMLInputElement>('catSearch');
	const emptySearch = byId<HTMLElement>('catEmptySearch');
	const offlineCount = byId<HTMLElement>('dlCount');
	const offlineBar = byId<HTMLElement>('dlBar');

	if (tomos.length > 0 || chips.length > 0) {
		let activeKind = chips.find((chip) => chip.dataset.activa === 'true')?.dataset.filtro ?? '*';

		const renderOfflineMeter = () => {
			const selectedKb = tomos
				.filter((tomo) => tomo.dataset.offline === 'true')
				.map((tomo) => Number(tomo.dataset.kb ?? '0'));
			const meter = computeOfflineMeter(selectedKb);
			if (offlineCount) offlineCount.textContent = meter.label;
			if (offlineBar) offlineBar.style.width = `${meter.barPercent}%`;
		};

		const applyCatalogFilter = () => {
			const query = normalizeSearchText(catalogSearch?.value ?? '');
			let visible = 0;

			for (const tomo of tomos) {
				const matchesKind = activeKind === '*' || tomo.dataset.kind === activeKind;
				const matchesQuery = !query || (tomo.dataset.search ?? '').includes(query);
				const show = matchesKind && matchesQuery;
				tomo.style.display = show ? '' : 'none';
				if (show) visible += 1;
			}

			if (emptySearch) {
				emptySearch.hidden = visible > 0 || tomos.length === 0;
			}
		};

		for (const chip of chips) {
			chip.addEventListener(
				'click',
				() => {
					activeKind = chip.dataset.filtro ?? '*';
					for (const other of chips) {
						const active = other === chip;
						other.dataset.activa = active ? 'true' : 'false';
						other.setAttribute('aria-pressed', String(active));
					}
					applyCatalogFilter();
				},
				{ signal },
			);
		}

		catalogSearch?.addEventListener('input', applyCatalogFilter, { signal });

		for (const tomo of tomos) {
			const button = tomo.querySelector<HTMLButtonElement>('.btn-dl');
			const badge = tomo.querySelector<HTMLElement>('.tomo-badge');
			if (!button) continue;

			button.addEventListener(
				'click',
				() => {
					const nowOffline = tomo.dataset.offline !== 'true';
					tomo.dataset.offline = nowOffline ? 'true' : 'false';
					button.textContent = nowOffline ? 'Quitar' : '↓ Descargar';
					button.setAttribute('aria-pressed', String(nowOffline));
					if (badge) badge.textContent = nowOffline ? 'offline ✓' : 'nube';
					renderOfflineMeter();
				},
				{ signal },
			);
		}

		renderOfflineMeter();
	}

	/* ---------------------------------------------------------------------
	 * d) Pipeline — steps and river stations cross-highlight + caption.
	 * ------------------------------------------------------------------ */

	const steps = Array.from(document.querySelectorAll<HTMLElement>('.paso[data-step]'));
	const stations = Array.from(document.querySelectorAll<SVGGElement>('.estacion[data-est]'));
	const pipeLabel = byId<HTMLElement>('pipeActiveLabel');

	if (steps.length > 0 || stations.length > 0) {
		const activateStep = (step: string | undefined) => {
			if (!step) return;
			for (const element of steps) {
				const active = element.dataset.step === step;
				element.dataset.activo = active ? 'true' : 'false';
				element.setAttribute('aria-pressed', String(active));
			}
			for (const station of stations) {
				const active = station.dataset.est === step;
				station.dataset.lit = active ? 'true' : 'false';
				station.setAttribute('aria-pressed', String(active));
			}
			if (pipeLabel) pipeLabel.textContent = pipelineCaptionForStep(step);
		};

		for (const element of steps) {
			const step = element.dataset.step;
			element.addEventListener('mouseenter', () => activateStep(step), { signal });
			element.addEventListener('focus', () => activateStep(step), { signal });
			element.addEventListener('click', () => activateStep(step), { signal });
			element.addEventListener(
				'keydown',
				(event) => {
					if (!isKeyboardActivation(event)) return;
					event.preventDefault();
					activateStep(step);
				},
				{ signal },
			);
		}

		for (const station of stations) {
			const step = station.dataset.est;
			station.addEventListener('mouseenter', () => activateStep(step), { signal });
			station.addEventListener('focus', () => activateStep(step), { signal });
			station.addEventListener('click', () => activateStep(step), { signal });
			station.addEventListener(
				'keydown',
				(event) => {
					if (!isKeyboardActivation(event)) return;
					event.preventDefault();
					activateStep(step);
				},
				{ signal },
			);
		}
	}

	/* ---------------------------------------------------------------------
	 * e) Vigilia live embed — validated same-origin `/lecturas/:id` only.
	 * ------------------------------------------------------------------ */

	const embedInput = byId<HTMLInputElement>('embedUrlInput');
	const embedButton = byId<HTMLButtonElement>('embedLoadBtn');
	const embedQuickButton = byId<HTMLButtonElement>('embedQuickLoadBtn');
	const embedViewport = byId<HTMLElement>('embedViewport');
	const embedFrame = byId<HTMLIFrameElement>('embedIframe');
	const embedError = byId<HTMLElement>('embedError');
	const embedFullLink = byId<HTMLAnchorElement>('embedFullLink');

	if (embedInput && embedViewport && embedFrame) {
		const showEmbedError = (message: string) => {
			if (!embedError) return;
			embedError.textContent = message;
			embedError.hidden = false;
		};

		const clearEmbedError = () => {
			if (!embedError) return;
			embedError.textContent = '';
			embedError.hidden = true;
		};

		const loadEmbed = (raw: string) => {
			const safePath = resolveSafeReaderEmbedPath(raw, window.location.origin);
			if (!safePath) {
				// A rejected URL never touches `iframe.src`: the previous frame stays.
				showEmbedError(
					raw.trim()
						? 'Ruta no permitida: usá /lecturas/:id del mismo origen (por ejemplo /lecturas/4 o 4).'
						: 'Escribí una ruta del lector (/lecturas/4) o el ID del libro.',
				);
				return;
			}

			clearEmbedError();
			embedFrame.src = safePath;
			embedViewport.dataset.loaded = 'true';
			embedInput.value = safePath;

			if (embedFullLink) {
				embedFullLink.href = safePath;
				if (embedFullLink.dataset.fullLink !== 'true') {
					embedFullLink.textContent = 'Abrir pantalla completa ↗';
					embedFullLink.dataset.fullLink = 'true';
				}
			}
		};

		embedButton?.addEventListener('click', () => loadEmbed(embedInput.value), { signal });
		embedInput.addEventListener(
			'keydown',
			(event) => {
				if (event.key !== 'Enter') return;
				event.preventDefault();
				loadEmbed(embedInput.value);
			},
			{ signal },
		);
		embedQuickButton?.addEventListener(
			'click',
			() => loadEmbed(embedQuickButton.dataset.defaultPath ?? embedInput.value),
			{ signal },
		);

		const initialDefault = embedViewport.dataset.defaultPath;
		if (initialDefault && !embedFrame.getAttribute('src')) {
			loadEmbed(initialDefault);
		}
	}

	/* ---------------------------------------------------------------------
	 * f) Journey simulator — desktop ↔ phone continuity (preview only).
	 * ------------------------------------------------------------------ */

	const journeyStage = byId<HTMLElement>('viajeStage');

	if (journeyStage) {
		/* `JourneyState.offline`/`pending`/pages feed every label below; each
		   bound click only asks the pure reducers for the next state. */
		let journey: JourneyState = createInitialJourneyState();

		const onlineButton = byId<HTMLButtonElement>('btnOnline');
		const offlineButton = byId<HTMLButtonElement>('btnOffline');
		const phonePrev = byId<HTMLButtonElement>('phonePrev');
		const phoneNext = byId<HTMLButtonElement>('phoneNext');
		const deskStatus = byId<HTMLElement>('deskStatus');
		const deskNote = byId<HTMLElement>('deskNote');
		const deskPage = byId<HTMLElement>('deskPage');
		const deskPct = byId<HTMLElement>('deskPct');
		const deskBar = byId<HTMLElement>('deskBar');
		const deskText = byId<HTMLElement>('deskText');
		const phonePill = byId<HTMLElement>('phonePill');
		const phoneText = byId<HTMLElement>('phoneText');
		const phoneQueue = byId<HTMLElement>('phoneQueue');
		const phonePage = byId<HTMLElement>('phonePage');
		const phonePct = byId<HTMLElement>('phonePct');
		const syncTag = byId<HTMLElement>('syncTag');
		const titlePage = byId<HTMLElement>('vTitlePage');

		const snippetAt = (index: number) => {
			const length = JOURNEY_SNIPPETS.length;
			return JOURNEY_SNIPPETS[((index % length) + length) % length]!;
		};

		// Text nodes + `<span class="en-focus">` only: no `innerHTML` anywhere.
		const paintSnippet = (
			target: HTMLElement | null,
			parts: { lead?: string; focus: string; tail: string },
		) => {
			if (!target) return;
			const nodes: Node[] = [];
			if (parts.lead) nodes.push(document.createTextNode(parts.lead));
			const focus = document.createElement('span');
			focus.className = 'en-focus';
			focus.textContent = parts.focus;
			nodes.push(focus, document.createTextNode(parts.tail));
			target.replaceChildren(...nodes);
		};

		const renderJourney = () => {
			journeyStage.dataset.offline = journey.offline ? 'true' : 'false';

			if (onlineButton) {
				onlineButton.dataset.active = journey.offline ? 'false' : 'true';
				onlineButton.setAttribute('aria-pressed', String(!journey.offline));
			}
			if (offlineButton) {
				offlineButton.dataset.active = journey.offline ? 'true' : 'false';
				offlineButton.setAttribute('aria-pressed', String(journey.offline));
			}

			if (deskStatus) deskStatus.textContent = journey.deskStatus;
			if (deskNote) deskNote.textContent = journey.deskNote;
			if (deskPage) deskPage.textContent = String(journey.deskPage);
			if (deskPct) deskPct.textContent = `${journey.deskPct}%`;
			if (deskBar) deskBar.style.width = `${journey.deskPct}%`;

			if (phonePill) phonePill.textContent = journey.phonePill;
			if (phoneQueue) phoneQueue.textContent = journey.phoneQueueLabel;
			if (phonePage) phonePage.textContent = String(journey.phonePage);
			if (phonePct) phonePct.textContent = `${journey.phonePct}%`;
			if (syncTag) syncTag.textContent = journey.syncTag;
			if (titlePage) titlePage.textContent = String(journey.phonePage);

			const deskSnippet = snippetAt(journey.deskSnippetIndex);
			paintSnippet(deskText, {
				lead: deskSnippet.deskLead,
				focus: deskSnippet.deskFocus,
				tail: deskSnippet.deskTail,
			});

			const phoneSnippet = snippetAt(journey.phoneSnippetIndex);
			paintSnippet(phoneText, {
				focus: phoneSnippet.phoneFocus,
				tail: phoneSnippet.phoneTail,
			});
		};

		offlineButton?.addEventListener(
			'click',
			() => {
				journey = setJourneyOffline(journey, true);
				renderJourney();
			},
			{ signal },
		);
		onlineButton?.addEventListener(
			'click',
			() => {
				journey = setJourneyOffline(journey, false);
				renderJourney();
			},
			{ signal },
		);
		phonePrev?.addEventListener(
			'click',
			() => {
				journey = stepJourneyPage(journey, -1);
				renderJourney();
			},
			{ signal },
		);
		phoneNext?.addEventListener(
			'click',
			() => {
				journey = stepJourneyPage(journey, 1);
				renderJourney();
			},
			{ signal },
		);

		renderJourney();
	}

	activeCleanup = cleanup;
	return cleanup;
}
