import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Point } from '../../lib/geometry';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import { face, line, sceneOf, SQUARE, FIXTURE_SHEET_PX } from '../../lib/paper/paperScene.fixtures';
import { paperSceneToFoldedGeometry } from '../adapters/cpFoldedToScene';
import { StackHitIndex, type StackHit } from '../picking/stackHitIndex';
import { joinFills } from '../renderer/fillTint';
import type { FillGeometry, FoldedGeometry, PointGeometry, StrokeGeometry } from '../renderer/types';
import type { CpSurfaceControls, CpSurfaceHitRadii } from './useCpSurface';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The renderer is stubbed whole, keeping what each channel was last handed:
 * the pane is about which channel carries what, in which frame, not about
 * pixels (the browser check, `scripts/layer-order-dialog-check.mjs`, has those).
 */
const channels = vi.hoisted(() => ({ last: new Map<string, unknown>() }));
vi.mock('../renderer/reglRenderer', () => ({
  createReglRenderer: () =>
    new Proxy(
      {},
      {
        get: (_target, key: string) => (value: unknown) => {
          channels.last.set(key, value);
        },
      }
    ),
}));

const { PaperPane } = await import('./PaperPane');
type PaperPaneProps<Hit> = import('./PaperPane').PaperPaneProps<Hit>;

/** The canvas box: 400 × 400 CSS px. */
const VIEWPORT = { left: 0, top: 0, width: 400, height: 400 };

/**
 * The pane's frame is the unit square, y up; user space is 100 px to the
 * unit, y down, shifted: a frame of its own, as Fold's is.
 */
const modelToSvg = (point: Point): Point => ({ x: 10 + point.x * FIXTURE_SHEET_PX, y: 10 + (1 - point.y) * FIXTURE_SHEET_PX });

/** Two cells over the frame's square: the left half holds faces 2 over 1, the right half face 1. */
const CELLS = [
  { polygon: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 1 }, { x: 0, y: 1 }], faces_top_to_bottom: [2, 1] },
  { polygon: [{ x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0.5, y: 1 }], faces_top_to_bottom: [1] },
];

/** A hit: the stack under the point, as the dialog's folded pane would take it. */
interface CellHit {
  cell: number | null;
  face: number | null;
}

const fill = (count: number, alpha: number): FillGeometry => ({
  position: new Float32Array(count * 2),
  color: new Float32Array(count * 4).fill(alpha),
  count,
});

const stroke = (count: number): StrokeGeometry => ({
  a: new Float32Array(count * 2),
  b: new Float32Array(count * 2).fill(1),
  color: new Float32Array(count * 4),
  widthMul: new Float32Array(count).fill(1),
  count,
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(props: Partial<PaperPaneProps<CellHit>> = {}): HTMLCanvasElement {
  const all: PaperPaneProps<CellHit> = {
    scene: null,
    look: { style: DEFAULT_PAPER_STYLE, policy: PAPER_STYLE_POLICIES.fold },
    modelToSvg,
    contentBounds: { minX: 10, minY: 10, maxX: 110, maxY: 110 },
    framingKey: 'sheet',
    wheelGesture: 'zoom',
    snapRadius: 4,
    strokeWidthPx: ({ ratio }) => ratio,
    hitTest: (_at, _radii, stack) => ({ cell: stack?.cell ?? null, face: stack?.faces[0] ?? null }),
    sameHit: (a, b) => a.cell === b.cell && a.face === b.face,
    onPick: () => undefined,
    ariaLabel: 'The folded form',
    testId: 'paper-canvas',
    markers: { 'data-paper-test-pane': 'folded' },
    errorSurface: 'test:paper-webgl',
    ...props,
  };
  act(() => root?.render(<PaperPane<CellHit> {...all} />));
  const canvas = host?.querySelector<HTMLCanvasElement>('[data-testid="paper-canvas"]') ?? null;
  if (!canvas) throw new Error('no canvas');
  return canvas;
}

const at = (x: number, y: number) => ({
  pointerId: 1,
  pointerType: 'mouse',
  button: 0,
  clientX: x,
  clientY: y,
  bubbles: true,
});

function click(canvas: HTMLCanvasElement, clientX: number, clientY: number): void {
  act(() => {
    canvas.dispatchEvent(new PointerEvent('pointerdown', at(clientX, clientY)));
    canvas.dispatchEvent(new PointerEvent('pointerup', at(clientX, clientY)));
  });
}

/** Animation frames asked for, run when a test says a frame has passed. */
const frames: FrameRequestCallback[] = [];

/** A pointer passing over the canvas, and the frame its hover probe waits for. */
function hover(canvas: HTMLCanvasElement, clientX: number, clientY: number): void {
  act(() => {
    canvas.dispatchEvent(new PointerEvent('pointermove', at(clientX, clientY)));
    for (let frame = frames.shift(); frame; frame = frames.shift()) frame(0);
  });
}

/** Where a point of the pane's frame lands on the canvas, CSS px, once the camera has fitted the content. */
function onCanvas(point: Point): { x: number; y: number } {
  const user = modelToSvg(point);
  // The fit centres the 100 px content in the 400 px box at 0.7 of it.
  const scale = (VIEWPORT.width * 0.7) / 100;
  return { x: VIEWPORT.width / 2 + (user.x - 60) * scale, y: VIEWPORT.height / 2 + (user.y - 60) * scale };
}

beforeEach(() => {
  vi.stubGlobal('devicePixelRatio', 1);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    getExtension: () => ({ loseContext: () => {} }),
    isContextLost: () => false,
  } as unknown as RenderingContext);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    ...VIEWPORT,
    right: VIEWPORT.width,
    bottom: VIEWPORT.height,
    x: VIEWPORT.left,
    y: VIEWPORT.top,
    toJSON: () => ({}),
  } as DOMRect);
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => undefined;
    HTMLElement.prototype.releasePointerCapture = () => undefined;
  }
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  channels.last.clear();
  frames.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('a paper pane', () => {
  it('names its canvas, marks its box with the host’s attributes, and hands the host its camera', () => {
    const ref = createRef<CpSurfaceControls>();
    const onActivate = vi.fn();
    const canvas = mount({ ref, onActivate });
    expect(canvas.getAttribute('role')).toBe('img');
    expect(canvas.getAttribute('aria-label')).toBe('The folded form');
    const pane = host?.querySelector<HTMLElement>('[data-paper-test-pane="folded"]');
    expect(pane?.contains(canvas)).toBe(true);
    expect(ref.current).toMatchObject({ zoomIn: expect.any(Function), fit: expect.any(Function) });
    // A press focuses the pane and says so.
    act(() => {
      canvas.dispatchEvent(new PointerEvent('pointerdown', at(200, 200)));
    });
    expect(document.activeElement).toBe(pane);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('paints its scene through the shared painter in the look it is handed, the policy as given', () => {
    const scene = sceneOf([
      face([SQUARE]),
      line('mountain', [0, FIXTURE_SHEET_PX / 2], [FIXTURE_SHEET_PX, FIXTURE_SHEET_PX / 2], { face: 0 }),
    ]);
    const look = { style: DEFAULT_PAPER_STYLE, policy: PAPER_STYLE_POLICIES.fold };
    mount({ scene, look });
    const painted = channels.last.get('setFolded') as FoldedGeometry;
    expect(painted).toEqual(paperSceneToFoldedGeometry(scene, look.style, { policy: look.policy }));
    // Read as a step diagram, not as the painter's default 3D figure, whose folds are edges.
    const asFigure = paperSceneToFoldedGeometry(scene, look.style, { policy: PAPER_STYLE_POLICIES['folded-3d'] });
    expect([...painted.strokes.color]).not.toEqual([...asFigure.strokes.color]);
    // No scene, no paper.
    mount({ scene: null, look });
    expect((channels.last.get('setFolded') as FoldedGeometry).fills.count).toBe(0);
  });

  it('draws X-ray: a face alpha under 1 shows the buried faces the scene kept, at that alpha', () => {
    const scene = sceneOf([face([SQUARE], { face: 1, hidden: true }), face([SQUARE], { face: 2 })]);
    const opaque = { style: DEFAULT_PAPER_STYLE, policy: PAPER_STYLE_POLICIES.fold };
    mount({ scene, look: opaque });
    const shown = (channels.last.get('setFolded') as FoldedGeometry).fills;
    mount({ scene, look: { ...opaque, faceAlpha: 0.4 } });
    const xray = (channels.last.get('setFolded') as FoldedGeometry).fills;
    expect(xray.count).toBe(shown.count * 2);
    expect(xray.color[3]).toBeCloseTo(0.4, 6);
  });

  it('puts each channel where it belongs: creases, fills under and over, strokes over all, the pointer’s on top', () => {
    const creases = stroke(3);
    const underFills = fill(3, 0.16);
    const fills = fill(6, 0.42);
    const strokes = stroke(1);
    const hoverFills = fill(3, 0.26);
    const hoverStrokes = stroke(2);
    const hoverPoints: PointGeometry = {
      center: new Float32Array(2),
      radius: new Float32Array(1),
      screenSpace: new Float32Array(1),
      fill: new Float32Array(4),
      stroke: new Float32Array(4),
      count: 1,
    };
    const overlay = vi.fn((hovered: CellHit | null) =>
      hovered ? { fills: hoverFills, strokes: hoverStrokes, points: hoverPoints } : {}
    );
    const canvas = mount({ creases, underFills, fills, strokes, overlay, stacks: new StackHitIndex(CELLS) });
    expect(channels.last.get('setStrokes')).toBe(creases);
    expect(channels.last.get('setSheetFill')).toBe(underFills);
    expect(channels.last.get('setDiagnosticFills')).toBe(fills);
    expect(channels.last.get('setPreview')).toBe(strokes);
    expect(channels.last.get('setOverlayPoints')).toBeNull();
    // Over a cell: the pointer's fills over the pane's, its strokes over the pane's, its points.
    const right = onCanvas({ x: 0.75, y: 0.5 });
    hover(canvas, right.x, right.y);
    expect(overlay).toHaveBeenLastCalledWith({ cell: 1, face: 1 });
    expect(channels.last.get('setDiagnosticFills')).toEqual(joinFills(fills, hoverFills));
    expect((channels.last.get('setPreview') as StrokeGeometry).count).toBe(3);
    expect(channels.last.get('setOverlayPoints')).toBe(hoverPoints);
  });

  it('asks its hit test at the point under the pointer in its own frame, with the stack there and radii in its units', () => {
    const hitTest = vi.fn((_at: Point, _radii: CpSurfaceHitRadii, stack: StackHit | null) => ({
      cell: stack?.cell ?? null,
      face: stack?.faces[0] ?? null,
    }));
    const onPick = vi.fn();
    const onHover = vi.fn();
    const canvas = mount({ hitTest, onPick, onHover, stacks: new StackHitIndex(CELLS) });
    // The left half, through the frame's own map: faces 2 over 1.
    const left = onCanvas({ x: 0.25, y: 0.75 });
    click(canvas, left.x, left.y);
    expect(onPick).toHaveBeenLastCalledWith({ cell: 0, face: 2 });
    const [point, radii, stack] = hitTest.mock.calls.at(-1)!;
    expect(point.x).toBeCloseTo(0.25, 6);
    expect(point.y).toBeCloseTo(0.75, 6);
    expect(stack).toEqual({ cell: 0, faces: [2, 1] });
    // Off the paper: no stack.
    click(canvas, 5, 5);
    expect(onPick).toHaveBeenLastCalledWith({ cell: null, face: null });
    // The host is told what is under the pointer, once per thing.
    const right = onCanvas({ x: 0.75, y: 0.25 });
    hover(canvas, right.x, right.y);
    hover(canvas, right.x + 1, right.y + 1);
    expect(onHover.mock.calls.filter(([hit]) => hit?.cell === 1)).toHaveLength(1);

    // Radii in the pane's units: Edit's, times its scale.
    hitTest.mockClear();
    act(() => root?.unmount());
    root = host ? createRoot(host) : null;
    const scaled = mount({ hitTest, stacks: new StackHitIndex(CELLS), radiusScale: 0.25 });
    click(scaled, left.x, left.y);
    const [, quarter] = hitTest.mock.calls.at(-1)!;
    expect(quarter.point).toBeCloseTo(radii.point * 0.25, 9);
    expect(quarter.line).toBeCloseTo(radii.line * 0.25, 9);
  });

  it('hands the hit test no stack without an index', () => {
    const hitTest = vi.fn((_at: Point, _radii: CpSurfaceHitRadii, _stack: StackHit | null) => null);
    const canvas = mount({ hitTest });
    const left = onCanvas({ x: 0.25, y: 0.75 });
    click(canvas, left.x, left.y);
    expect(hitTest.mock.calls.at(-1)?.[2]).toBeNull();
  });

  it('shows the pointer over what a click would take, and only that', () => {
    const canvas = mount({ stacks: new StackHitIndex(CELLS), isTarget: (hit) => hit.face === 2 });
    const left = onCanvas({ x: 0.25, y: 0.5 });
    hover(canvas, left.x, left.y);
    expect(canvas.style.cursor).toBe('pointer');
    const right = onCanvas({ x: 0.75, y: 0.5 });
    hover(canvas, right.x, right.y);
    expect(canvas.style.cursor).toBe('');
  });
});
