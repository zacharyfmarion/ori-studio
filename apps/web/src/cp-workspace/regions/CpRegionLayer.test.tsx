import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../../components/ui/Tooltip';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { cpOverlayViewStore } from '../cpOverlayViewStore';
import type { CanvasAnnotation } from '../annotations/annotation';
import {
  createCpSuppressionRegion,
  type CpSuppressionRegion,
} from '../annotations/suppressionRegion';
import { createTextAnnotation } from '../annotations/textAnnotation';
import { CpRegionLayer, type CpRegionSolveBinding } from './CpRegionLayer';

/**
 * The layer: one chip per region, always mounted, and which of the two chip
 * components each region gets.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

let host: HTMLDivElement;
let container: HTMLDivElement;
let root: Root;

function box(id: string, x: number, solveInput?: unknown) {
  return createCpSuppressionRegion({
    id,
    center: { x, y: 0.5 },
    width: 0.4,
    height: 0.4,
    label: id,
    ...(solveInput === undefined ? {} : { solveInput }),
  });
}

function seed(annotations: CanvasAnnotation[], selectedId: string | null = null): void {
  useWorkspaceStore.setState({
    oristudioCpDocument: { document: { crease_pattern: {}, metadata: {} } },
    oristudioCpAnnotations: annotations,
    oristudioCpSelectedAnnotationId: selectedId,
    oristudioCpHistoryPast: [],
    oristudioCpHistoryFuture: [],
    oristudioCpCamvResult: null,
  } as unknown as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
}

function render(solve?: CpRegionSolveBinding, withContainer = true): void {
  act(() => {
    root.render(
      <TooltipProvider>
        <CpRegionLayer container={withContainer ? container : null} solve={solve} />
      </TooltipProvider>
    );
  });
}

function chips(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="toolbar"]')];
}

/** A pointer event jsdom will deliver — it has no `PointerEvent` of its own. */
function pointer(type: string, clientX: number, clientY: number): Event {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  return event;
}

/** jsdom implements no pointer capture, and the bar takes one on every drag. */
function stubPointerCapture(element: Element): void {
  const target = element as unknown as Record<string, unknown>;
  target.setPointerCapture = () => {};
  target.hasPointerCapture = () => false;
  target.releasePointerCapture = () => {};
}

function regionById(id: string): CpSuppressionRegion {
  const found = useWorkspaceStore
    .getState()
    .oristudioCpAnnotations.find((annotation) => annotation.id === id);
  if (!found) throw new Error(`no region ${id}`);
  return found as CpSuppressionRegion;
}

beforeEach(() => {
  cpOverlayViewStore.set({
    model: { origin: [100, 100], ex: [400, 0], ey: [0, 400] },
    user: { origin: [100, 100], ex: [400, 0], ey: [0, 400] },
  });
  container = document.createElement('div');
  container.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 600);
  document.body.appendChild(container);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  container.remove();
});

describe('CpRegionLayer', () => {
  it('mounts a chip for every region, selected or not, and for nothing else', () => {
    seed([
      createTextAnnotation({ center: { x: 0.5, y: 0.5 } }),
      box('alpha', 0.4),
      box('beta', 0.7),
    ]);
    render();

    // Always visible is the whole point of the kind: nothing here is selected.
    expect(chips()).toHaveLength(2);
    expect(chips().map((chip) => chip.textContent).join(' ')).toContain('alpha');
    expect(chips().map((chip) => chip.textContent).join(' ')).toContain('beta');
  });

  it('renders nothing before the viewport has laid out', () => {
    seed([box('alpha', 0.5)]);
    render(undefined, false);
    expect(chips()).toHaveLength(0);
  });

  it('gives every chip the full control set, selected or not', () => {
    seed([box('alpha', 0.4), box('beta', 0.7)], 'beta');
    render();

    // Two of each: a region's controls do not wait for a selection, because a
    // suppressor's visible half must not be smaller than what it suppresses.
    expect(document.querySelectorAll('button[aria-label="Suppressed checks"]')).toHaveLength(2);
    expect(document.querySelectorAll('button[aria-label="Delete region"]')).toHaveLength(2);
    // And nothing from the image toolbar's half of the shared actions.
    expect(document.querySelectorAll('input[type="range"]')).toHaveLength(0);
    expect(document.querySelectorAll('button[aria-label="Bring to front"]')).toHaveLength(0);
  });

  it('gives the Solve chip only to a region carrying an attachment', () => {
    seed([box('plain', 0.35), box('detected', 0.7, { spans: [] })]);
    render({
      stateFor: () => undefined,
      onSolve: vi.fn(),
      onStop: vi.fn(),
      onAccept: vi.fn(),
      onTryAgain: vi.fn(),
    });

    const plain = chips().find((chip) => chip.textContent?.includes('plain'));
    const detected = chips().find((chip) => chip.textContent?.includes('detected'));
    expect(plain?.textContent).not.toContain('Solve');
    expect(detected?.textContent).toContain('Solve');
  });

  it('withholds Solve when the host cannot service one, rather than showing a dead button', () => {
    seed([box('detected', 0.5, { spans: [] })]);
    render(undefined);

    // Two separate questions: whether the region *can* be solved is the
    // attachment, whether this host can *run* one is the binding.
    expect(chips()).toHaveLength(1);
    expect(chips()[0].textContent).not.toContain('Solve');
  });

  it('routes a solve request to the region it came from', () => {
    const onSolve = vi.fn();
    seed([box('alpha', 0.35, { spans: [] }), box('beta', 0.7, { spans: [] })]);
    render({
      stateFor: () => ({ status: 'idle' }),
      onSolve,
      onStop: vi.fn(),
      onAccept: vi.fn(),
      onTryAgain: vi.fn(),
    });

    const beta = chips().find((chip) => chip.textContent?.includes('beta'));
    const solve = [...(beta?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
      (button) => button.textContent === 'Solve'
    );
    act(() => solve?.click());
    expect(onSolve).toHaveBeenCalledWith('beta');
  });

  it('selects the region whose chip was pressed', () => {
    seed([box('alpha', 0.35), box('beta', 0.7)]);
    render();

    const beta = chips().find((chip) => chip.textContent?.includes('beta'));
    if (!beta) throw new Error('no chip for beta');
    stubPointerCapture(beta);
    act(() => beta.dispatchEvent(pointer('pointerdown', 400, 150)));
    expect(useWorkspaceStore.getState().oristudioCpSelectedAnnotationId).toBe('beta');
  });

  /**
   * The gesture the region's body can no longer take.
   *
   * A region sits over the creases being repaired, so its body is inert and
   * clicks fall through to them — which leaves the chip as the only handle. Both
   * halves are asserted together because they are one rule: the bar drags, the
   * controls on it do not.
   */
  it('moves the region on a chip drag, as one undo entry — but not from its delete button', () => {
    seed([box('alpha', 0.5)]);
    render();

    const bar = chips()[0];
    stubPointerCapture(bar);
    act(() => {
      bar.dispatchEvent(pointer('pointerdown', 300, 200));
      bar.dispatchEvent(pointer('pointermove', 380, 200));
      bar.dispatchEvent(pointer('pointermove', 500, 240));
      bar.dispatchEvent(pointer('pointerup', 500, 240));
    });

    // 200 CSS px along x and 40 down, through a camera of 400 px per model unit.
    expect(regionById('alpha').center).toEqual({ x: 1, y: 0.6 });
    // One entry for the whole drag, not one per sample.
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toHaveLength(1);

    const remove = document.querySelector<HTMLButtonElement>('button[aria-label="Delete region"]');
    if (!remove) throw new Error('the delete button did not render');
    stubPointerCapture(remove);
    act(() => {
      remove.dispatchEvent(pointer('pointerdown', 600, 200));
      bar.dispatchEvent(pointer('pointermove', 700, 300));
      bar.dispatchEvent(pointer('pointerup', 700, 300));
    });

    // Still where the drag left it: a press on a control is that control's.
    expect(regionById('alpha').center).toEqual({ x: 1, y: 0.6 });
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toHaveLength(1);
  });

  it('deletes through the store, as one undo entry', () => {
    seed([box('alpha', 0.5)], 'alpha');
    render();

    const remove = document.querySelector<HTMLButtonElement>('button[aria-label="Delete region"]');
    act(() => remove?.click());

    expect(useWorkspaceStore.getState().oristudioCpAnnotations).toHaveLength(0);
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toHaveLength(1);
    expect(chips()).toHaveLength(0);
  });
});
