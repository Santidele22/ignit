import type { APIRoute } from 'astro';
import { backendUrl, contentCacheKv, neonAuthUrl } from '../../shared/api/serverEnvironment';
import { invalidateContentCache, setEdgeCacheStore } from '../../shared/api/contentCache';

const BETTER_AUTH_PREFIX = '/api/auth';

/**
 * Web origins allowed to call `/api/auth/*` cross-origin with credentials.
 * Same-origin traffic is always accepted without needing CORS.
 */
const ALLOWED_CROSS_ORIGINS: readonly string[] = [];

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const UPSTREAM_CORS_HEADERS = new Set([
	'access-control-allow-origin',
	'access-control-allow-credentials',
	'access-control-allow-methods',
	'access-control-allow-headers',
	'access-control-expose-headers',
	'access-control-max-age',
	'access-control-allow-private-network',
]);

const ORIGIN_FORBIDDEN = JSON.stringify({ message: 'Origen no permitido.' });

function parseOrigin(originHeader: string | null): string | null {
	if (!originHeader) return null;
	try {
		return new URL(originHeader).origin;
	} catch {
		return null;
	}
}

function allowedCrossOrigin(originHeader: string | null): string | null {
	const origin = parseOrigin(originHeader);
	return origin && ALLOWED_CROSS_ORIGINS.includes(origin) ? origin : null;
}

const DEFAULT_BODY_LIMIT = 1_048_576; // 1 MiB
const BOOK_FILE_BODY_LIMIT = 62_914_560; // 60 MiB
const BOOK_FILE_ROUTE = /^\/api\/books\/[^/]+\/file$/;

export const prerender = false;

function upstreamUrl(url: URL): string {
	if (neonAuthUrl && url.pathname.startsWith(BETTER_AUTH_PREFIX)) {
		const authPath = url.pathname.slice(BETTER_AUTH_PREFIX.length);
		return `${neonAuthUrl}${authPath}${url.search}`;
	}

	if (url.pathname.startsWith(BETTER_AUTH_PREFIX)) {
		return `${backendUrl}${url.pathname}${url.search}`;
	}

	return `${backendUrl}${url.pathname.replace(/^\/api/, '')}${url.search}`;
}

function bodyLimitFor(pathname: string, method: string): number {
	return method === 'POST' && BOOK_FILE_ROUTE.test(pathname) ? BOOK_FILE_BODY_LIMIT : DEFAULT_BODY_LIMIT;
}

const PAYLOAD_TOO_LARGE = JSON.stringify({
	message: 'El cuerpo de la petición supera el límite permitido.',
});

async function readBody(request: Request, limit: number): Promise<ArrayBuffer | 'too-large' | undefined> {
	if (['GET', 'HEAD'].includes(request.method)) {
		return undefined;
	}

	const declared = Number(request.headers.get('content-length') ?? '0');
	if (Number.isFinite(declared) && declared > limit) {
		return 'too-large';
	}

	if (!request.body) {
		return undefined;
	}

	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;

	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;

			size += value.byteLength;
			if (size > limit) {
				await reader.cancel();
				return 'too-large';
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const body = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}

	return body.buffer;
}

async function forward(request: Request, clientAddress?: string): Promise<Response> {
	const url = new URL(request.url);
	const upstream = upstreamUrl(url);

	const headers = new Headers();
	for (const [key, value] of request.headers) {
		if (
			[
				'host',
				'connection',
				'content-length',
				'transfer-encoding',
				'upgrade',
				'forwarded',
				'x-forwarded-host',
				'x-forwarded-proto',
				'x-forwarded-port',
			].includes(key.toLowerCase())
		) {
			continue;
		}
		headers.set(key, value);
	}

	if (clientAddress) {
		const claimed = headers.get('x-forwarded-for')?.split(',').map((entry) => entry.trim()).filter(Boolean) ?? [];
		headers.set('x-forwarded-for', [...claimed, clientAddress].join(', '));
	}

	const body = await readBody(request, bodyLimitFor(url.pathname, request.method));
	if (body === 'too-large') {
		return new Response(PAYLOAD_TOO_LARGE, { status: 413, headers: { 'Content-Type': 'application/json' } });
	}

	let response: Response;
	try {
		response = await fetch(upstream, { method: request.method, headers, body });
	} catch {
		return new Response(
			JSON.stringify({ message: 'No se pudo conectar con el servidor. Inténtalo de nuevo en unos minutos.' }),
			{ status: 502, headers: { 'Content-Type': 'application/json' } },
		);
	}

	const echoed = new Headers();
	for (const [key, value] of response.headers) {
		if (
			['content-length', 'transfer-encoding', 'connection', 'set-cookie'].includes(key.toLowerCase()) ||
			UPSTREAM_CORS_HEADERS.has(key.toLowerCase())
		) {
			continue;
		}
		echoed.append(key, value);
	}

	for (const cookie of response.headers.getSetCookie?.() ?? []) {
		echoed.append('set-cookie', cookie);
	}

	return new Response(response.body, { status: response.status, headers: echoed });
}

function forbiddenOrigin(): Response {
	return new Response(ORIGIN_FORBIDDEN, { status: 403, headers: { 'Content-Type': 'application/json' } });
}

function authPreflight(request: Request, crossOrigin: string): Response {
	const headers = new Headers();
	headers.set('Access-Control-Allow-Origin', crossOrigin);
	headers.set('Access-Control-Allow-Credentials', 'true');
	headers.set('Access-Control-Allow-Methods', request.headers.get('access-control-request-method') ?? 'POST');
	const allowHeaders = request.headers.get('access-control-request-headers');
	if (allowHeaders) headers.set('Access-Control-Allow-Headers', allowHeaders);
	headers.set('Access-Control-Max-Age', '7200');
	headers.set('Vary', 'Origin');

	return new Response(null, { status: 204, headers });
}

function applyAuthCors(headers: Headers, crossOrigin: string): void {
	headers.set('Access-Control-Allow-Origin', crossOrigin);
	headers.set('Access-Control-Allow-Credentials', 'true');
	headers.append('Vary', 'Origin');
}

async function forwardApi(request: Request, clientAddress?: string): Promise<Response> {
	const url = new URL(request.url);
	if (!url.pathname.startsWith(BETTER_AUTH_PREFIX)) {
		const response = await forward(request, clientAddress);
		if (MUTATING_METHODS.has(request.method) && response.status < 400) {
			setEdgeCacheStore(contentCacheKv);
			await invalidateContentCache();
		}
		return response;
	}

	const originHeader = request.headers.get('origin');
	const crossOrigin = allowedCrossOrigin(originHeader);

	if (request.method === 'OPTIONS' && originHeader && request.headers.get('access-control-request-method')) {
		return crossOrigin ? authPreflight(request, crossOrigin) : forbiddenOrigin();
	}

	if (MUTATING_METHODS.has(request.method) && originHeader) {
		const sameOrigin = parseOrigin(originHeader) === url.origin;
		if (!sameOrigin && !crossOrigin) {
			return forbiddenOrigin();
		}
	}

	const response = await forward(request, clientAddress);
	if (crossOrigin) {
		applyAuthCors(response.headers, crossOrigin);
	}

	return response;
}

export const GET: APIRoute = (context) => forwardApi(context.request, context.clientAddress);
export const POST: APIRoute = (context) => forwardApi(context.request, context.clientAddress);
export const PUT: APIRoute = (context) => forwardApi(context.request, context.clientAddress);
export const PATCH: APIRoute = (context) => forwardApi(context.request, context.clientAddress);
export const DELETE: APIRoute = (context) => forwardApi(context.request, context.clientAddress);
export const HEAD: APIRoute = (context) => forwardApi(context.request, context.clientAddress);
export const OPTIONS: APIRoute = (context) => forwardApi(context.request, context.clientAddress);
