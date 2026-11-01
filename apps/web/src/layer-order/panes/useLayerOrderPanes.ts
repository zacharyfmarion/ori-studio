/**
 * The Layer order dialog's two panes, bound: what each `PaperPane` is handed
 * for the session's status, the host's look, the view and the marks
 * (`implementation-plans/layer-order-dialog.md`, row U8). The panes'
 * component (`components/layer-order/LayerOrderPanes.tsx`) only composes
 * what these hooks answer.
 *
 * - **The crease pattern** draws at once, from the request's source, as
 *   Edit draws a crease pattern whatever the host (D18): in the line style
 *   and width of Edit's view, which the host hands over in its look, in
 *   Edit's frame. Only the pattern the fold came from: the source's creases
 *   and the aux lines of the host's region, its sheet, never the rest of a
 *   document of many. Its faces, for tints, rings, letters and hits, come
 *   from the session's scene once it is open, or from the scene the host
 *   shows until then, so a refusal can name a face.
 * - **The folded figure** draws once the session is open: the side shown's
 *   scene, restacked for the order on screen (a preview's included),
 *   painted by the shared pipeline (`foldedFlatPaperScene`, then
 *   `paperSceneToFoldedGeometry` inside `PaperPane`) in the host's paper
 *   style and policy, turned as the host turns it from the side its picture
 *   shows, with no spread (D18). X-ray draws every layer, the buried ones
 *   too, see-through.
 * - **Fit**: each pane fits its own content as every `PaperPane` does,
 *   about 70% of it: the crease pattern its region's paper, the folded
 *   figure the figure itself, from either side, X-ray or not. So a figure
 *   that folds small is drawn large, and the two readouts each say their
 *   own scale (your call, 2026-10-26, over Round3's one shared sheet). A
 *   turn over keeps the figure in view.
 * - **What follows the pointer** (the face pointed at, a row's faces) is
 *   painted apart, on the overlay channel (`pointerPanePaint`): under the
 *   creases on the crease pattern, as every tint there is (D20), over the
 *   paper on the folded figure. The letters take it on last
 *   (`withPointerLetters`): a hover changes those and nothing else. The marks' lists are held by value, so a caller that builds
 *   them afresh for each hover rebuilds nothing.
 *
 * The inks are the theme's, read off the dialog's element, and read again
 * when the theme changes.
 */
import { useMemo } from 'react';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { Point } from '../../lib/geometry';
import type { LayerOrderRequest } from '../../lib/layerOrder/layerOrderRequest';
import type { PaperScene, ScenePoint } from '../../lib/paper/paperScene';
import { cpPatternStrokes, type CpPatternStrokes } from '../../cp-workspace/adapters/cpPatternStrokes';
import { foldedFlatPaperScene } from '../../cp-workspace/folded/foldedFlatScene';
import { StackHitIndex, type StackHit } from '../../cp-workspace/picking/stackHitIndex';
import type { UserBounds } from '../../cp-workspace/renderer/camera';
import { readCssVarColor } from '../../cp-workspace/renderer/cssColor';
import { cpCreaseStrokeWidthPx } from '../../cp-workspace/cpSizingScales';
import { ptToDevicePx } from '../../lib/paper/paperStyle';
import { surfacePaperStyle } from '../../lib/paper/paperStyleResolve';
import { penForRole } from '../../lib/paper/paperSvg';
import type { FillGeometry, Rgba } from '../../cp-workspace/renderer/types';
import type { PaperLook, PaperPaneOverlay } from '../../cp-workspace/surface/PaperPane';
import type { LayerOrderSessionStatus } from '../dialog/useLayerOrderSession';
import type { FaceLetters, LayerFace } from '../engine/faceIndex';
import type { LayerSide } from '../engine/layerOrderEngine';
import {
  creaseSegments,
  foldedOutlinesOf,
  foldedPaneFrame,
  foldedPaneLines,
  foldedPaneToUser,
  foldedPivot,
  PANE_USER_PER_UNIT,
  paneFacesOf,
  paneTurnDeg,
  patternPaneFrame,
  patternPaneLines,
  patternPaneToUser,
  restackedScene,
  stackDepth,
  xrayFaceAlpha,
  type LayerPaneSegment,
} from './layerPaneFigure';
import type { LayerPaneHit, LayerPaneId } from './layerPaneInput';
import {
  foldedLabelIndex,
  labelLineIndex,
  paneLetters,
  patternLabelIndex,
  withPointerLetters,
  type LayerLabelLines,
  type LayerLabelSpots,
  type LayerPaneLabel,
} from './layerPaneLabels';
import {
  baseFoldedPaint,
  basePatternPaint,
  NO_FACE_MARKS,
  paneTintFills,
  pointerPanePaint,
  type LayerFaceMarks,
  type LayerPaneInks,
  type LayerPaneInk,
  type LayerPanePaint,
  type LayerPanesStacks,
  type LayerPanesView,
} from './layerPaneMarks';

/** A ring a pane draws over everything, inside its face: its face's ring in the pane's frame. */
export interface LayerPaneRingMark {
  readonly face: LayerFace;
  readonly ring: readonly Point[];
  readonly ink: LayerPaneInk;
  readonly widthPx: number;
}

/** What one pane is handed. */
export interface LayerPaneChannels {
  readonly id: LayerPaneId;
  /** The paper, built through {@link modelToSvg}; null on the crease pattern, which draws creases. */
  readonly scene: PaperScene | null;
  readonly look: PaperLook;
  readonly modelToSvg: (point: Point) => Point;
  readonly creases: CpPatternStrokes | null;
  /** Tints under the creases: the crease pattern's. */
  readonly underFills: FillGeometry | null;
  /** Tints over the paper: the folded figure's. */
  readonly fills: FillGeometry | null;
  /** What follows the pointer, on the overlay channel: the face pointed at, a row's faces. */
  readonly overlay: () => PaperPaneOverlay;
  /**
   * How wide, CSS px, the pane draws the line along a face's edge at a frame's
   * line boost: a crease, or the paper's widest pen. Rings and letters keep
   * clear of half of it.
   */
  readonly lineWidthCss: (widthBoost: number) => number;
  /** The cells a press is tested against, in the pane's frame. */
  readonly stacks: StackHitIndex | null;
  readonly hitTest: (at: Point, radii: unknown, stack: StackHit | null) => LayerPaneHit | null;
  /** The faces a pick can take now: the pointer's cursor says so over them. */
  readonly pickable: ReadonlySet<LayerFace>;
  /** What a fit frames: the pane's own content (see the module docs). */
  readonly contentBounds: UserBounds | null;
  /** What the content is: the side shown and its turn, on the folded pane, so turning it over or rotating it keeps the view while it shows. */
  readonly keepInViewKey: string | null;
  /** What must still show across a new {@link keepInViewKey}: the folded figure itself. */
  readonly keepInViewBounds: UserBounds | null;
  readonly rings: readonly LayerPaneRingMark[];
  /** The crease a notice names ({@link LayerFaceMarks.crease}), in the pane's frame: drawn beside its line. */
  readonly litCrease: readonly LayerPaneSegment[];
  /** The spots fading, in the pane's frame, and which flash they are. */
  readonly flash: { readonly n: number; readonly spots: readonly (readonly Point[])[] } | null;
  readonly labels: readonly LayerPaneLabel[];
  readonly labelSpots: (face: LayerFace) => LayerLabelSpots | null;
  /** Every line the pane draws, in its frame: a letter set beside its face keeps clear of them all (D20). */
  readonly labelLines: LayerLabelLines | null;
  /**
   * How wide, CSS px, the widest of {@link labelLines} is drawn at a frame's
   * line boost: the aux pen may be wider than the line along a face's edge,
   * which {@link lineWidthCss} is and which the rings and the room inside a
   * face keep to.
   */
  readonly labelLinesWidthCss: (widthBoost: number) => number;
  readonly letterOf: (face: LayerFace) => string;
}

const NO_FACES: ReadonlySet<LayerFace> = new Set();
const NO_OVERLAY: PaperPaneOverlay = {};
const NO_SPOTS = () => null;
const NO_SEGMENTS: readonly LayerPaneSegment[] = [];

/** The crease `marks` names, on `scene`, in `frame`'s coordinates: none when it names none. */
function useLitCrease(
  scene: OristudioCpFoldedPaperScene | null,
  crease: LayerFaceMarks['crease'],
  frame: 'pattern' | 'folded'
): readonly LayerPaneSegment[] {
  const a = crease?.[0] ?? null;
  const b = crease?.[1] ?? null;
  return useMemo(
    () => (scene && a !== null && b !== null ? creaseSegments(scene, [a, b], frame) : NO_SEGMENTS),
    [scene, a, b, frame]
  );
}

/** What `--face-pick` is when nothing has set it: the dark type's (`applyTheme`'s `FACE_PICK_COLORS`). */
const PICK_FALLBACK: Rgba = [0xa7 / 255, 0x8b / 255, 0xfa / 255, 1];
const DANGER_FALLBACK: Rgba = [0.86, 0.33, 0.36, 1];

/** The marks' colours, resolved against `element`; null until there is one. */
export function useLayerPaneInks(element: Element | null, themeKey: string): LayerPaneInks | null {
  return useMemo(() => {
    if (!element) return null;
    return {
      pick: readCssVarColor(element, '--face-pick', PICK_FALLBACK),
      danger: readCssVarColor(element, '--status-danger', DANGER_FALLBACK),
    };
    // The theme is read off the element: its key is what says it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [element, themeKey]);
}

/** The view the dialog opens with: the host's side, X-ray as the host says (D18), Undecided off. */
export function layerOrderOpeningView(request: LayerOrderRequest): LayerPanesView {
  return { side: request.look.side, xray: request.look.xray, undecided: false, turnDeg: request.look.turnDeg };
}

/** What the session has to draw from, or the request's own until it is open. */
function figureOf(status: LayerOrderSessionStatus, request: LayerOrderRequest) {
  if (status.kind === 'ready') {
    const { scenes } = status.open;
    return { faces: scenes.front ?? scenes.back, scenes };
  }
  return { faces: request.shown ?? null, scenes: null };
}

/** A refusal that names a face marks it on the crease pattern, as its notice names it (D4). */
export function refusalMarks(status: LayerOrderSessionStatus): LayerFaceMarks | null {
  if (status.kind !== 'refused' || status.refusal.code !== 'source_non_convex_face') return null;
  return { ...NO_FACE_MARKS, clash: [status.refusal.face] };
}

function lettersOf(letters: FaceLetters | null): (face: LayerFace) => string {
  return (face) => letters?.letterOf(face) ?? '';
}

function ringMarks(
  paints: readonly LayerPanePaint[],
  ringOf: (face: LayerFace) => readonly Point[] | undefined
): LayerPaneRingMark[] {
  return paints.flatMap((paint) =>
    paint.rings.flatMap(({ face, ink, widthPx }) => {
      const ring = ringOf(face);
      return ring && ring.length >= 3 ? [{ face, ring, ink, widthPx }] : [];
    })
  );
}

/** A list held while its values are the same, whatever its identity: a caller may build it afresh each render. */
function useListByValue<T>(list: readonly T[]): readonly T[] {
  const key = list.join(',');
  // The key is the list's value: a new array with the same values is the same list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => list, [key]);
}

/**
 * The marks split for drawing: `base`, everything but what follows the
 * pointer, held by value; and `marks`, the same with the pointer's faces,
 * which only those change.
 */
export function useSplitMarks(marks: LayerFaceMarks): { base: LayerFaceMarks; marks: LayerFaceMarks } {
  const pickable = useListByValue(marks.pickable);
  const objects = useListByValue(marks.objects);
  const clash = useListByValue(marks.clash);
  const row = useListByValue(marks.row);
  const undecidedFront = useListByValue(marks.undecided.front);
  const undecidedBack = useListByValue(marks.undecided.back);
  const crease = useListByValue(marks.crease ?? []);
  const { picking, subject, clashStrong, changed, flash, pointed } = marks;
  const base = useMemo<LayerFaceMarks>(
    () => ({
      picking,
      pickable,
      subject,
      objects,
      pointed: null,
      row: [],
      clash,
      clashStrong,
      changed,
      flash,
      undecided: { front: undecidedFront, back: undecidedBack },
      crease: crease.length === 2 ? [crease[0]!, crease[1]!] : null,
    }),
    [picking, pickable, subject, objects, clash, clashStrong, changed, flash, undecidedFront, undecidedBack, crease]
  );
  const full = useMemo<LayerFaceMarks>(
    () => (pointed === null && row.length === 0 ? base : { ...base, pointed, row }),
    [base, pointed, row]
  );
  return { base, marks: full };
}

export interface LayerPaneInputs {
  readonly status: LayerOrderSessionStatus;
  readonly request: LayerOrderRequest;
  /** The face index of the opening (`LayerOrderPanesProps.letters`). */
  readonly letters: FaceLetters | null;
  readonly view: LayerPanesView;
  /** Everything but what follows the pointer (`useSplitMarks`). */
  readonly base: LayerFaceMarks;
  readonly marks: LayerFaceMarks;
  /** The order on screen, per side: a preview's while one shows; null for the session's own. */
  readonly stacks: LayerPanesStacks | null;
  readonly inks: LayerPaneInks | null;
  /** The element the theme's line inks are read off, for the creases. */
  readonly element: Element | null;
  readonly themeKey: string;
}

/**
 * The overlay channel's fills for what follows the pointer, as `PaperPane`
 * asks for them: `under` the creases, or over the paper.
 */
function useOverlay(fills: FillGeometry | null, slot: 'underFills' | 'fills'): () => PaperPaneOverlay {
  return useMemo(() => (fills ? () => ({ [slot]: fills }) : () => NO_OVERLAY), [fills, slot]);
}

/** The crease-pattern pane: Edit's drawing of the source, its faces marked. */
export function useLayerPatternPane({
  status,
  request,
  letters: faceLetters,
  base: baseIn,
  marks: marksIn,
  inks,
  element,
  themeKey,
}: LayerPaneInputs): LayerPaneChannels {
  const { source, look } = request;
  const region = request.region ?? null;
  const facesScene = figureOf(status, request).faces;
  const lines = useMemo(() => patternPaneLines(source, region), [source, region]);
  const contentBounds = useMemo(() => patternPaneFrame(source, region), [source, region]);
  const creases = useMemo(
    () =>
      element ? cpPatternStrokes(lines, element, { lineStyle: look.lineStyle, lineWidth: look.lineWidth }) : null,
    // The theme is read off the element: its key is what says it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, element, themeKey, look.lineStyle, look.lineWidth]
  );
  const faces = useMemo(() => (facesScene ? paneFacesOf(facesScene) : null), [facesScene]);
  const index = useMemo(() => {
    if (!faces) return null;
    const cells = faces.pattern.flatMap((ring, face) => (ring.length >= 3 ? [{ ring, face }] : []));
    return {
      faceOf: cells.map((cell) => cell.face),
      hits: new StackHitIndex(cells.map(({ ring, face }) => ({ polygon: ring, faces_top_to_bottom: [face] }))),
    };
  }, [faces]);
  // A refusal that names a face marks it, and nothing else.
  const refused = useMemo(() => refusalMarks(status), [status]);
  const base = refused ?? baseIn;
  const marks = refused ?? marksIn;
  const basePaint = useMemo(() => basePatternPaint(base), [base]);
  const pointerPaint = useMemo(() => pointerPanePaint(marks, 'pattern'), [marks]);
  const ringOf = useMemo(() => (face: LayerFace) => faces?.pattern[face], [faces]);
  const underFills = useMemo(
    () => (inks && faces ? paneTintFills(basePaint.tints, inks, ringOf, null) : null),
    [basePaint, inks, faces, ringOf]
  );
  const pointerFills = useMemo(
    () => (inks && faces ? paneTintFills(pointerPaint.tints, inks, ringOf, null) : null),
    [pointerPaint, inks, faces, ringOf]
  );
  // Under the creases, as the base tints are: a tint never veils a crease (D20).
  const overlay = useOverlay(pointerFills, 'underFills');
  const baseLetters = useMemo(() => (faces ? paneLetters(base, faces.patternCentroids) : null), [base, faces]);
  const letters = useMemo(
    () => (faces && baseLetters ? withPointerLetters(baseLetters, marks, faces.patternCentroids).labels : []),
    [baseLetters, marks, faces]
  );
  const labelSpots = useMemo(() => (faces ? patternLabelIndex(faces.pattern) : NO_SPOTS), [faces]);
  const labelLines = useMemo(() => labelLineIndex(lines.map(({ a, b }) => [a, b] as const)), [lines]);
  const lineWidthCss = useMemo(
    () => (widthBoost: number) => cpCreaseStrokeWidthPx(look.lineWidth, { ratio: 1, widthBoost }),
    [look.lineWidth]
  );
  const pickable = useMemo(() => new Set(base.pickable), [base.pickable]);
  const letterOf = useMemo(() => lettersOf(faceLetters), [faceLetters]);
  const paperLook = useMemo<PaperLook>(() => ({ style: look.style, policy: look.policy }), [look.style, look.policy]);
  const hitTest = useMemo(
    () =>
      (_at: Point, _radii: unknown, stack: StackHit | null): LayerPaneHit | null => {
        const face = stack && index ? index.faceOf[stack.cell] : undefined;
        return face === undefined ? null : { pane: 'pattern', face, spot: null };
      },
    [index]
  );
  const baseRings = useMemo(() => ringMarks([basePaint], ringOf), [basePaint, ringOf]);
  const rings = useMemo(
    () => (pointerPaint.rings.length === 0 ? baseRings : [...baseRings, ...ringMarks([pointerPaint], ringOf)]),
    [baseRings, pointerPaint, ringOf]
  );
  const litCrease = useLitCrease(facesScene, base.crease, 'pattern');
  return {
    id: 'pattern',
    scene: null,
    look: paperLook,
    modelToSvg: patternPaneToUser,
    creases,
    underFills,
    fills: null,
    overlay,
    lineWidthCss,
    stacks: index?.hits ?? null,
    hitTest,
    pickable: pickable.size > 0 ? pickable : NO_FACES,
    contentBounds,
    keepInViewKey: null,
    keepInViewBounds: null,
    rings,
    litCrease,
    flash: null,
    labels: letters,
    labelSpots,
    labelLines,
    // Edit draws every line of the pattern, aux lines too, at the crease's width.
    labelLinesWidthCss: lineWidthCss,
    letterOf,
  };
}

/** The scene the folded pane shows from `side`, stacked in the order on screen. */
function sideScene(
  scenes: { front: OristudioCpFoldedPaperScene | null; back: OristudioCpFoldedPaperScene | null } | null,
  stacks: LayerPanesStacks | null,
  side: LayerSide
): { kernel: OristudioCpFoldedPaperScene; shown: OristudioCpFoldedPaperScene } | null {
  const kernel = scenes?.[side] ?? null;
  if (!kernel) return null;
  return { kernel, shown: restackedScene(kernel, stacks?.[side] ?? null) };
}

/** The folded figure's pane, once the session is open; null before, or with no scene for the side shown. */
export function useLayerFoldedPane({
  status,
  request,
  letters: faceLetters,
  view,
  base,
  marks,
  stacks,
  inks,
}: LayerPaneInputs): LayerPaneChannels | null {
  const { look } = request;
  const figure = figureOf(status, request);
  const { side, xray, turnDeg } = view;
  const scenes = figure.scenes;
  const pair = useMemo(() => sideScene(scenes, stacks, side), [scenes, stacks, side]);
  const kernel = pair?.kernel ?? null;
  const shown = pair?.shown ?? null;
  // The turn, about the paper's middle, from the side shown: the host's, or wherever Rotate moved it.
  const turn = paneTurnDeg(turnDeg, look.side, side);
  const modelToSvg = useMemo(
    () => foldedPaneToUser(turn, kernel ? foldedPivot(kernel) : { x: 0, y: 0 }),
    [turn, kernel]
  );
  const scene = useMemo(
    () =>
      shown
        ? foldedFlatPaperScene(shown, {
            // A buried face is never seen, unless the paper is see-through.
            markHidden: !xray,
            toScenePx: (point): ScenePoint => {
              const { x, y } = modelToSvg(point);
              return [x, y];
            },
            scale: PANE_USER_PER_UNIT,
          })
        : null,
    [shown, xray, modelToSvg]
  );
  const paperLook = useMemo<PaperLook>(
    () => ({
      style: look.style,
      policy: look.policy,
      ...(xray && shown ? { faceAlpha: xrayFaceAlpha(stackDepth(shown)) } : {}),
    }),
    [look.style, look.policy, xray, shown]
  );
  // The cells never move with the order: one index per scene.
  const index = useMemo(() => (kernel ? new StackHitIndex(kernel.subfaces) : null), [kernel]);
  const outlines = useMemo(() => (kernel ? foldedOutlinesOf(kernel) : null), [kernel]);
  // Fit frames the figure itself, and a turn over keeps it in view.
  const figureBounds = useMemo(() => (kernel ? foldedPaneFrame(kernel, modelToSvg) : null), [kernel, modelToSvg]);
  const basePaint = useMemo(() => (shown ? baseFoldedPaint(base, shown, view) : null), [base, shown, view]);
  const pointerPaint = useMemo(() => pointerPanePaint(marks, 'folded'), [marks]);
  const ringOf = useMemo(() => (face: LayerFace) => outlines?.[face], [outlines]);
  const fills = useMemo(
    () => (basePaint && inks ? paneTintFills(basePaint.tints, inks, ringOf, index) : null),
    [basePaint, inks, ringOf, index]
  );
  const pointerFills = useMemo(
    () => (inks && outlines ? paneTintFills(pointerPaint.tints, inks, ringOf, index) : null),
    [pointerPaint, inks, outlines, ringOf, index]
  );
  const overlay = useOverlay(pointerFills, 'fills');
  // The paper's pens hold their width on screen (pt), whatever the zoom.
  const edgePx = useMemo(() => {
    const { edges, mountainFolds, valleyFolds } = look.style;
    return ptToDevicePx(Math.max(edges.width, mountainFolds.width, valleyFolds.width), 1);
  }, [look.style]);
  const lineWidthCss = useMemo(() => () => edgePx, [edgePx]);
  // The aux pen as the paper draws it (`PaperPane`'s painter): null when the style leaves aux lines out.
  const auxPen = useMemo(() => penForRole(surfacePaperStyle(look.style, look.policy), 'aux'), [look.style, look.policy]);
  const labelLinesWidthCss = useMemo(() => {
    const widest = Math.max(edgePx, auxPen ? ptToDevicePx(auxPen.width, 1) : 0);
    return () => widest;
  }, [edgePx, auxPen]);
  const faces = useMemo(() => (figure.faces ? paneFacesOf(figure.faces) : null), [figure.faces]);
  const baseLetters = useMemo(() => (faces ? paneLetters(base, faces.patternCentroids) : null), [base, faces]);
  const letters = useMemo(
    () => (faces && baseLetters ? withPointerLetters(baseLetters, marks, faces.patternCentroids).labels : []),
    [baseLetters, marks, faces]
  );
  const labelSpots = useMemo(() => (shown ? foldedLabelIndex(shown) : NO_SPOTS), [shown]);
  // What the paper draws changes with the order shown, with X-ray, which draws the buried faces too, and with
  // the style, which may leave the aux lines out.
  const auxShown = auxPen !== null;
  const labelLines = useMemo(
    () => (shown ? labelLineIndex(foldedPaneLines(shown, xray, auxShown)) : null),
    [shown, xray, auxShown]
  );
  const flashSpots = base.flash?.changed[side];
  const flash = useMemo(() => {
    if (!base.flash || !kernel || !flashSpots || flashSpots.length === 0) return null;
    const polygons = Array.from(flashSpots, (spot) => kernel.subfaces[spot]?.polygon ?? []).filter((ring) => ring.length >= 3);
    return { n: base.flash.n, spots: polygons };
  }, [base.flash, kernel, flashSpots]);
  const pickable = useMemo(() => new Set(base.pickable), [base.pickable]);
  const letterOf = useMemo(() => lettersOf(faceLetters), [faceLetters]);
  const hitTest = useMemo(
    () =>
      (_at: Point, _radii: unknown, stack: StackHit | null): LayerPaneHit | null => {
        const face = stack ? shown?.subfaces[stack.cell]?.faces_top_to_bottom[0] : undefined;
        return stack && face !== undefined ? { pane: 'folded', face, spot: stack.cell } : null;
      },
    [shown]
  );
  const baseRings = useMemo(() => (basePaint ? ringMarks([basePaint], ringOf) : []), [basePaint, ringOf]);
  const rings = useMemo(
    () => (pointerPaint.rings.length === 0 ? baseRings : [...baseRings, ...ringMarks([pointerPaint], ringOf)]),
    [baseRings, pointerPaint, ringOf]
  );
  const litCrease = useLitCrease(kernel, base.crease, 'folded');
  if (!shown) return null;
  return {
    id: 'folded',
    scene,
    look: paperLook,
    modelToSvg,
    creases: null,
    underFills: null,
    fills,
    overlay,
    lineWidthCss,
    stacks: index,
    hitTest,
    pickable: pickable.size > 0 ? pickable : NO_FACES,
    contentBounds: figureBounds,
    // Turned over or rotated, the figure stays in view.
    keepInViewKey: `${side}:${turn}`,
    keepInViewBounds: figureBounds,
    rings,
    litCrease,
    flash,
    labels: letters,
    labelSpots,
    labelLines,
    labelLinesWidthCss,
    letterOf,
  };
}
