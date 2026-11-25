export const SITE_NAME = 'Ignit';
export const SITE_TITLE = 'Ignit — Lectura inmersiva y biblioteca PDF';
export const SITE_DESCRIPTION =
	'Biblioteca multiusuario y lector PDF en modo Vigilia: subí tus libros, organizá tu lectura y sincronizá tu progreso, subrayados y glosario.';
export const SITE_AUTHOR = 'Ignit';
export const SITE_LEGAL_EMAIL = (import.meta.env.PUBLIC_LEGAL_EMAIL || 'santiidele21@gmail.com').trim();

export type NavLink = {
	href: string;
	label: string;
};

export const NAV_LINKS: NavLink[] = [
	{ href: '/', label: 'Explorar' },
	{ href: '/biblioteca', label: 'Mi biblioteca' },
];

export const LEGAL_LINKS: NavLink[] = [
	{ href: '/terminos', label: 'Términos y Condiciones' },
	{ href: '/privacidad', label: 'Privacidad' },
	{ href: '/dmca', label: 'Derechos de autor / DMCA' },
];
