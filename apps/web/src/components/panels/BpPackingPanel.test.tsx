import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioBpDocumentState } from '../../engine/oristudioBpTypes';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { TooltipProvider } from '../ui/Tooltip';
import { BpPackingPanel } from './BpPackingPanel';

/**
 * Nothing inside the packing canvas may be focusable.
 *
 * A focusable hit target gets the browser's own focus ring drawn around its
 * box — and those boxes sit directly on the flaps, rivers and creases the user
 * is trying to grab, so the ring covers the geometry and gets in the way of the
 * drag. Selection here is by pointer; the pane's keyboard actions (nudge) live
 * on the container, which is focusable via tabIndex={-1} without drawing a ring.
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

const sheet = {
  kind: 'rectangular' as const,
  width: 16,
  height: 16,
  grid: { kind: 'rectangular' as const, interval: 1, snap: true },
};

function packingDocument(): OristudioBpDocumentState {
  return {
    workflowTarget: 'box-pleat',
    kind: 'box-pleat-project',
    handle: 1,
    source: { format: 'generated', filename: 'Untitled.bps', path: null },
    activeSurface: 'packing',
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
        rivers: 1,
        stretches: 0,
        devices: 0,
        invalidJunctions: 0,
        packingValidity: 'valid',
      },
      tree: {
        rootVertexId: 0,
        sheet,
        maxTreeHeight: null,
        vertices: [
          {
            id: 0,
            name: '',
            loc: { x: 8, y: 8 },
            isRoot: true,
            isLeaf: false,
            degree: 2,
            dist: 0,
            height: 1,
            maxHeight: null,
            maxNewLeafLength: null,
            dualFlapId: null,
          },
          {
            id: 1,
            name: '',
            loc: { x: 8, y: 7 },
            isRoot: false,
            isLeaf: true,
            degree: 1,
            dist: 1,
            height: 0,
            maxHeight: null,
            maxNewLeafLength: null,
            dualFlapId: 1,
          },
          {
            id: 2,
            name: '',
            loc: { x: 8, y: 9 },
            isRoot: false,
            isLeaf: true,
            degree: 1,
            dist: 1,
            height: 0,
            maxHeight: null,
            maxNewLeafLength: null,
            dualFlapId: 2,
          },
        ],
        edges: [
          { id: 1, vertices: [0, 1], length: 1, maxLength: null, isLeafEdge: true, dualRiverId: null },
          { id: 2, vertices: [0, 2], length: 1, maxLength: null, isLeafEdge: false, dualRiverId: 1 },
        ],
      },
      packing: {
        sheet,
        flaps: [
          { id: 1, vertexId: 1, name: '', anchor: { x: 4, y: 4 }, width: 2, height: 2, radius: 1, constrained: true },
          { id: 2, vertexId: 2, name: '', anchor: { x: 10, y: 10 }, width: 2, height: 2, radius: 1, constrained: true },
        ],
        rivers: [{ id: 1, edgeId: 2, vertices: [0, 2], width: 1, length: 1 }],
        // A conflict, so the merged conflict hit targets are covered too.
        invalidJunctions: [
          {
            id: 'j1',
            flapIds: [1, 2],
            riverIds: [],
            paths: [
              [
                { x: 5, y: 5 },
                { x: 7, y: 5 },
                { x: 7, y: 7 },
                { x: 5, y: 7 },
              ],
            ],
            overlap: -1,
            message: 'Flaps 1 and 2 overlap',
          },
        ],
        stretches: [],
        devices: [],
        graphics: [
          {
            kind: 'line' as const,
            id: 'ridge:1',
            layer: 'ridge' as const,
            points: [
              { x: 4, y: 4 },
              { x: 6, y: 6 },
            ] as [{ x: number; y: number }, { x: number; y: number }],
            stroke: '#888888',
            width: 1,
          },
        ],
        validity: 'valid',
      },
      creasePattern: null,
      diagnostics: [],
      stale: { packing: false, creasePattern: true, exports: true, reasons: [] },
    },
  } satisfies OristudioBpDocumentState;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

function renderPacking() {
  const document_ = packingDocument();
  useWorkspaceStore.setState(
    {
      ...useWorkspaceStore.getInitialState(),
      oristudioBpDocument: document_,
      oristudioBpSelection: { kind: 'bp-none' },
    },
    true
  );
  container = window.document.createElement('div');
  window.document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <TooltipProvider>
        <BpPackingPanel document={document_} />
      </TooltipProvider>
    );
  });
  return container;
}

/** Geometry of an SVG <rect>, as numbers. */
function rectOf(element: Element) {
  const num = (name: string) => Number(element.getAttribute(name) ?? '0');
  const width = num('width');
  const height = num('height');
  const x = num('x');
  const y = num('y');
  return { x, y, width, height, cx: x + width / 2, cy: y + height / 2 };
}

describe('BP packing pane — the whole flap is draggable', () => {
  it('covers the drawn flap footprint, not just its centre', () => {
    const host = renderPacking();
    const drawn = [...host.querySelectorAll('.bp-packing-flap')].map(rectOf);
    const hits = [...host.querySelectorAll('.bp-packing-flap-hit')].map(rectOf);
    expect(drawn.length).toBeGreaterThan(0);
    expect(hits).toHaveLength(drawn.length);

    for (const flap of drawn) {
      // Pair by centre: the hit target is concentric with the flap it grabs.
      const hit = hits.find(
        (candidate) =>
          Math.abs(candidate.cx - flap.cx) < 0.01 && Math.abs(candidate.cy - flap.cy) < 0.01
      );
      expect(hit).toBeDefined();
      // BP Studio's hit target is the flap's filled contour — the drawn shape
      // grown by its radius — so the target must strictly contain the flap.
      expect(hit!.width).toBeGreaterThan(flap.width);
      expect(hit!.height).toBeGreaterThan(flap.height);
      expect(hit!.x).toBeLessThanOrEqual(flap.x);
      expect(hit!.y).toBeLessThanOrEqual(flap.y);
      expect(hit!.x + hit!.width).toBeGreaterThanOrEqual(flap.x + flap.width);
      expect(hit!.y + hit!.height).toBeGreaterThanOrEqual(flap.y + flap.height);
    }
  });

  it('scales the target with the flap instead of using a fixed centre dot', () => {
    const host = renderPacking();
    const hits = [...host.querySelectorAll('.bp-packing-flap-hit')].map(rectOf);
    // 16px is the floor for a degenerate flap; a real one must beat it.
    for (const hit of hits) expect(hit.width).toBeGreaterThan(16);
  });
});

describe('BP packing pane — nothing in the canvas takes focus', () => {
  it('renders flap hit targets that are not focusable', () => {
    const host = renderPacking();
    const hits = host.querySelectorAll('.bp-packing-flap-hit');
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.hasAttribute('tabindex')).toBe(false);
      expect(hit.getAttribute('role')).not.toBe('button');
      // Still announced — dropping the ring must not drop the label.
      expect(hit.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('leaves no focusable element anywhere in the canvas', () => {
    const host = renderPacking();
    const canvas = host.querySelector('.bp-packing-canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.querySelectorAll('[tabindex]')).toHaveLength(0);
    expect(canvas?.querySelectorAll('[role="button"]')).toHaveLength(0);
  });
});
