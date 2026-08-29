import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cpSurfacePress } from './picking/cpSurfacePressRegistry';
import type { CreasePatternWebglCanvasProps } from './CreasePatternWebglCanvas';

// Effects only flush inside `act` when React knows it is in a test environment,
// and the registration under test happens in one.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The canvas' half of crease-over-image press precedence: it publishes a press
 * pipeline the canvas-object overlay can reach, since the two are DOM siblings
 * with the overlay on top.
 *
 * This file exists because that wiring is a single line inside a 3.8k-line
 * effect with no other coverage — cut it and every other test in the suite stays
 * green while creases under a reference image silently become unclickable again.
 *
 * It also guards the sharper failure: `claimsPress` reusing the canvas' own
 * `hitTest` rather than recomputing proximity. A second radius would drift from
 * the first and open a ring around every crease where the overlay declines and
 * the canvas picks nothing either. Asserting *true on a crease, false on empty
 * space* exercises the real radius end to end, which no unit test of the pure
 * rule can do.
 */

/**
 * The renderer is stubbed whole rather than at the regl boundary: this file is
 * about where a press is routed, and nothing below `CpRenderer` can affect that.
 * Stubbing regl instead would mean standing up every draw program just to have
 * them draw nothing into a context jsdom does not have.
 */
vi.mock('./renderer/reglRenderer', () => ({
  createReglRenderer: () =>
    new Proxy({}, { get: () => () => {} }) as unknown as ReturnType<
      typeof import('./renderer/reglRenderer').createReglRenderer
    >,
}));

const { CreasePatternWebglCanvas } = await import('./CreasePatternWebglCanvas');

/** Viewport the canvas measures itself as; jsdom reports every rect as zero. */
const VIEWPORT = { left: 0, top: 0, width: 400, height: 400 };

/**
 * One unit-per-CSS-pixel camera centred on the geometry below, so a model point
 * maps to a client point by `client = model + 200 - 100`. Supplied rather than
 * fitted so the arithmetic in the assertions is legible.
 */
const CAMERA = { centerX: 100, centerY: 100, zoom: 1, rotation: 0 };

/** Model (x, y) → client point, under {@link CAMERA} and {@link VIEWPORT}. */
function clientOf(x: number, y: number): { clientX: number; clientY: number } {
  return {
    clientX: VIEWPORT.width / 2 + (x - CAMERA.centerX),
    clientY: VIEWPORT.height / 2 + (y - CAMERA.centerY),
  };
}

/**
 * A single horizontal crease from (0, 100) to (200, 100) — id 1, since hit ids
 * are 1-based indices into `lineSegments`.
 */
const CREASE = {
  a: { x: 0, y: 100 },
  b: { x: 200, y: 100 },
  color: 'Black0',
};

const identity = (point: { x: number; y: number }) => point;
const noop = () => {};

function props(): CreasePatternWebglCanvasProps {
  return {
    lineSegments: [CREASE],
    modelToSvg: identity,
    svgToModel: identity,
    // The camera seeds from this rather than from fitting the geometry, so the
    // model→client arithmetic in `clientOf` is exact rather than approximate.
    initialCamera: CAMERA,
    selectedLineIds: [],
    selectedPointIds: [],
    selectedCircleIds: [],
    onSelect: noop,
    onBoxSelect: noop,
    onTranslateSelection: noop,
    resolveMoveSnap: (rawDelta) => ({ delta: rawDelta, snapLabel: null }),
    // The **resting** configuration, not an empty one. The canvas rests with Box
    // Select armed, so `activeToolInputMode` is `'drag-box'` and its click
    // action is `select` — a fixture that said `null` here is what let the
    // hover-cursor gate ship broken while this file stayed green.
    activeToolInputMode: 'drag-box',
    activeToolClickAction: 'select',
    activeToolOperationId: 'CreaseSelect',
    panToolActive: false,
    wheelGesture: 'zoom',
    activeToolStepKinds: [],
    activeToolCommitsLoneCandidate: false,
    snapRadius: 12,
    onSnapDistanceChange: noop,
    activeToolLineCount: 0,
    activeToolRequireSnap: false,
    activeToolDualMirror: false,
    activeToolMeasureCreasePick: false,
    activeToolConverging: false,
    activeToolSquareBisector: false,
    activeToolVoronoi: false,
    activeToolDashedPreview: false,
    activeToolTransform: null,
    voronoiSeeds: [],
    onVoronoiSeedsChange: noop,
    resolveFirstPickKind: () => 'point',
    resolveDrawPoint: (point) => ({ point, snapped: false }),
    resolveDrawPointOnCrease: (point) => ({ point, snappedToVertex: false }),
    onToolCommit: noop,
    onToolPreviewInput: noop,
    onToolPickProgress: noop,
    onToolSnapKind: noop,
    toolCommandPreviewSegments: [],
    toolCommandHighlightSegments: [],
    toolReplacedLineIds: [],
    toolCommandPreviewPoints: [],
    toolPreviewColor: [0, 0, 0, 1],
    // Empty rather than null: these two are read for `.count` unconditionally.
    diagnosticMarkers: {
      center: new Float32Array(),
      size: new Float32Array(),
      shape: new Float32Array(),
      fill: new Float32Array(),
      stroke: new Float32Array(),
      count: 0,
    },
    diagnosticWedges: {
      center: new Float32Array(),
      dir0: new Float32Array(),
      dir1: new Float32Array(),
      radiusPx: new Float32Array(),
      color: new Float32Array(),
      count: 0,
    },
    operationFrame: null,
    onZoomPercentChange: noop,
    onRotationChange: noop,
    onViewChange: noop,
    onEraseBox: noop,
    onEraseLine: noop,
    onEraseCircle: noop,
    onRequestContextMenu: noop,
    mode: 'mvf',
    lineStyle: 'color',
    foldAngleDisplay: 'color',
    lineWidth: 1,
    points: [],
    vertices: [],
    pointSize: 3,
    circles: [],
    circleRadiusToSvg: (radius) => radius,
    foldedFigures: [],
    importedForms: null,
    grid: null,
    gridVisible: false,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  // The canvas measures itself with ResizeObserver and getBoundingClientRect,
  // neither of which jsdom implements usefully. Without a non-zero rect the
  // camera never seeds and every `clientToModel` returns null — so `hitTest`
  // would answer "nothing here" everywhere and the crease assertion below would
  // pass or fail for reasons unrelated to what it is testing.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  // The canvas probes for WebGL before building anything and renders the
  // "unavailable" state instead when the probe fails — which in jsdom is always,
  // since `getContext` returns null. The probe asks exactly two questions, so
  // answering both is enough; regl itself is mocked above and never touches this.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    getExtension: () => ({ loseContext: () => {} }),
  } as unknown as RenderingContext);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    ...VIEWPORT,
    right: VIEWPORT.width,
    bottom: VIEWPORT.height,
    x: VIEWPORT.left,
    y: VIEWPORT.top,
    toJSON: () => ({}),
  } as DOMRect);

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount(): void {
  act(() => root?.render(<CreasePatternWebglCanvas {...props()} />));
}

/** A primary-button press at a client point, as the overlay would hand it over. */
function pressAt(point: { clientX: number; clientY: number }): PointerEvent {
  return new PointerEvent('pointerdown', {
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
    ...point,
  });
}

describe('the canvas press pipeline the overlay hands presses back to', () => {
  it('is published while the canvas is mounted and withdrawn when it goes', () => {
    expect(cpSurfacePress()).toBeNull();
    mount();
    expect(cpSurfacePress()).not.toBeNull();
    act(() => root?.unmount());
    expect(cpSurfacePress()).toBeNull();
  });

  it('claims a press on a crease, so the crease wins over an image beneath it', () => {
    mount();
    expect(cpSurfacePress()?.claimsPress(pressAt(clientOf(100, 100)))).toBe(true);
  });

  it('declines a press on empty space, so the image keeps it and stays movable', () => {
    mount();
    // Well clear of the crease at y = 100 — far outside any plausible hit radius,
    // so this is not a boundary case in disguise.
    expect(cpSurfacePress()?.claimsPress(pressAt(clientOf(100, 180)))).toBe(false);
  });

  /**
   * The cursor half of the same question. Wiring-level rather than a unit test
   * of `cpCanvasCursor`, because what breaks silently is the chain from the
   * pointer handler through the probe to the rendered style — not the pure
   * function, which has its own tests.
   */
  it('points at a crease under the cursor, and only at a crease', () => {
    vi.useFakeTimers();
    try {
      mount();
      const canvas = container!.querySelector('canvas')!;
      const hover = (point: { clientX: number; clientY: number }) => {
        act(() => {
          canvas.dispatchEvent(
            new PointerEvent('pointermove', { pointerId: 1, pointerType: 'mouse', ...point })
          );
          // The probe coalesces onto an animation frame, so nothing has been
          // asked until one runs.
          vi.advanceTimersByTime(32);
        });
      };

      hover(clientOf(100, 100));
      expect(canvas.style.cursor).toBe('pointer');

      hover(clientOf(100, 180));
      expect(canvas.style.cursor).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * What the overlay above asks for when the pointer is over a reference image,
   * where this canvas receives no hover of its own. It must be *computed*, not
   * read off this canvas' rendered style — that style is only ever resolved from
   * hovers this canvas receives, so over an image it is stale by construction.
   */
  it('answers what cursor to show at a point it is not itself hovering', () => {
    mount();
    const surface = cpSurfacePress()!;

    expect(surface.hoverCursor({ button: 0, metaKey: false, ...clientOf(100, 100) })).toBe(
      'pointer'
    );
    // Empty space: the press belongs to the object, so the canvas offers nothing
    // and the object keeps its own move cursor.
    expect(
      surface.hoverCursor({ button: 0, metaKey: false, ...clientOf(100, 180) })
    ).toBeNull();
  });

  it('offers its pan cursor over an image, where a modifier still pans', () => {
    mount();
    const surface = cpSurfacePress()!;

    // Meta claims the press wherever it lands, so the answer is the pan
    // affordance rather than the crease one — even directly over a crease.
    expect(surface.hoverCursor({ button: 0, metaKey: true, ...clientOf(100, 100) })).toBe('grab');
    expect(surface.hoverCursor({ button: 0, metaKey: true, ...clientOf(100, 180) })).toBe('grab');
  });

  it('leaves the cursor to a draw tool, which owns its own hover feedback', () => {
    // The other half of the gate. It is not "no tool armed" — the canvas rests
    // with Box Select armed — it is "a click here would select", which a draw
    // tool's click would not.
    vi.useFakeTimers();
    try {
      act(() =>
        root?.render(
          <CreasePatternWebglCanvas
            {...props()}
            activeToolInputMode="drag-line"
            activeToolClickAction={null}
            activeToolOperationId="DrawCreaseFree"
          />
        )
      );
      const canvas = container!.querySelector('canvas')!;
      act(() => {
        canvas.dispatchEvent(
          new PointerEvent('pointermove', {
            pointerId: 1,
            pointerType: 'mouse',
            ...clientOf(100, 100),
          })
        );
        vi.advanceTimersByTime(32);
      });

      expect(canvas.style.cursor).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the canvas own hit radius, not a second one of its own', () => {
    // A few pixels off the crease still counts as on it: `CP_LINE_HIT_MIN_CSS`
    // floors the line radius at 8 CSS px so a crease stays clickable. If
    // `claimsPress` ever recomputed proximity instead of reusing `hitTest`, this
    // is the band the two would disagree about — and a press landing in it would
    // be taken by neither layer.
    mount();
    expect(cpSurfacePress()?.claimsPress(pressAt(clientOf(100, 104)))).toBe(true);
  });
});
