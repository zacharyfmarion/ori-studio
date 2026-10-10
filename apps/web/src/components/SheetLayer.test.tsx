import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useLayoutStore } from '../store/layoutStore';
import { SheetLayer, SheetPortal } from './SheetLayer';
import { topmostModalDialog } from './ui/useModalDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The touch layout's sheets go before every modal in the document (rf6): the
 * two share the modal tier, where the later is on top, so a dialog a sheet
 * opens — Replace from References… in the Settings sheet — is over it.
 */

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  useLayoutStore.setState({ sheetLayer: null });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const sheet = <div role="dialog" aria-modal="true" aria-label="Settings" />;

describe('the sheet layer', () => {
  it('takes every sheet, ahead of a dialog rendered after it, which is then the dialog on top', () => {
    act(() =>
      root?.render(
        <>
          <SheetLayer />
          <SheetPortal>{sheet}</SheetPortal>
          <div role="dialog" aria-modal="true" aria-label="Replace step 1’s card" />
        </>
      )
    );
    const layer = host!.querySelector('[data-sheet-layer]')!;
    expect(useLayoutStore.getState().sheetLayer).toBe(layer);
    expect(layer.querySelector('[aria-label="Settings"]')).not.toBeNull();
    expect(topmostModalDialog()?.getAttribute('aria-label')).toBe('Replace step 1’s card');
  });

  it('lets go of the layer when it unmounts, and a sheet goes to the body without one', () => {
    act(() => root?.render(<SheetLayer />));
    act(() => root?.render(<SheetPortal>{sheet}</SheetPortal>));
    expect(useLayoutStore.getState().sheetLayer).toBeNull();
    expect(document.body.lastElementChild?.getAttribute('aria-label')).toBe('Settings');
  });

  it('is laid out by App before every modal it renders', () => {
    const app = readFileSync(join(dirname(new URL(import.meta.url).pathname), '../App.tsx'), 'utf8');
    const rendered = app.slice(app.indexOf('<TooltipProvider>'));
    const layer = rendered.indexOf('<SheetLayer />');
    expect(layer).toBeGreaterThan(0);
    const modals = [...rendered.matchAll(/<(\w+Modal) \/>/g)];
    expect(modals.map((match) => match[1])).toContain('DiagramReferencesModal');
    expect(modals.map((match) => match[1])).toContain('CommandDialogModal');
    for (const modal of modals) expect(modal.index).toBeGreaterThan(layer);
  });
});
