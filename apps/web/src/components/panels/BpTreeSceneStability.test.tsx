import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioBpDocumentState } from '../../engine/oristudioBpTypes';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { TooltipProvider } from '../ui/Tooltip';
import { BpTreePanel } from './BpTreePanel';

/**
 * The performance property of the BP tree pane, written as a test so it cannot
 * drift back.
 *
 * The pane used to re-render its whole drawing on every pointer sample: work
 * proportional to the tree rather than to what moved, which made a drag on a
 * large tree unusable. What stops that from returning is not a faster render —
 * it is the canvas *not rendering at all* while a gesture runs.
 *
 * So these assert mutation counts on the live SVG rather than milliseconds. A
 * timing test would be flaky and would still pass if someone reintroduced the
 * full re-render on a fast machine; "the canvas did not change" is exact, and it
 * is the thing that actually matters.
 */

vi.mock('react-zoom-pan-pinch', async () => {
  const React = await import('react');
  type MockProps = {
    children: React.ReactNode;
    onInit?: (ref: unknown) => void;
    onTransformed?: (ref: unknown, state: { scale: number }) => void;
  };
  const api = { centerView: vi.fn(), setTransform: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn() };
  return {
    TransformWrapper: React.forwardRef<unknown, MockProps>(function MockTransformWrapper(
      { children, onInit, onTransformed },
      ref
    ) {
      const didInit = React.useRef(false);
      React.useImperativeHandle(ref, () => api, []);
      React.useEffect(() => {
        if (didInit.current) return;
        didInit.current = true;
        onInit?.(api);
        onTransformed?.(api, { scale: 1 });
      }, [onInit, onTransformed]);
      return React.createElement('div', null, children);
    }),
    TransformComponent: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

for (const proto of [Element.prototype] as Element[]) {
  Object.assign(proto, {
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
    hasPointerCapture: () => false,
  });
}

/** A star: a root with `leafCount` unit-length leaves around it. */
function bpDocument(leafCount: number): OristudioBpDocumentState {
  const sheet = {
    kind: 'rectangular' as const,
    width: 40,
    height: 40,
    grid: { kind: 'rectangular' as const, interval: 1, snap: true },
  };
  const vertices: OristudioBpDocumentState['snapshot']['tree']['vertices'] = [
    {
      id: 0,
      name: '',
      loc: { x: 20, y: 20 },
      isRoot: true,
      isLeaf: false,
      degree: leafCount,
      dist: 0,
      height: 1,
      maxHeight: null,
      maxNewLeafLength: null,
      dualFlapId: null,
    },
  ];
  const edges = [];
  for (let index = 0; index < leafCount; index += 1) {
    const angle = (index / leafCount) * Math.PI * 2;
    const id = index + 1;
    vertices.push({
      id,
      name: `L${id}`,
      loc: { x: 20 + 5 * Math.cos(angle), y: 20 + 5 * Math.sin(angle) },
      isRoot: false,
      isLeaf: true,
      degree: 1,
      dist: 1,
      height: 0,
      maxHeight: null,
      maxNewLeafLength: null,
      dualFlapId: id,
    });
    edges.push({
      id,
      vertices: [0, id] as [number, number],
      length: 5,
      maxLength: null,
      isLeafEdge: true,
      dualRiverId: null,
    });
  }
  return {
    workflowTarget: 'box-pleat',
    kind: 'box-pleat-project',
    handle: 1,
    source: { format: 'generated', filename: 'Untitled.bps', path: null },
    activeSurface: 'tree',
    dirty: false,
    history: { pastCount: 0, futureCount: 0, activeLabel: null },
    optimizer: {
      running: false,
      options: {
        openNew: false,
        useDimension: true,
        layoutMode: 'view',
        useBasinHopping: true,
        respectSymmetry: true,
        randomCandidateCount: 100,
        seed: null,
      },
      progress: {
        stage: 'idle',
        label: 'Idle',
        current: null,
        total: null,
        canSkip: false,
        canCancel: false,
        message: null,
      },
      lastError: null,
      lastResultValid: null,
    },
    exportStatus: { busy: false, lastFormat: null, lastError: null },
    snapshot: {
      summary: {
        title: 'Untitled',
        description: null,
        upstreamVersion: null,
        treeVertices: vertices.length,
        treeEdges: edges.length,
        leafVertices: leafCount,
        flaps: leafCount,
        rivers: 0,
        stretches: 0,
        devices: 0,
        invalidJunctions: 0,
        packingValidity: 'unknown',
      },
      tree: { rootVertexId: 0, sheet, maxTreeHeight: null, vertices, edges },
      packing: {
        sheet,
        flaps: [],
        rivers: [],
        invalidJunctions: [],
        stretches: [],
        devices: [],
        graphics: [],
        validity: 'unknown',
      },
      diagnostics: [],
      stale: { packing: false, creasePattern: true, exports: true, reasons: [] },
    },
  } satisfies OristudioBpDocumentState;
}

const actions = {
  addOristudioBpTreeLeaf: vi.fn(async () => true),
  addOristudioBpTreeLeafWithSymmetry: vi.fn(async () => true),
  selectOristudioBp: vi.fn(),
  clearOristudioBpSelection: vi.fn(),
  setOristudioBpActiveSurface: vi.fn(),
  moveOristudioBpTreeVertices: vi.fn(async () => true),
  moveOristudioBpTreeVerticesWithSymmetry: vi.fn(async () => true),
  setOristudioBpTreeEdgeLength: vi.fn(async () => true),
  renameOristudioBpVertex: vi.fn(async () => true),
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  for (const fn of Object.values(actions)) fn.mockClear();
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

function render(
  document_: OristudioBpDocumentState,
  selectedVertexId: number | null,
  symmetryEnabled = false
) {
  useWorkspaceStore.setState(
    {
      ...useWorkspaceStore.getInitialState(),
      ...actions,
      oristudioBpDocument: document_,
      oristudioBpSelection:
        selectedVertexId === null
          ? { kind: 'bp-none' }
          : { kind: 'bp-vertex', id: selectedVertexId },
      oristudioBpSymmetry: {
        enabled: symmetryEnabled,
        fold: 'book',
        angle: 90,
        loc: { x: 20, y: 20 },
        pairs: [],
      },
    },
    true
  );

  container = window.document.createElement('div');
  window.document.body.append(container);
  root = createRoot(container);
  const tree = (
    <TooltipProvider>
      <BpTreePanel document={document_} />
    </TooltipProvider>
  );
  act(() => root?.render(tree));

  const body = container.querySelector<HTMLElement>('.bp-tree-panel__body');
  if (!body) throw new Error('BP tree panel body did not render');
  Object.defineProperty(body, 'clientWidth', { configurable: true, value: 900 });
  Object.defineProperty(body, 'clientHeight', { configurable: true, value: 720 });
  return { body, rerender: () => act(() => root?.render(tree)) };
}

/**
 * Counts DOM changes inside the canvas. `takeRecords` reads them synchronously,
 * so a test never has to guess when the observer's microtask ran.
 */
function watchCanvas(body: HTMLElement) {
  const svg = body.querySelector('svg.bp-tree-canvas');
  if (!svg) throw new Error('BP tree canvas did not render');
  const observer = new MutationObserver(() => {});
  observer.observe(svg, { attributes: true, childList: true, subtree: true, characterData: true });
  return {
    count: () => observer.takeRecords().length,
    stop: () => observer.disconnect(),
  };
}

describe('BP tree canvas — the drawing is not rebuilt for nothing', () => {
  it('does not touch the canvas when the panel re-renders on the same document', () => {
    const { body, rerender } = render(bpDocument(24), null);
    const canvas = watchCanvas(body);
    rerender();
    rerender();
    expect(canvas.count()).toBe(0);
    canvas.stop();
  });

  /** Press a leaf dot, sweep the pointer, release. Returns what the canvas saw. */
  function dragALeaf(leafCount: number) {
    const { body } = render(bpDocument(leafCount), null);
    const svg = body.querySelector('svg.bp-tree-canvas');
    if (!svg) throw new Error('BP tree canvas did not render');
    // The dots render in vertex order, so index 1 is the first leaf.
    const dot = body.querySelectorAll<SVGCircleElement>('.bp-tree-node')[1];

    const touched = new Set<Node>();
    const observer = new MutationObserver(() => {});
    observer.observe(svg, { attributes: true, childList: true, subtree: true });
    const drain = () => {
      for (const record of observer.takeRecords()) touched.add(record.target);
    };

    act(() => {
      dot.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 400, clientY: 300 })
      );
    });
    drain();
    // The press selects, which is a legitimate redraw. Everything after it is
    // the gesture, and the gesture is what must not redraw the tree.
    touched.clear();
    for (let step = 0; step < 12; step += 1) {
      act(() => {
        body.dispatchEvent(
          new MouseEvent('pointermove', {
            bubbles: true,
            button: 0,
            clientX: 400 + step * 7,
            clientY: 300 + step * 5,
          })
        );
      });
      drain();
    }
    act(() => {
      body.dispatchEvent(
        new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 484, clientY: 360 })
      );
    });
    drain();
    observer.disconnect();
    return { touched: touched.size, committed: actions.moveOristudioBpTreeVertices.mock.calls.length };
  }

  it('touches the same few elements whether the tree is small or large', () => {
    // The property that makes a drag usable: its cost is set by the subtree that
    // moves, not by the tree it lives in. An 8× larger tree that touches 8× more
    // elements is the full re-render coming back.
    const small = dragALeaf(6);
    const large = dragALeaf(48);
    // Guard against the comparison passing because nothing happened at all.
    expect(small.committed).toBe(1);
    expect(small.touched).toBeGreaterThan(0);
    expect(large.touched).toBe(small.touched);
    // A leaf drag moves one dot, its label, its edge and that edge's label.
    expect(small.touched).toBeLessThanOrEqual(4);
  });

  /** Sweep the pointer across the pane. Returns the elements the canvas saw change. */
  function hover(leafCount: number, symmetryEnabled: boolean) {
    const { body } = render(bpDocument(leafCount), symmetryEnabled ? 1 : null, symmetryEnabled);
    const svg = body.querySelector('svg.bp-tree-canvas');
    if (!svg) throw new Error('BP tree canvas did not render');
    // One move to arm the ghost, which is a legitimate render; the rest is hover.
    act(() => {
      body.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 300, clientY: 260 }));
    });
    const touched = new Set<Node>();
    const observer = new MutationObserver(() => {});
    observer.observe(svg, { attributes: true, childList: true, subtree: true });
    for (let step = 0; step < 12; step += 1) {
      act(() => {
        body.dispatchEvent(
          new MouseEvent('pointermove', {
            bubbles: true,
            clientX: 300 + step * 9,
            clientY: 260 + step * 6,
          })
        );
      });
      for (const record of observer.takeRecords()) touched.add(record.target);
    }
    observer.disconnect();
    return { touched: touched.size, ghost: svg.querySelector('.symmetry-ghost') !== null };
  }

  it('leaves the canvas alone while the pointer moves with mirror draw off', () => {
    // Nothing on screen depends on where the pointer is, so nothing should change.
    const result = hover(48, false);
    expect(result.ghost).toBe(false);
    expect(result.touched).toBe(0);
  });

  it('touches only the ghost while previewing, whatever the tree size', () => {
    const small = hover(6, true);
    const large = hover(48, true);
    expect(small.ghost).toBe(true);
    expect(small.touched).toBeGreaterThan(0);
    expect(large.touched).toBe(small.touched);
    // The ghost is two segments and two dots, and nothing else may move.
    expect(small.touched).toBeLessThanOrEqual(4);
  });

  it('still redraws when the document actually changes', () => {
    const document_ = bpDocument(6);
    const { body } = render(document_, null);
    const canvas = watchCanvas(body);
    const moved = structuredClone(document_);
    moved.snapshot.tree.vertices[1].loc = { x: 30, y: 30 };
    act(() =>
      root?.render(
        <TooltipProvider>
          <BpTreePanel document={moved} />
        </TooltipProvider>
      )
    );
    expect(canvas.count()).toBeGreaterThan(0);
    canvas.stop();
  });
});
