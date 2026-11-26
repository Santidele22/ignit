import { pingBackend, resolvePingPath } from './ping';

export interface Env {
	BACKEND_URL?: string;
}

async function runScheduledPing(cron: string | undefined, env: Env): Promise<void> {
	const backendUrl = env.BACKEND_URL?.trim();
	if (!backendUrl) {
		console.error('[ignit-keep-alive] BACKEND_URL is not configured');
		return;
	}

	const path = resolvePingPath(cron);
	const result = await pingBackend(backendUrl, { path });
	const logLine = JSON.stringify({
		event: 'ignit-keep-alive',
		cron: cron ?? 'manual',
		...result,
	});

	if (result.ok) {
		console.log(logLine);
	} else {
		console.error(logLine);
	}
}

export default {
	async fetch(): Promise<Response> {
		return new Response('Not Found', {
			status: 404,
			headers: { 'Cache-Control': 'no-store' },
		});
	},

	async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		ctx.waitUntil(runScheduledPing(controller.cron, env));
	},
};
