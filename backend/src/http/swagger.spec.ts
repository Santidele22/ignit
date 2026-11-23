import { describe, expect, it } from 'vitest';
import { buildSwaggerConfig, isSwaggerEnabled } from './swagger.js';

describe('swagger configuration', () => {
  describe('isSwaggerEnabled', () => {
    it('enables Swagger outside production when SWAGGER_ENABLED is unset', () => {
      expect(isSwaggerEnabled({})).toBe(true);
      expect(isSwaggerEnabled({ NODE_ENV: 'development' })).toBe(true);
      expect(isSwaggerEnabled({ NODE_ENV: 'test' })).toBe(true);
    });

    it('disables Swagger in production unless SWAGGER_ENABLED is explicitly true', () => {
      expect(isSwaggerEnabled({ NODE_ENV: 'production' })).toBe(false);
      expect(
        isSwaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: 'false' }),
      ).toBe(false);
      expect(
        isSwaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: '1' }),
      ).toBe(false);
    });

    it('enables Swagger in production when SWAGGER_ENABLED is true', () => {
      expect(
        isSwaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: 'true' }),
      ).toBe(true);
    });

    it('honors SWAGGER_ENABLED=false even outside production', () => {
      expect(
        isSwaggerEnabled({ NODE_ENV: 'development', SWAGGER_ENABLED: 'false' }),
      ).toBe(false);
    });
  });

  describe('buildSwaggerConfig', () => {
    it('registers bearer and cookie security schemes and servers', () => {
      const config = buildSwaggerConfig();

      expect(config.info.title).toBe('Ignit API');
      expect(config.info.version).toBe('1.0.0');
      expect(config.servers?.map((s) => s.url)).toEqual(['/', '/api']);
      expect(config.components?.securitySchemes).toHaveProperty('bearer');
      expect(config.components?.securitySchemes).toHaveProperty(
        'session-cookie',
      );
    });
  });
});
