import { HealthDbController } from './health.controller.js';

function makeController(query: () => Promise<unknown>): HealthDbController {
  return new HealthDbController({ query } as never);
}

const noopSleep = async () => {};

describe('HealthDbController', () => {
  it('returns ok true when the database answers', async () => {
    const controller = makeController(async () => [{ '?column?': 1 }]);
    expect(await controller.checkWithRetry(noopSleep)).toEqual({ ok: true });
  });

  it('retries once on a transient first-query failure and returns ok true', async () => {
    let calls = 0;
    const controller = makeController(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error('Connection terminated unexpectedly');
      }
      return [{ '?column?': 1 }];
    });

    expect(await controller.checkWithRetry(noopSleep)).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('throws when the database query fails after retry', async () => {
    let calls = 0;
    const controller = makeController(async () => {
      calls += 1;
      throw new Error('connection refused');
    });
    await expect(controller.checkWithRetry(noopSleep)).rejects.toThrow(
      'connection refused',
    );
    expect(calls).toBe(2);
  });
});
