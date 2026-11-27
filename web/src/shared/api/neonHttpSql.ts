export type SqlRunner = <T = Record<string, unknown>>(
	query: string,
	params?: unknown[],
) => Promise<T[]>;

/**
 * Creates a zero-dependency Neon HTTP SQL runner compatible with Cloudflare Workers.
 * Uses Neon's serverless HTTP SQL endpoint (`https://<host>/sql`).
 */
export function createNeonHttpSqlRunner(connectionString: string): SqlRunner {
	const parsed = new URL(connectionString);
	const endpoint = `https://${parsed.hostname}/sql`;

	return async <T = Record<string, unknown>>(
		query: string,
		params: unknown[] = [],
	): Promise<T[]> => {
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Neon-Connection-String': connectionString,
			},
			body: JSON.stringify({ query, params }),
		});
		if (!response.ok) {
			const msg = await response.text().catch(() => response.statusText);
			throw new Error(`Neon HTTP SQL error (${response.status}): ${msg}`);
		}
		const payload = (await response.json()) as { rows?: T[] };
		return Array.isArray(payload.rows) ? payload.rows : [];
	};
}
