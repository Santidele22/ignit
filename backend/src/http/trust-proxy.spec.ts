import { describe, expect, it } from 'vitest';

import { trustProxyHops } from './trust-proxy.js';

describe('trustProxyHops', () => {
  it('defaults to one hop: the Astro SSR proxy', () => {
    expect(trustProxyHops({})).toBe(1);
  });

  it('reads the configured bounded hop count', () => {
    expect(trustProxyHops({ TRUST_PROXY_HOPS: '0' })).toBe(0);
    expect(trustProxyHops({ TRUST_PROXY_HOPS: '2' })).toBe(2);
  });

  it('never trusts wildcard or unbounded values', () => {
    for (const raw of ['', 'true', 'yes', '-1', '3', '1.5']) {
      expect(trustProxyHops({ TRUST_PROXY_HOPS: raw })).toBe(1);
    }
  });
});
