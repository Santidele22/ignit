export const SITE_NAME = 'Ignit';
export const SITE_TITLE = 'Ignit — Lectura inmersiva y biblioteca PDF';
export const SITE_DESCRIPTION =
	'Biblioteca multiusuario y lector PDF en modo Vigilia: subí tus libros, organizá tu lectura y sincronizá tu progreso, subrayados y glosario.';
export const SITE_AUTHOR = 'Ignit';

export type NavLink = {
	href: string;
	label: string;
};

export const NAV_LINKS: NavLink[] = [
	{ href: '/', label: 'Explorar' },
	{ href: '/biblioteca', label: 'Mi biblioteca' },
];
