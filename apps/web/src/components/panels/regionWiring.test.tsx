import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { emptyOristudioCpSelection } from '../../lib/creasePatternViewport';
import { createStarterOristudioCpDocument } from '../../lib/oristudioCpStarterDocument';
import { createCpSuppressionRegion } from '../../cp-workspace/annotations/suppressionRegion';
import { cpOverlayViewStore } from '../../cp-workspace/cpOverlayViewStore';
import { toolbarRenderProbe } from '../../cp-workspace/cpSelectionToolbarDebug';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { TooltipProvider } from '../ui/Tooltip';
import { CreasePatternPanel } from './CreasePatternPanel';

/**
 * What a suppression region costs the crease-pattern panel, tested through the
 * panel.
 *
 * Both cases here are wiring, which is the thing that goes silently dead in this
 * file: `CpRegionLayer` and `useCpRegions` have their own tests, and they pass
 * whether or not anything ever mounts the layer; the inspector cascade is four
 * hand-written conditions with no registry behind it, so leaving a kind out of
 * one produces no type error and no failure anywhere else in the tree.
 *
 * The GL half — `regions` reaching `CpRenderer.setRegions` — is deliberately not
 * here. jsdom has no WebGL context, so the canvas mounts `CpRendererUnavailable`
 * and no renderer is ever constructed. `reglRendererRegions.test.ts` covers the
 * seam from `setRegions` onward; the two prop hops between are a browser check.
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

const REGION = createCpSuppressionRegion({
  id: 'region-1',
  center: { x: 0.5, y: 0.5 },
  width: 0.6,
  height: 0.6,
  label: 'Repair area',
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const realRect = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect');

function mount(): void {
  useWorkspaceStore.setState({
    activePanelId: 'crease-pattern',
    oristudioCpDocument: DOCUMENT,
    oristudioCpAnnotations: [REGION],
    oristudioCpSelectedAnnotationId: null,
    // Creases selected too. The selection toolbar follows *this*, and a click on
    // a region leaves it standing — which is why the two can collide at all.
    oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [1, 2] },
  });
  act(() =>
    root?.render(
      <TooltipProvider>
        <CreasePatternPanel />
      </TooltipProvider>
    )
  );
}

/** Chips and toolbars portal to `body`, so query from there, not from the host. */
function present(selector: string): boolean {
  return document.querySelector(selector) !== null;
}

beforeEach(() => {
  // Every floating chip drops out when its boundary has no area, and jsdom lays
  // nothing out — so without this the panel's viewport measures 0×0 and
  // `FloatingToolbar` returns null for reasons that have nothing to do with the
  // wiring under test.
  Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(0, 0, 1000, 600),
  });
  // The chip anchors through the overlay view; the canvas never publishes one
  // without a renderer, so seed it.
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
  // `cpOverlayViewStore` takes no null and is re-seeded above per test; it is a
  // module singleton, and vitest gives each file its own module registry.
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('suppression regions in the crease-pattern panel', () => {
  it('shows a region chip without the region being selected', () => {
    // The safety argument in one assertion: a region hides findings, so its chip
    // is mounted for as long as the region exists rather than on selection like
    // every other inspector. Nothing else fails if the layer is left unmounted.
    mount();
    expect(present('.cp-region-chip')).toBe(true);
  });

  it('unmounts the selection toolbar while a region holds the selection', () => {
    mount();
    // `renders === 0` is the probe's own definition of "never mounted" — the
    // reading to take here, because the toolbar needs segmentation artifacts to
    // put anything in the DOM and this test has no kernel behind it. Mounted is
    // the whole question: the guard decides whether it is in the tree at all.
    expect(toolbarRenderProbe.renders).toBeGreaterThan(0);

    toolbarRenderProbe.renders = 0;
    act(() => {
      useWorkspaceStore.setState({ oristudioCpSelectedAnnotationId: REGION.id });
    });
    expect(toolbarRenderProbe.renders).toBe(0);
    // ...and the chip it stood down for is the one on screen.
    expect(present('.cp-region-chip')).toBe(true);
  });
});
