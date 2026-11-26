const { jwtVerify } = vi.hoisted(() => ({ jwtVerify: vi.fn() }));

vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => 'remote-jwks'),
  jwtVerify,
}));

import { NeonSessionReader } from './neon-session.reader.js';

const env = {
  NEON_AUTH_BASE_URL: 'https://auth.example.com/ignit/auth',
  NEON_AUTH_JWKS_URL: 'https://auth.example.com/ignit/auth/.well-known/jwks.json',
};

describe('NeonSessionReader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('verifies a bearer token and maps its claims to the route session', async () => {
    jwtVerify.mockResolvedValue({
      payload: {
        sub: 'user-1',
        email: 'admin@example.com',
        name: 'Admin',
        role: 'admin',
        exp: 1_800_000_000,
      },
    });
    const reader = new NeonSessionReader(undefined, env);

    const session = await reader.read({ authorization: 'Bearer signed-token' });

    expect(jwtVerify).toHaveBeenCalledWith('signed-token', 'remote-jwks', {
      algorithms: ['EdDSA'],
      issuer: 'https://auth.example.com',
      audience: 'https://auth.example.com',
    });
    expect(session?.user).toEqual({
      id: 'user-1',
      email: 'admin@example.com',
      name: 'Admin',
      role: 'admin',
    });
  });

  it('returns null without a bearer token', async () => {
    const reader = new NeonSessionReader(undefined, env);

    await expect(reader.read({})).resolves.toBeNull();
    await expect(reader.read({ authorization: 'Basic abc' })).resolves.toBeNull();
    expect(jwtVerify).not.toHaveBeenCalled();
  });

  it('rejects banned users and invalid tokens', async () => {
    const reader = new NeonSessionReader(undefined, env);
    jwtVerify.mockResolvedValueOnce({
      payload: { sub: 'user-1', email: 'admin@example.com', banned: true },
    });
    jwtVerify.mockRejectedValueOnce(new Error('expired'));

    await expect(reader.read({ authorization: 'Bearer banned' })).resolves.toBeNull();
    await expect(reader.read({ authorization: 'Bearer expired' })).resolves.toBeNull();
  });

  it('rejects payloads without the required identity claims', async () => {
    jwtVerify.mockResolvedValue({ payload: { role: 'admin' } });
    const reader = new NeonSessionReader(undefined, env);

    await expect(reader.read({ authorization: 'Bearer token' })).resolves.toBeNull();
  });

  it('uses the current database role over a non-admin token role', async () => {
    jwtVerify.mockResolvedValue({
      payload: {
        sub: 'user-1',
        email: 'admin@example.com',
        name: 'Admin',
        role: 'authenticated',
      },
    });
    const dataSource = {
      query: vi.fn().mockResolvedValue([{ role: 'admin' }]),
    };
    const reader = new NeonSessionReader(dataSource as never, env);

    const session = await reader.read({ authorization: 'Bearer signed-token' });

    expect(dataSource.query).toHaveBeenCalledWith(
      'SELECT "role" FROM neon_auth."user" WHERE "id" = $1 LIMIT 1',
      ['user-1'],
    );
    expect(session?.user.role).toBe('admin');
  });

  it('caches the database role across consecutive reads for the same user', async () => {
    jwtVerify.mockResolvedValue({
      payload: {
        sub: 'user-1',
        email: 'admin@example.com',
        name: 'Admin',
        role: 'authenticated',
      },
    });
    const dataSource = {
      query: vi.fn().mockResolvedValue([{ role: 'admin' }]),
    };
    const reader = new NeonSessionReader(dataSource as never, env);

    const first = await reader.read({ authorization: 'Bearer signed-token' });
    const second = await reader.read({ authorization: 'Bearer signed-token' });

    expect(first?.user.role).toBe('admin');
    expect(second?.user.role).toBe('admin');
    expect(dataSource.query).toHaveBeenCalledTimes(1);
  });
});
