import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { emptyOristudioCpSelection } from '../../lib/creasePatternViewport';
import { createStarterOristudioCpDocument } from '../../lib/oristudioCpStarterDocument';
import { cpOverlayViewStore } from '../../cp-workspace/cpOverlayViewStore';
import { toolbarRenderProbe } from '../../cp-workspace/cpSelectionToolbarDebug';
import {
  IMAGE,
  REGION,
  TEXT,
  WINDOW,
} from '../../cp-workspace/canvasObjects/canvasObjectKinds.fixtures';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { TooltipProvider } from '../ui/Tooltip';
import { CpPropertiesPanel } from './CpPropertiesPanel';
import { CreasePatternPanel } from './CreasePatternPanel';

/**
 * What a selected canvas object costs the crease-pattern panel, tested through
 * the panel: each selection mounts exactly one floating surface on the canvas
 * and exactly one sheet in the Properties pane. The floating switch and the
 * property registry each have their own tests and pass whether or not the
 * panel mounts either; the pairing is the thing that goes silently dead.
 *
 * The folded-figure clause is not here: its toolbar anchors on a render
 * snapshot only a kernel produces. The switch's exhaustiveness is the typecheck.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// FloatingToolbar's autoUpdate attaches one, and jsdom has none.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

const DOCUMENT = {
  handle: 4,
  loadSerial: 1,
  document: createStarterOristudioCpDocument(),
  geometry: null,
  summary: null,
  source: { format: 'cp', filename: 'Untitled.cp', path: null },
} as unknown as OristudioCpDocumentState;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const realRect = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect');

function mount(selection: Partial<ReturnType<typeof useWorkspaceStore.getState>>): void {
  useWorkspaceStore.setState({
    activePanelId: 'crease-pattern',
    oristudioCpDocument: DOCUMENT,
    oristudioCpAnnotations: [IMAGE, TEXT, REGION],
    oristudioCpInlineSimulations: [WINDOW],
    oristudioCpSelection: emptyOristudioCpSelection(),
    ...selection,
  });
  act(() =>
    root?.render(
      <TooltipProvider>
        <CreasePatternPanel />
        <CpPropertiesPanel />
      </TooltipProvider>
    )
  );
}

const FLOATING = [
  '.cp-image-inspector',
  '.cp-inline-simulation-inspector',
  '.cp-folded-figure-toolbar',
  '.cp-text-toolbar',
];

/** Which floating surfaces are on screen; toolbars portal to `body`. */
function floating(): string[] {
  return FLOATING.filter((selector) => document.querySelector(selector) !== null);
}

const sheetTitle = () => document.querySelector('.property-sheet__title')?.textContent ?? null;

beforeEach(() => {
  Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(0, 0, 1000, 600),
  });
  cpOverlayViewStore.set({
    model: { origin: [100, 100], ex: [400, 0], ey: [0, 400] },
    user: { origin: [100, 100], ex: [400, 0], ey: [0, 400] },
  });
  toolbarRenderProbe.renders = 0;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  if (realRect) Object.defineProperty(Element.prototype, 'getBoundingClientRect', realRect);
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('canvas objects in the crease-pattern panel', () => {
  it('mounts nothing floating and an empty pane with nothing selected', () => {
    mount({});
    expect(floating()).toEqual([]);
    expect(sheetTitle()).toBeNull();
    expect(document.querySelector('.cp-properties-panel .empty-note')).not.toBeNull();
  });

  it('gives a selected image its toolbar and its sheet, and nothing else', () => {
    mount({ oristudioCpSelectedAnnotationId: IMAGE.id });
    expect(floating()).toEqual(['.cp-image-inspector']);
    expect(sheetTitle()).toBe('Image');
    // The toolbar keeps the verbs and lost the adjective: opacity is the pane's.
    const toolbar = document.querySelector('.cp-image-inspector');
    expect(toolbar?.querySelector('input[type="range"]')).toBeNull();
    expect(document.querySelector('.cp-properties-panel input[aria-label="Opacity"]')).not.toBeNull();
  });

  it('gives a selected text box no floating toolbar until it is edited, and its sheet', () => {
    mount({ oristudioCpSelectedAnnotationId: TEXT.id });
    expect(floating()).toEqual([]);
    expect(sheetTitle()).toBe('Text');
  });

  it('gives a selected region its chip and its sheet', () => {
    mount({ oristudioCpSelectedAnnotationId: REGION.id });
    expect(floating()).toEqual([]);
    expect(document.querySelector('.cp-region-chip')).not.toBeNull();
    expect(sheetTitle()).toBe('Suppression region');
  });

  it('gives a focused window its inspector and the shared settings sheet', () => {
    mount({ oristudioCpFocusedInlineSimulationId: WINDOW.id });
    expect(floating()).toEqual(['.cp-inline-simulation-inspector']);
    expect(sheetTitle()).toBe('Simulation window');
    // The colour-mode menu left the bar for the pane.
    expect(document.querySelector('.cp-inline-simulation-inspector [aria-label="Colour"]')).toBeNull();
  });

  it('stands the selection toolbar down for any selected object', () => {
    mount({ oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [1, 2] } });
    expect(toolbarRenderProbe.renders).toBeGreaterThan(0);

    toolbarRenderProbe.renders = 0;
    act(() => useWorkspaceStore.setState({ oristudioCpFocusedInlineSimulationId: WINDOW.id }));
    expect(toolbarRenderProbe.renders).toBe(0);
  });
});
