import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { BooksService } from './books.service.js';
import {
	DEMO_FEATURED_ROTATION_MS,
	pickDemoFeaturedBookId,
} from './lib/demo-featured.js';
import type { Book } from './entities/book.entity.js';
import type { BookStorage } from './storage/book-storage.js';
import type { DownloadEvent } from './entities/download-event.entity.js';
import type { ReadingState } from './entities/reading-state.entity.js';
import type { User } from '../users/entities/user.entity.js';

const HOUR = DEMO_FEATURED_ROTATION_MS;

describe('pickDemoFeaturedBookId', () => {
	it('returns null for an empty public shelf', () => {
		expect(pickDemoFeaturedBookId([], 0)).toBeNull();
	});

	it('keeps the single published book featured across every slot', () => {
		expect(pickDemoFeaturedBookId([5], 0)).toBe(5);
		expect(pickDemoFeaturedBookId([5], HOUR * 1000)).toBe(5);
		expect(pickDemoFeaturedBookId([5], -HOUR)).toBe(5);
	});

	it('rotates by hour slot and cycles back to the start of the pool', () => {
		expect(pickDemoFeaturedBookId([10, 20, 30], 0)).toBe(10);
		expect(pickDemoFeaturedBookId([10, 20, 30], HOUR)).toBe(20);
		expect(pickDemoFeaturedBookId([10, 20, 30], HOUR * 2)).toBe(30);
		// Slot 3 wraps to the first entry: the rotation never dead-ends.
		expect(pickDemoFeaturedBookId([10, 20, 30], HOUR * 3)).toBe(10);
	});
});

function buildService(bookIds: number[]) {
	const booksRepository = {
		find: vi.fn(async () => bookIds.map((id) => ({ id }) as Book)),
		findOne: vi.fn(),
		create: vi.fn(),
		save: vi.fn(),
		delete: vi.fn(),
		merge: vi.fn(),
	} as unknown as Repository<Book>;
	const service = new BooksService(
		booksRepository,
		{} as Repository<DownloadEvent>,
		{} as Repository<ReadingState>,
		{} as Repository<User>,
		{ strategy: 's3' } as BookStorage,
	);
	return { service, booksRepository };
}

describe('BooksService demo showcase', () => {
	it('resolves the rotating featured id from the published+approved pool', async () => {
		vi.useFakeTimers();
		try {
			const { service, booksRepository } = buildService([3, 8, 12]);
			vi.setSystemTime(0);
			await expect(service.getDemoFeaturedBookId()).resolves.toBe(3);
			vi.setSystemTime(HOUR);
			await expect(service.getDemoFeaturedBookId()).resolves.toBe(8);
			// Exactly one pool scan gated to published+approved ids, capped.
			expect(booksRepository.find).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { published: true, reviewStatus: 'approved' },
					select: { id: true },
					order: { id: 'ASC' },
					take: 200,
				}),
			);
		} finally {
			vi.useRealTimers();
		}
	});

	it('resolves null when no published book remains', async () => {
		const { service } = buildService([]);
		await expect(service.getDemoFeaturedBookId()).resolves.toBeNull();
	});

	it('lets an anonymous visitor read only the featured demo slide', async () => {
		const { service } = buildService([7]);
		// Probe: the anonymous gate opens (no 401) and the flow proceeds to the
		// book lookup; a missing stored file is the rejection, not the gate.
		await expect(service.getReading(7, null)).rejects.not.toThrow(UnauthorizedException);
	});

	it('blocks an anonymous visitor from reading any other book (401)', async () => {
		const { service } = buildService([7]);
		await expect(service.getReading(42, null)).rejects.toThrow(UnauthorizedException);
	});

	it('keeps authenticated readers unlimited regardless of the showcase', async () => {
		const { service } = buildService([7]);
		const sessionUser = { id: 'user-a', role: 'user' };
		await expect(service.getReading(42, sessionUser)).rejects.not.toThrow(UnauthorizedException);
	});

	it('rejects anonymous metric pings: the demo showcase persists nothing', async () => {
		const { service, booksRepository } = buildService([7]);
		await expect(
			service.recordMetric(7, 'read_started', null),
		).rejects.toThrow(UnauthorizedException);
		expect(
			(booksRepository as unknown as { increment?: unknown }).increment,
		).toBeUndefined();
	});
});
