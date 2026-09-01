import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { CP_EXACT_SOLVE_REQUEST_EVENT } from '../../commands/menuActions';
import {
  emptyOristudioCpSelection,
  ORIEDITA_PAPER_MAX,
  ORIEDITA_PAPER_MIN,
} from '../../lib/creasePatternViewport';
import { createStarterOristudioCpDocument } from '../../lib/oristudioCpStarterDocument';
import type { CanvasAnnotation } from '../../cp-workspace/annotations/annotation';
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

/**
 * The one solve implementation, stubbed at its own module so that *reaching* it
 * is what is under test.
 *
 * `useCpRegionSolve` has its own suite and `runCpExactSolve` has its own suite;
 * both pass whether or not `CreasePatternPanel` ever calls either. That is the
 * same shape as the bug this file exists for — the binding was written, the
 * engine was written, and the prop between them was missing — so the assertions
 * below are about the wiring and deliberately not about the solve.
 */
const runCpExactSolve = vi.hoisted(() => vi.fn());
vi.mock('../../engine/cpExactSolve', () => ({
  runCpExactSolve: (...args: unknown[]) => runCpExactSolve(...args),
}));

/**
 * The solve rebuilds its input from the live creases before it runs, and both
 * halves of that need a kernel. Stubbed here for the same reason the solve
 * itself is: these assertions are about the wiring reaching the shared
 * implementation, not about what the solver does with it.
 */
const REBUILT_INPUT = { schema: 'exact-solve-input', source: 'rebuilt-from-document' };
const exportCreasesAsFold = vi.hoisted(() => vi.fn());
vi.mock('../../store/workspaceStore/oristudioCpRuntime', () => ({
  exportOristudioCpCreasesAsFold: exportCreasesAsFold,
}));
const rebuildSolveInput = vi.hoisted(() => vi.fn());
vi.mock('../../engine/cpExactSolveInputRebuild', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  rebuildCpExactSolveInput: rebuildSolveInput,
}));

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

/**
 * What a detection leaves behind: the same box, carrying an `ExactSolveInput`.
 *
 * Sized around the whole sheet with a margin, the way `repairAnnotations` places
 * it, so it genuinely *owns* the starter document's four border creases. That
 * matters for the solve tests below and not for the chip ones: a region holding
 * no creases is refused as `no_pattern` before the solver is ever reached, so a
 * token-sized box would make "did this reach the shared solve" unanswerable.
 */
const PAPER_SPAN = ORIEDITA_PAPER_MAX - ORIEDITA_PAPER_MIN;
const DETECTED_REGION = createCpSuppressionRegion({
  id: 'region-2',
  center: { x: 0, y: 0 },
  width: PAPER_SPAN * 1.1,
  height: PAPER_SPAN * 1.1,
  label: 'Detected crease pattern',
  solveInput: { schema: 'exact-solve-input', vertices: [] },
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const realRect = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect');

function mount(regions: CanvasAnnotation[] = [REGION]): void {
  useWorkspaceStore.setState({
    activePanelId: 'crease-pattern',
    oristudioCpDocument: DOCUMENT,
    oristudioCpAnnotations: regions,
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
  exportCreasesAsFold.mockReset().mockResolvedValue('{"edges_vertices":[]}');
  rebuildSolveInput.mockReset().mockResolvedValue({
    schema: 'oristudio/cp-detect/exact-solve-input-from-fold-v1',
    input: REBUILT_INPUT,
    transform: { origin: { x: 100, y: 100 }, ux: [1, 0], uy: [0, 1], side: 400, flip: 1 },
  });
  runCpExactSolve.mockReset();
  // Never settles: these tests assert the call was made, and a resolution would
  // land a `setRecords` outside `act`.
  runCpExactSolve.mockReturnValue(new Promise(() => {}));
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

  /**
   * The `solve` prop, which was missing for a whole phase.
   *
   * `CpRegionLayer` picks the Solve chip on `solvable && solve`, and `solve` is
   * **optional** — deliberately, because a host that cannot service a solve should
   * render no button rather than a dead one. The consequence is that dropping it
   * typechecks perfectly and the Solve variant silently never renders, which is
   * exactly what happened: `engine/cpExactSolve.ts` existed and the repair flow
   * had no way to reach it. Nothing but this assertion notices.
   */
  it('gives a detected region a Solve button — the prop the panel must pass', () => {
    mount([DETECTED_REGION]);

    const solve = [...document.querySelectorAll<HTMLButtonElement>('.cp-region-chip button')].find(
      (button) => button.textContent === 'Solve'
    );
    expect(solve).toBeDefined();
  });

  it('leaves a hand-drawn region without one', () => {
    // The discriminator is the attachment, not the binding: the rail tool's box
    // is a perfectly good suppressor and must never grow a Solve button.
    mount([REGION]);

    const labels = [...document.querySelectorAll('.cp-region-chip button')].map(
      (button) => button.textContent
    );
    expect(labels).not.toContain('Solve');
  });

  /**
   * Rendering the button and the button *doing* something are two failures, and
   * the second one also typechecks: the panel could build a `CpRegionSolveBinding`
   * literal of four no-ops and every assertion above would still pass.
   */
  it('runs the shared solve when the chip button is pressed', async () => {
    mount([DETECTED_REGION]);

    const solve = [...document.querySelectorAll<HTMLButtonElement>('.cp-region-chip button')].find(
      (button) => button.textContent === 'Solve'
    );
    await act(async () => {
      solve?.click();
    });

    expect(runCpExactSolve).toHaveBeenCalledTimes(1);
    const [input, options] = runCpExactSolve.mock.calls[0] as [unknown, { run: unknown }];
    // The creases as they stand, rebuilt — **not** `DETECTED_REGION.solveInput`,
    // the input detection attached at import. Solving the attachment is what made
    // every hand repair invisible to the solver.
    expect(input).toBe(REBUILT_INPUT);
    expect(input).not.toBe(DETECTED_REGION.solveInput);
    expect(options.run).toEqual({ kind: 'region', targetId: DETECTED_REGION.id });
  });

  /**
   * `Crease Pattern ▸ Repair ▸ Exact Solve…`, through the real panel.
   *
   * The menu action dispatches `CP_EXACT_SOLVE_REQUEST_EVENT` and for a whole
   * phase **nothing listened** — the command was a silent no-op. The listener
   * lives in `useCpRegionSolve`, so this passes only while the panel actually
   * mounts that hook; a hand-rolled binding object would keep the chip tests
   * green and kill the command again.
   */
  it('runs the same solve when the menu command is dispatched', async () => {
    mount([DETECTED_REGION]);

    await act(async () => {
      window.dispatchEvent(new CustomEvent(CP_EXACT_SOLVE_REQUEST_EVENT));
    });

    expect(runCpExactSolve).toHaveBeenCalledTimes(1);
    const [input, options] = runCpExactSolve.mock.calls[0] as [unknown, { run: unknown }];
    expect(input).toBe(REBUILT_INPUT);
    // One implementation, one argument apart: only the run kind separates the
    // two entry points.
    expect(options.run).toEqual({ kind: 'command', targetId: DETECTED_REGION.id });
  });
});
