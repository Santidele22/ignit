import type { APIRoute } from 'astro';
import { getServerSession } from '../../../features/auth/api/serverSession';
import { handleEdgeSyncPush, type EdgeSyncPushItem } from '../../../features/library/api/edgeSync';
import { createNeonHttpSqlRunner } from '../../../shared/api/neonHttpSql';
import { backendUrl, databaseUrl } from '../../../shared/api/serverEnvironment';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	const rawBody = await request.text();
	if (!databaseUrl) {
		const upstream = await fetch(`${backendUrl}/sync/push`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				...(request.headers.get('cookie') ? { cookie: request.headers.get('cookie')! } : {}),
				...(request.headers.get('authorization')
					? { authorization: request.headers.get('authorization')! }
					: {}),
			},
			body: rawBody,
		});
		return new Response(upstream.body, {
			status: upstream.status,
			headers: { 'content-type': 'application/json; charset=utf-8' },
		});
	}

	const session = await getServerSession(request.headers.get('cookie'));
	if (!session.authenticated) {
		return new Response(JSON.stringify({ message: 'No autorizado' }), {
			status: 401,
			headers: { 'content-type': 'application/json; charset=utf-8' },
		});
	}

	const parsed = JSON.parse(rawBody || '{}') as { items?: EdgeSyncPushItem[] };
	const items = Array.isArray(parsed.items) ? parsed.items : [];
	const sql = createNeonHttpSqlRunner(databaseUrl);
	const result = await handleEdgeSyncPush(session.user.id, items, sql);

	return new Response(JSON.stringify(result), {
		status: 200,
		headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
	});
};
