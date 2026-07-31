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
        // minimal_repro_circle_issue.osf: two unit leaves whose flaps conflict.
        flaps: [
          { id: 5, vertexId: 5, name: '', anchor: { x: 9, y: 8 }, width: 0, height: 0, radius: 1, constrained: true },
          { id: 7, vertexId: 7, name: '', anchor: { x: 11, y: 6 }, width: 0, height: 0, radius: 1, constrained: true },
        ],
        rivers: [{ id: 1, edgeId: 2, vertices: [0, 2], width: 1, length: 1 }],
        // The engine's own output for that file, so the rendered geometry is
        // checked against what the engine actually produces.
        invalidJunctions: [
          {
            id: 'j5,7',
            flapIds: [5, 7],
            riverIds: [],
            paths: [
              [
                { x: 9.9557, y: 7.7057, arc: { x: 9.8, y: 7.2 }, r: 1 },
                { x: 9.2943, y: 7.0443, arc: { x: 9.5454545, y: 7.4545455 }, r: 2 },
              ],
              [
                { x: 10.7057, y: 6.9557, arc: { x: 10.4545455, y: 6.5454545 }, r: 2 },
                { x: 10.0443, y: 6.2943, arc: { x: 10.2, y: 6.8 }, r: 1 },
              ],
            ],
            overlap: 1,
            message: 'Flaps 5 and 7 overlap',
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
          // The river's own contour — the target that selects it.
          {
            kind: 'polyline' as const,
            id: 're0,2:contour',
            layer: 'river' as const,
            points: [
              { x: 3, y: 3 },
              { x: 7, y: 3 },
              { x: 7, y: 7 },
              { x: 3, y: 7 },
            ],
            stroke: '#888888',
            width: 1,
            closed: true,
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

describe('BP packing pane — conflict fills sit behind the geometry', () => {
  it('paints conflicts before the rivers, flaps and creases', () => {
    const host = renderPacking();
    const canvas = host.querySelector('.bp-packing-canvas');
    expect(canvas).not.toBeNull();
    const order = [...canvas!.children].map((child) => child.getAttribute('class') ?? '');
    const conflicts = order.findIndex((c) => c.includes('bp-packing-conflicts'));
    expect(conflicts).toBeGreaterThanOrEqual(0);
    // SVG paints in document order, so "behind" means "earlier". Compare against
    // whichever geometry layers this fixture actually renders.
    const geometry = ['bp-packing-flaps', 'bp-packing-flap-hits']
      .map((name) => order.findIndex((c) => c.includes(name)))
      .filter((index) => index >= 0);
    expect(geometry.length).toBeGreaterThan(0);
    for (const index of geometry) expect(conflicts).toBeLessThan(index);
  });

  it('fades the conflict layer once, so overlaps cannot compound to opaque', () => {
    const host = renderPacking();
    // Per-group opacity would stack: two overlapping junctions at 0.6 read as
    // 0.84, three as 0.94, until the fill hides the creases underneath.
    const groups = host.querySelectorAll('.bp-packing-conflict-group');
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group.getAttribute('style') ?? '').not.toContain('opacity');
    }
  });
});

describe('BP packing pane — conflicts never paint outside a flap', () => {
  it('clips the conflict layer to the flaps own shapes', () => {
    const host = renderPacking();
    const layer = host.querySelector('.bp-packing-conflicts');
    expect(layer).not.toBeNull();

    // The conflict outline stroke is centred on the region's edge, and that edge
    // *is* the flap circle — so without a clip half the stroke renders outside
    // the flap and reads as the conflict being somewhere it isn't.
    const inner = layer!.querySelector('g[clip-path]');
    expect(inner).not.toBeNull();
    const id = /url\(#([^)]+)\)/.exec(inner!.getAttribute('clip-path') ?? '')?.[1];
    expect(id).toBeTruthy();

    const clip = [...(host.querySelector('defs')?.children ?? [])].find(
      (node) => node.getAttribute('id') === id
    );
    expect(clip).toBeDefined();
    // One shape per flap, matching what the clearance circles draw.
    const shapes = [...clip!.children];
    expect(shapes).toHaveLength(2); // one per flap in the fixture
    for (const shape of shapes) {
      expect(Number(shape.getAttribute('width'))).toBeGreaterThan(0);
      expect(Number(shape.getAttribute('rx'))).toBeGreaterThan(0);
    }
  });

  it('leaves a legible conflict unstroked, so its tips stay sharp', () => {
    const host = renderPacking();
    const paths = [...host.querySelectorAll('.bp-packing-conflict')];
    expect(paths.length).toBeGreaterThan(0);
    // This region renders ~6.6px thick — plainly visible. A stroke would be
    // centred on its outline, and clipping that to the flap truncates the
    // region's tips, blunting points that should be sharp.
    for (const path of paths) {
      const width = Number(path.getAttribute('stroke-width') ?? '0');
      expect(width).toBe(0);
    }
  });

  it('paints a conflict path that stays on its flap circle', () => {
    const host = renderPacking();
    const paths = [...host.querySelectorAll('.bp-packing-conflict')];
    expect(paths.length).toBeGreaterThan(0);
    // Every conflict vertex sits on a flap circle: that is what makes clipping
    // to the flaps lossless for the fill, and lossy only for the stray stroke.
    const defs = host.querySelector('defs');
    const circles = [...(defs?.children ?? [])]
      .flatMap((clip) => [...clip.children])
      .filter((el) => Number(el.getAttribute('rx')) > 0)
      .map((el) => {
        const x = Number(el.getAttribute('x'));
        const y = Number(el.getAttribute('y'));
        const w = Number(el.getAttribute('width'));
        const h = Number(el.getAttribute('height'));
        return { cx: x + w / 2, cy: y + h / 2, r: Number(el.getAttribute('rx')) };
      });
    expect(defs).not.toBeNull();
    expect(circles.length).toBeGreaterThan(0);
    for (const path of paths) {
      const move = /M([\d.]+),([\d.]+)/.exec(path.getAttribute('d') ?? '');
      expect(move).not.toBeNull();
      const point = { x: Number(move![1]), y: Number(move![2]) };
      const onACircle = circles.some(
        (c) => Math.abs(Math.hypot(point.x - c.cx, point.y - c.cy) - c.r) < 0.5
      );
      expect(onACircle).toBe(true);
    }
  });
});

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

describe('BP packing pane — a river is grabbed by its contour', () => {
  it('draws no bounding-box overlay around the river', () => {
    const host = renderPacking();
    // The padded rect over the river's bounds was the focusable target's hit
    // box. It swallowed presses meant for whatever sits inside the river and
    // ringed the geometry once selected — the same treatment the flaps lost.
    expect(host.querySelector('.bp-packing-rivers')).toBeNull();
    expect(host.querySelector('.bp-packing-river-hit')).toBeNull();
    expect(host.querySelector('.bp-packing-river-shade')).toBeNull();
  });

  it('selects the river when its contour is pressed', () => {
    const host = renderPacking();
    const contour = host.querySelector('[data-bp-select="river:1"]');
    expect(contour).not.toBeNull();
    act(() => {
      contour?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    });
    expect(useWorkspaceStore.getState().oristudioBpSelection).toEqual({ kind: 'bp-river', id: 1 });
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
