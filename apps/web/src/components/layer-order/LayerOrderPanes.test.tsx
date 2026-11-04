/**
 * The Layer order dialog's panes (row U8), as the inspector drives them: the
 * crease pattern and the folded figure for each session status, the marks by
 * role, and the events a press sends. The renderer is stubbed whole; the
 * pixels are the browser check's (`scripts/layer-order-dialog-check.mjs`).
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OristudioCpLineSegment } from '../../engine/oristudioCpTypes';
import { faceLettersOf } from '../../layer-order/engine/faceIndex';
import type { LayerOrderSessionOpen } from '../../layer-order/dialog/layerOrderSession';
import type { LayerOrderSessionStatus } from '../../layer-order/dialog/useLayerOrderSession';
import { DEFAULT_FIT_SHARE } from '../../cp-workspace/surface/useCpSurface';
import { PANE_USER_PER_UNIT } from '../../layer-order/panes/layerPaneFigure';
import { DOUBLE_TAP_MS } from '../../layer-order/panes/layerPaneInput';
import { NO_FACE_MARKS, type LayerFaceMarks } from '../../layer-order/panes/layerPaneMarks';
import { zScene } from '../../layer-order/panes/layerPanes.fixtures';
import type { LayerOrderRequest } from '../../lib/layerOrder/layerOrderRequest';
import { DEFAULT_FOLDED_MODEL } from '../../lib/orieditaNativeMetadata';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import { allByRole, byRole, queryByRole } from '../../test/roleQueries';
import type { LayerOrderPanesProps } from './LayerOrderDialogFrame';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The renderer, stubbed whole, keeping what each channel was last handed per canvas. */
const channels = vi.hoisted(() => ({ last: new Map<HTMLCanvasElement, Map<string, unknown>>(), fits: 0 }));
vi.mock('../../cp-workspace/renderer/reglRenderer', () => ({
  createReglRenderer: (canvas: HTMLCanvasElement) => {
    const mine = new Map<string, unknown>();
    channels.last.set(canvas, mine);
    return new Proxy({}, { get: (_target, key: string) => (value: unknown) => mine.set(key, value) });
  },
}));
vi.mock('../../cp-workspace/renderer/webglSupport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../cp-workspace/renderer/webglSupport')>()),
  cpWebglSupport: () => ({ supported: true }),
}));

const { LayerOrderPanes } = await import('./LayerOrderPanes');

const VIEWPORT = { left: 0, top: 0, width: 400, height: 400 };

const segment = (color: string, ax: number, ay: number, bx: number, by: number): OristudioCpLineSegment => ({
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
  active: 'INACTIVE_0',
  color,
  selected: 0,
  customized: 0,
  customized_color: { red: 0, green: 0, blue: 0 },
});

const FRONT = zScene('front');
const BACK = zScene('back');
const LETTERS = faceLettersOf(FRONT);

const REQUEST: LayerOrderRequest = {
  source: {
    segments: [
      segment('Black0', 0, 0, 40, 0),
      segment('Black0', 40, 0, 40, 10),
      segment('Black0', 40, 10, 0, 10),
      segment('Black0', 0, 10, 0, 0),
      segment('Blue2', 20, 0, 20, 10),
      segment('Red1', 30, 0, 30, 10),
    ],
    startingFaceId: 0,
    auxSegments: [],
    model: DEFAULT_FOLDED_MODEL,
    digest: 'z',
  },
  record: null,
  look: {
    style: DEFAULT_PAPER_STYLE,
    policy: PAPER_STYLE_POLICIES['folded-flat'],
    turnDeg: 0,
    side: 'front',
    xray: false,
    lineStyle: 'color',
    lineWidth: 1,
  },
  shown: FRONT,
};

const LIMITS = { maxNodes: 1, fastNodes: 1, deadlineMs: 1 };

const READY: LayerOrderSessionStatus = {
  kind: 'ready',
  limits: LIMITS,
  open: {
    how: 'showing',
    opened: {} as LayerOrderSessionOpen['opened'],
    stacks: {
      front: { offsets: new Uint32Array([0, 1, 4]), faces: new Uint32Array([0, 2, 1, 0]) },
      back: { offsets: new Uint32Array([0, 1, 4]), faces: new Uint32Array([0, 0, 1, 2]) },
    },
    scenes: { front: FRONT, back: BACK },
    letters: LETTERS,
    facts: {} as LayerOrderSessionOpen['facts'],
  },
};

const OPENING: LayerOrderSessionStatus = { kind: 'opening', limits: LIMITS };

let host: HTMLDivElement;
let root: Root;
const frames: FrameRequestCallback[] = [];

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
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => undefined;
    HTMLElement.prototype.releasePointerCapture = () => undefined;
  }
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  channels.last.clear();
  frames.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function render(props: Partial<LayerOrderPanesProps> = {}) {
  act(() =>
    root.render(<LayerOrderPanes status={READY} phonePane={null} request={REQUEST} letters={LETTERS} {...props} />)
  );
}

const canvasOf = (pane: 'pattern' | 'folded') =>
  host.querySelector<HTMLCanvasElement>(`[data-testid="layer-order-${pane}-canvas"]`);
const lettersOn = (pane: 'pattern' | 'folded') =>
  [...host.querySelectorAll<HTMLElement>(`[data-layer-order-marks="${pane}"] [data-layer-order-letter]`)].map((chip) => ({
    letter: chip.dataset.layerOrderLetter,
    tone: chip.dataset.tone,
    under: chip.dataset.under !== undefined,
  }));
const ringsOn = (pane: 'pattern' | 'folded') =>
  [...host.querySelectorAll<SVGElement>(`[data-layer-order-marks="${pane}"] [data-layer-order-ring]`)].map((ring) =>
    Number(ring.dataset.layerOrderRing)
  );

/** The centre of a face's letter on a pane: where its spot lands on the canvas. */
function letterAt(pane: 'pattern' | 'folded', letter: string): { x: number; y: number } {
  const chip = host.querySelector<HTMLElement>(`[data-layer-order-marks="${pane}"] [data-layer-order-letter="${letter}"]`);
  if (!chip) throw new Error(`no ${letter} on the ${pane} pane`);
  return {
    x: Number.parseFloat(chip.style.left) + Number.parseFloat(chip.style.width) / 2,
    y: Number.parseFloat(chip.style.top) + Number.parseFloat(chip.style.height) / 2,
  };
}

const pointer = (type: string, x: number, y: number, pointerType = 'mouse') =>
  new PointerEvent(type, { pointerId: 1, pointerType, button: 0, clientX: x, clientY: y, bubbles: true });

/** Let the frames asked for run. */
function runFrames() {
  act(() => {
    for (let frame = frames.shift(); frame; frame = frames.shift()) frame(0);
  });
}

function press(canvas: HTMLCanvasElement, at: { x: number; y: number }, pointerType = 'mouse') {
  act(() => {
    canvas.dispatchEvent(pointer('pointerdown', at.x, at.y, pointerType));
    canvas.dispatchEvent(pointer('pointerup', at.x, at.y, pointerType));
  });
}

const A = LETTERS.faceOf('A')!;
const B = LETTERS.faceOf('B')!;
const C = LETTERS.faceOf('C')!;

/** A subject and two objects picked (D21), every other face of it on offer. */
const PICKED: LayerFaceMarks = { ...NO_FACE_MARKS, picking: 'object', pickable: [B, C], subject: A, objects: [B, C] };

describe('the Layer order panes', () => {
  it('while the session opens: the crease pattern at once, the folded figure loading', () => {
    render({ status: OPENING });
    expect(canvasOf('pattern')).not.toBeNull();
    expect(canvasOf('folded')).toBeNull();
    expect(byRole(host, 'region', 'Folded figure').querySelector('[role="status"]')).not.toBeNull();
    // The crease pattern is drawn as Edit draws it: its lines on the crease channel.
    const strokes = channels.last.get(canvasOf('pattern')!)?.get('setStrokes') as { count: number };
    expect(strokes.count).toBeGreaterThan(0);
  });

  it('once open: both panes, each with its own zoom bar whose Fit frames both', () => {
    render();
    expect(byRole(host, 'region', 'Crease pattern').contains(canvasOf('pattern'))).toBe(true);
    expect(byRole(host, 'region', 'Folded figure').contains(canvasOf('folded'))).toBe(true);
    expect(allByRole(host, 'toolbar').map((bar) => bar.getAttribute('aria-label'))).toEqual([
      'Crease pattern view',
      'Folded figure view',
    ]);
    expect(allByRole(host, 'button').filter((button) => button.getAttribute('aria-label') === 'Fit both views')).toHaveLength(2);
    expect(byRole(host, 'button', 'Reset the folded figure zoom').textContent).toMatch(/%$/);
    // The folded figure is the shared painter's, on the folded channel.
    const folded = channels.last.get(canvasOf('folded')!)?.get('setFolded') as { fills: { count: number } };
    expect(folded.fills.count).toBeGreaterThan(0);
  });

  it('the folded figure’s bar has Rotate Left and Right after Fit; the crease pattern’s has none', () => {
    const onTurn = vi.fn();
    render({ onTurn });
    const crease = byRole(host, 'toolbar', 'Crease pattern view');
    const folded = byRole(host, 'toolbar', 'Folded figure view');
    expect(queryByRole(crease, 'button', 'Rotate Left')).toBeNull();
    expect(queryByRole(crease, 'button', 'Rotate Right')).toBeNull();
    const labels = allByRole(folded, 'button').map((button) => button.getAttribute('aria-label'));
    expect(labels.slice(labels.indexOf('Fit both views'))).toEqual(['Fit both views', 'Rotate Left', 'Rotate Right']);
    act(() => byRole(folded, 'button', 'Rotate Left').click());
    act(() => byRole(folded, 'button', 'Rotate Right').click());
    expect(onTurn.mock.calls).toEqual([['left'], ['right']]);
    // Nothing listening, nothing offered.
    render({ onTurn: undefined });
    expect(queryByRole(host, 'button', 'Rotate Left')).toBeNull();
  });

  it('draws the folded figure at the view’s turn, its letters with it; the crease pattern never turns', () => {
    render({ marks: PICKED });
    runFrames();
    const [folded, pattern] = [letterAt('folded', 'A'), letterAt('pattern', 'A')];
    render({ marks: PICKED, view: { side: 'front', xray: false, undecided: false, turnDeg: 90 } });
    runFrames();
    const turned = letterAt('folded', 'A');
    expect(Math.hypot(turned.x - folded.x, turned.y - folded.y)).toBeGreaterThan(1);
    expect(letterAt('pattern', 'A')).toEqual(pattern);
  });

  it('marks nothing until it is told to', () => {
    render();
    expect(lettersOn('pattern')).toEqual([]);
    expect(lettersOn('folded')).toEqual([]);
    expect(ringsOn('folded')).toEqual([]);
  });

  it('a subject and two objects: lettered and ringed on both panes, tinted under the creases and over the paper', () => {
    render({ marks: PICKED });
    for (const pane of ['pattern', 'folded'] as const) {
      expect(lettersOn(pane).map(({ letter, tone }) => `${letter} ${tone}`).sort()).toEqual(['A pick', 'B pick', 'C pick']);
      expect(ringsOn(pane).sort()).toEqual([A, B, C].sort());
    }
    // B is buried on the front: its chip is the quieter one.
    expect(lettersOn('folded').find(({ letter }) => letter === 'B')?.under).toBe(true);
    const pattern = channels.last.get(canvasOf('pattern')!)!;
    expect((pattern.get('setSheetFill') as { count: number }).count).toBeGreaterThan(0);
    const folded = channels.last.get(canvasOf('folded')!)!;
    expect((folded.get('setDiagnosticFills') as { count: number }).count).toBeGreaterThan(0);
  });

  it('a clash in danger, with the dot on its letter', () => {
    render({ marks: { ...PICKED, clash: [C] } });
    const c = lettersOn('pattern').find(({ letter }) => letter === 'C');
    expect(c?.tone).toBe('danger');
    const chip = host.querySelector('[data-layer-order-marks="pattern"] [data-layer-order-letter="C"]');
    expect(chip?.children.length).toBe(1);
  });

  it('a pick sends its face, its pane and its input; no paper sends empty paper', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const onFacePicked = vi.fn();
    const onEmptyPaper = vi.fn();
    render({ marks: PICKED, onFacePicked, onEmptyPaper });
    press(canvasOf('folded')!, letterAt('folded', 'C'));
    expect(onFacePicked).toHaveBeenLastCalledWith({ face: C, origin: 'folded', input: 'pointer' });
    // A tap's pick waits out the double-tap window.
    press(canvasOf('pattern')!, letterAt('pattern', 'A'), 'touch');
    expect(onFacePicked).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(DOUBLE_TAP_MS));
    expect(onFacePicked).toHaveBeenLastCalledWith({ face: A, origin: 'pattern', input: 'tap' });
    press(canvasOf('pattern')!, { x: 2, y: 2 });
    expect(onEmptyPaper).toHaveBeenLastCalledWith({ origin: 'pattern', input: 'pointer' });
  });

  it('two taps far apart are two picks, the first sent as the second comes', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const onFacePicked = vi.fn();
    render({ marks: PICKED, onFacePicked });
    const canvas = canvasOf('folded')!;
    press(canvas, letterAt('folded', 'A'), 'touch');
    press(canvas, letterAt('folded', 'C'), 'touch');
    expect(onFacePicked.mock.calls.map(([event]) => event.face)).toEqual([A]);
    act(() => vi.advanceTimersByTime(DOUBLE_TAP_MS));
    expect(onFacePicked.mock.calls.map(([event]) => event.face)).toEqual([A, C]);
  });

  it('a tap keeps its face pointed at until its pick goes', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const onFacePicked = vi.fn();
    const onFaceHovered = vi.fn();
    render({ marks: PICKED, onFacePicked, onFaceHovered });
    const canvas = canvasOf('folded')!;
    const at = letterAt('folded', 'C');
    // The finger down: its face is pointed at.
    act(() => {
      canvas.dispatchEvent(pointer('pointerdown', at.x, at.y, 'touch'));
    });
    expect(onFaceHovered).toHaveBeenLastCalledWith({ face: C, origin: 'folded', input: 'tap' });
    act(() => {
      canvas.dispatchEvent(pointer('pointerup', at.x, at.y, 'touch'));
    });
    // The finger has lifted, and the pick waits out the double-tap window: C stays pointed at.
    expect(onFaceHovered).toHaveBeenLastCalledWith({ face: C, origin: 'folded', input: 'tap' });
    expect(onFacePicked).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(DOUBLE_TAP_MS));
    expect(onFacePicked).toHaveBeenCalledWith({ face: C, origin: 'folded', input: 'tap' });
    expect(onFaceHovered).toHaveBeenLastCalledWith({ face: null, origin: 'folded', input: 'tap' });
    // The pick first, then the hover it ends.
    expect(onFacePicked.mock.invocationCallOrder[0]!).toBeLessThan(onFaceHovered.mock.invocationCallOrder.at(-1)!);
  });

  it('draws the pointer’s tint under the creases on the crease pattern, over the paper on the folded figure', () => {
    render({ marks: { ...PICKED, pointed: B, row: [A, C] } });
    const pattern = channels.last.get(canvasOf('pattern')!)!;
    expect((pattern.get('setSheetMarks') as { count: number }).count).toBeGreaterThan(0);
    expect(pattern.get('setDiagnosticFills')).toBeNull();
    const folded = channels.last.get(canvasOf('folded')!)!;
    expect(folded.get('setSheetMarks')).toBeNull();
    render({ marks: PICKED });
    expect(pattern.get('setSheetMarks')).toBeNull();
  });

  it('moves the letters with a pan, and places them again once it settles', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    render({ marks: PICKED });
    const canvas = canvasOf('pattern')!;
    const before = letterAt('pattern', 'C');
    act(() => {
      canvas.dispatchEvent(pointer('pointerdown', 200, 200));
      canvas.dispatchEvent(pointer('pointermove', 230, 210));
      canvas.dispatchEvent(pointer('pointerup', 230, 210));
    });
    runFrames();
    const panned = letterAt('pattern', 'C');
    expect(panned.x - before.x).toBeCloseTo(30, 5);
    expect(panned.y - before.y).toBeCloseTo(10, 5);
    act(() => vi.advanceTimersByTime(200));
    const settled = letterAt('pattern', 'C');
    expect(settled.x).toBeCloseTo(panned.x, 5);
    expect(settled.y).toBeCloseTo(panned.y, 5);
  });

  it('tells the hover when the face under the pointer changes', () => {
    const onFaceHovered = vi.fn();
    render({ marks: PICKED, onFaceHovered });
    const at = letterAt('folded', 'C');
    act(() => {
      canvasOf('folded')!.dispatchEvent(pointer('pointermove', at.x, at.y));
      for (let frame = frames.shift(); frame; frame = frames.shift()) frame(0);
    });
    expect(onFaceHovered).toHaveBeenLastCalledWith({ face: C, origin: 'folded', input: 'pointer' });
  });

  it('a double tap fits, and picks nothing', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const onFacePicked = vi.fn();
    render({ marks: PICKED, onFacePicked });
    const readout = () => byRole(host, 'button', 'Reset the folded figure zoom').textContent;
    const fitted = readout();
    act(() => byRole(host, 'button', 'Zoom in the folded figure').click());
    runFrames();
    expect(readout()).not.toBe(fitted);
    const canvas = canvasOf('folded')!;
    const at = letterAt('folded', 'C');
    press(canvas, at, 'touch');
    press(canvas, at, 'touch');
    act(() => vi.advanceTimersByTime(DOUBLE_TAP_MS * 2));
    runFrames();
    expect(onFacePicked).not.toHaveBeenCalled();
    expect(readout()).toBe(fitted);
  });

  it('on a phone: one pane, nothing floats over it, and a switch keeps both canvases and their cameras', () => {
    const shown = (pane: 'pattern' | 'folded') => canvasOf(pane)!.closest('[hidden]') === null;
    render({ phonePane: 'crease' });
    const pattern = canvasOf('pattern')!;
    const folded = canvasOf('folded')!;
    expect([shown('pattern'), shown('folded')]).toEqual([true, false]);
    expect(queryByRole(host, 'toolbar', 'Crease pattern view')).toBeNull();
    render({ phonePane: 'folded' });
    expect([shown('pattern'), shown('folded')]).toEqual([false, true]);
    expect(allByRole(host, 'toolbar')).toEqual([]);
    render({ phonePane: 'crease' });
    render({ phonePane: 'folded' });
    // The same two canvases throughout: no pane remounted, so no new context and no camera reset.
    expect([canvasOf('pattern'), canvasOf('folded')]).toEqual([pattern, folded]);
    expect(channels.last.size).toBe(2);
  });

  it('refused or lost: the crease pattern alone; a face the refusal names marked in danger', () => {
    render({ status: { kind: 'refused', refusal: { code: 'source_non_convex_face', face: B }, limits: LIMITS } });
    expect(canvasOf('folded')).toBeNull();
    expect(lettersOn('pattern')).toEqual([{ letter: 'B', tone: 'danger', under: false }]);
    render({ status: { kind: 'lost', cause: 'failed', limits: LIMITS }, phonePane: 'folded' });
    expect(canvasOf('pattern')?.closest('[hidden]')).toBeNull();
    expect(canvasOf('folded')).toBeNull();
  });

  it('the flash fades once, and says so 1.6 s on, whichever pane shows', () => {
    vi.useFakeTimers();
    const onFlashEnded = vi.fn();
    const flash = { changed: { front: new Uint32Array([1]), back: new Uint32Array([1]) }, n: 4 };
    render({ marks: { ...NO_FACE_MARKS, flash }, onFlashEnded });
    expect(host.querySelector('[data-layer-order-flash="4"]')?.children).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1_599));
    expect(onFlashEnded).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onFlashEnded).toHaveBeenCalledWith(4);
  });

  it('a new flash callback each render neither restarts the fade nor misses its end', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const flash = { changed: { front: new Uint32Array([1]), back: new Uint32Array([1]) }, n: 5 };
    const first = vi.fn();
    const second = vi.fn();
    render({ marks: { ...NO_FACE_MARKS, flash }, onFlashEnded: first });
    act(() => vi.advanceTimersByTime(800));
    render({ marks: { ...NO_FACE_MARKS, flash }, onFlashEnded: second });
    act(() => vi.advanceTimersByTime(800));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(5);
  });

  describe('Fit: each pane fills itself with its own content', () => {
    /** Fit's zoom readout for content `width` by `height` (crease-pattern units) in the 400 px pane, at every pane's 70%. */
    const fitted = (width: number, height: number) =>
      `${Math.round(Math.min(VIEWPORT.width / width, VIEWPORT.height / height) * (DEFAULT_FIT_SHARE / PANE_USER_PER_UNIT) * 100)}%`;
    const readouts = () => [
      byRole(host, 'button', 'Reset the crease pattern zoom').textContent,
      byRole(host, 'button', 'Reset the folded figure zoom').textContent,
    ];
    /** Zoom both panes in, then Fit: what Fit frames now, wherever the camera was. */
    const zoomThenFit = () => {
      act(() => byRole(host, 'button', 'Zoom in the folded figure').click());
      act(() => byRole(host, 'button', 'Zoom in the crease pattern').click());
      runFrames();
      act(() => allByRole(host, 'button').find((button) => button.getAttribute('aria-label') === 'Fit both views')!.click());
      runFrames();
    };

    it('the strip, 40 by 10, on the crease pattern; the Z it folds to, 20 by 10, at twice the scale', () => {
      render();
      expect(readouts()).toEqual([fitted(40, 10), fitted(20, 10)]);
    });

    it('the folded figure from the back, and see-through, framed as itself', () => {
      render({ view: { side: 'back', xray: false, undecided: false, turnDeg: 0 } });
      zoomThenFit();
      expect(readouts()[1]).toBe(fitted(20, 10));
      render({ view: { side: 'front', xray: true, undecided: false, turnDeg: 0 } });
      zoomThenFit();
      expect(readouts()[1]).toBe(fitted(20, 10));
    });

    it('a region: its paper framed, and its own aux lines drawn, not the document’s other patterns', () => {
      // The strip sits in a document whose aux lines run across another pattern far off.
      const far = segment('Cyan3', 900, 900, 980, 940);
      const own = segment('Cyan3', 0, 5, 40, 5);
      const strokes = () => (channels.last.get(canvasOf('pattern')!)?.get('setStrokes') as { count: number }).count;
      const inDocument = { ...REQUEST, source: { ...REQUEST.source, auxSegments: [own, far] } };
      render({ request: inDocument });
      const withEvery = strokes();
      // The region's paper is its sheet, 40 by 80 here: a margin below the strip.
      const paper = [[{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 80 }, { x: 0, y: 80 }]];
      act(() => root.unmount());
      root = createRoot(host);
      render({ request: { ...inDocument, region: { paper, auxSegments: [own] } } });
      expect(strokes()).toBeLessThan(withEvery);
      expect(readouts()[0]).toBe(fitted(40, 80));
    });
  });

  it('X-ray draws every layer see-through, the buried ones too', () => {
    render();
    const opaque = channels.last.get(canvasOf('folded')!)?.get('setFolded') as { fills: { count: number; color: Float32Array } };
    render({ view: { side: 'front', xray: true, undecided: false, turnDeg: 0 } });
    const xray = channels.last.get(canvasOf('folded')!)?.get('setFolded') as { fills: { count: number; color: Float32Array } };
    expect(xray.fills.count).toBeGreaterThan(opaque.fills.count);
    expect(xray.fills.color[3]).toBeCloseTo(1 - 0.4 ** (1 / 3), 5);
  });
});
