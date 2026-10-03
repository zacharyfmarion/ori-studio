/**
 * The PDF writer in the browser and the desktop webview: the wasm bridge in a
 * worker of its own, started for one export and ended after it, so its memory
 * (the pages, the fonts, the document) goes with it.
 */
import { wrap } from 'comlink';
import { attachWorkerDiagnostics } from '../../lib/workerDiagnostics';
import type { DiagramPdfWorkerApi } from '../../workers/diagramPdfWorker';
import type { PdfWriter } from './diagramPdf';

/** A failure the writer reported, by its bridge's `code`: `text` for text it would not print as set. */
export class DiagramPdfError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'DiagramPdfError';
  }
}

export const browserPdfWriter: PdfWriter = (pages, fonts, options) =>
  new Promise<Uint8Array>((resolve, reject) => {
    const worker = new Worker(new URL('../../workers/diagramPdfWorker.ts', import.meta.url), { type: 'module' });
    const finish = () => {
      detach();
      worker.terminate();
    };
    const detach = attachWorkerDiagnostics(worker, 'diagram-pdf', (failure) => {
      finish();
      reject(new DiagramPdfError('crashed', failure.message));
    });
    wrap<DiagramPdfWorkerApi>(worker)
      .pagesToPdf(pages, fonts, options)
      .then(
        (bytes) => {
          finish();
          resolve(bytes);
        },
        (error: unknown) => {
          finish();
          const envelope = error as { code?: unknown; message?: unknown } | null;
          reject(
            typeof envelope?.code === 'string'
              ? new DiagramPdfError(envelope.code, String(envelope.message ?? ''))
              : error
          );
        }
      );
  });
