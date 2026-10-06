import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { printPages, printPagesCss, removePrintLayer, type PrintHost } from './printPages';

/** The print dialog's surroundings, for each runtime: the window's `print` as it answers there. */
function host(print: PrintHost['print']) {
  const listeners = new Set<() => void>();
  const seen: { pages: string[]; css: string }[] = [];
  const value: PrintHost = {
    document,
    print: () => {
      // What the dialog would lay out, as it is asked for.
      seen.push({
        pages: [...document.querySelectorAll<HTMLImageElement>('[data-print-pages] > img')].map((image) => image.src),
        css: document.querySelector('style[data-print-pages]')?.textContent ?? '',
      });
      return print();
    },
    addAfterPrint: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { host: value, seen, closeDialog: () => listeners.forEach((listener) => listener()) };
}

const REQUEST = { pages: ['data:image/svg+xml,a', 'data:image/svg+xml,b'], widthMm: 210, heightMm: 297 };
const layers = () => document.querySelectorAll('[data-print-pages]').length;

afterEach(() => removePrintLayer({ document }));

describe('printPagesCss', () => {
  it('sets the dialog’s paper to the pages’, edge to edge, and prints nothing but them, one to a sheet', () => {
    const css = printPagesCss(215.9, 279.4);
    expect(css).toContain('@page { size: 215.9mm 279.4mm; margin: 0; }');
    expect(css).toMatch(/@media screen \{ \[data-print-pages\] \{ display: none !important; \} \}/);
    expect(css).toContain('body > :not([data-print-pages]) { display: none !important; }');
    expect(css).toContain('width: 215.9mm; height: 279.4mm;');
    expect(css).toContain('break-after: page');
  });
});

describe('printPages', () => {
  it('on the web: lays the pages out for the dialog, prints, and takes them away when it closes', async () => {
    // A browser's window.print() answers nothing, once the dialog has closed or been asked for.
    const web = host(() => undefined);
    await printPages(REQUEST, web.host);
    expect(web.seen).toEqual([{ pages: REQUEST.pages, css: printPagesCss(210, 297) }]);
    // Until the dialog says it closed, the pages stay, unseen on screen.
    expect(layers()).toBe(2);
    web.closeDialog();
    expect(layers()).toBe(0);
  });

  it('on the desktop’s macOS: waits for Tauri’s print, and keeps the pages for a panel that draws them after', async () => {
    // Tauri puts its own print command in window.print's place there, a promise.
    let answer: () => void = () => undefined;
    const tauri = host(() => new Promise<void>((resolve) => (answer = resolve)));
    let done = false;
    const printing = printPages(REQUEST, tauri.host).then(() => (done = true));
    await vi.waitFor(() => expect(tauri.seen).toHaveLength(1));
    expect(done).toBe(false);
    answer();
    await printing;
    // The sheet returns at once and lays its pages out after: they stay, until the next print replaces them.
    expect(layers()).toBe(2);
    await printPages({ ...REQUEST, pages: ['data:image/svg+xml,c'] }, host(() => Promise.resolve()).host);
    expect(document.querySelectorAll('[data-print-pages] > img')).toHaveLength(1);
  });

  it('takes the pages away and says why when the runtime refuses to print', async () => {
    const refused = host(() => Promise.reject(new Error('webview.print not allowed')));
    await expect(printPages(REQUEST, refused.host)).rejects.toThrow('webview.print not allowed');
    expect(layers()).toBe(0);
  });
});

describe('the desktop shell', () => {
  it('lets the webview print: Tauri’s print command on macOS needs its permission', () => {
    const capability = JSON.parse(
      readFileSync(join(dirname(new URL(import.meta.url).pathname), '../../../tauri/src-tauri/capabilities/default.json'), 'utf8')
    ) as { permissions: string[] };
    expect(capability.permissions).toContain('core:webview:allow-print');
  });
});
