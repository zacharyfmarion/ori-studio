/**
 * Printing pages of one paper size through the runtime's own print dialog:
 * the browser's on the web, the webview's on the desktop.
 *
 * Each page is an image the size of the paper, in a layer of the document
 * that only print shows: on screen it is not drawn, and in print it is all
 * that is, the app hidden behind it. The paper size and no margin go to the
 * dialog as `@page`, so a page prints at its own size, edge to edge, as the
 * PDF it matches would. Then `window.print()`:
 *
 * - **Web.** Chromium, Firefox and WebKit print the top document. A PDF in a
 *   frame would print only where the browser draws PDFs in frames, and how
 *   each lets a page print it differs; the layer prints the same in all.
 * - **Desktop.** Windows (WebView2) and Linux (WebKitGTK) print the webview
 *   with `window.print()` as browsers do. On macOS, WKWebView ignores it, and
 *   Tauri puts its own in its place — its `print` command, which opens the
 *   print panel on the webview and needs the `core:webview:allow-print`
 *   permission — and returns a promise, awaited here, that rejects when the
 *   command is refused.
 *
 * The layer goes when the dialog closes (`afterprint`). A print panel that
 * does not say so — macOS's sheet returns at once, and draws its pages after —
 * keeps it, unseen, until the next print replaces it.
 */

/** The layer's mark, on its element and on its style. */
const LAYER = 'data-print-pages';

export interface PrintPagesRequest {
  /** Each page as an image URL, drawn at the paper's size. */
  pages: readonly string[];
  widthMm: number;
  heightMm: number;
}

/** What printing reaches: a document, and its window's print. Injected by tests. */
export interface PrintHost {
  document: Document;
  /** `window.print`; a promise where the runtime's own is asynchronous (Tauri on macOS). */
  print: () => unknown;
  addAfterPrint: (listener: () => void) => () => void;
}

function browserPrintHost(): PrintHost {
  return {
    document,
    print: () => window.print(),
    addAfterPrint: (listener) => {
      window.addEventListener('afterprint', listener, { once: true });
      return () => window.removeEventListener('afterprint', listener);
    },
  };
}

/** The print-only rules: the paper's size, nothing but the pages, one to a sheet. */
export function printPagesCss(widthMm: number, heightMm: number): string {
  const size = `${round(widthMm)}mm ${round(heightMm)}mm`;
  return [
    `@page { size: ${size}; margin: 0; }`,
    `@media screen { [${LAYER}] { display: none !important; } }`,
    '@media print {',
    '  html, body { margin: 0 !important; padding: 0 !important; width: auto !important; height: auto !important;',
    '    min-height: 0 !important; overflow: visible !important; background: #ffffff !important; }',
    `  body > :not([${LAYER}]) { display: none !important; }`,
    `  [${LAYER}] { display: block !important; }`,
    `  [${LAYER}] > img { display: block; width: ${round(widthMm)}mm; height: ${round(heightMm)}mm;`,
    '    break-after: page; page-break-after: always; break-inside: avoid; }',
    `  [${LAYER}] > img:last-child { break-after: auto; page-break-after: auto; }`,
    '}',
  ].join('\n');
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Take away a print layer, and its rules, left by an earlier print. */
export function removePrintLayer(host: Pick<PrintHost, 'document'> = browserPrintHost()): void {
  for (const element of host.document.querySelectorAll(`[${LAYER}]`)) element.remove();
}

/**
 * Print `request.pages` through the runtime's print dialog. Resolves once the
 * dialog is asked for — after it closes where the runtime waits for it —
 * and rejects when the runtime refuses to print.
 */
export async function printPages(request: PrintPagesRequest, host: PrintHost = browserPrintHost()): Promise<void> {
  const { document: doc } = host;
  removePrintLayer(host);
  const style = doc.createElement('style');
  style.setAttribute(LAYER, '');
  style.textContent = printPagesCss(request.widthMm, request.heightMm);
  const layer = doc.createElement('div');
  layer.setAttribute(LAYER, '');
  layer.setAttribute('aria-hidden', 'true');
  const images = request.pages.map((url, index) => {
    const image = doc.createElement('img');
    image.alt = '';
    image.decoding = 'sync';
    image.dataset.printPage = String(index + 1);
    image.src = url;
    layer.append(image);
    return image;
  });
  doc.head.append(style);
  doc.body.append(layer);
  // Every page drawn before the dialog lays them out.
  await Promise.all(images.map((image) => (typeof image.decode === 'function' ? image.decode().catch(() => undefined) : undefined)));
  const detach = host.addAfterPrint(() => {
    style.remove();
    layer.remove();
  });
  try {
    await host.print();
  } catch (error) {
    detach();
    style.remove();
    layer.remove();
    throw error;
  }
}
