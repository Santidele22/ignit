import { defineMiddleware } from 'astro:middleware';
import { getServerSession, type ServerSession } from './features/auth/api/serverSession';
import { isAuthSecurityScope, isProtectedRoute, LOGIN_PATH } from './features/auth/paths';
import { setEdgeCacheStore, setWaitUntil } from './shared/api/contentCache';
import { contentCacheKv } from './shared/api/serverEnvironment';
import { applySecurityHeaders } from './shared/lib/securityHeaders';

const PAGE_BG = '#f4efe4';
const PAGE_FG = '#23201a';
const PAGE_MUTED = '#6f6657';
const PAGE_AKA = '#c73e3a';

function wakingPage(pathname: string): Response {
	const escapedPath = pathname.replace(/[&<>"']/g, (ch) =>
		({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
	);
	const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<meta http-equiv="refresh" content="30" />
<title>Ignit se está despertando</title>
<style>
:root { color-scheme: light; }
body {
  margin: 0;
  background: ${PAGE_BG};
  color: ${PAGE_FG};
  font-family: system-ui, sans-serif;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 2rem;
}
main { max-width: 34rem; }
p.eyebrow {
  display: flex; align-items: center; gap: .75rem;
  margin: 0 0 1rem;
  font-size: .8rem; font-weight: 500; letter-spacing: .25em;
  color: ${PAGE_MUTED};
}
span.rule { display: inline-block; width: 2.5rem; height: 1px; background: ${PAGE_AKA}; }
h1 { margin: 0 0 1rem; font-size: 1.9rem; line-height: 1.2; }
p { margin: 0 0 .5rem; line-height: 1.6; }
p.note { color: ${PAGE_MUTED}; font-size: .9rem; }
</style>
</head>
<body>
<main>
<p class="eyebrow"><span class="rule"></span>ERROR 503</p>
<h1>Ignit se está despertando</h1>
<p>${escapedPath} está bien, pero el servidor todavía está encendiendo. Recargá en un minuto para abrir tu biblioteca.</p>
<p class="note">La página se recarga sola en 30 segundos, o podés hacerlo vos.</p>
</main>
</body>
</html>`;

	return new Response(html, {
		status: 503,
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Retry-After': '60',
			'Cache-Control': 'no-store',
		},
	});
}

export const onRequest = defineMiddleware(async (context, next) => {
	const runtime = context.locals as unknown as {
		cfContext?: { waitUntil?: (promise: Promise<unknown>) => void };
		runtime?: { ctx?: { waitUntil?: (promise: Promise<unknown>) => void } };
	};

	const waitUntilOwner = runtime.cfContext?.waitUntil
		? runtime.cfContext
		: runtime.runtime?.ctx?.waitUntil
			? runtime.runtime.ctx
			: undefined;
	setWaitUntil(waitUntilOwner?.waitUntil ? (promise) => waitUntilOwner.waitUntil!(promise) : undefined);
	setEdgeCacheStore(contentCacheKv);

	let response: Response;

	const isProtected = isProtectedRoute(context.url.pathname);
	if (isProtected) {
		const session = await getServerSession(context.request.headers.get('cookie'));

		if (!session.authenticated) {
			const redirect = context.url.pathname + context.url.search;
			response = new Response(null, {
				status: 302,
				headers: { Location: `${LOGIN_PATH}?redirect=${encodeURIComponent(redirect)}` },
			});
		} else {
			(context.locals as unknown as { serverSession?: ServerSession }).serverSession = session;
			try {
				response = await next();
			} catch (error) {
				console.error(`[middleware] render failed for ${context.url.pathname}`, error);
				response = wakingPage(context.url.pathname);
			}
		}
	} else {
		try {
			response = await next();
		} catch (error) {
			console.error(`[middleware] render failed for ${context.url.pathname}`, error);
			response = wakingPage(context.url.pathname);
		}
	}

	const allowEvalForAuth = isAuthSecurityScope(context.url.pathname);
	applySecurityHeaders(response.headers, {
		pathname: context.url.pathname,
		isHttps: context.url.protocol === 'https:',
		allowEvalForAuth,
	});
	if (isProtected) {
		response.headers.set('Cache-Control', 'no-store');
	}

	return response;
});
