/**
 * The diagram PDF writer (`crates/oristudio-pdf-wasm`), off the main thread:
 * a long document takes a second or two to write, and the Diagram stays
 * usable meanwhile. One export per worker (`diagram/export/browserPdfWriter.ts`).
 */
import { expose, transfer } from 'comlink';
import init, { pages_to_pdf } from '../generated/oristudio-pdf-wasm/oristudio_pdf_wasm';
import type { PdfWriterOptions } from '../diagram/export/diagramPdf';

let ready: Promise<void> | null = null;

const api = {
  async pagesToPdf(pages: string[], fonts: Uint8Array[], options: PdfWriterOptions): Promise<Uint8Array> {
    ready ??= init().then(() => undefined);
    await ready;
    const bytes = pages_to_pdf(pages, fonts, options);
    return transfer(bytes, [bytes.buffer]);
  },
};

export type DiagramPdfWorkerApi = typeof api;

expose(api);
