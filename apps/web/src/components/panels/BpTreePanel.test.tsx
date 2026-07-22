import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioBpDocumentState } from '../../engine/oristudioBpTypes';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { TooltipProvider } from '../ui/Tooltip';
import { BpTreePanel } from './BpTreePanel';

/**
 * The BP tree pane's *interaction rules* — the layer where this pane's
 * user-reported bugs actually lived, and which unit tests over pure helpers
 * could not see:
 *
 * - a canvas click adds a leaf to the selected vertex, and to nothing else;
 * - the hover ghost previews exactly what that click would do;
 * - Escape means "nothing selected", which also disarms adding;
 * - adding keeps the parent anchored and doesn't grab focus.
 *
 * Deliberately written against behaviour, not markup internals, so the Phase 4
 * viewport extraction (and further decomposition) can't invalidate them.
 */

vi.mock('react-zoom-pan-pinch', async () => {
  const React = await import('react');
  type MockProps = {
    children: React.ReactNode;
    onInit?: (ref: unknown) => void;
    onTransformed?: (ref: unknown, state: { scale: number }) => void;
  };
  const api = {
    centerView: vi.fn(),
    setTransform: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
  };
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

// jsdom has no Pointer Events capture API; the pane captures the pointer when a
// vertex drag starts. Stub it so a synthesized press reaches the real handler.
for (const proto of [Element.prototype] as Element[]) {
  Object.assign(proto, {
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
    hasPointerCapture: () => false,
  });
}

//   0 (root) ── 1 (leaf)
//            └─ 2 (leaf)
function bpDocument(): OristudioBpDocumentState {
  const sheet = {
    kind: 'rectangular' as const,
    width: 20,
    height: 20,
    grid: { kind: 'rectangular' as const, interval: 1, snap: true },
  };
  const vertex = (id: number, x: number, y: number, isRoot: boolean, isLeaf: boolean) => ({
    id,
    name: '',
    loc: { x, y },
    isRoot,
    isLeaf,
    degree: isRoot ? 2 : 1,
    dist: isRoot ? 0 : 1,
    height: isRoot ? 1 : 0,
    maxHeight: null,
    maxNewLeafLength: null,
    dualFlapId: isLeaf ? id : null,
  });
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
        treeVertices: 3,
        treeEdges: 2,
        leafVertices: 2,
        flaps: 2,
        rivers: 0,
        stretches: 0,
        devices: 0,
        invalidJunctions: 0,
        packingValidity: 'unknown',
      },
      tree: {
        rootVertexId: 0,
        sheet,
        maxTreeHeight: null,
        vertices: [
          vertex(0, 10, 10, true, false),
          vertex(1, 10, 9, false, true),
          vertex(2, 10, 11, false, true),
        ],
        edges: [
          { id: 1, vertices: [0, 1] as [number, number], length: 1, maxLength: null, isLeafEdge: true, dualRiverId: null },
          { id: 2, vertices: [0, 2] as [number, number], length: 1, maxLength: null, isLeafEdge: true, dualRiverId: null },
        ],
      },
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
      creasePattern: null,
      diagnostics: [],
      stale: { packing: false, creasePattern: true, exports: true, reasons: [] },
    },
  } satisfies OristudioBpDocumentState;
}

const actions = {
  addOristudioBpTreeLeaf: vi.fn(async (_parentId: number, _loc?: unknown) => true),
  addOristudioBpTreeLeafWithSymmetry: vi.fn(
    async (_parentId: number, _loc?: unknown, _tolerance?: number) => true
  ),
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
let document_: OristudioBpDocumentState;

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  for (const fn of Object.values(actions)) fn.mockClear();
  document_ = bpDocument();
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

function render(selectedVertexId: number | null, symmetryEnabled = false) {
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
        angle: 90,
        loc: { x: 10, y: 10 },
        pairs: [],
      },
    },
    true
  );

  container = window.document.createElement('div');
  window.document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <TooltipProvider>
        <BpTreePanel document={document_} />
      </TooltipProvider>
    );
  });

  const body = container.querySelector<HTMLElement>('.bp-tree-panel__body');
  if (!body) throw new Error('BP tree panel body did not render');
  Object.defineProperty(body, 'clientWidth', { configurable: true, value: 900 });
  Object.defineProperty(body, 'clientHeight', { configurable: true, value: 720 });
  return body;
}

/** A click on empty canvas: press and release at the same point. */
function clickCanvas(body: HTMLElement, at = { clientX: 400, clientY: 300 }) {
  act(() => {
    body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, ...at }));
    body.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0, ...at }));
  });
}

describe('BP tree pane — adding is anchored to the selection', () => {
  it('adds nothing when nothing is selected', () => {
    const body = render(null);
    clickCanvas(body);
    expect(actions.addOristudioBpTreeLeaf).not.toHaveBeenCalled();
    expect(actions.addOristudioBpTreeLeafWithSymmetry).not.toHaveBeenCalled();
  });

  it('adds to the selected vertex when one is selected', () => {
    const body = render(1);
    clickCanvas(body);
    expect(actions.addOristudioBpTreeLeaf).toHaveBeenCalledTimes(1);
    // ...anchored to the selected vertex, not the root.
    expect(actions.addOristudioBpTreeLeaf).toHaveBeenCalledWith(1, expect.anything());
  });

  it('never falls back to the root when the selection is empty', () => {
    // The regression this pane shipped: clearing the selection silently
    // re-anchored adding to the root, so a click still created a leaf there.
    const body = render(null);
    clickCanvas(body);
    clickCanvas(body, { clientX: 200, clientY: 500 });
    expect(actions.addOristudioBpTreeLeaf).not.toHaveBeenCalled();
  });

  it('routes through the symmetry-aware add when mirror-draw is on', () => {
    const body = render(1, true);
    clickCanvas(body);
    expect(actions.addOristudioBpTreeLeafWithSymmetry).toHaveBeenCalledTimes(1);
    expect(actions.addOristudioBpTreeLeaf).not.toHaveBeenCalled();
  });

  it('does not add on a drag, only on a click', () => {
    const body = render(1);
    act(() => {
      body.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 400, clientY: 300 })
      );
      body.dispatchEvent(
        new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 460, clientY: 360 })
      );
    });
    expect(actions.addOristudioBpTreeLeaf).not.toHaveBeenCalled();
  });
});

describe('BP tree pane — the hover ghost previews the click', () => {
  const ghost = () => container?.querySelector('.symmetry-ghost');

  it('shows no ghost with nothing selected, matching a click that does nothing', () => {
    const body = render(null, true);
    act(() => {
      body.dispatchEvent(
        new MouseEvent('pointermove', { bubbles: true, clientX: 400, clientY: 300 })
      );
    });
    expect(ghost()).toBeNull();
  });

  it('shows a ghost once a vertex is selected, matching a click that adds', () => {
    const body = render(1, true);
    act(() => {
      body.dispatchEvent(
        new MouseEvent('pointermove', { bubbles: true, clientX: 400, clientY: 300 })
      );
    });
    expect(ghost()).not.toBeNull();
  });
});

describe('BP tree pane — selecting an edge highlights the edge', () => {
  it('draws the selection on the edge line itself', () => {
    useWorkspaceStore.setState(
      {
        ...useWorkspaceStore.getInitialState(),
        ...actions,
        oristudioBpDocument: document_,
        oristudioBpSelection: { kind: 'bp-edge', id: 1 },
        oristudioBpSymmetry: { enabled: false, angle: 90, loc: { x: 10, y: 10 }, pairs: [] },
      },
      true
    );
    container = window.document.createElement('div');
    window.document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <TooltipProvider>
          <BpTreePanel document={document_} />
        </TooltipProvider>
      );
    });

    const selected = container.querySelectorAll('.bp-tree-edge.tree-edge--selected');
    expect(selected).toHaveLength(1);
    expect(selected[0].tagName.toLowerCase()).toBe('line');
  });

  it('keeps the whole canvas out of the focus order, so no ring covers it', () => {
    // Anything focusable inside the canvas gets the browser's own ring drawn
    // over the geometry the user is trying to grab or read.
    const body = render(null);
    expect(body.querySelectorAll('.bp-tree-canvas [tabindex]')).toHaveLength(0);
    expect(body.querySelectorAll('.bp-tree-canvas [role="button"]')).toHaveLength(0);
  });

  it('keeps edges out of the focus order, so no focus ring wraps them', () => {
    // A focusable <g> gets the browser's own ring around its box — which spans
    // the edge and its length label — reading as a capsule around the edge
    // rather than a highlight on it.
    const body = render(null);
    const edgeGroups = body.querySelectorAll('.bp-tree-canvas > g');
    expect(edgeGroups.length).toBeGreaterThan(0);
    for (const group of edgeGroups) {
      expect(group.hasAttribute('tabindex')).toBe(false);
      expect(group.getAttribute('role')).not.toBe('button');
    }
  });
});

describe('BP tree pane — Escape', () => {
  it('clears the selection from the canvas', () => {
    const body = render(1);
    act(() => {
      body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    });
    expect(actions.clearOristudioBpSelection).toHaveBeenCalled();
  });

  it('clears the selection from the flap name field, in one press', () => {
    render(1);
    const input = container?.querySelector<HTMLInputElement>('.bp-name-editor__input');
    expect(input).toBeTruthy();
    act(() => {
      input?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    });
    expect(actions.clearOristudioBpSelection).toHaveBeenCalled();
  });
});

describe('BP tree pane — the name field never steals focus', () => {
  it('shows the name field on selection without focusing it', () => {
    render(1);
    const input = container?.querySelector<HTMLInputElement>('.bp-name-editor__input');
    // While the field holds focus it owns the keyboard: Delete edits the name
    // instead of deleting the node, and undo undoes the field's text.
    expect(input).toBeTruthy();
    expect(window.document.activeElement).not.toBe(input);
  });

  it('does not focus a name field that appears as a result of adding', () => {
    const body = render(1);
    clickCanvas(body);
    // Whatever the add leaves selected, the field must not take focus: while it
    // holds focus the browser undoes the field's text instead of the add.
    act(() => {
      useWorkspaceStore.setState({ oristudioBpSelection: { kind: 'bp-vertex', id: 2 } });
    });
    const input = container?.querySelector<HTMLInputElement>('.bp-name-editor__input');
    expect(input).toBeTruthy();
    expect(window.document.activeElement).not.toBe(input);
  });

  it('does not focus the field when the user picks a different leaf', () => {
    render(1);
    act(() => {
      const dot = container?.querySelectorAll<SVGCircleElement>('.bp-tree-node')[2];
      dot?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      useWorkspaceStore.setState({ oristudioBpSelection: { kind: 'bp-vertex', id: 2 } });
    });
    const input = container?.querySelector<HTMLInputElement>('.bp-name-editor__input');
    expect(input).toBeTruthy();
    expect(window.document.activeElement).not.toBe(input);
  });

  it('leaves keystrokes to the canvas, so Delete reaches the tree', () => {
    const body = render(1);
    // Nothing in the pane may hold focus on selection — that is what let the
    // name field swallow Delete.
    const focused = window.document.activeElement;
    expect(focused === body || focused === window.document.body).toBe(true);
  });
});
