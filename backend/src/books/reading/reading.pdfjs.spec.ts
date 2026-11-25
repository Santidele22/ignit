import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { extractPagesWithPdfJs } from './reading.pdfjs.js';

describe('reading.pdfjs', () => {
  it('extracts multi-page text using pdfjs-dist with CMap/encoding support', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);

    const page1 = doc.addPage([600, 800]);
    page1.drawText('Capitulo Uno', { x: 72, y: 720, size: 20, font });
    page1.drawText('Primera linea de prosa clara en espanol.', { x: 72, y: 680, size: 12, font });

    const page2 = doc.addPage([600, 800]);
    page2.drawText('Segunda pagina del libro con texto real.', { x: 72, y: 720, size: 12, font });

    const bytes = Buffer.from(await doc.save());
    const pages = await extractPagesWithPdfJs(bytes);

    expect(pages).not.toBeNull();
    expect(pages).toHaveLength(2);
    expect(pages![0]).toContain('Capitulo Uno');
    expect(pages![0]).toContain('Primera linea de prosa clara en espanol.');
    expect(pages![1]).toContain('Segunda pagina del libro con texto real.');
  });

  it('returns null gracefully on invalid/corrupt bytes', async () => {
    const pages = await extractPagesWithPdfJs(Buffer.from('not a pdf'));
    expect(pages).toBeNull();
  });
});
