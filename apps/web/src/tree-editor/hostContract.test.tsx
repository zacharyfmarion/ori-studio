import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../components/ui/Tooltip';
import { TreeEditor } from './TreeEditor';
import { createCenteredTreeFrame } from './frame';
import { CONTINUOUS_LENGTHS } from './lengths';
import type { TreeEditorCopy, TreeEditorHost } from './host';
import type { EditableTree, TreeVertexUpdate } from './model';

/**
 * The editor's half of the host contract: it works against a surface whose
 * intents resolve *now*, and against one whose intents resolve later, without
 * knowing which it has.
 *
 * This is the property the extraction exists for. Box-pleat's intents are worker
 * round trips; a local surface's are plain state writes. An editor that quietly
 * assumed either — by reading the tree straight back after an intent, or by
 * waiting for a promise before drawing — would work on one surface and not the
 * other, and the failure would show up as a feature that "just doesn't update".
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

const COPY: TreeEditorCopy = {
  canvas: 'Tree canvas',
  viewportControls: 'Tree viewport controls',
  mirrorDraw: 'Mirror draw',
  symmetry: 'Symmetry',
  mirrorDrawOn: 'Mirror draw (on)',
  unpair: 'Unpair',
  layers: 'Layers',
  layerLabels: 'Labels',
  length: 'Length',
  decreaseLength: 'Shorter',
  increaseLength: 'Longer',
  edgeTitle: (from, to) => `Edge ${from}-${to}`,
  edgeLengthGroup: (from, to) => `Length of edge ${from} to ${to}`,
  selectEdge: (id) => `Select edge ${id}`,
  selectVertex: (id) => `Select vertex ${id}`,
  nameTitle: (label) => `Node ${label}`,
  nameAria: (label) => `Name of node ${label}`,
};

function starterTree(): EditableTree {
  return {
    rootVertexId: 0,
    vertices: [
      { id: 0, loc: { x: 0, y: 0 }, isLeaf: false, isRoot: true, name: '' },
      { id: 1, loc: { x: 0, y: 1 }, isLeaf: true, isRoot: false, name: '' },
      { id: 2, loc: { x: 1, y: 0 }, isLeaf: true, isRoot: false, name: '' },
    ],
    edges: [
      { id: 10, vertices: [0, 1], length: 1, isLeafEdge: true, maxLength: null },
      { id: 11, vertices: [0, 2], length: 1, isLeafEdge: true, maxLength: null },
    ],
  };
}

/**
 * A stub surface whose intents land either immediately or on demand.
 *
 * `resolve()` is what makes the deferred case a real test rather than a slower
 * copy of the synchronous one: nothing about the tree changes until it is
 * called, which is exactly the window a tab switch lives in on the real thing.
 */
function stubHost(mode: 'sync' | 'deferred') {
  let tree = starterTree();
  const pending: (() => void)[] = [];
  const calls: { addLeaf: number; moveVertices: TreeVertexUpdate[][] } = {
    addLeaf: 0,
    moveVertices: [],
  };
  let notify = () => {};

  const land = (change: () => void) => {
    if (mode === 'sync') {
      change();
      notify();
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      pending.push(() => {
        change();
        notify();
        resolve();
      });
    });
  };

  const host = (): TreeEditorHost => ({
    tree,
    frame: createCenteredTreeFrame({ unitSvg: 60, halfExtent: 4 }),
    lengths: CONTINUOUS_LENGTHS,
    copy: COPY,
    classPrefix: 'stub-tree',
    surface: 'tree',
    fitKey: 'stub',
    selection: { vertexId: 0, edgeId: null, vertices: new Set([0]), edges: new Set() },
    select: () => {},
    toggleSelection: () => {},
    clearSelection: () => {},
    addLeaf: (parentId, loc) => {
      calls.addLeaf += 1;
      return land(() => {
        const id = tree.vertices.length;
        tree = {
          ...tree,
          vertices: [...tree.vertices, { id, loc, isLeaf: true, isRoot: false, name: '' }],
          edges: [
            ...tree.edges,
            { id: 100 + id, vertices: [parentId, id], length: 1, isLeafEdge: true, maxLength: null },
          ],
        };
      });
    },
    moveVertices: (updates) => {
      calls.moveVertices.push([...updates]);
      return land(() => {
        const moved = new Map(updates.map((update) => [update.id, update.loc]));
        tree = {
          ...tree,
          vertices: tree.vertices.map((vertex) =>
            moved.has(vertex.id) ? { ...vertex, loc: moved.get(vertex.id)! } : vertex
          ),
        };
      });
    },
    setEdgeLength: () => land(() => {}),
    labelOf: (vertex) => (vertex.isLeaf ? `L${vertex.id}` : ''),
    defaultLabelOf: (vertex) => `L${vertex.id}`,
    isNameable: (vertex) => vertex.isLeaf,
    symmetry: null,
    layers: { labels: true },
    setLayer: () => {},
  });

  return {
    host,
    calls,
    flush: () => {
      for (const resolve of pending.splice(0)) resolve();
    },
    onChange: (listener: () => void) => {
      notify = listener;
    },
    vertexCount: () => tree.vertices.length,
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

function mount(stub: ReturnType<typeof stubHost>) {
  const Harness = () => {
    const [, setTick] = useState(0);
    stub.onChange(() => setTick((value) => value + 1));
    return <TreeEditor host={stub.host()} />;
  };
  act(() => {
    root?.render(
      <TooltipProvider>
        <Harness />
      </TooltipProvider>
    );
  });
  return container!.querySelector<HTMLElement>('.stub-tree-panel__body')!;
}

function click(target: HTMLElement, point: { x: number; y: number }) {
  const options = {
    bubbles: true,
    button: 0,
    clientX: point.x,
    clientY: point.y,
    pointerId: 1,
  };
  act(() => {
    target.dispatchEvent(new PointerEvent('pointerdown', options));
    target.dispatchEvent(new PointerEvent('pointerup', options));
  });
}

describe.each(['sync', 'deferred'] as const)('the editor against a %s surface', (mode) => {
  it('draws the tree the host gives it', () => {
    const stub = stubHost(mode);
    const body = mount(stub);
    expect(body.querySelectorAll('.stub-tree-node')).toHaveLength(3);
    expect(body.querySelectorAll('.stub-tree-edge')).toHaveLength(2);
  });

  it('asks the host to add a leaf, and never adds one itself', () => {
    const stub = stubHost(mode);
    const body = mount(stub);
    click(body, { x: 260, y: 120 });

    expect(stub.calls.addLeaf).toBe(1);
    // The editor is not allowed to have drawn the new leaf on its own: until the
    // host says the tree changed, nothing has.
    if (mode === 'deferred') {
      expect(stub.vertexCount()).toBe(3);
      expect(body.querySelectorAll('.stub-tree-node')).toHaveLength(3);
      act(() => stub.flush());
    }
    expect(stub.vertexCount()).toBe(4);
    expect(container!.querySelectorAll('.stub-tree-node')).toHaveLength(4);
  });

  it('renders no mirror controls when the surface has no symmetry', () => {
    const stub = stubHost(mode);
    const body = mount(stub);
    expect(body.querySelector('.symmetry-line')).toBeNull();
    expect(body.querySelector('[title="Mirror draw"]')).toBeNull();
  });
});
