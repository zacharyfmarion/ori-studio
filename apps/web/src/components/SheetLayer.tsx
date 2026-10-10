import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLayoutStore } from '../store/layoutStore';

/**
 * Where the touch layout's sheets go: the View or Settings sheet
 * (`WorkspaceViewDrawer`), the tool lists (`CpToolsTrigger`,
 * `SimulatorToolsTrigger`) and Design's pane list (`DesignPaneSwitcher`).
 *
 * A sheet is a pane or a rail on a screen with no room to dock it, so every
 * dialog opens over it, as every dialog opens over a docked pane. Sheets and
 * dialogs share the modal tier (`--z-modal`), where the later in the document
 * is on top, and `topmostModalDialog` takes the last as the one that owns the
 * keys. So the sheets go in this layer, which `App` puts before every modal it
 * renders: a dialog opened from a sheet — Replace from References…, Delete
 * Step's question — is over it, holds focus and takes Escape. Portaled to the
 * end of `<body>`, as they were, a sheet was after every modal in the
 * document, and so over every dialog it opened.
 */
export function SheetLayer() {
  const setSheetLayer = useLayoutStore((state) => state.setSheetLayer);
  return <div data-sheet-layer="" ref={setSheetLayer} />;
}

/**
 * A sheet, portaled out of the pill lane or the toolbar it is opened from —
 * which is `pointer-events: none`, or a stacking context below the modal tier
 * — into the sheet layer ({@link SheetLayer}). To `<body>` until the layer is
 * there: a component rendered on its own, as a test renders one.
 */
export function SheetPortal({ children }: { children: ReactNode }) {
  const layer = useLayoutStore((state) => state.sheetLayer);
  return createPortal(children, layer ?? document.body);
}
