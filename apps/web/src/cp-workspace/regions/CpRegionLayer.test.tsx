import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../../components/ui/Tooltip';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { cpOverlayViewStore } from '../cpOverlayViewStore';
import type { CanvasAnnotation } from '../annotations/annotation';
import { createCpSuppressionRegion } from '../annotations/suppressionRegion';
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

  it('expands only the selected region', () => {
    seed([box('alpha', 0.4), box('beta', 0.7)], 'beta');
    render();

    // One class menu, on the selected chip.
    expect(document.querySelectorAll('button[aria-label="Suppressed checks"]')).toHaveLength(1);
    const expanded = chips().find((chip) => chip.textContent?.includes('beta'));
    expect(expanded?.querySelector('input[type="range"]')).not.toBeNull();
  });

  it('gives the Solve chip only to a region carrying an attachment', () => {
    seed([box('plain', 0.35), box('detected', 0.7, { spans: [] })]);
    render({
      stateFor: () => undefined,
      onSolve: vi.fn(),
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

  it('selects the region a collapsed chip belongs to', () => {
    seed([box('alpha', 0.35), box('beta', 0.7)]);
    render();

    const beta = chips().find((chip) => chip.textContent?.includes('beta'));
    act(() => beta?.querySelector<HTMLButtonElement>('button.cp-region-chip__summary')?.click());
    expect(useWorkspaceStore.getState().oristudioCpSelectedAnnotationId).toBe('beta');
  });

  it('deletes through the store, as one undo entry', () => {
    seed([box('alpha', 0.5)], 'alpha');
    render();

    const remove = document.querySelector<HTMLButtonElement>('button[aria-label="Delete"]');
    act(() => remove?.click());

    expect(useWorkspaceStore.getState().oristudioCpAnnotations).toHaveLength(0);
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toHaveLength(1);
    expect(chips()).toHaveLength(0);
  });
});
