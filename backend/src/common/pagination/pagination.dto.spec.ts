import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DEFAULT_LIMIT, MAX_LIMIT, PaginationQueryDto } from './pagination.dto.js';

const Dto = PaginationQueryDto;

async function validated(raw: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(Dto, raw);
  return (await validate(dto)).map((error) => error.property);
}

describe('PaginationQueryDto', () => {
  it('is not in pagination mode on an empty query (S3 envelope only with params)', () => {
    const dto = plainToInstance(Dto, {});
    expect(dto.isPaginated()).toBe(false);
    expect(dto.offsetValue()).toBe(0);
    expect(dto.limitValue()).toBe(DEFAULT_LIMIT);
  });

  it('coerces string query params into numbers and turns pagination mode on (S2 parsing)', () => {
    const dto = plainToInstance(Dto, { offset: '10', limit: '4' });
    expect(dto.offset).toBe(10);
    expect(dto.limit).toBe(4);
    expect(dto.isPaginated()).toBe(true);
    expect(dto.offsetValue()).toBe(10);
    expect(dto.limitValue()).toBe(4);
  });

  it('accepts the clamping boundaries', async () => {
    expect(await validated({ offset: '0', limit: String(MAX_LIMIT) })).toEqual([]);
    expect(await validated({ limit: '1' })).toEqual([]);
  });

  it('clamps an excessive limit to the hard cap instead of erroring (S2 saneado)', () => {
    const dto = plainToInstance(Dto, { offset: '0', limit: String(MAX_LIMIT + 1) });
    expect(dto.limitValue()).toBe(MAX_LIMIT);
  });

  it('clamps negative and zero limits into [1, MAX_LIMIT] (S2 saneado)', () => {
    expect(plainToInstance(Dto, { limit: '-3' }).limitValue()).toBe(1);
    expect(plainToInstance(Dto, { limit: '0' }).limitValue()).toBe(1);
  });

  it('clamps a negative offset to the first page (S2 saneado)', () => {
    expect(plainToInstance(Dto, { offset: '-1' }).offsetValue()).toBe(0);
  });

  it('rejects non-numeric params so garbage never reaches SQL (S2)', async () => {
    expect(await validated({ limit: 'abc' })).toContain('limit');
    expect(await validated({ offset: 'abc' })).toContain('offset');
  });

  it('rejects decimal params (offset/limit are integers)', async () => {
    expect(await validated({ limit: '2.5' })).toContain('limit');
    expect(await validated({ offset: '1.5' })).toContain('offset');
  });
});
