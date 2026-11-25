import { describe, expect, it } from 'vitest';
import { isOpenLicense, OPEN_LICENSE_OPTIONS } from './open-licenses.js';

describe('open-licenses', () => {
  it('accepts every canonical open license option', () => {
    for (const option of OPEN_LICENSE_OPTIONS) {
      expect(isOpenLicense(option)).toBe(true);
    }
  });

  it('accepts standard variations of open licenses and public domain', () => {
    expect(isOpenLicense('dominio publico')).toBe(true);
    expect(isOpenLicense('Public Domain')).toBe(true);
    expect(isOpenLicense('cc by-sa 3.0')).toBe(true);
    expect(isOpenLicense('CC0')).toBe(true);
    expect(isOpenLicense('MIT')).toBe(true);
    expect(isOpenLicense('Apache-2.0')).toBe(true);
    expect(isOpenLicense('GPL-3.0')).toBe(true);
    expect(isOpenLicense('GFDL 1.3')).toBe(true);
    expect(isOpenLicense('Creative Commons Attribution 4.0')).toBe(true);
  });

  it('rejects empty, copyrighted, or unrecognized license strings', () => {
    expect(isOpenLicense(null)).toBe(false);
    expect(isOpenLicense(undefined)).toBe(false);
    expect(isOpenLicense('')).toBe(false);
    expect(isOpenLicense('   ')).toBe(false);
    expect(isOpenLicense('Todos los derechos reservados')).toBe(false);
    expect(isOpenLicense('All rights reserved')).toBe(false);
    expect(isOpenLicense('Copyright 2024 Editorial X')).toBe(false);
    expect(isOpenLicense('Autorización editorial')).toBe(false);
    expect(isOpenLicense('Uso personal')).toBe(false);
    expect(isOpenLicense('Creative Commons no aplica')).toBe(false);
    expect(isOpenLicense('Open Source? No')).toBe(false);
    expect(isOpenLicense('Dominio público: no (todos los derechos reservados)')).toBe(false);
    expect(isOpenLicense('Public domain not verified')).toBe(false);
    expect(isOpenLicense('Licencia open source prohibida')).toBe(false);
    expect(isOpenLicense('Documentación libre denegada')).toBe(false);
  });
});
