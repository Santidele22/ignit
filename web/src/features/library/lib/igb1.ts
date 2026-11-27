import type {
	BookReadingDocument,
	ReadingChunk,
	ReadingChunkType,
	ReadingInlineRun,
	ReadingMood,
} from '../../../entities/book/types';

export const IGB1_MAGIC = 'IGB1';
export const IGB1_VERSION = 1;
export const IGB1_HEADER_BYTES = 18;
export const IGB1_NONCE_BYTES = 12;
export const IGB1_GCM_TAG_BYTES = 16;
export const IGB1_KEY_BYTES = 32;

export const IGB1_FLAG_BROTLI = 1 << 0;
export const IGB1_FLAG_ENCRYPTED = 1 << 1;
export const IGB1_FLAG_CHUNKED = 1 << 2;

export type ContentTier = 'public_open' | 'private_user' | 'editorial_closed';
export type Igb1Compression = 'gzip' | 'brotli';

export interface CompactReadingChunk {
	i: string;
	t?: ReadingChunkType;
	p: number;
	o: number;
	x: string;
	m?: ReadingMood;
	q?: string[];
	l?: 1 | 2 | 3;
	r?: ReadingInlineRun[];
	ord?: 1;
	it?: string[];
	a?: 'center' | 'right';
}

export interface CompactReadingDocument {
	v: 1;
	b: string;
	p: number;
	o?: 1;
	ev?: number;
	ai?: 1;
	c: CompactReadingChunk[];
}

export interface Igb1Header {
	magic: string;
	version: number;
	flags: number;
	nonce: Uint8Array;
}

export function buildIgb1Aad(bookId: string, version: number, tier: ContentTier): Uint8Array {
	return new TextEncoder().encode(`${bookId}|${version}|${tier}`);
}

export function compactReadingDocument(
	doc: BookReadingDocument & { refinedByAi?: boolean },
): CompactReadingDocument {
	const out: CompactReadingDocument = {
		v: 1,
		b: doc.bookId,
		p: doc.pdfPages,
		c: doc.chunks.map((chunk) => {
			const c: CompactReadingChunk = {
				i: chunk.id,
				p: chunk.page,
				o: chunk.offset,
				x: chunk.text,
			};
			if (chunk.type !== 'para') c.t = chunk.type;
			if (chunk.mood !== 'espera') c.m = chunk.mood;
			if (chunk.cues && chunk.cues.length > 0) c.q = chunk.cues;
			if (chunk.level !== undefined) c.l = chunk.level;
			if (chunk.runs && chunk.runs.length > 0) c.r = chunk.runs;
			if (chunk.ordered === true) c.ord = 1;
			if (chunk.items && chunk.items.length > 0) c.it = chunk.items;
			if (chunk.align === 'center' || chunk.align === 'right') c.a = chunk.align;
			return c;
		}),
	};
	if (doc.ocrPending) out.o = 1;
	if (doc.extractorVersion !== undefined) out.ev = doc.extractorVersion;
	if (doc.refinedByAi) out.ai = 1;
	return out;
}

export function expandReadingDocument(
	compact: CompactReadingDocument,
): BookReadingDocument & { refinedByAi?: boolean } {
	if (compact.v !== 1) {
		throw new Error(`Unsupported CompactReadingDocument version: ${String(compact.v)}`);
	}
	const chunks: ReadingChunk[] = compact.c.map((c) => {
		const out: ReadingChunk = {
			id: c.i,
			type: c.t ?? 'para',
			page: c.p,
			offset: c.o,
			text: c.x,
			mood: c.m ?? 'espera',
			cues: c.q ?? [],
			align: c.a ?? 'left',
		};
		if (c.l !== undefined) out.level = c.l;
		if (c.r !== undefined) out.runs = c.r;
		if (c.ord === 1) out.ordered = true;
		if (c.it !== undefined) out.items = c.it;
		return out;
	});

	const out: BookReadingDocument & { refinedByAi?: boolean } = {
		bookId: compact.b,
		pdfPages: compact.p,
		ocrPending: compact.o === 1,
		chunks,
	};
	if (compact.ev !== undefined) out.extractorVersion = compact.ev;
	if (compact.ai === 1) out.refinedByAi = true;
	return out;
}

export function parseIgb1Header(bytes: Uint8Array): Igb1Header {
	if (bytes.byteLength < IGB1_HEADER_BYTES) {
		throw new Error(`Invalid IGB1 buffer: expected at least ${IGB1_HEADER_BYTES} bytes`);
	}
	const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
	if (magic !== IGB1_MAGIC) {
		throw new Error(`Invalid IGB1 magic: expected "${IGB1_MAGIC}", got "${magic}"`);
	}
	const version = bytes[4];
	if (version !== IGB1_VERSION) {
		throw new Error(`Unsupported IGB1 version: ${version}`);
	}
	const flags = bytes[5];
	const nonce = bytes.slice(6, IGB1_HEADER_BYTES);
	return { magic, version, flags, nonce };
}

async function runStreamTransform(
	bytes: Uint8Array,
	stream: TransformStream<Uint8Array, Uint8Array>,
): Promise<Uint8Array> {
	const writer = stream.writable.getWriter();
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	const writePromise = writer.write(copy).then(() => writer.close());
	const reader = stream.readable.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		total += value.byteLength;
	}
	await writePromise;
	const out = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.byteLength;
	}
	return out;
}

async function compressGzip(bytes: Uint8Array): Promise<Uint8Array> {
	if (typeof CompressionStream !== 'undefined') {
		return runStreamTransform(
			bytes,
			new CompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>,
		);
	}
	const zlib = await import('node:zlib');
	return new Uint8Array(zlib.gzipSync(bytes, { level: 9 }));
}

async function decompressPayload(bytes: Uint8Array, useBrotli: boolean): Promise<Uint8Array> {
	if (!useBrotli && typeof DecompressionStream !== 'undefined') {
		return runStreamTransform(
			bytes,
			new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>,
		);
	}
	if (useBrotli && typeof DecompressionStream !== 'undefined') {
		try {
			return await runStreamTransform(
				bytes,
				new DecompressionStream('brotli' as CompressionFormat) as unknown as TransformStream<
					Uint8Array,
					Uint8Array
				>,
			);
		} catch {
			// Fall back to node:zlib when running in SSR / Vitest without browser brotli stream support.
		}
	}
	const zlib = await import('node:zlib');
	return new Uint8Array(useBrotli ? zlib.brotliDecompressSync(bytes) : zlib.gunzipSync(bytes));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const buf = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buf).set(bytes);
	return buf;
}

export async function encodeIgb1(
	doc: BookReadingDocument & { refinedByAi?: boolean },
	options: {
		bookId: string;
		tier: ContentTier;
		key?: Uint8Array;
		iv?: Uint8Array;
	},
): Promise<Uint8Array> {
	const encrypted = options.tier !== 'public_open';
	if (encrypted && (!options.key || options.key.byteLength !== IGB1_KEY_BYTES)) {
		throw new Error(`IGB1 encryption requires a ${IGB1_KEY_BYTES}-byte AES-256 key`);
	}

	const compact = compactReadingDocument(doc);
	const jsonBytes = new TextEncoder().encode(JSON.stringify(compact));
	const compressed = await compressGzip(jsonBytes);

	const flags = encrypted ? IGB1_FLAG_ENCRYPTED : 0;
	const nonce = encrypted
		? (options.iv ?? crypto.getRandomValues(new Uint8Array(IGB1_NONCE_BYTES)))
		: new Uint8Array(IGB1_NONCE_BYTES);

	const header = new Uint8Array(IGB1_HEADER_BYTES);
	header.set([0x49, 0x47, 0x42, 0x31], 0); // "IGB1"
	header[4] = IGB1_VERSION;
	header[5] = flags;
	header.set(nonce, 6);

	if (!encrypted) {
		const out = new Uint8Array(IGB1_HEADER_BYTES + compressed.byteLength);
		out.set(header, 0);
		out.set(compressed, IGB1_HEADER_BYTES);
		return out;
	}

	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		toArrayBuffer(options.key!),
		{ name: 'AES-GCM' },
		false,
		['encrypt'],
	);
	const sealed = await crypto.subtle.encrypt(
		{
			name: 'AES-GCM',
			iv: toArrayBuffer(nonce),
			additionalData: toArrayBuffer(buildIgb1Aad(options.bookId, IGB1_VERSION, options.tier)),
			tagLength: IGB1_GCM_TAG_BYTES * 8,
		},
		cryptoKey,
		toArrayBuffer(compressed),
	);
	const sealedBytes = new Uint8Array(sealed);
	const out = new Uint8Array(IGB1_HEADER_BYTES + sealedBytes.byteLength);
	out.set(header, 0);
	out.set(sealedBytes, IGB1_HEADER_BYTES);
	return out;
}

export async function decodeIgb1(
	bytes: Uint8Array,
	options: {
		bookId: string;
		tier: ContentTier;
		key?: Uint8Array;
	},
): Promise<BookReadingDocument & { refinedByAi?: boolean }> {
	const header = parseIgb1Header(bytes);
	const encrypted = Boolean(header.flags & IGB1_FLAG_ENCRYPTED);
	const useBrotli = Boolean(header.flags & IGB1_FLAG_BROTLI);

	let compressed: Uint8Array;
	if (!encrypted) {
		compressed = bytes.subarray(IGB1_HEADER_BYTES);
	} else {
		if (!options.key || options.key.byteLength !== IGB1_KEY_BYTES) {
			throw new Error(`IGB1 decryption requires a ${IGB1_KEY_BYTES}-byte AES-256 key`);
		}
		if (bytes.byteLength < IGB1_HEADER_BYTES + IGB1_GCM_TAG_BYTES) {
			throw new Error('Invalid encrypted IGB1 buffer: missing GCM auth tag');
		}
		const cryptoKey = await crypto.subtle.importKey(
			'raw',
			toArrayBuffer(options.key),
			{ name: 'AES-GCM' },
			false,
			['decrypt'],
		);
		const decrypted = await crypto.subtle.decrypt(
			{
				name: 'AES-GCM',
				iv: toArrayBuffer(header.nonce),
				additionalData: toArrayBuffer(buildIgb1Aad(options.bookId, header.version, options.tier)),
				tagLength: IGB1_GCM_TAG_BYTES * 8,
			},
			cryptoKey,
			toArrayBuffer(bytes.subarray(IGB1_HEADER_BYTES)),
		);
		compressed = new Uint8Array(decrypted);
	}

	const rawJson = await decompressPayload(compressed, useBrotli);
	const compact = JSON.parse(new TextDecoder().decode(rawJson)) as CompactReadingDocument;
	return expandReadingDocument(compact);
}
