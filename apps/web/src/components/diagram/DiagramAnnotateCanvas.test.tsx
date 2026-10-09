import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calloutShape, closeUpShape, NEW_CALLOUT_TEXT, pathCubics } from '../../diagram/annotate/annotationModel';
import { pendingFieldFocus } from '../../diagram/annotate/fieldFocus';
import { ANNOTATE_SELECTION_INK, ANNOTATION_INK_MM, mmInPictureUnits, ptInPictureUnits } from '../../diagram/annotate/canvasInk';
import { DIAGRAM_DIVISIONS_INK } from '../../cp-workspace/references/diagram/diagramInk';
import { setToolNotice, toolNotice } from '../../diagram/annotate/pickProgress';
import i18n from '../../i18n';
import { preloadLocale } from '../../test/preloadLocale';
import { nearestPathPoint, pathNodesOf } from '../../diagram/annotate/annotationPath';
import type { KnownDiagramAnnotation } from '../../diagram/document/diagramDocument';
import { CP_MODEL_TO_CSS } from '../../cp-workspace/snapRadius';
import { syncHeldModifiersFromEvent } from '../../keyboard/heldModifiers';
import { cubicPoint } from '../../lib/cubicBezier';
import { useSettingsStore } from '../../store/settingsStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { selectedDiagramPathNode } from '../../store/workspaceStore/diagramState';
import { TooltipProvider } from '../ui/Tooltip';
import { CIRCLE_RADIUS, INK_UNITS } from '../../diagram/annotate/useAnnotateCanvas';
import { transformBoxHandles } from '../../diagram/annotate/transformGrips';
import { pleatArrowInPicture, rightAngleGrips, rightAngleInPicture } from '../../diagram/annotate/annotationHit';
import { annotationDrawing } from '../../diagram/annotate/annotationPrimitives';
import { CARD_FRAME_PX } from '../../diagram/annotate/paintAnnotations';
import { rightAngleAt, rightAngleDiagonal } from '../../diagram/annotate/annotationModel';
import { DiagramAnnotateCanvas } from './DiagramAnnotateCanvas';
import { referencesStep, stepsIn } from '../../diagram/document/diagramSteps.fixtures';

import { ZOOM_SURROUND_DIM } from '../../diagram/zoom/paintZoomed';
import { ZOOM_FRAME_ID } from '../../diagram/zoom/zoomModel';
import { craneStep, imprintCase } from '../../diagram/zoom/zoom.fixtures';
import { watchFrames } from '../../diagram/zoom/zoomInvariant.fixtures';
import { paperFacesOf, toPicture } from '../../diagram/zoom/zoomImprint';
import { createDiagram, insertSteps } from '../../diagram/document/diagramDocument';

const tracked = vi.hoisted(() => ({
  trackDiagramAnnotationAdded: vi.fn(),
  trackDiagramArrowShaped: vi.fn(),
  trackDiagramEnlargementChanged: vi.fn(),
  trackDiagramMarkStyled: vi.fn(),
}));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  ...tracked,
}));

/** What Escape asks of the canvas: the cancel it registers, caught as it registers it. */
const gestures = vi.hoisted(() => ({ cancel: null as null | (() => boolean) }));
vi.mock('../../diagram/useDiagramShortcuts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../diagram/useDiagramShortcuts')>();
  return {
    ...actual,
    registerDiagramGestureCancel: (cancel: () => boolean) => {
      gestures.cancel = cancel;
      return actual.registerDiagramGestureCancel(cancel);
    },
  };
});

/** How many times the marks were drawn: `DiagramAnnotationLayer` draws them with `annotationMarks`. */
const marksDrawn = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../diagram/annotate/annotationPrimitives', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../diagram/annotate/annotationPrimitives')>();
  return {
    ...actual,
    annotationMarks: (...args: Parameters<typeof actual.annotationMarks>) => {
      marksDrawn.count += 1;
      return actual.annotationMarks(...args);
    },
  };
});

/** What the canvas asked its camera to bring into view, in world px: each rect, in turn. */
const camera = vi.hoisted(() => ({ revealed: [] as { x: number; y: number; width: number; height: number }[] }));
vi.mock('../../hooks/useViewportSurface', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useViewportSurface')>();
  const { useCallback } = await import('react');
  return {
    ...actual,
    useViewportSurface: (...args: Parameters<typeof actual.useViewportSurface>) => {
      const surface = actual.useViewportSurface(...args);
      const { bringIntoView } = surface;
      const asked = useCallback<typeof bringIntoView>(
        (rect, animationTime) => {
          camera.revealed.push(rect);
          bringIntoView(rect, animationTime);
        },
        [bringIntoView]
      );
      return { ...surface, bringIntoView: asked };
    },
  };
});

/**
 * The Annotate canvas's presses, through the store: what a drag, a click, a
 * second finger and a cancel each commit, and what they count. The overlay's
 * screen matrix is the identity, so a client point is a world point.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialState = useWorkspaceStore.getInitialState();
const state = () => useWorkspaceStore.getState();
let host: HTMLDivElement;
let root: Root;

const identity = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
  inverse() {
    return identity;
  },
};

// Every enlarged step's frame where its imprint lands, after every verb the canvas runs (Revision 2).
let frames: ReturnType<typeof watchFrames> | null = null;

beforeEach(() => {
  useWorkspaceStore.setState(initialState, true);
  frames = watchFrames(useWorkspaceStore.subscribe);
  // The Line tool draws a valley line unless a test picks another type, a solid one in the style's ink.
  useSettingsStore.setState({ diagramAnnotateLineType: 'valley', diagramAnnotateLineColor: null });
  // A label is put down in today's look unless a test chooses a Text Style (17b).
  useSettingsStore.setState({ diagramAnnotateTextStyle: { color: null, bold: false, halo: false, sizePt: null } });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal(
    'DOMPoint',
    class {
      constructor(
        public x: number,
        public y: number
      ) {}
      matrixTransform() {
        return { x: this.x, y: this.y };
      }
    }
  );
  (SVGElement.prototype as unknown as { getScreenCTM: () => typeof identity }).getScreenCTM = () => identity;
  Element.prototype.setPointerCapture = () => undefined;
  tracked.trackDiagramAnnotationAdded.mockClear();
  tracked.trackDiagramArrowShaped.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  frames?.stop();
  expect(frames?.problems).toEqual([]);
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

/** A step with a 400 × 300 picture, open in Annotate, and the canvas on it. */
function mount({ readOnly = false } = {}) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"/>';
  act(() => {
    state().addDiagramPictures([{ id: 'asset-1', kind: 'svg', svg, widthPx: 400, heightPx: 300, bytes: svg.length }]);
  });
  const stepId = state().diagramSelectedStepId!;
  act(() => {
    state().openDiagramStep(stepId, 'annotate');
  });
  rerender(readOnly);
  return stepId;
}

function rerender(readOnly = false) {
  const { diagram } = state();
  const step = stepsIn(diagram!).find((candidate) => candidate.id === state().diagramSelectedStepId)!;
  act(() =>
    root.render(
      <TooltipProvider>
        <DiagramAnnotateCanvas step={step} assets={diagram!.assets} style={diagram!.style} readOnly={readOnly} />
      </TooltipProvider>
    )
  );
}

const overlay = () => host.querySelector('svg[data-annotate-overlay]') as SVGSVGElement;
/** The camera's surface, the stage: the library's wrapper, which the view holds with the zoom pill over it. */
const stage = () => overlay().closest('.react-transform-wrapper') as HTMLDivElement;
const view = () => host.querySelector('[data-tool]') as HTMLDivElement;

/** Picture units to the client: the frame's group is translated, one unit 1000 world px. */
function at(u: number, v: number): [number, number] {
  const [, x, y] = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(overlay().querySelector(':scope > g')!.getAttribute('transform')!)!.map(Number);
  return [x! + u * 1000, y! + v * 1000];
}

/**
 * Modifier keys held — `free` is ⌘ or Ctrl, whichever the platform's accel
 * is — the buttons down, and how long after the last press this one comes (a
 * second apart unless said).
 */
interface PressInit {
  shiftKey?: boolean;
  altKey?: boolean;
  free?: boolean;
  buttons?: number;
  gapMs?: number;
}

/** The events' clock: presses a second apart are never a double-click. */
let clock = 0;

function pointer(
  type: string,
  [clientX, clientY]: [number, number],
  pointerId = 1,
  pointerType = 'mouse',
  target: Element = overlay(),
  { shiftKey = false, altKey = false, free = false, buttons = 0, gapMs = 1000 }: PressInit = {}
) {
  if (type === 'pointerdown') clock += gapMs;
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    button: 0,
    buttons,
    shiftKey,
    altKey,
    metaKey: free,
    ctrlKey: free,
  });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  Object.defineProperty(event, 'timeStamp', { value: clock });
  act(() => {
    target.dispatchEvent(event);
  });
}

function drag(
  from: [number, number],
  to: [number, number],
  pointerId = 1,
  pointerType = 'mouse',
  target: Element = overlay(),
  init: PressInit = {}
) {
  pointer('pointerdown', from, pointerId, pointerType, target, init);
  for (let i = 1; i <= 4; i += 1) {
    pointer(
      'pointermove',
      [from[0] + ((to[0] - from[0]) * i) / 4, from[1] + ((to[1] - from[1]) * i) / 4],
      pointerId,
      pointerType,
      target,
      init
    );
  }
  pointer('pointerup', to, pointerId, pointerType, target, init);
}

/** A `touchstart` with `fingers` touches down, as a browser sends one. */
function touchStart(target: Element, fingers: number) {
  const event = new Event('touchstart', { bubbles: true, cancelable: true });
  const touches = Array.from({ length: fingers }, (_, index) => {
    const at = { clientX: 100 + 50 * index, clientY: 100, pageX: 100 + 50 * index, pageY: 100 };
    return { ...at, identifier: index, target };
  });
  Object.defineProperty(event, 'touches', { value: touches });
  act(() => {
    target.dispatchEvent(event);
  });
}

const annotations = () => stepsIn(state().diagram!)[0]!.annotations as KnownDiagramAnnotation[];
const tool = (kind: Parameters<ReturnType<typeof state>['setDiagramAnnotateTool']>[0]) =>
  act(() => state().setDiagramAnnotateTool(kind));

describe('DiagramAnnotateCanvas', () => {
  it('draws an arrow with a drag, as one undo step, and counts it once by its tool', () => {
    mount();
    tool('valley-arrow');
    const past = state().diagramHistory.past.length;
    drag(at(0.2, 0.3), at(0.6, 0.3));
    expect(annotations()).toHaveLength(1);
    expect(annotations()[0]).toMatchObject({ kind: 'valley-arrow' });
    expect(annotations()[0]!.from[0]).toBeCloseTo(0.2, 3);
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([['valley_arrow', 'none']]);
  });

  it('lays a white arrow straight with a drag, in the template’s look, and counts it by its tool', () => {
    mount();
    tool('white-arrow');
    drag(at(0.2, 0.3), at(0.6, 0.5));
    expect(annotations()).toHaveLength(1);
    const [white] = annotations();
    expect(white).toMatchObject({ kind: 'white-arrow', width: 'regular', tail: 'pointed' });
    expect(white!.path).toHaveLength(2);
    expect(white!.path!.every((node) => node.in === undefined && node.out === undefined)).toBe(true);
    expect(white!.from[0]).toBeCloseTo(0.2, 3);
    expect(white!.to[1]).toBeCloseTo(0.5, 3);
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([['white_arrow', 'none']]);
    // A click is no arrow.
    const [x, y] = at(0.7, 0.7);
    pointer('pointerdown', [x, y]);
    pointer('pointerup', [x, y]);
    expect(annotations()).toHaveLength(1);
    // Drawn hollow, in the page's white.
    rerender();
    expect(overlay().innerHTML).toContain('stroke-miterlimit="1.5"');
  });

  it('lays a solid arrow with the Solid Arrow: a white arrow narrow, square-tailed and filled, counted as a solid arrow (15d)', () => {
    mount();
    tool('solid-arrow');
    drag(at(0.2, 0.3), at(0.6, 0.5));
    expect(annotations()).toHaveLength(1);
    const [solid] = annotations();
    expect(solid).toMatchObject({ kind: 'white-arrow', width: 'narrow', tail: 'square', fill: 'black' });
    expect(solid!.path).toHaveLength(2);
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([['solid_arrow', 'none']]);
    // The tool stays in hand, as a drawing tool does.
    expect(state().diagramAnnotateTool).toBe('solid-arrow');
    // The White Arrow still lays a white one.
    tool('white-arrow');
    drag(at(0.2, 0.7), at(0.6, 0.7));
    expect(annotations()[1]).not.toHaveProperty('fill');
    expect(tracked.trackDiagramAnnotationAdded.mock.calls.at(-1)).toEqual(['white_arrow', 'none']);
  });

  it('draws a pleat arrow straight with a drag, one Z unsaid, a bolt with its head, and selects it by its bolt (15c)', () => {
    mount();
    tool('pleat-arrow');
    drag(at(0.2, 0.3), at(0.6, 0.4));
    expect(annotations()).toHaveLength(1);
    const [pleat] = annotations();
    expect(Object.keys(pleat!).sort()).toEqual(['from', 'id', 'kind', 'to']);
    expect(pleat).toMatchObject({ kind: 'pleat-arrow' });
    expect(pleat!.from[0]).toBeCloseTo(0.2, 3);
    expect(pleat!.to[1]).toBeCloseTo(0.4, 3);
    // Never snapped, as no arrow is.
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([['pleat_arrow', 'none']]);
    // A click is no arrow.
    pointer('pointerdown', at(0.7, 0.7));
    pointer('pointerup', at(0.7, 0.7));
    expect(annotations()).toHaveLength(1);
    // Drawn as a bolt, its corners mitred, and a filled head.
    rerender();
    expect(overlay().innerHTML).toContain('stroke-linejoin="miter"');
    // Pressed with Select at its Z's far corner, it is selected.
    tool(null);
    const corner = pleatArrowInPicture(pleat!, INK_UNITS)!.bolt[2]!;
    pointer('pointerdown', at(corner.x, corner.y));
    pointer('pointerup', at(corner.x, corner.y));
    expect(state().diagramSelectedAnnotationId).toBe(pleat!.id);
  });

  it('puts a label down with a click, and draws nothing for a click with a line tool', () => {
    mount();
    tool('line');
    pointer('pointerdown', at(0.5, 0.5));
    pointer('pointerup', at(0.5, 0.5));
    expect(annotations()).toHaveLength(0);
    tool('label');
    pointer('pointerdown', at(0.5, 0.5));
    pointer('pointerup', at(0.5, 0.5));
    expect(annotations().map((annotation) => annotation.kind)).toEqual(['label']);
    // A label says its look (17b): today's, with no Text Style chosen.
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([
      ['label', 'none', { color: 'ink', bold: 'off', halo: 'off', size: 'picture' }],
    ]);
  });

  it('draws a line in the type the rail’s Line Type says, each its own kind (15a)', () => {
    mount();
    tool('line');
    drag(at(0.2, 0.3), at(0.6, 0.3));
    act(() => useSettingsStore.getState().setDiagramAnnotateLineType('mountain'));
    drag(at(0.2, 0.5), at(0.6, 0.5));
    act(() => useSettingsStore.getState().setDiagramAnnotateLineType('hidden'));
    drag(at(0.2, 0.7), at(0.6, 0.7));
    expect(annotations().map((annotation) => annotation.kind)).toEqual(['valley-line', 'mountain-line', 'hidden-line']);
    // Counted by what was drawn, as before Line: the event reads on.
    expect(tracked.trackDiagramAnnotationAdded.mock.calls.map(([kind]) => kind)).toEqual([
      'valley_line',
      'mountain_line',
      'hidden_line',
    ]);
    expect(state().diagramAnnotateTool).toBe('line');
  });

  it('draws a solid line in the colour beside the rail’s Line Type, counted by its name, never its value (17a)', () => {
    mount();
    tool('line');
    act(() => useSettingsStore.getState().setDiagramAnnotateLineType('solid'));
    drag(at(0.2, 0.3), at(0.6, 0.3));
    act(() => useSettingsStore.getState().setDiagramAnnotateLineColor('#2f9e44'));
    drag(at(0.2, 0.5), at(0.6, 0.5));
    act(() => useSettingsStore.getState().setDiagramAnnotateLineColor('#abcdef'));
    drag(at(0.2, 0.7), at(0.6, 0.7));
    expect(annotations().map(({ kind, color }) => [kind, color])).toEqual([
      ['solid-line', undefined],
      ['solid-line', '#2f9e44'],
      ['solid-line', '#abcdef'],
    ]);
    expect(Object.hasOwn(annotations()[0]!, 'color')).toBe(false);
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([
      ['solid_line', 'nothing_near', { color: 'ink' }],
      ['solid_line', 'nothing_near', { color: 'green' }],
      ['solid_line', 'nothing_near', { color: 'custom' }],
    ]);
    // Another type of line takes no colour, whatever the select says.
    act(() => useSettingsStore.getState().setDiagramAnnotateLineType('valley'));
    drag(at(0.2, 0.9), at(0.6, 0.9));
    expect(Object.hasOwn(annotations()[3]!, 'color')).toBe(false);
    expect(tracked.trackDiagramAnnotationAdded.mock.calls.at(-1)).toEqual(['valley_line', 'nothing_near']);
  });

  it('washes a selected solid line under its stroke, so the colour it is drawn in shows as it is (17a)', () => {
    mount();
    tool('line');
    act(() => {
      useSettingsStore.getState().setDiagramAnnotateLineType('solid');
      useSettingsStore.getState().setDiagramAnnotateLineColor('#e8590c');
    });
    drag(at(0.2, 0.3), at(0.6, 0.3));
    const [line] = annotations();
    expect(state().diagramSelectedAnnotationId).toBe(line!.id);
    rerender();
    const wash = overlay().querySelector('[data-selection-under]')!;
    const drawnLine = overlay().querySelector(`[data-annotation-id="${line!.id}"]`)!;
    expect(wash).not.toBeNull();
    // Painted before the line, so under it; nothing of the selection is laid over its stroke but its ends' dots.
    expect(wash.compareDocumentPosition(drawnLine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(overlay().querySelectorAll('[data-selection] polyline')).toHaveLength(0);
    const dots = [...overlay().querySelectorAll('[data-selection] [data-handle]')].map((dot) => dot.getAttribute('data-handle'));
    expect(dots.sort()).toEqual(['from', 'to']);
    // A valley line's wash is still over it: it is drawn in the diagram's pen, not a colour of its own.
    act(() => useSettingsStore.getState().setDiagramAnnotateLineType('valley'));
    drag(at(0.2, 0.6), at(0.6, 0.6));
    rerender();
    expect(overlay().querySelector('[data-selection-under]')).toBeNull();
    expect(overlay().querySelectorAll('[data-selection] polyline')).toHaveLength(1);
  });

  it('puts a circle down with a click, keeps the tool for the next, and washes its ring when selected', () => {
    mount();
    tool('circle');
    pointer('pointerdown', at(0.4, 0.3));
    pointer('pointerup', at(0.4, 0.3));
    expect(annotations()).toHaveLength(1);
    expect(annotations()[0]).toMatchObject({ kind: 'circle' });
    expect(annotations()[0]!.from[0]).toBeCloseTo(0.4, 3);
    expect(annotations()[0]!.to).toEqual(annotations()[0]!.from);
    expect(state().diagramAnnotateTool).toBe('circle');
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([['circle', 'nothing_near']]);
    // Drawn as References' ring, and selected: a wash along the ring, no ends to take hold of.
    rerender();
    expect(overlay().querySelector(`[data-annotation-id="${annotations()[0]!.id}"] circle`)).not.toBeNull();
    const wash = overlay().querySelector('circle[data-selection]');
    expect(Number(wash?.getAttribute('r'))).toBeCloseTo(CIRCLE_RADIUS * 1000, 6);
    expect(host.querySelector('[data-handle]')).toBeNull();
  });

  it('puts Select back in hand once a label is placed, and keeps a drawing tool after a stroke', () => {
    mount();
    tool('line');
    drag(at(0.2, 0.5), at(0.6, 0.5));
    expect(state().diagramAnnotateTool).toBe('line');
    tool('label');
    pointer('pointerdown', at(0.5, 0.2));
    pointer('pointerup', at(0.5, 0.2));
    expect(annotations().map((annotation) => annotation.kind)).toEqual(['valley-line', 'label']);
    expect(state().diagramAnnotateTool).toBeNull();
  });

  it('draws a callout from a point to where its box goes, as one undo step, its words then waiting in its field', () => {
    mount();
    tool('callout');
    const past = state().diagramHistory.past.length;
    drag(at(0.2, 0.6), at(0.55, 0.25));
    expect(annotations()).toHaveLength(1);
    const [callout] = annotations();
    expect(callout).toMatchObject({ kind: 'callout', text: NEW_CALLOUT_TEXT });
    expect(callout!.from[0]).toBeCloseTo(0.2, 3);
    expect(callout!.to[0]).toBeCloseTo(0.55, 3);
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([['callout', 'nothing_near']]);
    // Written, not drawn again: Select in hand, it selected, and its field asked for.
    expect(state().diagramAnnotateTool).toBeNull();
    expect(state().diagramSelectedAnnotationId).toBe(callout!.id);
    expect(pendingFieldFocus()).toEqual({ annotationId: callout!.id, field: 'text' });
    // Drawn: its line, its box and its words.
    rerender();
    const drawnCallout = overlay().querySelector(`[data-annotation-id="${callout!.id}"]`)!;
    expect(drawnCallout.querySelector('line')).not.toBeNull();
    expect(drawnCallout.querySelector('rect')).not.toBeNull();
    expect(drawnCallout.querySelector('text')?.textContent).toBe(NEW_CALLOUT_TEXT);
  });

  it('gives a new callout its words in the author’s language, which stay the author’s', async () => {
    preloadLocale('ja');
    i18n.addResourceBundle('ja', 'panels', { diagram: { annotations: { repeatBehind: '裏側も同様に' } } }, true, true);
    try {
      await act(() => i18n.changeLanguage('ja'));
      mount();
      tool('callout');
      drag(at(0.2, 0.6), at(0.55, 0.25));
      expect(annotations()[0]).toMatchObject({ kind: 'callout', text: '裏側も同様に' });
    } finally {
      await act(() => i18n.changeLanguage('en'));
    }
    // Written into the diagram: another language later leaves it as it is.
    expect(annotations()[0]!.text).toBe('裏側も同様に');
  });

  it('puts a callout down with a click, its box beside its point', () => {
    mount();
    tool('callout');
    pointer('pointerdown', at(0.2, 0.6));
    pointer('pointerup', at(0.2, 0.6));
    expect(annotations()).toHaveLength(1);
    const [callout] = annotations();
    expect(callout!.from).toEqual([expect.closeTo(0.2, 6), expect.closeTo(0.6, 6)]);
    // Away from the middle: up (the point is below it) and to the left.
    expect(callout!.to[0]).toBeLessThan(0.2);
    expect(callout!.to[1]).toBeGreaterThan(0.6);
    expect(calloutShape(callout!).line).not.toBeNull();
  });

  it('drops the stroke in hand for a second finger, a cancel or a lost capture', () => {
    mount();
    tool('line');
    pointer('pointerdown', at(0.2, 0.5), 1, 'touch');
    pointer('pointermove', at(0.4, 0.5), 1, 'touch');
    pointer('pointerdown', at(0.6, 0.5), 2, 'touch');
    pointer('pointermove', at(0.7, 0.6), 2, 'touch');
    pointer('pointerup', at(0.7, 0.6), 2, 'touch');
    pointer('pointerup', at(0.4, 0.5), 1, 'touch');
    expect(annotations()).toHaveLength(0);
    pointer('pointerdown', at(0.2, 0.5));
    pointer('pointermove', at(0.5, 0.5));
    pointer('lostpointercapture', at(0.5, 0.5));
    pointer('pointerup', at(0.5, 0.5));
    expect(annotations()).toHaveLength(0);
    expect(tracked.trackDiagramAnnotationAdded).not.toHaveBeenCalled();
  });

  it('moves an annotation it takes hold of, as one undo step, and counts nothing', () => {
    const stepId = mount();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', () => [
        { id: 'line', kind: 'valley-line', from: [0.2, 0.5], to: [0.6, 0.5] },
      ]);
    });
    rerender();
    const past = state().diagramHistory.past.length;
    drag(at(0.4, 0.5), at(0.4, 0.7));
    expect(annotations()[0]!.from[1]).toBeCloseTo(0.7, 3);
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(tracked.trackDiagramAnnotationAdded).not.toHaveBeenCalled();
  });

  it('keeps a move when an edit lands during it, and the edit with it', () => {
    const stepId = mount();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', () => [
        { id: 'label', kind: 'label', from: [0.3, 0.3], to: [0.3, 0.3], text: 'A' },
      ]);
    });
    rerender();
    pointer('pointerdown', at(0.3, 0.3));
    pointer('pointermove', at(0.4, 0.4));
    // The label's field commits mid-drag, and the step is a new object.
    act(() => {
      state().editDiagramAnnotations(stepId, 'Edit label', (list) => list.map((a) => ({ ...a, text: 'B' })));
      state().setDiagramStepText(stepId, 'Fold.');
    });
    rerender();
    pointer('pointermove', at(0.5, 0.5));
    pointer('pointerup', at(0.5, 0.5));
    expect(annotations()[0]).toMatchObject({ text: 'B' });
    expect(annotations()[0]!.from[0]).toBeCloseTo(0.5, 3);
  });

  it('selects without moving for a finger that drifts as it lifts', () => {
    const stepId = mount();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', () => [
        { id: 'line', kind: 'valley-line', from: [0.2, 0.5], to: [0.6, 0.5] },
      ]);
    });
    rerender();
    const past = state().diagramHistory.past.length;
    const [x, y] = at(0.4, 0.5);
    pointer('pointerdown', [x, y], 1, 'touch');
    pointer('pointermove', [x + 6, y], 1, 'touch');
    pointer('pointerup', [x + 6, y], 1, 'touch');
    expect(state().diagramSelectedAnnotationId).toBe('line');
    expect(state().diagramHistory.past).toHaveLength(past);
  });

  it('on a diagram that cannot change, selects but neither draws nor moves', () => {
    const stepId = mount();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', () => [
        { id: 'line', kind: 'valley-line', from: [0.2, 0.5], to: [0.6, 0.5] },
      ]);
    });
    rerender(true);
    drag(at(0.4, 0.5), at(0.4, 0.8));
    expect(state().diagramSelectedAnnotationId).toBe('line');
    expect(annotations()[0]!.from[1]).toBe(0.5);
    // Its ends are not offered to take hold of.
    expect(host.querySelector('[data-handle]')).toBeNull();
    tool('valley-arrow');
    drag(at(0.1, 0.1), at(0.5, 0.1));
    expect(annotations()).toHaveLength(1);
  });

  it('takes the keyboard to the canvas on a press, away from a field', () => {
    mount();
    const field = document.createElement('textarea');
    document.body.append(field);
    field.focus();
    pointer('pointerdown', at(0.5, 0.5));
    expect(document.activeElement).not.toBe(field);
    expect((document.activeElement as HTMLElement).contains(overlay())).toBe(true);
    field.remove();
  });

  it('drops a label’s waiting request for its field once another annotation is selected', async () => {
    const stepId = mount();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', () => [
        { id: 'label', kind: 'label', from: [0.3, 0.3], to: [0.3, 0.3], text: 'A' },
        { id: 'line', kind: 'valley-line', from: [0.2, 0.6], to: [0.6, 0.6] },
      ]);
    });
    rerender();
    const { requestFieldFocus } = await import('../../diagram/annotate/fieldFocus');
    act(() => {
      state().selectDiagramAnnotation('label');
      requestFieldFocus('label', 'text');
    });
    expect(pendingFieldFocus()?.annotationId).toBe('label');
    act(() => state().selectDiagramAnnotation('line'));
    expect(pendingFieldFocus()).toBeNull();
  });

  it('draws from a press anywhere on the stage, past the picture’s margin, no further out than reach', () => {
    mount();
    tool('valley-arrow');
    // Past the quarter frame the camera frames round the picture: the stage, not the overlay.
    drag(at(-0.8, 0.5), at(0.3, 0.5), 1, 'mouse', stage());
    expect(annotations()).toHaveLength(1);
    expect(annotations()[0]!.from[0]).toBeCloseTo(-0.8, 3);
    // Six frames out is past where an annotation may reach: it starts at the edge of reach.
    drag(at(-6, 0.2), at(0.3, 0.2), 1, 'mouse', stage());
    expect(annotations()).toHaveLength(2);
    expect(annotations()[1]!.from).toEqual([-4, expect.closeTo(0.2, 3)]);
  });

  it('leaves a press on the zoom pill to the pill, with a tool in hand', () => {
    mount();
    tool('valley-arrow');
    const pill = host.querySelector('[data-viewport-toolbar]')!;
    drag(at(0.2, 0.5), at(0.6, 0.5), 1, 'mouse', pill);
    expect(annotations()).toHaveLength(0);
    // The press after it, on the stage, draws as ever.
    drag(at(0.2, 0.5), at(0.6, 0.5), 1, 'mouse', stage());
    expect(annotations()).toHaveLength(1);
  });

  it('keeps one finger from the camera anywhere on the stage, and lets a second through to pinch', () => {
    mount();
    const seen: number[] = [];
    // Where the camera listens for its pans and pinches.
    stage().addEventListener('touchstart', (event) => seen.push((event as TouchEvent).touches.length));
    touchStart(stage(), 1);
    touchStart(overlay(), 1);
    touchStart(stage(), 2);
    expect(seen).toEqual([2]);
  });

  it('pinches on the stage past the margin without drawing, and pans with Space held', () => {
    mount();
    tool('line');
    pointer('pointerdown', at(-0.8, 0.5), 1, 'touch', stage());
    pointer('pointermove', at(-0.6, 0.5), 1, 'touch', stage());
    pointer('pointerdown', at(1.6, 0.5), 2, 'touch', stage());
    pointer('pointermove', at(1.4, 0.6), 2, 'touch', stage());
    pointer('pointerup', at(1.4, 0.6), 2, 'touch', stage());
    pointer('pointerup', at(-0.6, 0.5), 1, 'touch', stage());
    expect(annotations()).toHaveLength(0);
    // Space held: the press is the camera's (it pans on a left drag), not a stroke.
    act(() => {
      view().dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });
    expect(view().hasAttribute('data-space-pan')).toBe(true);
    drag(at(-0.8, 0.5), at(0.3, 0.5), 1, 'mouse', stage());
    expect(annotations()).toHaveLength(0);
    act(() => {
      view().dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
    });
    drag(at(-0.8, 0.5), at(0.3, 0.5), 1, 'mouse', stage());
    expect(annotations()).toHaveLength(1);
  });

  it('hits nothing with a press past reach, beside a mark left on the edge of reach', () => {
    const stepId = mount();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', () => [
        { id: 'edge', kind: 'valley-arrow', from: [-4, 0.2], to: [0.3, 0.2], bend: 0.2 },
      ]);
    });
    rerender();
    // Two frames past the arrow's tail, on its row: empty stage.
    pointer('pointerdown', at(-6, 0.2), 1, 'mouse', stage());
    pointer('pointerup', at(-6, 0.2), 1, 'mouse', stage());
    expect(state().diagramSelectedAnnotationId).toBeNull();
    // Selected, its tail is not taken from there either.
    act(() => state().selectDiagramAnnotation('edge'));
    drag(at(-6, 0.2), at(-6, 0.6), 1, 'mouse', stage());
    expect(annotations()[0]!.from).toEqual([-4, 0.2]);
    // Its tail, pressed where it is, still is.
    act(() => state().selectDiagramAnnotation('edge'));
    drag(at(-4, 0.2), at(-4, 0.6), 1, 'mouse', stage());
    expect(annotations()[0]!.from[1]).toBeCloseTo(0.6, 3);
  });

  it('holds a stroke’s pointer on the stage, whose cursor is the tool’s', () => {
    mount();
    tool('line');
    const holders: Element[] = [];
    Element.prototype.setPointerCapture = function capture(this: Element) {
      holders.push(this);
    };
    drag(at(0.2, 0.5), at(0.6, 0.5), 1, 'mouse', stage());
    expect(annotations()).toHaveLength(1);
    expect(holders).toEqual([stage()]);
  });

  it('sets its zoom pill on a solid ground, the stage being white in every theme', () => {
    mount();
    expect(host.querySelector('[data-viewport-toolbar]')?.getAttribute('data-tone')).toBe('raised');
  });
});

describe('DiagramAnnotateCanvas with a callout', () => {
  const callout: KnownDiagramAnnotation = { id: 'callout', kind: 'callout', from: [0.2, 0.6], to: [0.55, 0.25], text: 'Repeat behind' };

  function placed() {
    const stepId = mount();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', () => [callout]);
      state().selectDiagramAnnotation(null);
    });
    rerender();
    return stepId;
  }
  const now = () => annotations()[0]!;

  it('drags its box alone, by the pointer’s travel from wherever on it it was taken, as one undo step', () => {
    placed();
    const past = state().diagramHistory.past.length;
    // Off its middle, on a letter.
    drag(at(0.45, 0.26), at(0.5, 0.16));
    expect(now().from).toEqual([0.2, 0.6]);
    expect(now().to[0]).toBeCloseTo(0.6, 6);
    expect(now().to[1]).toBeCloseTo(0.15, 6);
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(state().diagramSelectedAnnotationId).toBe('callout');
  });

  it('drags its point alone once selected, and the whole by its line', () => {
    placed();
    act(() => state().selectDiagramAnnotation('callout'));
    rerender();
    // Selected: a dot at its point, none at its box's middle; its box and line washed.
    expect([...host.querySelectorAll('[data-handle]')].map((each) => each.getAttribute('data-handle'))).toEqual(['from']);
    // Its box washed along its outline as drawn, the pen outside the box the words were measured for (review).
    const washed = overlay().querySelector('[data-callout-box]')!;
    const { box } = annotationDrawing([now()], { width: 1, height: 1 }, CARD_FRAME_PX, state().diagram!.style).callouts[0]!;
    const [x, y] = at(box.x / CARD_FRAME_PX, box.y / CARD_FRAME_PX);
    expect(Number(washed.getAttribute('x'))).toBeCloseTo(x, 6);
    expect(Number(washed.getAttribute('y'))).toBeCloseTo(y, 6);
    expect(Number(washed.getAttribute('width'))).toBeCloseTo((box.width / CARD_FRAME_PX) * 1000, 6);
    expect(Number(washed.getAttribute('height'))).toBeCloseTo((box.height / CARD_FRAME_PX) * 1000, 6);
    expect(box.width / CARD_FRAME_PX).toBeGreaterThan(calloutShape(now()).box.width);
    drag(at(0.2, 0.6), at(0.1, 0.7));
    expect(now().from).toEqual([expect.closeTo(0.1, 6), expect.closeTo(0.7, 6)]);
    expect(now().to).toEqual([0.55, 0.25]);
    // On its line, halfway: both go.
    const { line } = calloutShape(now());
    const middle: [number, number] = [(line![0][0] + line![1][0]) / 2, (line![0][1] + line![1][1]) / 2];
    const past = state().diagramHistory.past.length;
    drag(at(...middle), at(middle[0] + 0.05, middle[1] + 0.05));
    expect(now().from).toEqual([expect.closeTo(0.15, 6), expect.closeTo(0.75, 6)]);
    expect(now().to).toEqual([expect.closeTo(0.6, 6), expect.closeTo(0.3, 6)]);
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(tracked.trackDiagramAnnotationAdded).not.toHaveBeenCalled();
  });

  it('selects it by its box with a click, moving nothing', () => {
    placed();
    pointer('pointerdown', at(0.55, 0.25));
    pointer('pointerup', at(0.55, 0.25));
    expect(state().diagramSelectedAnnotationId).toBe('callout');
    expect(now()).toEqual(callout);
  });
});

describe('DiagramAnnotateCanvas in Edit Path', () => {
  /** A half circle: three nodes when Edit Path shows it. */
  const HALF: KnownDiagramAnnotation = { id: 'v', kind: 'valley-arrow', from: [0.2, 0.5], to: [0.6, 0.5], bend: 0.5 };

  /** The step with `annotation` selected and a tool in hand (Edit Path unless said). */
  function shaping(annotation: KnownDiagramAnnotation = HALF, toolInHand: Parameters<typeof tool>[0] = 'edit-path') {
    const stepId = mount();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', () => [annotation]);
      state().selectDiagramAnnotation(annotation.id);
      state().setDiagramAnnotateTool(toolInHand);
    });
    rerender();
    return stepId;
  }
  /** A gesture, and the canvas drawn again with the step it left — as the panel does. */
  const then = (gesture: () => void) => {
    gesture();
    rerender();
  };
  const click = (point: [number, number], init: PressInit = {}) =>
    then(() => {
      pointer('pointerdown', point, 1, 'mouse', overlay(), init);
      pointer('pointerup', point, 1, 'mouse', overlay(), init);
    });
  const doubleClick = (point: [number, number]) =>
    then(() => {
      pointer('pointerdown', point);
      pointer('pointerup', point);
      rerender();
      pointer('pointerdown', point, 1, 'mouse', overlay(), { gapMs: 120 });
      pointer('pointerup', point);
    });
  const shown = () => pathNodesOf(annotations()[0]!)!;
  const nodeAt = (index: number) => at(shown()[index]!.at[0], shown()[index]!.at[1]);
  const curveAt = (segment: number, t: number) => {
    const [x, y] = cubicPoint(pathCubics(shown())[segment]!, t);
    return at(x, y);
  };
  const past = () => state().diagramHistory.past.length;
  const selectedNode = () => state().diagramSelectedPathNode?.node ?? null;
  const angle = (from: readonly number[], to: readonly number[]) => Math.atan2(to[1]! - from[1]!, to[0]! - from[0]!);

  it('shows an arc’s nodes without shaping it, and its handles once a node is selected', () => {
    shaping();
    expect(host.querySelectorAll('[data-path-node]')).toHaveLength(3);
    expect(host.querySelector('[data-handle]')).toBeNull();
    expect(host.querySelector('[data-path-handle]')).toBeNull();
    click(nodeAt(1));
    expect(selectedNode()).toBe(1);
    expect(annotations()[0]).toEqual(HALF);
    expect(host.querySelector('[data-path-node="1"]')?.hasAttribute('data-selected')).toBe(true);
    // The middle node's two handles, and each end's facing one.
    expect([...host.querySelectorAll('[data-path-handle]')].map((handle) => handle.getAttribute('data-path-handle'))).toEqual([
      '0-out',
      '1-in',
      '1-out',
      '2-in',
    ]);
    // With Select, its ends' dots again.
    tool(null);
    expect(host.querySelector('[data-path-node]')).toBeNull();
    expect(host.querySelectorAll('[data-handle]')).toHaveLength(2);
  });

  it('drags a node as one undo step, shaping the arc and counting it once', () => {
    shaping();
    const before = past();
    then(() => drag(nodeAt(2), at(0.6, 0.6)));
    expect(annotations()[0]!.bend).toBeUndefined();
    expect(annotations()[0]!.to[1]).toBeCloseTo(0.6, 3);
    expect(annotations()[0]!.path).toHaveLength(3);
    expect(past()).toBe(before + 1);
    expect(selectedNode()).toBe(2);
    expect(tracked.trackDiagramArrowShaped.mock.calls).toEqual([['valley_arrow', 'drag_node']]);
    then(() => drag(nodeAt(0), at(0.2, 0.45)));
    expect(annotations()[0]!.from[1]).toBeCloseTo(0.45, 3);
    expect(tracked.trackDiagramArrowShaped).toHaveBeenCalledOnce();
    expect(tracked.trackDiagramAnnotationAdded).not.toHaveBeenCalled();
  });

  it('keeps a node to 0, 45 or 90° from where it started with Shift', () => {
    shaping();
    const [x, y] = nodeAt(2);
    then(() => drag([x, y], [x + 50, y + 34], 1, 'mouse', overlay(), { shiftKey: true }));
    const tip = annotations()[0]!.to;
    expect(tip[0] - 0.6).toBeCloseTo(0.042, 3);
    expect(tip[1] - 0.5).toBeCloseTo(tip[0] - 0.6, 9);
  });

  it('drags a handle: a smooth node’s other turns with it; with Alt the node is a corner and the other stays', () => {
    shaping();
    click(nodeAt(1));
    const middle = shown()[1]!;
    then(() => drag(at(middle.out![0], middle.out![1]), at(middle.out![0], middle.out![1] + 0.05)));
    let node = shown()[1]!;
    expect(node.type).toBeUndefined();
    expect(Math.abs(angle(node.at, node.in!) - angle(node.out!, node.at))).toBeLessThan(1e-9);
    expect(tracked.trackDiagramArrowShaped.mock.calls).toEqual([['valley_arrow', 'drag_handle']]);
    const before = node;
    then(() =>
      drag(at(node.out![0], node.out![1]), at(node.out![0] + 0.03, node.out![1]), 1, 'mouse', overlay(), { altKey: true })
    );
    node = shown()[1]!;
    expect(node.type).toBe('corner');
    expect(node.in).toEqual(before.in);
    expect(node.out![0]).toBeCloseTo(before.out![0] + 0.03, 3);
  });

  it('bends the curve where it is dragged, the point pressed following the pointer', () => {
    shaping();
    const start = curveAt(0, 0.5);
    const before = past();
    then(() => drag(start, [start[0], start[1] + 40]));
    const [x, y] = cubicPoint(pathCubics(annotations()[0]!.path!)[0]!, 0.5);
    expect(at(x, y)[0]).toBeCloseTo(start[0], 0);
    expect(at(x, y)[1]).toBeCloseTo(start[1] + 40, 0);
    expect(past()).toBe(before + 1);
    expect(tracked.trackDiagramArrowShaped.mock.calls).toEqual([['valley_arrow', 'bend']]);
  });

  it('adds a node with a click on the curve, the curve unchanged, and selects it', () => {
    shaping();
    const before = past();
    const outline = pathCubics(shown()).flatMap((cubic) => [0.1, 0.3, 0.5, 0.7, 0.9].map((t) => cubicPoint(cubic, t)));
    click(curveAt(1, 0.4));
    expect(annotations()[0]!.path).toHaveLength(4);
    expect(past()).toBe(before + 1);
    expect(selectedNode()).toBe(2);
    const arrow = annotations()[0]!;
    for (const point of outline) {
      expect(nearestPathPoint(arrow, [point[0], point[1]])!.distance).toBeLessThan(1e-6);
    }
    expect(tracked.trackDiagramArrowShaped.mock.calls).toEqual([['valley_arrow', 'add_node']]);
  });

  it('turns a node corner and smooth with a double-click, its first click adding nothing', () => {
    shaping();
    const before = past();
    doubleClick(nodeAt(1));
    expect(shown()).toHaveLength(3);
    expect(shown()[1]!.type).toBe('corner');
    expect(past()).toBe(before + 1);
    doubleClick(nodeAt(1));
    expect(shown()[1]!.type).toBeUndefined();
    expect(past()).toBe(before + 2);
    // Beside the node, on the curve but within the node's reach: still the node, no node added.
    const [x, y] = nodeAt(1);
    doubleClick([x + 5, y]);
    expect(shown()).toHaveLength(3);
    expect(shown()[1]!.type).toBe('corner');
  });

  it('adds one smooth node for a double-click on the curve: the second click neither adds nor turns it', () => {
    shaping();
    const before = past();
    doubleClick(curveAt(0, 0.5));
    expect(shown()).toHaveLength(4);
    expect(shown().map((node) => node.type ?? 'smooth')).toEqual(['smooth', 'smooth', 'smooth', 'smooth']);
    expect(past()).toBe(before + 1);
  });

  it('lets a drag go when an undo changes the arrow under it, and lands nothing', () => {
    shaping();
    click(curveAt(0, 0.5));
    expect(shown()).toHaveLength(4);
    pointer('pointerdown', nodeAt(0));
    pointer('pointermove', at(0.25, 0.4));
    act(() => {
      state().undoDiagram();
    });
    rerender();
    const undone = annotations()[0]!;
    expect(undone).toEqual(HALF);
    const after = past();
    pointer('pointermove', at(0.3, 0.35));
    pointer('pointerup', at(0.3, 0.35));
    rerender();
    expect(annotations()[0]).toBe(undone);
    expect(past()).toBe(after);
    // The node selected against four nodes reads as none against three.
    expect(selectedDiagramPathNode(state())).toBeNull();
  });

  it('with a kind that is not shaped selected, shows no nodes and moves nothing', () => {
    shaping({ id: 'p', kind: 'push-arrow', from: [0.2, 0.5], to: [0.6, 0.5] });
    expect(host.querySelector('[data-path-node]')).toBeNull();
    // Its wash, but no end dots: Edit Path would not move them.
    expect(host.querySelector('[data-selection]')).not.toBeNull();
    expect(host.querySelector('[data-handle]')).toBeNull();
    const before = past();
    then(() => drag(at(0.4, 0.5), at(0.4, 0.7)));
    expect(annotations()[0]!.from).toEqual([0.2, 0.5]);
    expect(past()).toBe(before);
    expect(state().diagramSelectedAnnotationId).toBe('p');
  });

  it('deselects the node first, then the arrow, for presses on the empty stage', () => {
    shaping();
    click(nodeAt(1));
    click(at(0.4, 0.9));
    expect(selectedNode()).toBeNull();
    expect(state().diagramSelectedAnnotationId).toBe('v');
    click(at(0.4, 0.9));
    expect(state().diagramSelectedAnnotationId).toBeNull();
  });

  it('picks Edit Path up for a double-click on a fold arrow with Select, moving nothing', () => {
    shaping(HALF, null);
    const before = past();
    doubleClick(nodeAt(2));
    expect(state().diagramAnnotateTool).toBe('edit-path');
    expect(state().diagramSelectedAnnotationId).toBe('v');
    expect(annotations()[0]).toEqual(HALF);
    expect(past()).toBe(before);
    // A line is not shaped: a double-click on one keeps Select.
    tool(null);
    act(() => {
      state().editDiagramAnnotations(state().diagramSelectedStepId!, 'Add annotation', (list) => [
        ...list,
        { id: 'l', kind: 'valley-line', from: [0.2, 0.8], to: [0.6, 0.8] },
      ]);
    });
    rerender();
    doubleClick(at(0.4, 0.8));
    expect(state().diagramAnnotateTool).toBeNull();
    expect(state().diagramSelectedAnnotationId).toBe('l');
  });

  it('shapes a white arrow as it does a fold arrow: its two nodes, then its curve bent, counted once as a white arrow', () => {
    const WHITE: KnownDiagramAnnotation = {
      id: 'w',
      kind: 'white-arrow',
      from: [0.2, 0.5],
      to: [0.6, 0.5],
      path: [{ at: [0.2, 0.5] }, { at: [0.6, 0.5] }],
      width: 'narrow',
      tail: 'square',
    };
    // Select picks Edit Path up for a double-click on it, as on a fold arrow.
    shaping(WHITE, null);
    doubleClick(at(0.4, 0.5));
    expect(state().diagramAnnotateTool).toBe('edit-path');
    expect(annotations()[0]).toEqual(WHITE);
    rerender();
    expect(host.querySelectorAll('[data-path-node]')).toHaveLength(2);
    const before = past();
    then(() => drag(curveAt(0, 0.5), at(0.4, 0.35)));
    const [x, y] = cubicPoint(pathCubics(annotations()[0]!.path!)[0]!, 0.5);
    expect(x).toBeCloseTo(0.4, 3);
    expect(y).toBeCloseTo(0.35, 3);
    expect(annotations()[0]).toMatchObject({ kind: 'white-arrow', width: 'narrow', tail: 'square', from: [0.2, 0.5], to: [0.6, 0.5] });
    expect(past()).toBe(before + 1);
    expect(tracked.trackDiagramArrowShaped.mock.calls).toEqual([['white_arrow', 'bend']]);
    then(() => drag(nodeAt(1), at(0.65, 0.55)));
    expect(tracked.trackDiagramArrowShaped).toHaveBeenCalledOnce();
  });

  it('counts a third quick click as a click, and two double-clicks in a row as two', () => {
    shaping();
    const before = past();
    const node = nodeAt(1);
    then(() => {
      pointer('pointerdown', node);
      pointer('pointerup', node);
      rerender();
      pointer('pointerdown', node, 1, 'mouse', overlay(), { gapMs: 120 });
      pointer('pointerup', node);
      rerender();
      pointer('pointerdown', node, 1, 'mouse', overlay(), { gapMs: 120 });
      pointer('pointerup', node);
    });
    // One double-click and a click: a corner, once.
    expect(shown()[1]!.type).toBe('corner');
    expect(past()).toBe(before + 1);
    // Another double-click straight after, turning it back.
    then(() => {
      pointer('pointerdown', node, 1, 'mouse', overlay(), { gapMs: 300 });
      pointer('pointerup', node);
      rerender();
      pointer('pointerdown', node, 1, 'mouse', overlay(), { gapMs: 120 });
      pointer('pointerup', node);
    });
    expect(shown()[1]!.type).toBeUndefined();
    expect(past()).toBe(before + 2);
  });

  it('picks a node with the click that follows a Select double-click, shaping nothing', () => {
    shaping(HALF, null);
    const before = past();
    // On the arc's middle, where Edit Path's middle node will be.
    doubleClick(nodeAt(1));
    expect(state().diagramAnnotateTool).toBe('edit-path');
    click(nodeAt(1), { gapMs: 250 });
    expect(selectedNode()).toBe(1);
    expect(annotations()[0]).toEqual(HALF);
    expect(past()).toBe(before);
  });

  it('only picks an arrow it is double-clicked onto in Edit Path, as Select does', () => {
    shaping();
    act(() => state().selectDiagramAnnotation(null));
    rerender();
    const before = past();
    doubleClick(curveAt(0, 0.5));
    expect(state().diagramSelectedAnnotationId).toBe('v');
    act(() => state().selectDiagramAnnotation(null));
    rerender();
    doubleClick(nodeAt(1));
    expect(state().diagramSelectedAnnotationId).toBe('v');
    expect(annotations()[0]).toEqual(HALF);
    expect(past()).toBe(before);
    expect(tracked.trackDiagramArrowShaped).not.toHaveBeenCalled();
  });

  it('lands a drag where its preview showed it, a modifier let go after the last move', () => {
    shaping();
    const [x, y] = nodeAt(2);
    const to: [number, number] = [x + 50, y + 34];
    then(() => {
      pointer('pointerdown', [x, y], 1, 'mouse', overlay(), { shiftKey: true });
      for (let i = 1; i <= 4; i += 1) {
        pointer('pointermove', [x + (50 * i) / 4, y + (34 * i) / 4], 1, 'mouse', overlay(), { shiftKey: true });
      }
      // Shift let go, then the button: the 45° the preview showed lands.
      pointer('pointerup', to, 1, 'mouse', overlay(), { shiftKey: false });
    });
    const tip = annotations()[0]!.to;
    expect(tip[1] - 0.5).toBeCloseTo(tip[0] - 0.6, 9);
  });

  it('shows no drawing crosshair with Edit Path, which draws nothing', () => {
    shaping();
    expect(view().hasAttribute('data-draws')).toBe(false);
    tool('valley-arrow');
    expect(view().hasAttribute('data-draws')).toBe(true);
  });

  it('on a diagram that cannot change, selects a node but shapes nothing', () => {
    shaping();
    rerender(true);
    const before = past();
    // Each press drawn again read-only, as the panel would: the helpers above draw a writable canvas.
    drag(nodeAt(1), at(0.4, 0.2));
    rerender(true);
    const onCurve = curveAt(0, 0.5);
    pointer('pointerdown', onCurve);
    pointer('pointerup', onCurve);
    rerender(true);
    const node = nodeAt(1);
    pointer('pointerdown', node);
    pointer('pointerup', node);
    rerender(true);
    pointer('pointerdown', node, 1, 'mouse', overlay(), { gapMs: 120 });
    pointer('pointerup', node);
    rerender(true);
    expect(annotations()[0]).toEqual(HALF);
    expect(past()).toBe(before);
    expect(selectedNode()).toBe(1);
  });

  it('never snaps a node, an end included, onto a point (decision 9)', () => {
    const stepId = shaping();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', (list) => [
        ...list,
        { id: 'c', kind: 'circle', from: [0.65, 0.5], to: [0.65, 0.5] },
      ]);
      state().selectDiagramAnnotation('v');
    });
    rerender();
    // The tip, dragged to 0.006 from the circle's centre: well within the snap radius.
    then(() => drag(nodeAt(2), at(0.644, 0.504)));
    expect(annotations()[0]!.to[0]).toBeCloseTo(0.644, 4);
    expect(annotations()[0]!.to[1]).toBeCloseTo(0.504, 4);
  });
});

describe('DiagramAnnotateCanvas snapping (decision 9)', () => {
  /** Edit's default radius (10 model units) at 100%: 14.7 CSS px, a thousandth of a frame per px here. */
  const RADIUS = (10 * CP_MODEL_TO_CSS) / 1000;
  const line: KnownDiagramAnnotation = { id: 'line', kind: 'valley-line', from: [0.2, 0.5], to: [0.6, 0.5] };

  beforeEach(() => {
    useSettingsStore.setState({ diagramAnnotateSnap: true, cpSnapRadius: 10 });
    marksDrawn.count = 0;
  });

  /** The step with these annotations, and a tool in hand. */
  function drawn(list: KnownDiagramAnnotation[], toolInHand: Parameters<typeof tool>[0] = null) {
    const stepId = mount();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', () => list);
      state().selectDiagramAnnotation(null);
      state().setDiagramAnnotateTool(toolInHand);
    });
    rerender();
    return stepId;
  }
  const click = (point: [number, number], init: PressInit = {}, pointerType = 'mouse') => {
    pointer('pointerdown', point, 1, pointerType, overlay(), init);
    pointer('pointerup', point, 1, pointerType, overlay(), init);
    rerender();
  };
  const last = () => annotations()[annotations().length - 1]!;
  const targets = () => [...overlay().querySelectorAll('[data-snap-target]')].map((each) => each.getAttribute('data-snap-target'));

  it('puts a circle on a point within Edit’s snap radius, and where it was put past it', () => {
    expect(RADIUS).toBeCloseTo(0.0147, 4);
    drawn([line], 'circle');
    click(at(0.61, 0.505));
    expect(last()).toMatchObject({ kind: 'circle', from: [0.6, 0.5], to: [0.6, 0.5] });
    // 0.017 from the line's other end: past the radius.
    click(at(0.212, 0.512));
    expect(last().from[0]).toBeCloseTo(0.212, 6);
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([
      ['circle', 'snapped'],
      ['circle', 'nothing_near'],
    ]);
  });

  it('lands a line on two circles: its first end as it is pressed, its second as it moves and where it is let go', () => {
    drawn(
      [
        { id: 'a', kind: 'circle', from: [0.3, 0.4], to: [0.3, 0.4] },
        { id: 'b', kind: 'circle', from: [0.6, 0.4], to: [0.6, 0.4] },
      ],
      'line'
    );
    pointer('pointerdown', at(0.308, 0.394));
    // Shown at the press, before any move: a circle's centre is a point the picture marks (17d).
    expect(targets()).toEqual(['point']);
    pointer('pointermove', at(0.45, 0.42));
    expect(targets()).toEqual(['point']);
    pointer('pointermove', at(0.593, 0.405));
    // Both ends, each on its circle.
    expect(targets()).toEqual(['point', 'point']);
    const draft = overlay().querySelectorAll('[data-annotation-id="annotation-draft"]');
    expect(draft).toHaveLength(1);
    pointer('pointerup', at(0.594, 0.406));
    rerender();
    expect(last()).toMatchObject({ kind: 'valley-line', from: [0.3, 0.4], to: [0.6, 0.4] });
    expect(targets()).toEqual([]);
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([['valley_line', 'snapped']]);
  });

  it('draws an arrow where it is drawn, its ends pulled onto no point near them, nothing shown to land on (Zach)', () => {
    drawn(
      [
        { id: 'a', kind: 'circle', from: [0.3, 0.4], to: [0.3, 0.4] },
        { id: 'b', kind: 'circle', from: [0.6, 0.4], to: [0.6, 0.4] },
        line,
      ],
      'valley-arrow'
    );
    // Hovering near a point shows nothing to land on.
    pointer('pointermove', at(0.308, 0.394));
    expect(targets()).toEqual([]);
    pointer('pointerdown', at(0.308, 0.394));
    expect(targets()).toEqual([]);
    pointer('pointermove', at(0.593, 0.405));
    expect(targets()).toEqual([]);
    pointer('pointerup', at(0.594, 0.406));
    rerender();
    expect(last().kind).toBe('valley-arrow');
    expect(last().from).toEqual([expect.closeTo(0.308, 6), expect.closeTo(0.394, 6)]);
    expect(last().to).toEqual([expect.closeTo(0.594, 6), expect.closeTo(0.406, 6)]);
    // Its end dragged with Select near a line's end stays where it is let go too.
    const arrow = last().id;
    tool(null);
    act(() => state().selectDiagramAnnotation(arrow));
    rerender();
    drag(at(0.594, 0.406), at(0.603, 0.497));
    rerender();
    expect(last().id).toBe(arrow);
    expect(last().to).toEqual([expect.closeTo(0.603, 6), expect.closeTo(0.497, 6)]);
    for (const kind of ['mountain-arrow', 'fold-unfold-arrow', 'push-arrow', 'white-arrow'] as const) {
      tool(kind);
      drag(at(0.308, 0.394), at(0.594, 0.406));
      rerender();
      expect(last().kind, kind).toBe(kind);
      expect(last().from, kind).toEqual([expect.closeTo(0.308, 6), expect.closeTo(0.394, 6)]);
    }
    expect(tracked.trackDiagramAnnotationAdded.mock.calls.map(([, snap]) => snap)).toEqual(['none', 'none', 'none', 'none', 'none']);
  });

  it('puts a circle on the point beside an arrow’s free end, never on the end, though it is nearer', () => {
    // An arrow drawn to a few thousandths off the line's end, as one is drawn.
    const arrow: KnownDiagramAnnotation = { id: 'arrow', kind: 'valley-arrow', from: [0.3, 0.3], to: [0.603, 0.497] };
    drawn([line, arrow], 'circle');
    pointer('pointermove', at(0.605, 0.495));
    expect(targets()).toEqual(['annotation']);
    click(at(0.605, 0.495));
    // The line's end, 0.007 away, and not the arrow's tip, 0.003 away.
    expect(last()).toMatchObject({ kind: 'circle', from: [0.6, 0.5], to: [0.6, 0.5] });
    // Nothing else near the arrow's tail: the circle goes where it is put.
    click(at(0.302, 0.301));
    expect(last().from).toEqual([expect.closeTo(0.302, 6), expect.closeTo(0.301, 6)]);
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([
      ['circle', 'snapped'],
      ['circle', 'nothing_near'],
    ]);
  });

  it('puts a mark down where the pointer is with ⌘ (Ctrl) held, and anywhere with the switch off', () => {
    drawn([line], 'line');
    drag(at(0.605, 0.505), at(0.3, 0.7), 1, 'mouse', overlay(), { free: true });
    rerender();
    expect(last().from).toEqual([expect.closeTo(0.605, 6), expect.closeTo(0.505, 6)]);
    act(() => useSettingsStore.getState().setDiagramAnnotateSnap(false));
    rerender();
    tool('circle');
    click(at(0.605, 0.505));
    expect(last().from).toEqual([expect.closeTo(0.605, 6), expect.closeTo(0.505, 6)]);
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([
      ['valley_line', 'free'],
      ['circle', 'off'],
    ]);
  });

  it('drags a line’s end onto a point with Select, never onto the line itself', () => {
    drawn([line, { id: 'c', kind: 'circle', from: [0.7, 0.56], to: [0.7, 0.56] }]);
    act(() => state().selectDiagramAnnotation('line'));
    rerender();
    drag(at(0.6, 0.5), at(0.706, 0.553));
    rerender();
    expect(annotations()[0]!.to).toEqual([0.7, 0.56]);
    // A short drag from where the end is: its own old place is not a target.
    act(() => state().selectDiagramAnnotation('line'));
    rerender();
    drag(at(0.2, 0.5), at(0.208, 0.5));
    rerender();
    expect(annotations()[0]!.from[0]).toBeCloseTo(0.208, 6);
  });

  it('snaps a callout’s point where it is pressed, and its point dragged, never its box', () => {
    drawn([line], 'callout');
    // Pressed beside the line's end, let go beside its other: the point lands on the end, the box where it was let go.
    pointer('pointerdown', at(0.605, 0.505));
    expect(targets()).toEqual(['annotation']);
    pointer('pointermove', at(0.4, 0.4));
    pointer('pointermove', at(0.205, 0.503));
    // Only the point's target: the box is no point.
    expect(targets()).toEqual(['annotation']);
    pointer('pointerup', at(0.205, 0.503));
    rerender();
    expect(last()).toMatchObject({ kind: 'callout', from: [0.6, 0.5] });
    expect(last().to).toEqual([expect.closeTo(0.205, 6), expect.closeTo(0.503, 6)]);
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([['callout', 'snapped']]);
    // Its point dragged onto the line's other end.
    act(() => state().selectDiagramAnnotation(last().id));
    rerender();
    drag(at(0.6, 0.5), at(0.206, 0.497));
    rerender();
    expect(last().from).toEqual([0.2, 0.5]);
    // Its box — taken clear of its point, which lies under it — dragged so its middle comes
    // beside the line's end: it stays where it is let go.
    const box = last().to;
    drag(at(box[0] + 0.03, box[1]), at(0.633, 0.502));
    rerender();
    expect(last().to).toEqual([expect.closeTo(0.603, 6), expect.closeTo(0.502, 6)]);
  });

  it('puts a callout clicked beside a point on it, its box beside it, not at the pointer', () => {
    drawn([line], 'callout');
    // Zoomed out to half: the snap radius is 0.029 of the frame, more than a slip's length.
    (SVGElement.prototype as unknown as { getScreenCTM: () => typeof identity }).getScreenCTM = () => ({ ...identity, a: 0.5, d: 0.5 });
    // 0.025 off the line's end: the press lands on the end.
    click(at(0.625, 0.5));
    expect(last()).toMatchObject({ kind: 'callout', from: [0.6, 0.5] });
    // A click, however far its press snapped: the box beside the point, not on it where the
    // pointer was — below and to the right, away from the frame's middle.
    expect(calloutShape(last()).line).not.toBeNull();
    expect(last().to[0]).toBeGreaterThan(0.6 + 0.1);
    expect(last().to[1]).toBeGreaterThan(0.5 + 0.05);
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([['callout', 'snapped']]);
  });

  it('moves a circle whole onto a point: its centre snaps, wherever on its ring it was taken', () => {
    drawn([line, { id: 'c', kind: 'circle', from: [0.3, 0.3], to: [0.3, 0.3] }]);
    drag(at(0.3 + CIRCLE_RADIUS, 0.3), at(0.595 + CIRCLE_RADIUS, 0.494));
    rerender();
    expect(annotations()[1]!.from).toEqual([0.6, 0.5]);
  });

  it('reaches as far on screen at any zoom: fewer picture units zoomed in, more for a wider setting', () => {
    drawn([line], 'circle');
    // Zoomed in twice over: 0.012 from the end is 24 screen px, past 14.7.
    (SVGElement.prototype as unknown as { getScreenCTM: () => typeof identity }).getScreenCTM = () => ({ ...identity, a: 2, d: 2 });
    click(at(0.612, 0.5));
    expect(last().from[0]).toBeCloseTo(0.612, 6);
    // 0.0058 from the end: 11.7 screen px.
    click(at(0.605, 0.497));
    expect(last().from).toEqual([0.6, 0.5]);
    // Edit's setting doubled reaches as far again: 0.012 is within its 29.4 px.
    act(() => useSettingsStore.setState({ cpSnapRadius: 20 }));
    rerender();
    click(at(0.6, 0.512));
    expect(last().from).toEqual([0.6, 0.5]);
    expect(annotations()).toHaveLength(4);
  });

  it('shows where a press would land as the pointer hovers, and never draws the marks again for it', () => {
    drawn([line], 'circle');
    const drawnBefore = marksDrawn.count;
    pointer('pointermove', at(0.61, 0.505));
    expect(targets()).toEqual(['annotation']);
    pointer('pointermove', at(0.4, 0.3));
    expect(targets()).toEqual([]);
    pointer('pointermove', at(0.61, 0.505));
    expect(targets()).toEqual(['annotation']);
    // ⌘ pressed with the pointer still: nothing to land on; let go, there it is again.
    act(() => syncHeldModifiersFromEvent({ ctrlKey: true, metaKey: true, shiftKey: false, altKey: false }));
    expect(targets()).toEqual([]);
    act(() => syncHeldModifiersFromEvent({ ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }));
    expect(targets()).toEqual(['annotation']);
    pointer('pointermove', at(0.611, 0.505), 1, 'mouse', overlay(), { free: true });
    expect(targets()).toEqual([]);
    expect(marksDrawn.count).toBe(drawnBefore);
    // With Select in hand a press lands nowhere: nothing shows.
    tool(null);
    pointer('pointermove', at(0.61, 0.505));
    expect(targets()).toEqual([]);
    expect(marksDrawn.count).toBe(drawnBefore);
    // A drag does draw them again, each move: what the count above would have seen.
    tool('line');
    drag(at(0.3, 0.3), at(0.5, 0.3));
    expect(marksDrawn.count).toBeGreaterThan(drawnBefore);
  });

  it('shows what a still pointer would land on once the camera moves under it', () => {
    drawn([line], 'circle');
    // 12 px off the end at the zoom the picture opens at: the end shows.
    pointer('pointermove', at(0.612, 0.5));
    expect(targets()).toEqual(['annotation']);
    // The camera zooms in twice over under the pointer, which does not move: 24 px off, past the radius.
    (SVGElement.prototype as unknown as { getScreenCTM: () => typeof identity }).getScreenCTM = () => ({ ...identity, a: 2, d: 2 });
    act(() => {
      stage().dispatchEvent(new WheelEvent('wheel', { deltaY: -120, clientX: 612, clientY: 500, bubbles: true, cancelable: true }));
    });
    expect(targets()).toEqual([]);
  });

  it('shows a finger where its press landed before it moves, and puts the circle there', () => {
    drawn([line], 'circle');
    pointer('pointerdown', at(0.61, 0.505), 1, 'touch');
    expect(targets()).toEqual(['annotation']);
    pointer('pointerup', at(0.612, 0.505), 1, 'touch');
    rerender();
    expect(last()).toMatchObject({ kind: 'circle', from: [0.6, 0.5] });
    expect(targets()).toEqual([]);
  });

  it('puts a clicked circle where its press showed, though the pointer drifts within its slop before it lifts', () => {
    drawn([line], 'circle');
    // A finger 12 px off the end, which the press shows; it lifts 8 px further off, 20 px from it.
    pointer('pointerdown', at(0.612, 0.5), 1, 'touch');
    expect(targets()).toEqual(['annotation']);
    pointer('pointerup', at(0.62, 0.5), 1, 'touch');
    rerender();
    expect(last()).toMatchObject({ kind: 'circle', from: [0.6, 0.5] });
    // A press with nothing near, lifting nearer one: where it was pressed, as it showed.
    pointer('pointerdown', at(0.6195, 0.5), 2, 'touch');
    expect(targets()).toEqual([]);
    pointer('pointerup', at(0.611, 0.5), 2, 'touch');
    rerender();
    expect(last().from[0]).toBeCloseTo(0.6195, 6);
    // At the line's other end, a mouse's 3 px drift within its 4 px slop, past the radius.
    pointer('pointerdown', at(0.187, 0.5), 3, 'mouse');
    expect(targets()).toEqual(['annotation']);
    pointer('pointerup', at(0.184, 0.5), 3, 'mouse');
    rerender();
    expect(last().from).toEqual([0.2, 0.5]);
  });
});

describe('DiagramAnnotateCanvas right angles (decision 12)', () => {
  const R = Math.SQRT1_2;
  // Two lines drawn on the upload, meeting square at (0.3, 0.4): one right angle there, opening down and to the right.
  const across: KnownDiagramAnnotation = { id: 'across', kind: 'valley-line', from: [0.3, 0.4], to: [0.7, 0.4] };
  const down: KnownDiagramAnnotation = { id: 'down', kind: 'mountain-line', from: [0.3, 0.4], to: [0.3, 0.8] };

  beforeEach(() => {
    useSettingsStore.setState({ diagramAnnotateSnap: true, cpSnapRadius: 10 });
  });

  function drawn(list: KnownDiagramAnnotation[], toolInHand: Parameters<typeof tool>[0] = null) {
    const stepId = mount();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', () => list);
      state().selectDiagramAnnotation(null);
      state().setDiagramAnnotateTool(toolInHand);
    });
    rerender();
    return stepId;
  }
  const click = (point: [number, number], init: PressInit = {}) => {
    pointer('pointerdown', point, 1, 'mouse', overlay(), init);
    pointer('pointerup', point, 1, 'mouse', overlay(), init);
    rerender();
  };
  const last = () => annotations()[annotations().length - 1]!;
  const opens = (annotation: KnownDiagramAnnotation) => rightAngleDiagonal(annotation).map((v) => Math.round(v * 1e6) / 1e6 + 0);
  const ghost = () => overlay().querySelector('[data-right-angle-preview]');
  /** The ghost's path: its ∟, then its square's far sides, as client points. */
  const ghostPoints = () =>
    [...ghost()!.querySelectorAll('path')[1]!.getAttribute('d')!.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map(
      ([, x, y]) => [Number(x), Number(y)] as const
    );
  const targets = () => [...overlay().querySelectorAll('[data-snap-target]')].map((each) => each.getAttribute('data-snap-target'));
  const r = Math.round(R * 1e6) / 1e6;
  /** The mark at the corner (0.3, 0.4) opening into the angle there, as the canvas draws it, in picture units. */
  const inCorner = rightAngleInPicture(rightAngleAt([0.3, 0.4], [1, 1]), INK_UNITS);

  it('shows the mark a click would put in the corner it hovers, and puts it there, square into the angle', () => {
    drawn([across, down], 'right-angle');
    // 8 px off the corner, inside the angle: within the radius.
    pointer('pointermove', at(0.306, 0.406));
    expect(ghost()).not.toBeNull();
    expect(targets()).toEqual(['annotation']);
    // Its ∟ set into the angle off the corner, 2 ink in from each line, its legs along them, and its
    // square's far corner on the diagonal; tied to the corner by a hairline.
    const corner = at(0.3, 0.4);
    const [endA, inner, endB, , far] = ghostPoints();
    const ink = INK_UNITS * 1000;
    expect(inner![0] - corner[0]).toBeCloseTo(2 * ink, 2);
    expect(inner![1] - corner[1]).toBeCloseTo(2 * ink, 2);
    expect(endA![1]).toBeCloseTo(inner![1], 2);
    expect(endB![0]).toBeCloseTo(inner![0], 2);
    expect(far![0] - corner[0]).toBeCloseTo(far![1] - corner[1], 2);
    const tie = ghost()!.querySelector('[data-corner-tie]')!;
    expect(Number(tie.getAttribute('x1'))).toBeCloseTo(corner[0], 6);
    expect(Number(tie.getAttribute('y2'))).toBeCloseTo(inner![1], 2);
    click(at(0.306, 0.406));
    expect(last()).toMatchObject({ kind: 'right-angle', from: [0.3, 0.4] });
    expect(opens(last())).toEqual([r, r]);
    expect(state().diagramAnnotateTool).toBe('right-angle');
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([['right_angle', 'snapped']]);
    // Gone once the click lands, and drawn as the mark itself.
    expect(ghost()).toBeNull();
    expect(overlay().querySelector(`[data-annotation-id="${last().id}"] path`)).not.toBeNull();
  });

  it('shows the same mark hovering over the ghost, and a click there marks that corner; ⌘ puts the corner at the pointer', () => {
    drawn([across, down], 'right-angle');
    pointer('pointermove', at(0.306, 0.406));
    const shown = ghost()!.innerHTML;
    // Over the ghost, well past the snap radius: through its square, along a leg to its end, at its far corner.
    const { legs, square } = inCorner;
    const over: [number, number][] = [
      [(legs[1].x + square[1].x) / 2, (legs[1].y + square[1].y) / 2],
      [legs[0].x, legs[0].y],
      [legs[2].x - 0.0005, legs[2].y],
      [square[1].x, square[1].y],
    ];
    for (const [u, v] of over) {
      pointer('pointermove', at(u, v));
      expect(ghost()!.innerHTML).toBe(shown);
      expect(targets()).toEqual(['annotation']);
    }
    const [u, v] = over[0]!;
    click(at(u, v));
    expect(last()).toMatchObject({ kind: 'right-angle', from: [0.3, 0.4] });
    expect(opens(last())).toEqual([r, r]);
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([['right_angle', 'snapped']]);
    // ⌘ held over it: its corner where the pointer is.
    click(at(u, v), { free: true });
    expect(last().from).toEqual([expect.closeTo(u, 6), expect.closeTo(v, 6)]);
  });

  it('leaves a press at the corner to a line that ends there, with nothing selected', () => {
    const mark: KnownDiagramAnnotation = { id: 'mark', kind: 'right-angle', ...rightAngleAt([0.3, 0.4], [1, 1]) };
    drawn([across, down, mark]);
    click(at(0.3, 0.4));
    // The topmost line there, as drawn: though marks are taken over lines, the gap is the lines'.
    expect(state().diagramSelectedAnnotationId).toBe('down');
    // Its ink takes it: a press on its square.
    act(() => state().selectDiagramAnnotation(null));
    click(at(inCorner.square[1].x - 0.001, inCorner.square[1].y - 0.001));
    expect(state().diagramSelectedAnnotationId).toBe('mark');
  });

  it('draws one from a corner into the angle, squared; Shift holds a drag where there is none to 45°', () => {
    drawn([across, down], 'right-angle');
    // From the corner itself into the angle, well off its diagonal.
    drag(at(0.301, 0.401), at(0.36, 0.42));
    rerender();
    expect(last().from).toEqual([0.3, 0.4]);
    expect(opens(last())).toEqual([r, r]);
    // Nothing square here: toward the pointer, and with Shift, the nearest 45°.
    drag(at(0.6, 0.2), at(0.65, 0.21));
    rerender();
    expect(opens(last())).toEqual(rightAngleDiagonal({ from: [0, 0], to: [0.05, 0.01] }).map((v) => Math.round(v * 1e6) / 1e6 + 0));
    // Away from the one just put down, whose corner is a point to snap to.
    drag(at(0.6, 0.25), at(0.65, 0.26), 1, 'mouse', overlay(), { shiftKey: true });
    rerender();
    expect(opens(last())).toEqual([1, 0]);
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([
      ['right_angle', 'snapped'],
      ['right_angle', 'nothing_near'],
      ['right_angle', 'nothing_near'],
    ]);
  });

  it('puts one down with a click where no right angle is found, opening toward the picture’s middle', () => {
    drawn([across, down], 'right-angle');
    pointer('pointermove', at(0.9, 0.7));
    expect(ghost()).not.toBeNull();
    click(at(0.9, 0.7));
    expect(last().from[0]).toBeCloseTo(0.9, 6);
    // The frame is 1 × 0.75: its middle is up and to the left of here.
    expect(opens(last())).toEqual([-r, -r]);
    // ⌘ held: where the pointer is, though it is near the corner.
    click(at(0.306, 0.406), { free: true });
    expect(last().from).toEqual([expect.closeTo(0.306, 6), expect.closeTo(0.406, 6)]);
  });

  it('shows no ghost with another tool, or once the pointer leaves', () => {
    drawn([across, down], 'circle');
    pointer('pointermove', at(0.306, 0.406));
    expect(ghost()).toBeNull();
    tool('right-angle');
    pointer('pointermove', at(0.306, 0.406));
    expect(ghost()).not.toBeNull();
    // Out of the view altogether (React reads a leave from the `pointerout` it bubbles).
    act(() => {
      overlay().dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
    });
    expect(ghost()).toBeNull();
  });

  it('offers a selected one its corner and the way it opens; the far corner turns it, into a right angle where it finds one', () => {
    // In the corner, opening the wrong way: up and to the left, out of the angle.
    const mark: KnownDiagramAnnotation = { id: 'mark', kind: 'right-angle', ...rightAngleAt([0.3, 0.4], [-1, -1]) };
    drawn([across, down, mark]);
    act(() => state().selectDiagramAnnotation('mark'));
    rerender();
    expect([...host.querySelectorAll('[data-handle]')].map((each) => each.getAttribute('data-handle'))).toEqual([
      'corner',
      'direction',
    ]);
    // Washed along its ∟ and its square as one path, and tied to its corner by a hairline.
    const selection = host.querySelector('[data-selection]')!;
    expect(selection.querySelectorAll('path')).toHaveLength(1);
    expect(selection.querySelector('path')!.getAttribute('d')!.match(/M /g)).toHaveLength(2);
    const tie = selection.querySelector('[data-corner-tie]')!;
    expect([Number(tie.getAttribute('x1')), Number(tie.getAttribute('y1'))]).toEqual(at(0.3, 0.4));
    const { direction } = rightAngleGrips(mark, INK_UNITS);
    // The way it opens is held by its square's far corner.
    const opened = rightAngleInPicture(mark, INK_UNITS).square[1];
    expect(direction[0]).toBeCloseTo(opened.x, 12);
    expect(direction[1]).toBeCloseTo(opened.y, 12);
    // Turned toward a point inside the angle, off its diagonal: square into it.
    drag(at(direction[0], direction[1]), at(0.36, 0.42));
    rerender();
    expect(annotations()[2]!.from).toEqual([0.3, 0.4]);
    expect(opens(annotations()[2]!)).toEqual([r, r]);
    // Turned where there is no right angle, with Shift: the nearest 45°.
    act(() => state().selectDiagramAnnotation('mark'));
    rerender();
    const turned = rightAngleGrips(annotations()[2]!, INK_UNITS).direction;
    drag(at(turned[0], turned[1]), at(0.28, 0.31), 1, 'mouse', overlay(), { shiftKey: true });
    rerender();
    expect(opens(annotations()[2]!)).toEqual([0, -1]);
  });

  it('ties a mark to its vertex with a hairline a screen px wide at any zoom, selected or about to be put down', () => {
    const mark: KnownDiagramAnnotation = { id: 'mark', kind: 'right-angle', ...rightAngleAt([0.3, 0.4], [1, 1]) };
    drawn([across, down, mark], 'right-angle');
    act(() => state().selectDiagramAnnotation('mark'));
    rerender();
    const zoomed = () => Number(host.querySelector('[data-viewport-zoom]')!.textContent!.replace('%', '')) / 100;
    const widths = () =>
      [...overlay().querySelectorAll('[data-corner-tie]')].map((tie) => Number(tie.getAttribute('stroke-width')) * zoomed());
    pointer('pointermove', at(0.306, 0.406));
    expect(widths()).toEqual([expect.closeTo(1, 6), expect.closeTo(1, 6)]);
    // A pinch zooms the camera in: thinner on the overlay, the same on the screen.
    const before = zoomed();
    act(() => {
      view().dispatchEvent(new WheelEvent('wheel', { deltaY: -200, ctrlKey: true, bubbles: true, cancelable: true }));
    });
    pointer('pointermove', at(0.306, 0.406));
    expect(zoomed()).toBeGreaterThan(before);
    expect(widths()).toEqual([expect.closeTo(1, 6), expect.closeTo(1, 6)]);
  });

  it('moves a selected one by its corner onto another, square into the right angle there', () => {
    // A second corner, at the lines' other ends: (0.7, 0.4) has a right angle with a third line.
    const up: KnownDiagramAnnotation = { id: 'up', kind: 'hidden-line', from: [0.7, 0.4], to: [0.7, 0.1] };
    const mark: KnownDiagramAnnotation = { id: 'mark', kind: 'right-angle', ...rightAngleAt([0.3, 0.4], [1, 1]) };
    drawn([across, down, up, mark]);
    act(() => state().selectDiagramAnnotation('mark'));
    rerender();
    drag(at(0.3, 0.4), at(0.695, 0.404));
    rerender();
    const moved = annotations()[3]!;
    expect(moved.from).toEqual([0.7, 0.4]);
    // Up and to the left, between the lines that meet there.
    expect(opens(moved)).toEqual([-r, -r]);
    // A press on its legs moves it whole, as far as the pointer went.
    act(() => state().selectDiagramAnnotation(null));
    rerender();
    const leg = rightAngleGrips(moved, INK_UNITS).direction;
    drag(at(leg[0] - 0.001, leg[1] - 0.001), at(leg[0] - 0.101, leg[1] + 0.199));
    rerender();
    expect(annotations()[3]!.from[0]).toBeCloseTo(0.6, 6);
    expect(annotations()[3]!.from[1]).toBeCloseTo(0.6, 6);
    expect(opens(annotations()[3]!)).toEqual([-r, -r]);
  });
});

describe('the Angle Bisector and the equal-angle mark (15b)', () => {
  beforeEach(() => {
    useSettingsStore.setState({ diagramAnnotateSnap: true, cpSnapRadius: 10, diagramAnnotateLineType: 'valley' });
  });

  /** The step with these annotations, and a tool in hand. */
  function drawn(list: KnownDiagramAnnotation[], toolInHand: Parameters<typeof tool>[0]) {
    const stepId = mount();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', () => list);
      state().selectDiagramAnnotation(null);
      state().setDiagramAnnotateTool(toolInHand);
    });
    rerender();
    return stepId;
  }
  const click = (point: [number, number], init: PressInit = {}) => {
    pointer('pointerdown', point, 1, 'mouse', overlay(), init);
    pointer('pointerup', point, 1, 'mouse', overlay(), init);
    rerender();
  };
  const kinds = () => annotations().map((annotation) => annotation.kind);
  const direction = (from: readonly number[], to: readonly number[]) => Math.atan2(to[1]! - from[1]!, to[0]! - from[0]!);
  const picked = () => overlay().querySelectorAll('[data-pick-point]').length;

  it('bisects the angle three points make, the vertex second, to where a press on no line ends it, as one undo step', () => {
    drawn([], 'angle-bisector');
    const past = state().diagramHistory.past.length;
    click(at(0.1, 0.5));
    click(at(0.5, 0.9));
    click(at(0.5, 0.1));
    expect(annotations()).toHaveLength(0);
    expect(picked()).toBe(3);
    // The next press would draw it: shown under the pointer, line and mark.
    pointer('pointermove', at(0.35, 0.3));
    rerender();
    expect(overlay().querySelector('[data-annotation-id="annotation-pick-line"]')).not.toBeNull();
    expect(overlay().querySelector('[data-annotation-id="annotation-pick-mark"]')).not.toBeNull();
    click(at(0.35, 0.3));
    expect(kinds()).toEqual(['valley-line', 'angle-mark']);
    const [line, mark] = annotations() as [KnownDiagramAnnotation, KnownDiagramAnnotation];
    expect(line.from[0]).toBeCloseTo(0.5, 9);
    expect(line.from[1]).toBeCloseTo(0.9, 9);
    // It halves the angle.
    const along = direction(line.from, line.to);
    expect(along - direction([0.5, 0.9], [0.1, 0.5])).toBeCloseTo(direction([0.5, 0.9], [0.5, 0.1]) - along, 9);
    // The mark is at the vertex, its arms the points picked.
    expect(mark.from[0]).toBeCloseTo(0.5, 9);
    expect(mark.from[1]).toBeCloseTo(0.9, 9);
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(state().diagramHistory.past.at(-1)?.label).toBe('Bisect angle');
    expect(state().diagramSelectedAnnotationId).toBe(line.id);
    expect(state().diagramAnnotateTool).toBe('angle-bisector');
    expect(picked()).toBe(0);
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([['angle_bisector', 'nothing_near']]);
  });

  it('bisects the angle two drawn lines make, from where they cross, its far ends the arms', () => {
    drawn(
      [
        { id: 'a', kind: 'valley-line', from: [0.1, 0.8], to: [0.9, 0.8] },
        { id: 'b', kind: 'valley-line', from: [0.2, 0.9], to: [0.8, 0.3] },
      ],
      'angle-bisector'
    );
    // The line a press would pick, lightly: a pick toward more, not taken outright.
    pointer('pointermove', at(0.5, 0.8));
    expect(overlay().querySelector('[data-pick-marks] line')?.hasAttribute('data-takes')).toBe(false);
    // On each line, well away from its ends and the crossing: lines, not points.
    click(at(0.5, 0.8));
    click(at(0.6, 0.5));
    expect(overlay().querySelectorAll('[data-pick-marks] line')).toHaveLength(2);
    click(at(0.9, 0.62));
    expect(kinds()).toEqual(['valley-line', 'valley-line', 'valley-line', 'angle-mark']);
    const line = annotations()[2]!;
    expect(line.from[0]).toBeCloseTo(0.3, 9);
    expect(line.from[1]).toBeCloseTo(0.8, 9);
    // Between the line along x and the one up at 45°: 22.5° up, as the page shows it.
    expect(direction(line.from, line.to)).toBeCloseTo(-Math.PI / 8, 9);
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([['angle_bisector', 'none']]);
  });

  it('draws its line in the rail’s line type', () => {
    useSettingsStore.setState({ diagramAnnotateLineType: 'mountain' });
    drawn([], 'angle-bisector');
    for (const point of [at(0.1, 0.5), at(0.5, 0.9), at(0.5, 0.1), at(0.35, 0.3)]) click(point);
    expect(kinds()).toEqual(['mountain-line', 'angle-mark']);
  });

  it('draws a solid line in the rail’s colour (17a)', () => {
    useSettingsStore.setState({ diagramAnnotateLineType: 'solid', diagramAnnotateLineColor: '#7048e8' });
    drawn([], 'angle-bisector');
    for (const point of [at(0.1, 0.5), at(0.5, 0.9), at(0.5, 0.1), at(0.35, 0.3)]) click(point);
    expect(kinds()).toEqual(['solid-line', 'angle-mark']);
    expect(annotations()[0]!.color).toBe('#7048e8');
    expect(Object.hasOwn(annotations()[1]!, 'color')).toBe(false);
  });

  it('takes back the last pick with Escape, and goes on to the ladder once none is left', () => {
    drawn([], 'angle-bisector');
    click(at(0.1, 0.5));
    click(at(0.5, 0.9));
    expect(picked()).toBe(2);
    act(() => {
      expect(gestures.cancel!()).toBe(true);
    });
    rerender();
    expect(picked()).toBe(1);
    act(() => {
      expect(gestures.cancel!()).toBe(true);
    });
    act(() => {
      expect(gestures.cancel!()).toBe(false);
    });
    expect(state().diagramAnnotateTool).toBe('angle-bisector');
  });

  it('draws nothing for points that make no angle, and starts again', () => {
    drawn([], 'angle-bisector');
    for (const point of [at(0.1, 0.5), at(0.5, 0.5), at(0.9, 0.5), at(0.5, 0.2)]) click(point);
    expect(annotations()).toEqual([]);
    expect(picked()).toBe(0);
    expect(tracked.trackDiagramAnnotationAdded).not.toHaveBeenCalled();
  });

  it('puts an equal-angle mark down on its own: an arm, the vertex, the other arm', () => {
    drawn([], 'angle-mark');
    click(at(0.1, 0.5));
    click(at(0.5, 0.9));
    expect(annotations()).toEqual([]);
    click(at(0.5, 0.1));
    expect(kinds()).toEqual(['angle-mark']);
    expect(annotations()[0]!.from[0]).toBeCloseTo(0.5, 9);
    expect(annotations()[0]!.from[1]).toBeCloseTo(0.9, 9);
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([['angle_mark', 'nothing_near']]);
  });

  it('snaps its points to the picture’s, the vertex counted as snapped', () => {
    drawn([{ id: 'l', kind: 'valley-line', from: [0.5, 0.9], to: [0.9, 0.9] }], 'angle-mark');
    click(at(0.1, 0.5));
    // A hair off the line's end: the vertex lands on it.
    click(at(0.505, 0.895));
    click(at(0.5, 0.1));
    const mark = annotations().find((annotation) => annotation.kind === 'angle-mark')!;
    expect(mark.from).toEqual([0.5, 0.9]);
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([['angle_mark', 'snapped']]);
  });
});

describe('a close-up (15f)', () => {
  /** The step with these annotations, Select in hand, nothing selected. */
  function drawn(list: KnownDiagramAnnotation[]) {
    const stepId = mount();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', () => list);
      state().selectDiagramAnnotation(null);
      state().setDiagramAnnotateTool(null);
    });
    rerender();
  }
  const zoom: KnownDiagramAnnotation = { id: 'zoom', kind: 'close-up', from: [0.6, 0.3], to: [0.6, -0.25], radius: 0.1, scale: 2 };
  const closeUp = () => annotations().find((annotation) => annotation.kind === 'close-up')!;

  it('is dragged out from its area’s middle, put beside the picture at twice, its inside under the marks, and counted', () => {
    mount();
    tool('close-up');
    drag(at(0.6, 0.3), at(0.7, 0.3));
    rerender();
    const made = closeUp();
    expect(made).toMatchObject({ scale: 2 });
    expect(made.radius).toBeCloseTo(0.1, 3);
    // A frame wider than tall: above it, nearer the area than below.
    expect(made.to[0]).toBeCloseTo(0.6, 3);
    expect(made.to[1]).toBeCloseTo(-0.25, 3);
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([['close_up', 'none']]);
    // The picture drawn again inside it, clipped to its ring, under the marks, and named by nothing.
    const inside = overlay().querySelector(`[data-close-up-inside="${made.id}"]`)!;
    expect(inside.querySelector('image')?.getAttribute('href')).toMatch(/^data:image\/svg\+xml;base64,/);
    // In the marks' own px, as they are drawn: the close-up's ring, twice the area's.
    expect(Number(inside.querySelector('clipPath circle')?.getAttribute('r'))).toBeCloseTo(0.2 * CARD_FRAME_PX, 3);
    expect(inside.querySelector('[data-annotation-id]')).toBeNull();
    const rings = overlay().querySelector(`[data-annotation-id="${made.id}"]`)!;
    expect(rings.querySelectorAll('circle')).toHaveLength(2);
    expect(inside.compareDocumentPosition(rings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is put down with a click a corner’s worth', () => {
    mount();
    tool('close-up');
    pointer('pointerdown', at(0.3, 0.4));
    pointer('pointerup', at(0.3, 0.4));
    expect(closeUp().radius).toBe(0.08);
  });

  it('moves either circle alone by its inside, and both by its line', () => {
    drawn([zoom]);
    // Into the area: it goes by the pointer's travel, the close-up where it was.
    drag(at(0.62, 0.31), at(0.52, 0.41));
    expect(closeUp().from[0]).toBeCloseTo(0.5, 6);
    expect(closeUp().from[1]).toBeCloseTo(0.4, 6);
    expect(closeUp().to).toEqual([0.6, -0.25]);
    rerender();
    // The close-up, anywhere: the area where it was.
    drag(at(0.65, -0.2), at(0.95, -0.2));
    expect(closeUp().to[0]).toBeCloseTo(0.9, 6);
    expect(closeUp().from[0]).toBeCloseTo(0.5, 6);
    rerender();
    // Its line moves both.
    const before = closeUp();
    const { line } = closeUpShape(before);
    const middle: [number, number] = [(line![0][0] + line![1][0]) / 2, (line![0][1] + line![1][1]) / 2];
    drag(at(...middle), at(middle[0], middle[1] + 0.1));
    expect(closeUp().from[1]).toBeCloseTo(before.from[1] + 0.1, 6);
    expect(closeUp().to[1]).toBeCloseTo(before.to[1] + 0.1, 6);
  });

  it('resizes the selected one by its rings: the area’s its radius, the close-up’s its scale, Shift to halves', () => {
    drawn([zoom]);
    act(() => state().selectDiagramAnnotation('zoom'));
    rerender();
    // A dot at each centre, one on each ring.
    expect([...overlay().querySelectorAll('[data-selection] [data-handle]')].map((dot) => dot.getAttribute('data-handle'))).toEqual(
      ['from', 'ring-from', 'to', 'ring-to']
    );
    // The close-up's ring, out from 0.2 to 0.3 of the frame: three times.
    drag(at(0.4, -0.25), at(0.3, -0.25));
    expect(closeUp()).toMatchObject({ radius: 0.1, scale: 3 });
    rerender();
    // In to 0.27 with Shift: two and a half.
    drag(at(0.3, -0.25), at(0.33, -0.25), 1, 'mouse', overlay(), { shiftKey: true });
    expect(closeUp().scale).toBe(2.5);
    rerender();
    // The area's ring, out to 0.15: the close-up grows with it, at its scale.
    drag(at(0.6, 0.4), at(0.6, 0.45));
    expect(closeUp().radius).toBeCloseTo(0.15, 6);
    expect(closeUp().scale).toBe(2.5);
  });
});

describe('DiagramAnnotateCanvas equal divisions (Revision 2)', () => {
  const left: KnownDiagramAnnotation = { id: 'a', kind: 'circle', from: [0.2, 0.4], to: [0.2, 0.4] };
  const right: KnownDiagramAnnotation = { id: 'b', kind: 'circle', from: [0.7, 0.4], to: [0.7, 0.4] };
  const crease: KnownDiagramAnnotation = { id: 'crease', kind: 'valley-line', from: [0.2, 0.5], to: [0.6, 0.5] };

  beforeEach(() => {
    useSettingsStore.setState({ diagramAnnotateSnap: true, cpSnapRadius: 10 });
    setToolNotice(null);
  });

  function drawn(list: KnownDiagramAnnotation[], toolInHand: Parameters<typeof tool>[0] = null) {
    const stepId = mount();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', () => list);
      state().selectDiagramAnnotation(null);
      state().setDiagramAnnotateTool(toolInHand);
    });
    rerender();
    return stepId;
  }
  const click = (point: [number, number], init: PressInit = {}) => {
    pointer('pointerdown', point, 1, 'mouse', overlay(), init);
    pointer('pointerup', point, 1, 'mouse', overlay(), init);
    rerender();
  };
  const last = () => annotations()[annotations().length - 1]!;
  const hovered = () => overlay().querySelector('[data-pick-marks] line');

  it('lays them with a drag, each end snapped as a line’s: four parts, 2.5 mm off away from the middle, the tool kept and Parts asked for (ED1, ED5, ED13)', () => {
    drawn([left, right], 'divisions');
    const past = state().diagramHistory.past.length;
    drag(at(0.206, 0.404), at(0.694, 0.397));
    expect(last()).toMatchObject({ kind: 'divisions', from: [0.2, 0.4], to: [0.7, 0.4], parts: 4, offset: 2.5 });
    // Below the frame's middle, so its line below the measured one: to the right of the way it was drawn, unsaid.
    expect(last().mirrored).toBeUndefined();
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([['divisions', 'snapped', { placed: 'drag' }]]);
    expect(state().diagramAnnotateTool).toBe('divisions');
    expect(state().diagramSelectedAnnotationId).toBe(last().id);
    expect(pendingFieldFocus()).toEqual({ annotationId: last().id, field: 'parts' });
  });

  it('divides a line whole with a click on it, the line under the pointer and not its snapped start, counted as a line', () => {
    drawn([crease, { ...left, from: [0.4, 0.5], to: [0.4, 0.5] }], 'divisions');
    // On the line, a hair from a circle on it: a click takes the line, never the point.
    click(at(0.405, 0.503));
    expect(last()).toMatchObject({ kind: 'divisions', from: [0.2, 0.5], to: [0.6, 0.5], parts: 4, offset: 2.5 });
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([['divisions', 'none', { placed: 'line' }]]);
    // A drag past the slop but shorter than a slip is a click too.
    drag(at(0.3, 0.502), at(0.306, 0.502));
    expect(annotations().filter((each) => each.kind === 'divisions')).toHaveLength(2);
    expect(last()).toMatchObject({ from: [0.2, 0.5], to: [0.6, 0.5] });
  });

  it('puts nothing down for a click on no line, and says so in the tool window until the next press', () => {
    drawn([crease], 'divisions');
    click(at(0.4, 0.7));
    expect(annotations()).toHaveLength(1);
    expect(toolNotice()).toEqual({ tool: 'divisions', notice: 'no-line' });
    expect(tracked.trackDiagramAnnotationAdded).not.toHaveBeenCalled();
    pointer('pointerdown', at(0.4, 0.502));
    expect(toolNotice()).toBeNull();
    pointer('pointerup', at(0.4, 0.502));
    // Another tool, and it is gone too.
    click(at(0.4, 0.7));
    expect(toolNotice()).not.toBeNull();
    tool('circle');
    expect(toolNotice()).toBeNull();
  });

  it('shows the line a click would divide, whole, under the pointer', () => {
    drawn([crease], 'divisions');
    pointer('pointermove', at(0.3, 0.503));
    const line = hovered()!;
    expect(line).not.toBeNull();
    // Shown firmly: a click takes it outright, not toward a pick to come.
    expect(line.hasAttribute('data-takes')).toBe(true);
    const [x1, y1] = at(0.2, 0.5);
    const [x2] = at(0.6, 0.5);
    expect([Number(line.getAttribute('x1')), Number(line.getAttribute('y1')), Number(line.getAttribute('x2'))]).toEqual([x1, y1, x2]);
    pointer('pointermove', at(0.3, 0.7));
    expect(hovered()).toBeNull();
  });

  it('slides its line nearer and farther with a drag of the mark, over to the other side across its line, Shift to half millimetres, never moved whole (ED2)', () => {
    const divisions: KnownDiagramAnnotation = { id: 'd', kind: 'divisions', from: [0.2, 0.5], to: [0.6, 0.5], parts: 4, offset: 2.5 };
    drawn([divisions]);
    const mm = mmInPictureUnits(1);
    const past = state().diagramHistory.past.length;
    // On its line, out a millimetre.
    drag(at(0.3, 0.5 + 2.5 * mm), at(0.3, 0.5 + 3.5 * mm));
    expect(last()).toMatchObject({ from: [0.2, 0.5], to: [0.6, 0.5], offset: 3.5 });
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    rerender();
    // Across the line it measures: its line on the other side.
    drag(at(0.3, 0.5 + 3.5 * mm), at(0.32, 0.5 - mm));
    expect(last()).toMatchObject({ from: [0.2, 0.5], to: [0.6, 0.5], offset: 1, mirrored: true });
    rerender();
    // By its handle, with Shift: half millimetres.
    const handle = overlay().querySelector('[data-handle="offset"]')!;
    const hx = Number(handle.getAttribute('cx'));
    const hy = Number(handle.getAttribute('cy'));
    drag([hx, hy], [hx, hy - 0.3 * mm * 1000], 1, 'mouse', overlay(), { shiftKey: true });
    expect(last().offset).toBe(1.5);
    expect(state().diagramHistory.past).toHaveLength(past + 3);
  });

  it('moves an end of its line by its dot, snapping as when drawn', () => {
    const divisions: KnownDiagramAnnotation = { id: 'd', kind: 'divisions', from: [0.2, 0.5], to: [0.6, 0.5], parts: 4, offset: 2.5 };
    drawn([divisions, right]);
    act(() => state().selectDiagramAnnotation('d'));
    rerender();
    expect([...overlay().querySelectorAll('[data-divisions-selection] [data-handle]')].map((dot) => dot.getAttribute('data-handle'))).toEqual([
      'to',
      'from',
      'offset',
    ]);
    expect(overlay().querySelector('[data-measured-line]')).not.toBeNull();
    drag(at(0.6, 0.5), at(0.695, 0.405));
    expect(annotations().find((each) => each.id === 'd')).toMatchObject({ from: [0.2, 0.5], to: [0.7, 0.4], offset: 2.5 });
  });

  it('washes short dividers as drawn: those between the ends 1.65 mm either side of the line, the end ones to the measured line (R3-1 A, R3-2 A)', () => {
    const divisions: KnownDiagramAnnotation = {
      id: 'd',
      kind: 'divisions',
      from: [0.2, 0.5],
      to: [0.6, 0.5],
      parts: 4,
      offset: 10,
      shortDividers: true,
    };
    drawn([divisions]);
    act(() => state().selectDiagramAnnotation('d'));
    rerender();
    const measured = Number(overlay().querySelector('[data-measured-line]')!.getAttribute('y1'));
    // How far each washed stroke's ends stand off the measured line, the line's 10 mm giving the scale.
    const [line, ...rest] = [...overlay().querySelectorAll('[data-divisions-selection] polyline')].map((polyline) =>
      polyline
        .getAttribute('points')!
        .split(' ')
        .map((point) => Number(point.split(',')[1]) - measured)
    );
    const mm = line![0]! / 10;
    const overshoot = DIAGRAM_DIVISIONS_INK.overshoot * ANNOTATION_INK_MM;
    expect(overshoot).toBeCloseTo(1.65, 2);
    const dividers = rest.slice(0, 5).map((ends) => ends.map((each) => each / mm));
    expect(dividers).toHaveLength(5);
    for (const [index, [start, end]] of dividers.entries()) {
      expect(start).toBeCloseTo(index === 0 || index === 4 ? 0 : 10 - overshoot, 6);
      expect(end).toBeCloseTo(10 + overshoot, 6);
    }
  });
});

describe('DiagramAnnotateCanvas on an enlarged step (Revision 2)', () => {
  /** An SVG data URL's document. */
  const decoded = (href: string) => new TextDecoder().decode(Uint8Array.from(atob(href.split(',')[1]!), (c) => c.charCodeAt(0)));

  /** The step enlarged on its picture's circle of radius 0.2 about [0.5, 0.375]: its window a 0.4 square. */
  function enlarge() {
    const stepId = mount();
    act(() =>
      useWorkspaceStore.setState({
        diagram: {
          ...state().diagram!,
          steps: stepsIn(state().diagram!).map((step) =>
            step.id === stepId
              ? { ...step, zoom: { from: 'area-1', shape: 'circle' as const, frame: { centre: [0.5, 0.375] as [number, number], radius: 0.2 } } }
              : step
          ),
        },
      })
    );
    rerender();
    return stepId;
  }

  it('shows its window as the canvas’s frame, its picture clipped to the circle', () => {
    enlarge();
    const zoom = host.querySelector('[data-zoom-view]')!;
    expect(zoom).not.toBeNull();
    // No image of the whole picture as a card's: the window's own, under its clip.
    expect(host.querySelector('img')).toBeNull();
    const frame = host.querySelector('[data-annotate-frame]') as HTMLDivElement;
    expect(frame.dataset.zoomed).toBe('');
    // The window, 1000 world px across, inside the world's margin and the margin a card gives it (1 mm in 50):
    // a fit leaves its edge the room it leaves any picture's.
    expect([frame.style.left, frame.style.top, frame.style.width, frame.style.height]).toEqual(['270px', '270px', '1000px', '1000px']);
    // The window as its card paints it — clipped to its circle, its boundary over it — its window on the frame.
    const image = zoom.querySelector('image[data-zoom-window-picture]')!;
    expect(['x', 'y', 'width', 'height'].map((name) => Number(image.getAttribute(name)))).toEqual(
      [250, 250, 1040, 1040].map((value) => expect.closeTo(value, 6))
    );
    const picture = decoded(image.getAttribute('href')!);
    expect(picture).toContain('data-zoom-window');
    expect(picture).toMatch(/<clipPath id="zoom-clip"><circle [^>]*\/><\/clipPath>/);
    // An upload has no paper to cut along: its frame is drawn whole.
    expect(picture.match(/stroke-linecap="round"/g)).toHaveLength(1);
    expect(zoom.querySelector('[data-zoom-surround]')).toBeNull();
  });

  it('shows a small window by an image of the window, not of its whole picture enlarged', () => {
    const stepId = mount();
    // A window a fiftieth of the picture across: its whole picture at the window's scale would be fifty frames wide.
    act(() =>
      useWorkspaceStore.setState({
        diagram: {
          ...state().diagram!,
          steps: stepsIn(state().diagram!).map((step) =>
            step.id === stepId
              ? { ...step, zoom: { from: 'area-1', shape: 'circle' as const, frame: { centre: [0.5, 0.375] as [number, number], radius: 0.01 } } }
              : step
          ),
        },
      })
    );
    rerender();
    const images = [...host.querySelectorAll('[data-zoom-view] image')];
    expect(images).toHaveLength(1);
    expect(Number(images[0]!.getAttribute('width'))).toBeCloseTo(1040, 6);
  });

  it('draws a mark in its window’s units: the window is the frame', () => {
    enlarge();
    tool('valley-arrow');
    drag(at(0.2, 0.3), at(0.6, 0.3));
    expect(annotations()).toHaveLength(1);
    expect(annotations()[0]!.from[0]).toBeCloseTo(0.2, 3);
    expect(annotations()[0]!.to[0]).toBeCloseTo(0.6, 3);
  });

  it('neither draws nor takes a press on a mark lying far off its window, which it keeps', () => {
    const stepId = enlarge();
    // The window's frame is 1 × 1: one mark on it, one three windows off.
    const near: KnownDiagramAnnotation = { id: 'near', kind: 'valley-line', from: [0.2, 0.5], to: [0.8, 0.5] };
    const far: KnownDiagramAnnotation = { id: 'far', kind: 'valley-line', from: [3, 0.5], to: [3.6, 0.5] };
    act(() => state().editDiagramAnnotations(stepId, 'Add annotation', () => [near, far]));
    rerender();
    expect(overlay().querySelector('[data-annotation-id="near"]')).not.toBeNull();
    expect(overlay().querySelector('[data-annotation-id="far"]')).toBeNull();
    const press = (point: [number, number]) => {
      pointer('pointerdown', point);
      pointer('pointerup', point);
      rerender();
    };
    press(at(3.3, 0.5));
    expect(state().diagramSelectedAnnotationId).toBeNull();
    press(at(0.5, 0.5));
    expect(state().diagramSelectedAnnotationId).toBe('near');
    // Kept: the step still has it.
    expect(annotations().map(({ id }) => id)).toEqual(['near', 'far']);
  });

  it('shows a close-up on it its window again, larger, as its card does', () => {
    const stepId = enlarge();
    const closeUp: KnownDiagramAnnotation = { id: 'c', kind: 'close-up', from: [0.5, 0.5], to: [0.8, 0.2], radius: 0.1 };
    act(() => state().editDiagramAnnotations(stepId, 'Close-up', () => [closeUp]));
    rerender();
    const inside = decoded(host.querySelector('[data-close-up-inside] image')!.getAttribute('href')!);
    expect(inside).toContain('data-zoom-window');
    expect(inside).toContain('clip-path="url(#zoom-clip)"');
  });

  it('selects in the ink Pose outlines its frame in', () => {
    // The canvas's stylesheet and a picture painted as a document each hold it: the two are one blue.
    const css = readFileSync(resolve(process.cwd(), 'src/components/diagram/DiagramAnnotateCanvas.module.css'), 'utf8');
    expect(/--annotate-selection:\s*([^;]+);/.exec(css)?.[1]).toBe(ANNOTATE_SELECTION_INK);
  });

  it('shows the picture round the frame, dimmed, when the frame is selected', () => {
    enlarge();
    act(() => useWorkspaceStore.setState({ diagramSelectedAnnotationId: ZOOM_FRAME_ID }));
    rerender();
    const surround = host.querySelector('[data-zoom-surround]')!;
    expect(surround).not.toBeNull();
    // The whole picture, unclipped, and the page's white over all of it but the frame.
    expect(surround.querySelector('image')).not.toBeNull();
    const dim = surround.querySelector('path')!;
    expect(dim.getAttribute('fill-opacity')).toBe(String(ZOOM_SURROUND_DIM));
    // Over all of the picture round the frame, which reaches past the canvas's world: the window is small.
    const [x, y, right, bottom] = /^M (\S+) (\S+) H (\S+) V (\S+) H/.exec(dim.getAttribute('d')!)!.slice(1).map(Number);
    const image = surround.querySelector('image')!;
    const [ix, iy, iw, ih] = ['x', 'y', 'width', 'height'].map((name) => Number(image.getAttribute(name)));
    expect(ix! + iw!).toBeGreaterThan(1540);
    expect([x, y, right, bottom]).toEqual([Math.min(0, ix!), Math.min(0, iy!), Math.max(1540, ix! + iw!), Math.max(1540, iy! + ih!)]);
  });
});

describe('the Enlarge tools and the enlarged frame (Revision 2, 16e)', () => {
  beforeEach(() => tracked.trackDiagramEnlargementChanged.mockClear());
  const areas = () => annotations().filter((annotation) => annotation.kind === 'zoom');
  const handles = () =>
    [...overlay().querySelectorAll('[data-zoom-selection] [data-handle]')].map((dot) => dot.getAttribute('data-handle'));

  /** The step with these marks on it, Select in hand, nothing selected. */
  function drawn(list: KnownDiagramAnnotation[]) {
    const stepId = mount();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', () => list);
      state().selectDiagramAnnotation(null);
      state().setDiagramAnnotateTool(null);
    });
    rerender();
    return stepId;
  }

  it('drags a circle out from its middle with Enlarge: the area alone, as one undo step, selected and counted', () => {
    mount();
    tool('enlarge');
    const steps = state().diagram!.steps.length;
    const past = state().diagramHistory.past.length;
    drag(at(0.5, 0.4), at(0.7, 0.4));
    expect(areas()).toHaveLength(1);
    const [area] = areas();
    expect(area!.from[0]).toBeCloseTo(0.5, 6);
    expect(area!.radius).toBeCloseTo(0.2, 6);
    expect(area!.size).toBeUndefined();
    // Drawing it changes nothing else: no step made, one undo step, named for it (Z1).
    expect(state().diagram!.steps).toHaveLength(steps);
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(state().diagramHistory.past.at(-1)!.label).toBe('Enlarge area');
    expect(state().diagramSelectedAnnotationId).toBe(area!.id);
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([['enlarge', 'none']]);
    // The tool stays in hand: a second area goes on the same step (several may sit on one).
    pointer('pointerdown', at(0.2, 0.2));
    pointer('pointerup', at(0.2, 0.2));
    expect(areas()).toHaveLength(2);
    expect(areas()[1]!.radius).toBe(0.15);
  });

  it('drags a rounded rectangle corner to corner with Enlarge in Frame: Shift square, Alt from its middle, a click a standard size', () => {
    mount();
    tool('enlarge-frame');
    drag(at(0.2, 0.2), at(0.6, 0.3));
    expect(areas()[0]).toMatchObject({ size: [expect.closeTo(0.4, 6), expect.closeTo(0.1, 6)] });
    expect(areas()[0]!.from[0]).toBeCloseTo(0.4, 6);
    expect(areas()[0]!.from[1]).toBeCloseTo(0.25, 6);
    drag(at(0.2, 0.2), at(0.6, 0.3), 1, 'mouse', overlay(), { shiftKey: true });
    expect(areas()[1]!.size).toEqual([expect.closeTo(0.4, 6), expect.closeTo(0.4, 6)]);
    drag(at(0.5, 0.4), at(0.6, 0.45), 1, 'mouse', overlay(), { altKey: true });
    expect(areas()[2]!.from).toEqual([expect.closeTo(0.5, 6), expect.closeTo(0.4, 6)]);
    expect(areas()[2]!.size).toEqual([expect.closeTo(0.2, 6), expect.closeTo(0.1, 6)]);
    pointer('pointerdown', at(0.3, 0.3));
    pointer('pointerup', at(0.3, 0.3));
    expect(areas()[3]!.size).toEqual([0.3, 0.3]);
    expect(tracked.trackDiagramAnnotationAdded.mock.calls.map(([kind]) => kind)).toEqual([
      'enlarge_frame',
      'enlarge_frame',
      'enlarge_frame',
      'enlarge_frame',
    ]);
  });

  it('takes an area by its outline only, under the marks inside it, which stay pressable', () => {
    const area: KnownDiagramAnnotation = { id: 'area', kind: 'zoom', from: [0.5, 0.4], to: [0.5, 0.4], radius: 0.2 };
    const line: KnownDiagramAnnotation = { id: 'line', kind: 'valley-line', from: [0.4, 0.4], to: [0.6, 0.4] };
    drawn([area, line]);
    const press = (point: [number, number]) => {
      pointer('pointerdown', point);
      pointer('pointerup', point);
      rerender();
    };
    press(at(0.5, 0.4));
    expect(state().diagramSelectedAnnotationId).toBe('line');
    press(at(0.45, 0.3));
    expect(state().diagramSelectedAnnotationId).toBeNull();
    press(at(0.7, 0.4));
    expect(state().diagramSelectedAnnotationId).toBe('area');
  });

  it('moves a selected circle by its centre and resizes it by its rim, each one undo step on its step only', () => {
    const area: KnownDiagramAnnotation = { id: 'area', kind: 'zoom', from: [0.5, 0.4], to: [0.5, 0.4], radius: 0.2 };
    drawn([area]);
    act(() => state().selectDiagramAnnotation('area'));
    rerender();
    expect(handles()).toEqual(['zoom-centre', 'zoom-rim']);
    const past = state().diagramHistory.past.length;
    drag(at(0.5, 0.4), at(0.55, 0.45));
    expect(areas()[0]!.from).toEqual([expect.closeTo(0.55, 6), expect.closeTo(0.45, 6)]);
    rerender();
    drag(at(0.75, 0.45), at(0.85, 0.45));
    expect(areas()[0]!.radius).toBeCloseTo(0.3, 6);
    expect(state().diagramHistory.past).toHaveLength(past + 2);
    expect(state().diagramHistory.past.at(-1)!.label).toBe('Change enlarge area');
    expect(tracked.trackDiagramEnlargementChanged.mock.calls).toEqual([
      ['area', 'moved'],
      ['area', 'moved'],
    ]);
  });

  it('resizes a selected rounded rectangle by a corner, the opposite one held, or about its centre with Alt, and by an edge', () => {
    const area: KnownDiagramAnnotation = { id: 'area', kind: 'zoom', from: [0.5, 0.4], to: [0.5, 0.4], size: [0.4, 0.2] };
    drawn([area]);
    act(() => state().selectDiagramAnnotation('area'));
    rerender();
    expect(handles()).toEqual([
      'zoom-centre',
      'zoom-corner-0',
      'zoom-corner-1',
      'zoom-corner-2',
      'zoom-corner-3',
      'zoom-edge-0',
      'zoom-edge-1',
      'zoom-edge-2',
      'zoom-edge-3',
    ]);
    // The bottom-right corner out by 0.1 each way: the top-left one stays.
    drag(at(0.7, 0.5), at(0.8, 0.6));
    expect(areas()[0]!.size).toEqual([expect.closeTo(0.5, 6), expect.closeTo(0.3, 6)]);
    expect(areas()[0]!.from).toEqual([expect.closeTo(0.55, 6), expect.closeTo(0.45, 6)]);
    rerender();
    // With Alt, about its centre.
    drag(at(0.8, 0.6), at(0.9, 0.6), 1, 'mouse', overlay(), { altKey: true });
    expect(areas()[0]!.size).toEqual([expect.closeTo(0.7, 6), expect.closeTo(0.3, 6)]);
    expect(areas()[0]!.from).toEqual([expect.closeTo(0.55, 6), expect.closeTo(0.45, 6)]);
    rerender();
    // The left edge in by 0.1: its height kept.
    drag(at(0.2, 0.45), at(0.3, 0.45));
    expect(areas()[0]!.size).toEqual([expect.closeTo(0.6, 6), expect.closeTo(0.3, 6)]);
  });

  it('draws nothing with the Enlarge tools on an enlarged step', () => {
    const stepId = mount();
    act(() =>
      useWorkspaceStore.setState({
        diagram: {
          ...state().diagram!,
          steps: stepsIn(state().diagram!).map((step) =>
            step.id === stepId
              ? { ...step, zoom: { from: 'area-1', shape: 'circle' as const, frame: { centre: [0.5, 0.375] as [number, number], radius: 0.2 } } }
              : step
          ),
        },
      })
    );
    rerender();
    tool('enlarge');
    drag(at(0.3, 0.3), at(0.5, 0.3));
    expect(areas()).toHaveLength(0);
  });

  describe('an enlarged step’s frame', () => {
    /** The step enlarged on its picture's circle of radius 0.2 about [0.5, 0.375], a mark on its window. */
    function enlarged() {
      const stepId = mount();
      const mark: KnownDiagramAnnotation = { id: 'mark', kind: 'valley-line', from: [0.2, 0.5], to: [0.8, 0.5] };
      act(() =>
        useWorkspaceStore.setState({
          diagram: {
            ...state().diagram!,
            steps: stepsIn(state().diagram!).map((step) =>
              step.id === stepId
                ? {
                    ...step,
                    annotations: [mark],
                    annotatedPictureKey: step.picture!.key,
                    zoom: { from: 'area-1', shape: 'circle' as const, frame: { centre: [0.5, 0.375] as [number, number], radius: 0.2 } },
                  }
                : step
            ),
          },
        })
      );
      act(() => state().setDiagramAnnotateTool(null));
      rerender();
      return stepId;
    }
    const step = () => stepsIn(state().diagram!)[0]!;
    /** A point in the window's units, on the picture. */
    const onPicture = ([u, v]: readonly [number, number]): [number, number] => {
      const { centre, radius } = step().zoom!.frame!;
      return [centre[0] - radius! + u * 2 * radius!, centre[1] - radius! + v * 2 * radius!];
    };

    it('is selected by a click on its boundary, under every mark, its grips shown', () => {
      enlarged();
      pointer('pointerdown', at(1, 0.5));
      pointer('pointerup', at(1, 0.5));
      rerender();
      expect(state().diagramSelectedAnnotationId).toBe(ZOOM_FRAME_ID);
      expect(host.querySelector('[data-zoom-selection="frame"]')).not.toBeNull();
      expect(handles()).toEqual(['zoom-centre', 'zoom-rim']);
      // A mark inside it is still the mark's.
      pointer('pointerdown', at(0.3, 0.5));
      pointer('pointerup', at(0.3, 0.5));
      expect(state().diagramSelectedAnnotationId).toBe('mark');
    });

    it('is selected by a click on its boundary with an Enlarge tool in hand from another step: Select is in hand here', () => {
      enlarged();
      tool('enlarge-frame');
      expect(view().dataset.tool).not.toBe('enlarge-frame');
      pointer('pointerdown', at(1, 0.5));
      pointer('pointerup', at(1, 0.5));
      rerender();
      expect(state().diagramSelectedAnnotationId).toBe(ZOOM_FRAME_ID);
      // The tool is still the one picked, for the next step that can take an area.
      expect(state().diagramAnnotateTool).toBe('enlarge-frame');
    });

    it('moves by a drag, one undo step: its imprint made again and the marks kept on the same paper', () => {
      const stepId = enlarged();
      const before = onPicture(annotations()[0]!.from);
      const past = state().diagramHistory.past.length;
      drag(at(1, 0.5), at(1.1, 0.5));
      expect(state().diagramHistory.past).toHaveLength(past + 1);
      expect(state().diagramHistory.past.at(-1)!.label).toBe('Move enlarged frame');
      expect(stepsIn(state().diagram!).find((each) => each.id === stepId)!.zoom!.frame!.centre).toEqual([
        expect.closeTo(0.54, 6),
        expect.closeTo(0.375, 6),
      ]);
      const after = onPicture(annotations()[0]!.from);
      expect(after[0]).toBeCloseTo(before[0], 9);
      expect(after[1]).toBeCloseTo(before[1], 9);
      expect(tracked.trackDiagramEnlargementChanged.mock.calls).toEqual([['frame', 'moved']]);
    });

    it('resizes by its rim once selected, drawing only an outline until it lands', () => {
      enlarged();
      act(() => state().selectDiagramAnnotation(ZOOM_FRAME_ID));
      rerender();
      const surround = host.querySelector('[data-zoom-surround] image')!.getAttribute('href');
      pointer('pointerdown', at(1, 0.5));
      pointer('pointermove', at(1.1, 0.5), 1, 'mouse', overlay(), { buttons: 1 });
      pointer('pointermove', at(1.25, 0.5), 1, 'mouse', overlay(), { buttons: 1 });
      // Mid-drag: the outline follows the pointer over the same picture, nothing painted again.
      expect(host.querySelector('[data-zoom-surround] image')!.getAttribute('href')).toBe(surround);
      const outline = host.querySelector('[data-zoom-selection="frame"] polygon')!.getAttribute('points')!;
      const xs = outline.split(' ').map((pair) => Number(pair.split(',')[0]));
      expect(Math.max(...xs)).toBeCloseTo(at(1.25, 0.5)[0], 3);
      const before = onPicture(annotations()[0]!.to);
      pointer('pointerup', at(1.25, 0.5));
      // A quarter of the window, 0.4 of the picture across, further out: 0.1 more radius.
      expect(step().zoom!.frame!.radius).toBeCloseTo(0.3, 6);
      expect(state().diagramHistory.past.at(-1)!.label).toBe('Resize enlarged frame');
      // The marks on the same paper, in the larger window's units.
      const after = onPicture(annotations()[0]!.to);
      expect(after[0]).toBeCloseTo(before[0], 9);
      expect(after[1]).toBeCloseTo(before[1], 9);
    });

    it('holds still on a diagram that cannot change, and still selects', () => {
      enlarged();
      rerender(true);
      drag(at(1, 0.5), at(1.1, 0.5));
      expect(state().diagramSelectedAnnotationId).toBe(ZOOM_FRAME_ID);
      expect(step().zoom!.frame!.centre).toEqual([0.5, 0.375]);
    });
  });
});

describe('the X-Ray tool and its windows (Revision 3, 18e)', () => {
  beforeEach(() => {
    tracked.trackDiagramEnlargementChanged.mockClear();
    tracked.trackDiagramMarkStyled.mockClear();
  });

  /** Zach's crane, step 22 (`zoom.fixtures.ts`), its faces on the paper kept, open in Annotate with `marks`. */
  function crane(marks: KnownDiagramAnnotation[] = [], step = craneStep('S.none')) {
    const opened = { ...step, annotations: marks, annotatedPictureKey: step.picture!.key };
    act(() => {
      useWorkspaceStore.setState({ diagram: insertSteps(createDiagram({ title: 'Crane' }), [opened], 0) });
      state().openDiagramStep(opened.id, 'annotate');
      state().selectDiagramAnnotation(null);
      state().setDiagramAnnotateTool(null);
    });
    rerender();
    return opened.id;
  }
  const xrays = () => annotations().filter((annotation) => annotation.kind === 'x-ray');
  const windows = () => [...overlay().querySelectorAll('[data-x-ray-inside]')];
  const xray: KnownDiagramAnnotation = { id: 'xray', kind: 'x-ray', from: [0.45, 0.6], to: [0.45, 0.6], radius: 0.08, depth: 2 };

  it('drags a window out from its middle, one layer deep, as one undo step, selected and counted — and asks for its Depth', () => {
    crane();
    act(() => state().setDiagramAnnotateTool('x-ray'));
    const past = state().diagramHistory.past.length;
    drag(at(0.45, 0.6), at(0.55, 0.6));
    expect(xrays()).toHaveLength(1);
    const [laid] = xrays();
    expect(laid).toMatchObject({ from: [expect.closeTo(0.45, 6), expect.closeTo(0.6, 6)], depth: 1 });
    expect(laid!.radius).toBeCloseTo(0.1, 6);
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(state().diagramHistory.past.at(-1)!.label).toBe('Add annotation');
    expect(state().diagramSelectedAnnotationId).toBe(laid!.id);
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([['x_ray', 'none']]);
    expect(pendingFieldFocus()).toEqual({ annotationId: laid!.id, field: 'depth' });
    // Drawn on the canvas: its window, under the marks, with its rim.
    rerender();
    expect(windows()).toHaveLength(1);
    expect(windows()[0]!.querySelector('clipPath circle')).not.toBeNull();
    // A click puts down a standard size.
    pointer('pointerdown', at(0.3, 0.3));
    pointer('pointerup', at(0.3, 0.3));
    expect(xrays()[1]!.radius).toBe(0.15);
  });

  it('draws nothing on a picture with no layers to x-ray, as the rail’s held tool says: Select is in hand there', () => {
    mount();
    act(() => state().setDiagramAnnotateTool('x-ray'));
    rerender();
    expect(view().dataset.tool).toBe('select');
    drag(at(0.3, 0.3), at(0.4, 0.3));
    expect(xrays()).toHaveLength(0);
    // The tool picked is kept: on the next step that can take it, it is in hand again.
    expect(state().diagramAnnotateTool).toBe('x-ray');
  });

  it('lays nothing off the paper, where a window would take nothing away: the press deselects, and the tool says why (review of 18e)', () => {
    crane([xray]);
    act(() => {
      state().selectDiagramAnnotation('xray');
      state().setDiagramAnnotateTool('x-ray');
    });
    rerender();
    tracked.trackDiagramAnnotationAdded.mockClear();
    // The frame's top left corner: no paper there.
    pointer('pointerdown', at(0.02, 0.02));
    pointer('pointerup', at(0.02, 0.02));
    drag(at(0.02, 0.02), at(0.12, 0.02));
    expect(xrays()).toHaveLength(1);
    expect(state().diagramSelectedAnnotationId).toBeNull();
    expect(toolNotice()).toEqual({ tool: 'x-ray', notice: 'no-paper' });
    expect(tracked.trackDiagramAnnotationAdded).not.toHaveBeenCalled();
    // On the paper, as ever: and the notice goes with the press.
    drag(at(0.45, 0.6), at(0.55, 0.6));
    expect(xrays()).toHaveLength(2);
    expect(toolNotice()).toBeNull();
  });

  it('is held, as the rail holds it, on a flat step whose faces need a Refresh: Select is in hand there, and a press lays nothing (review of 18e)', () => {
    crane();
    act(() => state().setDiagramAnnotateTool('x-ray'));
    rerender();
    expect(view().dataset.tool).toBe('x-ray');
    // Its faces never kept, and no pattern open to fold them from: "Refresh step 1 to x-ray it".
    crane([], craneStep('S.none', { faces: false }));
    act(() => state().setDiagramAnnotateTool('x-ray'));
    rerender();
    expect(view().dataset.tool).toBe('select');
    tracked.trackDiagramAnnotationAdded.mockClear();
    drag(at(0.45, 0.6), at(0.55, 0.6));
    pointer('pointerdown', at(0.45, 0.6));
    pointer('pointerup', at(0.45, 0.6));
    expect(xrays()).toHaveLength(0);
    expect(tracked.trackDiagramAnnotationAdded).not.toHaveBeenCalled();
    expect(state().diagramAnnotateTool).toBe('x-ray');
  });

  it('is pressed by its rim, under the marks over its inside; moved and resized by a circle’s grips as “Change X-ray”, never an enlargement', () => {
    const line: KnownDiagramAnnotation = { id: 'line', kind: 'valley-line', from: [0.4, 0.6], to: [0.5, 0.6] };
    crane([xray, line]);
    pointer('pointerdown', at(0.45, 0.6));
    pointer('pointerup', at(0.45, 0.6));
    expect(state().diagramSelectedAnnotationId).toBe('line');
    pointer('pointerdown', at(0.53, 0.6));
    pointer('pointerup', at(0.53, 0.6));
    expect(state().diagramSelectedAnnotationId).toBe('xray');
    rerender();
    expect([...overlay().querySelectorAll('[data-zoom-selection] [data-handle]')].map((dot) => dot.getAttribute('data-handle'))).toEqual([
      'zoom-centre',
      'zoom-rim',
    ]);
    drag(at(0.45, 0.6), at(0.47, 0.62));
    expect(xrays()[0]!.from).toEqual([expect.closeTo(0.47, 6), expect.closeTo(0.62, 6)]);
    expect(xrays()[0]).toMatchObject({ depth: 2 });
    rerender();
    drag(at(0.55, 0.62), at(0.6, 0.62));
    expect(xrays()[0]!.radius).toBeCloseTo(0.13, 6);
    expect(state().diagramHistory.past.at(-1)!.label).toBe('Change X-ray');
    expect(tracked.trackDiagramEnlargementChanged).not.toHaveBeenCalled();
  });

  it('anchors where it is clicked in the pick mode, as “Change X-ray”, counted as its own option, never an enlargement', () => {
    const stepId = crane([xray]);
    act(() => {
      state().selectDiagramAnnotation('xray');
      state().setDiagramAnchorPick({ stepId, target: 'xray' });
    });
    rerender();
    pointer('pointerdown', at(0.45, 0.6));
    pointer('pointerup', at(0.45, 0.6));
    expect(xrays()[0]!.anchor).toBeDefined();
    expect(xrays()[0]!.from).toEqual([0.45, 0.6]);
    expect(state().diagramHistory.past.at(-1)!.label).toBe('Change X-ray');
    expect(state().diagramAnchorPick).toBeNull();
    expect(tracked.trackDiagramMarkStyled.mock.calls).toEqual([['x_ray', 'anchor', 'picked']]);
    expect(tracked.trackDiagramEnlargementChanged).not.toHaveBeenCalled();
    // Selected, its picked point is marked where it was picked, in the selection's ink (review of 18e).
    rerender();
    const mark = overlay().querySelector('[data-x-ray-anchor]')!;
    expect(mark).not.toBeNull();
    const [x, y] = at(0.45, 0.6);
    expect(Number(mark.getAttribute('cx'))).toBeCloseTo(x, 3);
    expect(Number(mark.getAttribute('cy'))).toBeCloseTo(y, 3);
    // Not while anything else is selected.
    act(() => state().selectDiagramAnnotation(null));
    rerender();
    expect(overlay().querySelector('[data-x-ray-anchor]')).toBeNull();
  });

  it('is kept, but drawn nowhere, while its step shows its crease pattern; drawn again as a flat fold (R3-18b A)', () => {
    const stepId = crane([xray]);
    expect(windows()).toHaveLength(1);
    const showAs = (render: object) =>
      act(() =>
        useWorkspaceStore.setState({
          diagram: {
            ...state().diagram!,
            steps: stepsIn(state().diagram!).map((step) =>
              step.id === stepId && step.source?.kind === 'cp' ? { ...step, source: { ...step.source, render: render as never } } : step
            ),
          },
        })
      );
    const flat = craneStep('S.none').source!;
    showAs({ mode: 'crease-pattern', side: 'front', rotationDeg: 0 });
    rerender();
    expect(windows()).toHaveLength(0);
    expect(xrays()).toHaveLength(1);
    // Drawn nowhere, so not pressed by its rim there either (review of 18e).
    pointer('pointerdown', at(0.53, 0.6));
    pointer('pointerup', at(0.53, 0.6));
    expect(state().diagramSelectedAnnotationId).toBeNull();
    showAs(flat.kind === 'cp' ? flat.render : {});
    rerender();
    expect(windows()).toHaveLength(1);
  });
});

describe('the anchor’s pick mode (Revision 2, 16e)', () => {
  beforeEach(() => tracked.trackDiagramEnlargementChanged.mockClear());

  /** Zach's crane, step 22, with 16.0's area round the head, open in Annotate, the area selected. */
  function crane() {
    const s = craneStep('S.none');
    const { centre, radius } = toPicture(paperFacesOf(s)!, imprintCase('C.none').frame);
    const area: KnownDiagramAnnotation = { id: 'area-head', kind: 'zoom', from: centre, to: centre, radius };
    const step = { ...s, annotations: [area], annotatedPictureKey: s.picture!.key };
    act(() => {
      useWorkspaceStore.setState({ diagram: insertSteps(createDiagram({ title: 'Crane' }), [step], 0) });
      state().openDiagramStep(step.id, 'annotate');
      state().selectDiagramAnnotation('area-head');
    });
    rerender();
    return { stepId: step.id, centre };
  }
  const area = () => annotations()[0]!;

  it('outlines the anchor face a screen px or so wide at any zoom, as the grips are sized', () => {
    crane();
    const zoomed = () => Number(host.querySelector('[data-viewport-zoom]')!.textContent!.replace('%', '')) / 100;
    const width = () => Number(overlay().querySelector('[data-face-ring]')!.getAttribute('stroke-width')) * zoomed();
    expect(width()).toBeCloseTo(1.25, 6);
    act(() => {
      view().dispatchEvent(new WheelEvent('wheel', { deltaY: 400, ctrlKey: true, bubbles: true, cancelable: true }));
    });
    rerender();
    expect(width()).toBeCloseTo(1.25, 6);
  });

  it('outlines the selected area’s anchor face, and shows the face a click would anchor to', () => {
    const { stepId, centre } = crane();
    expect(overlay().querySelectorAll('[data-face-ring]')).toHaveLength(1);
    act(() => state().setDiagramAnchorPick({ stepId, target: 'area-head' }));
    rerender();
    expect(view().dataset.picking).toBe('true');
    pointer('pointermove', at(...centre));
    expect(overlay().querySelectorAll('[data-face-ring]')).toHaveLength(2);
  });

  it('anchors where it is clicked, one undo step that leaves the area where it is, and leaves the mode', () => {
    const { stepId, centre } = crane();
    act(() => state().setDiagramAnchorPick({ stepId, target: 'area-head' }));
    rerender();
    const past = state().diagramHistory.past.length;
    pointer('pointerdown', at(...centre));
    pointer('pointerup', at(...centre));
    expect(area().anchor).toBeDefined();
    expect(area().from).toEqual(centre);
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(state().diagramAnchorPick).toBeNull();
    expect(tracked.trackDiagramEnlargementChanged.mock.calls).toEqual([['area', 'anchor', 'picked']]);
  });

  it('is put down by selecting anything else, with nothing to clear', () => {
    const { stepId } = crane();
    act(() => state().setDiagramAnchorPick({ stepId, target: 'area-head' }));
    act(() => state().selectDiagramAnnotation(null));
    rerender();
    expect(view().dataset.picking).toBeUndefined();
  });
});

describe('DiagramAnnotateCanvas hung text (17b)', () => {
  beforeEach(() => {
    useSettingsStore.setState({ diagramAnnotateSnap: true, cpSnapRadius: 10 });
  });

  /** A step with a ring and words hung off a point near it, Select in hand, the words selected. */
  function hung() {
    const stepId = mount();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', () => [
        { id: 'ring', kind: 'circle', from: [0.6, 0.4], to: [0.6, 0.4] },
        { id: 'p', kind: 'label', from: [0.3, 0.4], to: [0.3, 0.4], text: 'P', bold: true, halo: true, sizePt: 9, color: '#c91d87', offsetPt: [-10, -8] },
      ]);
      state().setDiagramAnnotateTool(null);
      state().selectDiagramAnnotation('p');
    });
    rerender();
    return stepId;
  }
  const words = () => {
    const unit = ptInPictureUnits(1);
    const label = annotations().find((each) => each.id === 'p')!;
    return [label.from[0] + label.offsetPt![0] * unit, label.from[1] + label.offsetPt![1] * unit] as const;
  };

  it('shows a dot at its anchor, and drags its words alone by them: its offset changes, its anchor stays, nothing snaps', () => {
    hung();
    expect(overlay().querySelector('[data-handle="from"]')).not.toBeNull();
    const unit = ptInPictureUnits(1);
    const [x, y] = words();
    // Taken by its words and moved 20 pt right, 12 down: past the ring's centre, which it does not snap to.
    drag(at(x, y), at(x + 20 * unit, y + 12 * unit));
    rerender();
    const label = annotations().find((each) => each.id === 'p')!;
    expect(label.from).toEqual([0.3, 0.4]);
    expect(label.offsetPt![0]).toBeCloseTo(10, 6);
    expect(label.offsetPt![1]).toBeCloseTo(4, 6);
    expect(state().diagramHistory.past.at(-1)?.label).toBe('Move annotation');
  });

  it('drags it by its anchor onto a ring’s centre, snapped, the words following at their offset', () => {
    hung();
    // Dropped 0.006 from the ring's centre: within the snap radius.
    drag(at(0.3, 0.4), at(0.594, 0.405));
    rerender();
    const label = annotations().find((each) => each.id === 'p')!;
    expect(label.from).toEqual([0.6, 0.4]);
    expect(label.to).toEqual([0.6, 0.4]);
    expect(label.offsetPt).toEqual([-10, -8]);
  });

  it('drags plain text whole, unsnapped, as before', () => {
    const stepId = mount();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', () => [
        { id: 'ring', kind: 'circle', from: [0.6, 0.4], to: [0.6, 0.4] },
        { id: 'q', kind: 'label', from: [0.3, 0.4], to: [0.3, 0.4], text: 'Q' },
      ]);
      state().setDiagramAnnotateTool(null);
      state().selectDiagramAnnotation('q');
    });
    rerender();
    expect(overlay().querySelector('[data-handle="from"]')).toBeNull();
    drag(at(0.3, 0.4), at(0.596, 0.404));
    rerender();
    const label = annotations().find((each) => each.id === 'q')!;
    expect(label.from[0]).toBeCloseTo(0.596, 6);
    expect(label.from[1]).toBeCloseTo(0.404, 6);
    expect(label).not.toHaveProperty('offsetPt');
  });

  it('fills a halo with the face it stands on, on a References step’s back: grey on the sheet, white off it', () => {
    const sent = referencesStep('step-back', { side: 'back' });
    const step = {
      ...sent,
      annotations: [
        { id: 'on', kind: 'label', from: [0.5, 0.5], to: [0.5, 0.5], text: 'ON', halo: true, sizePt: 9 },
        { id: 'off', kind: 'label', from: [1.2, 0.5], to: [1.2, 0.5], text: 'OFF', halo: true, sizePt: 9 },
      ] satisfies KnownDiagramAnnotation[],
      annotatedPictureKey: sent.picture!.key,
    };
    act(() => {
      useWorkspaceStore.setState({ diagram: insertSteps(createDiagram({ title: 'Halo' }), [step], 0) });
      state().openDiagramStep(step.id, 'annotate');
    });
    rerender();
    const halo = (text: string) =>
      [...host.querySelectorAll('text')].find((element) => element.textContent === text)?.getAttribute('stroke');
    expect(halo('ON')).toBe('#b3b3b3');
    expect(halo('OFF')).toBe('#ffffff');
  });

  it('puts a label down in the rail’s Text Style, and says so when it counts it', () => {

    mount();
    useSettingsStore.setState({ diagramAnnotateTextStyle: { color: '#c91d87', bold: true, halo: true, sizePt: 9 } });
    tool('label');
    pointer('pointerdown', at(0.5, 0.5));
    pointer('pointerup', at(0.5, 0.5));
    expect(annotations()[0]).toMatchObject({ kind: 'label', color: '#c91d87', bold: true, halo: true, sizePt: 9 });
    expect(annotations()[0]).not.toHaveProperty('offsetPt');
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([
      ['label', 'none', { color: 'reference', bold: 'on', halo: 'on', size: '9' }],
    ]);
  });
});

describe('DiagramAnnotateCanvas stars (Revision 3)', () => {
  const line: KnownDiagramAnnotation = { id: 'line', kind: 'valley-line', from: [0.2, 0.5], to: [0.6, 0.5] };
  const star: KnownDiagramAnnotation = { id: 'star', kind: 'star', from: [0.5, 0.3], to: [0.5, 0.3] };

  beforeEach(() => {
    useSettingsStore.setState({ diagramAnnotateSnap: true, cpSnapRadius: 10, diagramAnnotateStarFill: 'black' });
    tracked.trackDiagramMarkStyled.mockClear();
  });

  /** The step with these annotations, a tool in hand, and one selected. */
  function drawn(list: KnownDiagramAnnotation[], toolInHand: Parameters<typeof tool>[0] = null, selected: string | null = null, readOnly = false) {
    const stepId = mount();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', () => list);
      state().selectDiagramAnnotation(selected);
      state().setDiagramAnnotateTool(toolInHand);
    });
    rerender(readOnly);
    return stepId;
  }
  const click = (point: [number, number], init: PressInit = {}) => {
    pointer('pointerdown', point, 1, 'mouse', overlay(), init);
    pointer('pointerup', point, 1, 'mouse', overlay(), init);
    rerender();
  };
  /** A handle's middle on the client: a square's or a turn handle's, by its name. */
  const handleAt = (name: string): [number, number] => {
    const handle = overlay().querySelector(`[data-handle="${name}"]`)!;
    if (handle.tagName.toLowerCase() === 'circle') return [Number(handle.getAttribute('cx')), Number(handle.getAttribute('cy'))];
    const side = Number(handle.getAttribute('width'));
    return [Number(handle.getAttribute('x')) + side / 2, Number(handle.getAttribute('y')) + side / 2];
  };
  const theStar = () => annotations().find((each) => each.kind === 'star')!;
  const label = () => state().diagramHistory.past.at(-1)?.label;

  it('puts a star down with a click, snapped as a circle is, in the rail’s fill, counted with it; the tool stays in hand', () => {
    drawn([line], 'star');
    click(at(0.605, 0.497));
    expect(theStar()).toEqual({ id: theStar().id, kind: 'star', from: [0.6, 0.5], to: [0.6, 0.5], fill: 'black' });
    expect(state().diagramAnnotateTool).toBe('star');
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([['star', 'snapped', { fill: 'filled' }]]);
    // Outline, laid as one: no fill written.
    act(() => useSettingsStore.getState().setDiagramAnnotateStarFill('white'));
    click(at(0.3, 0.2));
    const outline = annotations().at(-1)!;
    expect(outline).toMatchObject({ kind: 'star', from: [0.3, 0.2] });
    expect(outline).not.toHaveProperty('fill');
    // With ⌘ held, where the pointer is.
    click(at(0.205, 0.497), { free: true });
    expect(annotations().at(-1)!.from[0]).toBeCloseTo(0.205, 6);
    expect(tracked.trackDiagramAnnotationAdded.mock.calls.slice(1)).toEqual([
      ['star', 'nothing_near', { fill: 'outline' }],
      ['star', 'free', { fill: 'outline' }],
    ]);
  });

  it('lets a line drawn after it snap to its centre, as the sample’s dashed line starts on its star', () => {
    drawn([star], 'line');
    drag(at(0.505, 0.296), at(0.8, 0.3));
    expect(annotations().at(-1)).toMatchObject({ kind: 'valley-line', from: [0.5, 0.3] });
  });

  it('shows a selected star’s transform box: its outline, a square at each corner and a turn handle out from each — none on a diagram that cannot change', () => {
    drawn([star], null, 'star');
    expect(overlay().querySelector('[data-transform-box] polygon')).not.toBeNull();
    const names = [...overlay().querySelectorAll('[data-transform-box] [data-handle]')].map((each) => each.getAttribute('data-handle'));
    expect(names).toEqual(['rotate-nw', 'rotate-ne', 'rotate-se', 'rotate-sw', 'scale-nw', 'scale-ne', 'scale-se', 'scale-sw']);
    // 8 px squares and 5 px turn handles, 18 px out from each corner (a world px is a screen px here).
    const square = overlay().querySelector('[data-handle="scale-ne"]')!;
    expect(Number(square.getAttribute('width'))).toBeCloseTo(8, 9);
    expect(Number(overlay().querySelector('[data-handle="rotate-ne"]')!.getAttribute('r'))).toBeCloseTo(5, 9);
    const [cx, cy] = handleAt('scale-ne');
    const [rx, ry] = handleAt('rotate-ne');
    expect(Math.hypot(rx - cx, ry - cy)).toBeCloseTo(18, 6);
    // The corner where the star's box is: its tips' square, 4.5 ink out each way.
    const [sx, sy] = at(0.5, 0.3);
    expect(cx - sx).toBeCloseTo(4.5 * INK_UNITS * 1000, 6);
    expect(sy - cy).toBeCloseTo(4.5 * INK_UNITS * 1000, 6);
    rerender(true);
    expect(overlay().querySelector('[data-transform-box] polygon')).not.toBeNull();
    expect(overlay().querySelectorAll('[data-transform-box] [data-handle]')).toHaveLength(0);
  });

  it('scales a star about its centre by a corner square, one undo step, counted by its handle; a click records nothing', () => {
    drawn([star], null, 'star');
    const past = state().diagramHistory.past.length;
    const corner = handleAt('scale-se');
    const [sx, sy] = at(0.5, 0.3);
    // Drawn out to twice as far from the middle.
    drag(corner, [sx + 2 * (corner[0] - sx), sy + 2 * (corner[1] - sy)]);
    expect(theStar().from).toEqual([0.5, 0.3]);
    expect(theStar().scale).toBeCloseTo(2, 3);
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(label()).toBe('Resize annotation');
    expect(tracked.trackDiagramMarkStyled.mock.calls).toEqual([['star', 'size', 'handle']]);
    // Still selected, its box grown with it; a click on a square changes nothing.
    rerender();
    click(handleAt('scale-nw'));
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(state().diagramSelectedAnnotationId).toBe('star');
  });

  it('turns it by a turn handle about its centre, freely, and with Shift in 15° steps', () => {
    drawn([star], null, 'star');
    const [sx, sy] = at(0.5, 0.3);
    const about = ([x, y]: [number, number], degrees: number): [number, number] => {
      const a = (degrees * Math.PI) / 180;
      return [sx + (x - sx) * Math.cos(a) - (y - sy) * Math.sin(a), sy + (x - sx) * Math.sin(a) + (y - sy) * Math.cos(a)];
    };
    const turn = handleAt('rotate-ne');
    drag(turn, about(turn, 22));
    expect(theStar().angle).toBeCloseTo(22, 1);
    expect(theStar().from).toEqual([0.5, 0.3]);
    expect(label()).toBe('Rotate annotation');
    expect(tracked.trackDiagramMarkStyled.mock.calls).toEqual([['star', 'rotation', 'handle']]);
    rerender();
    const again = handleAt('rotate-ne');
    drag(again, about(again, 20), 1, 'mouse', overlay(), { shiftKey: true });
    // 42° held to the nearest 15°.
    expect(theStar().angle).toBe(45);
  });

  it('moves it whole by its body, snapping where it lands as when it was put down', () => {
    drawn([line, star], null, 'star');
    drag(at(0.5, 0.3), at(0.597, 0.503));
    expect(theStar().from).toEqual([0.6, 0.5]);
    expect(label()).toBe('Move annotation');
  });

  it('draws its box’s outline and its handles’ strokes 1.5 screen px wide at any zoom, as its squares are drawn 8 (18b review)', () => {
    drawn([star], null, 'star');
    const strokes = [...overlay().querySelectorAll('[data-transform-box] polygon, [data-transform-box] [data-handle]')];
    expect(strokes).toHaveLength(9);
    // A world px is a screen px here: the stroke is divided by the zoom as the squares' side is.
    const side = Number(overlay().querySelector('[data-handle="scale-ne"]')!.getAttribute('width'));
    for (const each of strokes) expect(Number(each.getAttribute('stroke-width')) / side, each.getAttribute('data-handle') ?? 'outline').toBeCloseTo(1.5 / 8, 9);
  });

  /**
   * By a finger (18b review): its 18 px reach is more than a corner's 17 px
   * from the middle of a box at its 24 px floor, so a drag meant to move a
   * selected star scaled it. The overlay's screen matrix says the zoom; a
   * client point is still a world point.
   */
  describe('by a finger', () => {
    function fingerAt(zoom: number) {
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)', addEventListener() {}, removeEventListener() {} }));
      const scaled = { ...identity, a: zoom, d: zoom, inverse: () => scaled };
      (SVGElement.prototype as unknown as { getScreenCTM: () => typeof scaled }).getScreenCTM = () => scaled;
    }
    /** A point most of the way out along the star's arm `degrees` clockwise from its top tip, on the client. */
    const arm = (degrees: number): [number, number] => {
      const a = (degrees * Math.PI) / 180;
      const reach = 0.85 * 4.5 * INK_UNITS;
      const [u, v] = theStar().from;
      return at(u + reach * Math.sin(a), v - reach * Math.cos(a));
    };
    const cases = [
      ['at an iPad’s fit, the star 31 px across', 31.3],
      ['at the box’s 24 px floor, the star 6 px across', 6],
    ] as const;
    for (const [name, across] of cases) {
      it(`moves a selected star by a finger on its middle or an arm ${name}; a square still scales it`, () => {
        const zoom = across / (9 * INK_UNITS * 1000);
        fingerAt(zoom);
        drawn([star], null, 'star');
        for (const press of [() => at(...theStar().from), () => arm(144), () => arm(216)]) {
          const was = theStar().from;
          const from = press();
          drag(from, [from[0] + 40, from[1]], 1, 'touch');
          expect(label()).toBe('Move annotation');
          expect(theStar().from[0]).toBeCloseTo(was[0] + 0.04, 6);
          expect('scale' in theStar()).toBe(false);
          rerender();
        }
        // On a square as it is drawn: a screen px is 1 / (zoom × 1000) of the frame.
        const corner = transformBoxHandles(theStar(), 1 / (zoom * 1000))!.handles.scale.find((each) => each.handle === 'se')!.at;
        const square = at(corner.x, corner.y);
        drag(square, [square[0] + 10, square[1] + 10], 1, 'touch');
        expect(label()).toBe('Resize annotation');
        expect(theStar().scale).toBeGreaterThan(1);
      });
    }

    it('draws a finger’s handles larger and a touch target apart, and takes a press 14 px wide of a corner as its square, not its turn handle (18d follow-up)', () => {
      fingerAt(1);
      drawn([star], null, 'star');
      // 12 px squares and 7 px turn handles, each turn handle 44 px (`--touch-target`) out from its corner.
      expect(Number(overlay().querySelector('[data-handle="scale-se"]')!.getAttribute('width'))).toBeCloseTo(12, 9);
      expect(Number(overlay().querySelector('[data-handle="rotate-se"]')!.getAttribute('r'))).toBeCloseTo(7, 9);
      const corner = handleAt('scale-se');
      const turn = handleAt('rotate-se');
      expect(Math.hypot(turn[0] - corner[0], turn[1] - corner[1])).toBeCloseTo(44, 6);
      // Out along the line from the middle, where a finger aiming at the corner lands a little wide: 18 px apart, the turn handle took it.
      const [sx, sy] = at(0.5, 0.3);
      const out = Math.hypot(corner[0] - sx, corner[1] - sy);
      const press: [number, number] = [corner[0] + ((corner[0] - sx) / out) * 14, corner[1] + ((corner[1] - sy) / out) * 14];
      drag(press, [press[0], press[1] + 40], 1, 'touch');
      expect(label()).toBe('Resize annotation');
      expect(theStar().scale).toBeGreaterThan(1);
      expect('angle' in theStar()).toBe(false);
    });
  });

  it('takes a drag on a just-laid star’s square with K still in hand: it scales that star, and lays no other; its body is drawn on (18d)', () => {
    drawn([], 'star');
    click(at(0.5, 0.3));
    const laid = theStar();
    expect(state().diagramSelectedAnnotationId).toBe(laid.id);
    expect(state().diagramAnnotateTool).toBe('star');
    const past = state().diagramHistory.past.length;
    // The square's cursor, as with Select; over its body, the tool's own.
    const hover = (point: [number, number]) => {
      pointer('pointermove', point);
      return view().getAttribute('data-transform-hover');
    };
    expect(hover(handleAt('scale-se'))).toBe('scale');
    expect(hover(handleAt('rotate-se'))).toBe('rotate');
    expect(hover(at(0.5, 0.3))).toBeNull();
    const [sx, sy] = at(0.5, 0.3);
    const corner = handleAt('scale-se');
    drag(corner, [sx + 2 * (corner[0] - sx), sy + 2 * (corner[1] - sy)]);
    expect(annotations()).toHaveLength(1);
    expect(theStar()).toMatchObject({ id: laid.id, from: [0.5, 0.3] });
    expect(theStar().scale).toBeCloseTo(2, 3);
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(label()).toBe('Resize annotation');
    expect(state().diagramAnnotateTool).toBe('star');
    // A click away from its handles lays the next star, as the tool in hand does.
    rerender();
    click(at(0.2, 0.6));
    expect(annotations()).toHaveLength(2);
  });

  it('lets another tool draw from a selected star’s square: only the Star takes its handles (18d review)', () => {
    drawn([star], 'valley-arrow', 'star');
    const corner = handleAt('scale-se');
    pointer('pointermove', corner);
    expect(view().getAttribute('data-transform-hover')).toBeNull();
    drag(corner, [corner[0] + 120, corner[1] + 60]);
    expect(annotations().filter((each) => each.kind === 'valley-arrow')).toHaveLength(1);
    expect(theStar()).toEqual(star);
    expect(label()).toBe('Add annotation');
  });

  it('shows the Edit canvas’s cursors over its box with Select: move on its body, pointer on a square, grab on a turn handle', () => {
    drawn([star], null, 'star');
    const hover = (point: [number, number]) => {
      pointer('pointermove', point);
      return view().getAttribute('data-transform-hover');
    };
    expect(hover(at(0.5, 0.3))).toBe('body');
    expect(hover(handleAt('scale-sw'))).toBe('scale');
    expect(hover(handleAt('rotate-sw'))).toBe('rotate');
    expect(hover(at(0.8, 0.8))).toBeNull();
    // Nothing selected: no box to say anything of.
    act(() => state().selectDiagramAnnotation(null));
    rerender();
    expect(hover(at(0.5, 0.3))).toBeNull();
  });
});

describe('DiagramAnnotateCanvas eyes (Revision 3)', () => {
  // Looking left, as the eye in Zach's note does.
  const eye: KnownDiagramAnnotation = { id: 'eye', kind: 'eye', from: [0.5, 0.3], to: [0.5, 0.3], angle: 180 };

  beforeEach(() => {
    useSettingsStore.setState({ diagramAnnotateSnap: true, cpSnapRadius: 10 });
    tracked.trackDiagramMarkStyled.mockClear();
  });

  function drawn(list: KnownDiagramAnnotation[], toolInHand: Parameters<typeof tool>[0] = null, selected: string | null = null) {
    const stepId = mount();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', () => list);
      state().selectDiagramAnnotation(selected);
      state().setDiagramAnnotateTool(toolInHand);
    });
    rerender();
    return stepId;
  }
  const click = (point: [number, number], init: PressInit = {}) => {
    pointer('pointerdown', point, 1, 'mouse', overlay(), init);
    pointer('pointerup', point, 1, 'mouse', overlay(), init);
    rerender();
  };
  const handleAt = (name: string): [number, number] => {
    const handle = overlay().querySelector(`[data-handle="${name}"]`)!;
    if (handle.tagName.toLowerCase() === 'circle') return [Number(handle.getAttribute('cx')), Number(handle.getAttribute('cy'))];
    const side = Number(handle.getAttribute('width'));
    return [Number(handle.getAttribute('x')) + side / 2, Number(handle.getAttribute('y')) + side / 2];
  };
  const theEye = () => annotations().find((each) => each.kind === 'eye')!;
  const label = () => state().diagramHistory.past.at(-1)?.label;
  /** A point `length` picture units from `from`, `degrees` clockwise from right. */
  const toward = (from: [number, number], degrees: number, length = 0.2): [number, number] => {
    const a = (degrees * Math.PI) / 180;
    return at(from[0] + length * Math.cos(a), from[1] + length * Math.sin(a));
  };

  it('lays an eye where a drag starts, looking toward where it ends, freely; counted, one undo step, and the tool stays in hand (R3-8 A)', () => {
    // A line under the start: an eye is put down freely, never snapped to it (R3-24 A).
    drawn([{ id: 'line', kind: 'valley-line', from: [0.2, 0.2], to: [0.6, 0.2] }], 'eye');
    const past = state().diagramHistory.past.length;
    drag(at(0.205, 0.203), toward([0.205, 0.203], 37));
    expect(theEye().from[0]).toBeCloseTo(0.205, 6);
    expect(theEye().from[1]).toBeCloseTo(0.203, 6);
    expect(theEye().to).toEqual(theEye().from);
    expect(theEye().angle).toBeCloseTo(37, 2);
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(label()).toBe('Add annotation');
    expect(state().diagramSelectedAnnotationId).toBe(theEye().id);
    expect(state().diagramAnnotateTool).toBe('eye');
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([['eye', 'none']]);
  });

  it('holds the way a drag lays it to 15° steps with Shift (R3-28 A)', () => {
    drawn([], 'eye');
    drag(at(0.3, 0.3), toward([0.3, 0.3], 98), 1, 'mouse', overlay(), { shiftKey: true });
    expect(theEye().angle).toBe(105);
  });

  it('looks at the picture’s middle when it is clicked', () => {
    drawn([], 'eye');
    // Left of the middle of a 1 × 0.75 frame, level with it: looking right, its angle unsaid.
    click(at(0.1, 0.375));
    expect(annotations().at(-1)).toEqual({ id: annotations().at(-1)!.id, kind: 'eye', from: [0.1, 0.375], to: [0.1, 0.375] });
    // Right of it, looking left; below it, looking up.
    click(at(0.9, 0.375));
    expect(annotations().at(-1)!.angle).toBe(180);
    click(at(0.5, 0.7));
    expect(annotations().at(-1)!.angle).toBe(270);
  });

  it('shows a selected eye’s transform box, turned the way it looks: corners only, and no corner or direction grip', () => {
    drawn([eye], null, 'eye');
    const names = [...overlay().querySelectorAll('[data-selection] [data-handle]')].map((each) => each.getAttribute('data-handle'));
    expect(names).toEqual(['rotate-nw', 'rotate-ne', 'rotate-se', 'rotate-sw', 'scale-nw', 'scale-ne', 'scale-se', 'scale-sw']);
    // Looking left, its box's own north-west is the page's south-east: 7.5 ink right of it and 4.8 below.
    const [cx, cy] = handleAt('scale-nw');
    const [ex, ey] = at(0.5, 0.3);
    expect(cx - ex).toBeCloseTo(7.5 * INK_UNITS * 1000, 6);
    expect(cy - ey).toBeCloseTo(4.8 * INK_UNITS * 1000, 6);
  });

  it('scales about its centre by a corner square, turns the way it looks by a turn handle — Shift in 15° steps — and moves by its body, each one undo step', () => {
    drawn([eye], null, 'eye');
    const [ex, ey] = at(0.5, 0.3);
    const corner = handleAt('scale-se');
    drag(corner, [ex + 1.5 * (corner[0] - ex), ey + 1.5 * (corner[1] - ey)]);
    expect(theEye()).toMatchObject({ from: [0.5, 0.3], angle: 180 });
    expect(theEye().scale).toBeCloseTo(1.5, 3);
    expect(label()).toBe('Resize annotation');
    rerender();
    const about = ([x, y]: [number, number], degrees: number): [number, number] => {
      const a = (degrees * Math.PI) / 180;
      return [ex + (x - ex) * Math.cos(a) - (y - ey) * Math.sin(a), ey + (x - ex) * Math.sin(a) + (y - ey) * Math.cos(a)];
    };
    const turn = handleAt('rotate-ne');
    drag(turn, about(turn, 38), 1, 'mouse', overlay(), { shiftKey: true });
    expect(theEye().angle).toBe(225);
    expect(label()).toBe('Rotate annotation');
    expect(tracked.trackDiagramMarkStyled.mock.calls).toEqual([
      ['eye', 'size', 'handle'],
      ['eye', 'rotation', 'handle'],
    ]);
    rerender();
    drag(at(0.5, 0.3), at(0.6, 0.35));
    expect(theEye().from[0]).toBeCloseTo(0.6, 6);
    expect(theEye().from[1]).toBeCloseTo(0.35, 6);
    expect(theEye().angle).toBe(225);
    expect(label()).toBe('Move annotation');
  });

  it('takes a drag on a just-laid eye’s turn handle with Y still in hand: it turns that eye, and lays no other (18d)', () => {
    drawn([], 'eye');
    drag(at(0.5, 0.3), toward([0.5, 0.3], 180));
    expect(theEye().angle).toBe(180);
    expect(state().diagramAnnotateTool).toBe('eye');
    rerender();
    const [ex, ey] = at(0.5, 0.3);
    const turn = handleAt('rotate-ne');
    const a = (40 * Math.PI) / 180;
    drag(turn, [ex + (turn[0] - ex) * Math.cos(a) - (turn[1] - ey) * Math.sin(a), ey + (turn[0] - ex) * Math.sin(a) + (turn[1] - ey) * Math.cos(a)]);
    expect(annotations().filter((each) => each.kind === 'eye')).toHaveLength(1);
    expect(theEye().angle).toBeCloseTo(220, 1);
    expect(label()).toBe('Rotate annotation');
  });
});

describe('a paste brought into view (18d review)', () => {
  const star: KnownDiagramAnnotation = { id: 'star', kind: 'star', from: [0.9, 0.7], to: [0.9, 0.7] };

  it('asks the camera to show what a paste put on the step, once, and not a paste made before the canvas opened', () => {
    const stepId = mount();
    act(() => {
      useWorkspaceStore.setState({ activePanelId: 'diagram' });
      state().editDiagramAnnotations(stepId, 'Add annotation', () => [star]);
      state().selectDiagramAnnotation('star');
      state().copySelection();
    });
    rerender();
    camera.revealed.length = 0;
    act(() => void state().pasteClipboard());
    rerender();
    // Down and right of its original by a paste's step: its box, in world px, round the copy.
    const copy = annotations()[1]!;
    expect(copy.from[0]).toBeCloseTo(0.93, 9);
    expect(camera.revealed).toHaveLength(1);
    const [rect] = camera.revealed;
    const [x, y] = at(...copy.from);
    expect(rect!.x).toBeLessThan(x);
    expect(rect!.x + rect!.width).toBeGreaterThan(x);
    expect(rect!.y).toBeLessThan(y);
    expect(rect!.y + rect!.height).toBeGreaterThan(y);
    expect(rect!.width).toBeLessThan(at(0.2, 0)[0] - at(0, 0)[0]);
    // An edit since asks nothing; nor does the canvas opened again on the step.
    act(() => {
      state().editDiagramAnnotations(stepId, 'Move annotation', (list) =>
        list.map((each) => (each.id === 'star' ? { ...each, from: [0.5, 0.5] as [number, number], to: [0.5, 0.5] as [number, number] } : each))
      );
    });
    act(() => root.unmount());
    root = createRoot(host);
    rerender();
    expect(camera.revealed).toHaveLength(1);
  });
});

describe('DiagramAnnotateCanvas shapes (Revision 3)', () => {
  const oval: KnownDiagramAnnotation = { id: 'oval', kind: 'oval', from: [0.5, 0.4], to: [0.5, 0.4], size: [0.4, 0.2] };
  const line: KnownDiagramAnnotation = { id: 'line', kind: 'valley-line', from: [0.45, 0.42], to: [0.55, 0.42] };

  beforeEach(() => {
    useSettingsStore.setState({ diagramAnnotateSnap: true, cpSnapRadius: 10 });
    tracked.trackDiagramMarkStyled.mockClear();
    tracked.trackDiagramEnlargementChanged.mockClear();
  });

  function drawn(list: KnownDiagramAnnotation[], toolInHand: Parameters<typeof tool>[0] = null, selected: string | null = null) {
    const stepId = mount();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', () => list);
      state().selectDiagramAnnotation(selected);
      state().setDiagramAnnotateTool(toolInHand);
    });
    rerender();
    return stepId;
  }
  const click = (point: [number, number], init: PressInit = {}) => {
    pointer('pointerdown', point, 1, 'mouse', overlay(), init);
    pointer('pointerup', point, 1, 'mouse', overlay(), init);
    rerender();
  };
  const handleAt = (name: string): [number, number] => {
    const handle = overlay().querySelector(`[data-handle="${name}"]`)!;
    if (handle.tagName.toLowerCase() === 'circle') return [Number(handle.getAttribute('cx')), Number(handle.getAttribute('cy'))];
    const side = Number(handle.getAttribute('width'));
    return [Number(handle.getAttribute('x')) + side / 2, Number(handle.getAttribute('y')) + side / 2];
  };
  const shape = () => annotations().find((each) => each.kind === 'oval' || each.kind === 'rectangle')!;
  const label = () => state().diagramHistory.past.at(-1)?.label;
  const near = (actual: readonly number[], expected: readonly number[], digits = 6) =>
    actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, digits));

  it('lays an oval corner to corner, put down freely, counted, one undo step, the tool staying in hand (R3-10b A, R3-24 A)', () => {
    // The drag starts a hair off the line's end: nothing snaps it there.
    drawn([{ id: 'l', kind: 'valley-line', from: [0.2, 0.2], to: [0.6, 0.2] }], 'oval');
    const past = state().diagramHistory.past.length;
    drag(at(0.203, 0.205), at(0.603, 0.405));
    near(shape().from, [0.403, 0.305]);
    near(shape().size!, [0.4, 0.2]);
    expect(shape().to).toEqual(shape().from);
    expect('angle' in shape()).toBe(false);
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(label()).toBe('Add annotation');
    expect(state().diagramSelectedAnnotationId).toBe(shape().id);
    expect(state().diagramAnnotateTool).toBe('oval');
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([['oval', 'none']]);
  });

  it('lays a circle or a square with Shift, from its middle with Alt, and a standard size with a click', () => {
    drawn([], 'rectangle');
    drag(at(0.2, 0.2), at(0.5, 0.3), 1, 'mouse', overlay(), { shiftKey: true });
    near(annotations().at(-1)!.size!, [0.3, 0.3]);
    expect(annotations().at(-1)!.kind).toBe('rectangle');
    drag(at(0.5, 0.4), at(0.6, 0.45), 1, 'mouse', overlay(), { altKey: true });
    near(annotations().at(-1)!.from, [0.5, 0.4]);
    near(annotations().at(-1)!.size!, [0.2, 0.1]);
    click(at(0.3, 0.6));
    expect(annotations().at(-1)).toMatchObject({ kind: 'rectangle', from: [0.3, 0.6], size: [0.3, 0.3] });
  });

  it('shows a selected shape’s transform box: eight squares and four turn handles, its outline its own', () => {
    drawn([oval], null, 'oval');
    const names = [...overlay().querySelectorAll('[data-transform-box] [data-handle]')].map((each) => each.getAttribute('data-handle'));
    expect(names).toEqual([
      'rotate-nw',
      'rotate-ne',
      'rotate-se',
      'rotate-sw',
      'scale-nw',
      'scale-n',
      'scale-ne',
      'scale-e',
      'scale-se',
      'scale-s',
      'scale-sw',
      'scale-w',
    ]);
    const [ox, oy] = at(0.5, 0.4);
    const [ex, ey] = handleAt('scale-e');
    expect(ex - ox).toBeCloseTo(200, 6);
    expect(ey - oy).toBeCloseTo(0, 6);
  });

  it('resizes by a square freely, Shift in proportion, Alt about its centre; turns by a handle, Shift by 15°; each one undo step, counted by its handle', () => {
    drawn([oval], null, 'oval');
    // The east edge drawn 50 px out: 0.05 wider, the west edge held.
    const e = handleAt('scale-e');
    drag(e, [e[0] + 50, e[1] + 30]);
    near(shape().size!, [0.45, 0.2]);
    near(shape().from, [0.525, 0.4]);
    expect(label()).toBe('Resize annotation');
    rerender();
    // The south-east corner with Alt: about its centre.
    const se = handleAt('scale-se');
    drag(se, [se[0] + 20, se[1] + 10], 1, 'mouse', overlay(), { altKey: true });
    near(shape().from, [0.525, 0.4]);
    near(shape().size!, [0.49, 0.22]);
    rerender();
    // With Shift: in its proportions.
    const corner = handleAt('scale-se');
    drag(corner, [corner[0] + 49, corner[1]], 1, 'mouse', overlay(), { shiftKey: true });
    expect(shape().size![0] / shape().size![1]).toBeCloseTo(0.49 / 0.22, 6);
    rerender();
    const [cx, cy] = at(...shape().from);
    const turn = handleAt('rotate-ne');
    const a = (38 * Math.PI) / 180;
    drag(turn, [cx + (turn[0] - cx) * Math.cos(a) - (turn[1] - cy) * Math.sin(a), cy + (turn[0] - cx) * Math.sin(a) + (turn[1] - cy) * Math.cos(a)], 1, 'mouse', overlay(), {
      shiftKey: true,
    });
    expect(shape().angle).toBe(45);
    expect(label()).toBe('Rotate annotation');
    expect(tracked.trackDiagramMarkStyled.mock.calls).toEqual([
      ['oval', 'size', 'handle'],
      ['oval', 'size', 'handle'],
      ['oval', 'size', 'handle'],
      ['oval', 'rotation', 'handle'],
    ]);
    expect(tracked.trackDiagramEnlargementChanged).not.toHaveBeenCalled();
  });

  it('moves by a press anywhere in its box while it is selected, but a line inside it is taken first (R3-31 A)', () => {
    drawn([oval, line], null, 'oval');
    const hover = (point: [number, number]) => {
      pointer('pointermove', point);
      return view().getAttribute('data-transform-hover');
    };
    // Empty paper inside it: the move cursor, and a drag moves it.
    expect(hover(at(0.4, 0.36))).toBe('body');
    expect(hover(at(0.5, 0.42))).toBeNull();
    drag(at(0.4, 0.36), at(0.45, 0.36));
    near(shape().from, [0.55, 0.4]);
    expect(label()).toBe('Move annotation');
    rerender();
    // The line inside it: selected by a press on it, not moved through.
    click(at(0.5, 0.42));
    expect(state().diagramSelectedAnnotationId).toBe('line');
  });

  it('lets a press inside an unselected shape select what is under it, or nothing', () => {
    drawn([oval, line]);
    click(at(0.5, 0.42));
    expect(state().diagramSelectedAnnotationId).toBe('line');
    click(at(0.4, 0.36));
    expect(state().diagramSelectedAnnotationId).toBeNull();
    // Its rim selects it.
    click(at(0.7, 0.4));
    expect(state().diagramSelectedAnnotationId).toBe('oval');
  });

  it('takes a drag on a just-laid shape’s square with its tool still in hand: it resizes that shape, and lays no other (18d)', () => {
    drawn([], 'rectangle');
    drag(at(0.2, 0.2), at(0.5, 0.4));
    expect(annotations()).toHaveLength(1);
    rerender();
    const e = handleAt('scale-e');
    drag(e, [e[0] + 100, e[1]]);
    expect(annotations()).toHaveLength(1);
    near(shape().size!, [0.4, 0.2]);
    expect(label()).toBe('Resize annotation');
    expect(state().diagramAnnotateTool).toBe('rectangle');
  });

  it('lets another tool draw from a selected shape’s squares and turn handles: only the shape’s own tool takes them (18d review)', () => {
    drawn([], 'oval');
    drag(at(0.2, 0.2), at(0.5, 0.4));
    const laid = shape();
    expect(state().diagramSelectedAnnotationId).toBe(laid.id);
    // The Valley Fold Arrow picked up: the oval stays selected, its box drawn.
    tool('valley-arrow');
    rerender();
    expect(state().diagramSelectedAnnotationId).toBe(laid.id);
    const e = handleAt('scale-e');
    pointer('pointermove', e);
    expect(view().getAttribute('data-transform-hover')).toBeNull();
    // A drag from its square draws the arrow, and leaves the oval as it was.
    drag(e, [e[0] + 100, e[1] + 80]);
    expect(annotations().filter((each) => each.kind === 'valley-arrow')).toHaveLength(1);
    expect(annotations().find((each) => each.id === laid.id)).toEqual(laid);
    expect(label()).toBe('Add annotation');
    // Another shape's tool, from the oval's turn handle: a rectangle, not a turn.
    act(() => state().selectDiagramAnnotation(laid.id));
    tool('rectangle');
    rerender();
    const turn = handleAt('rotate-se');
    pointer('pointermove', turn);
    expect(view().getAttribute('data-transform-hover')).toBeNull();
    drag(turn, [turn[0] + 100, turn[1] + 100]);
    expect(annotations().filter((each) => each.kind === 'rectangle')).toHaveLength(1);
    expect(annotations().find((each) => each.id === laid.id)).toEqual(laid);
  });
});
