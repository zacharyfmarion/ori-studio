/**
 * What the Layer order dialog's panes mark on the paper, and how
 * (`implementation-plans/layer-order-dialog.md`, row U8; D20, D21; the
 * approved boards: `Round3` (A3), `Round4-States`, `Round4-Horizon`,
 * `Round5-Compound`).
 *
 * **The props, in pane terms.** {@link LayerFaceMarks} names faces by the
 * role they play now — the subject, any number of objects, the face pointed
 * at, a pressed or hovered row's faces, the faces a pick can take, a clash's
 * faces — and spots by what happened to them. The panes know nothing of the
 * sentence, the list or the engine's answers: the inspector's hook (U10)
 * reads its model and fills these in.
 *
 * **How each role is drawn:** a tint, at one rung of the tint ladder Fold's
 * panes share (`fillTint.ts`, `TINT`), and at most one ring per face, inside
 * it (`faceRing.ts`). Picks, the face pointed at and a row's faces are
 * `--face-pick`, violet in every theme; a clash is the theme's danger. What
 * tells the roles apart is never hue alone: the alpha, the ring's width,
 * which letters are outlined and the dot on a clash's letters
 * (`Round4-Horizon`'s legend).
 *
 * | Role | Crease pattern | Folded paper |
 * | --- | --- | --- |
 * | Pickable | faint, the whole face | choosing objects: faint where one is on top |
 * | Subject | emphasis, 2 px ring | hover rung on its spots, 2 px ring |
 * | An object | hover rung, 1.5 px ring | 1.5 px ring |
 * | Pointed at | hover rung, 1.5 px ring | hover rung, 1.5 px ring |
 * | A row's faces | picked rung, 1.5 px ring | hover rung, 1.5 px ring |
 * | In a clash | danger, moving rung (picked when its reason is pointed at), 1.5 px ring | the same |
 * | A spot a preview changes | – | picked rung |
 * | Undecided spots | – | faint, while the view's Undecided is on |
 * | A crease a notice names | a 2 px line each side of it, clear of its colour | the same, along the folded edge |
 *
 * While a subject is being chosen, the faint tint of every face with a choice
 * is on the crease pattern only (spec §6.4): on the folded paper it would
 * tint most of the figure and say nothing. A face in a clash is drawn
 * as the clash and not as a pick, so an object the clash names turns danger
 * while the subject and the other objects stay violet (D21).
 *
 * **What follows the pointer is drawn apart.** The face pointed at and a
 * pressed or hovered row's faces change at pointer rate, so they are their
 * own paint ({@link pointerPanePaint}), on the panes' overlay channel: a
 * change of either redraws those few faces and leaves every other tint,
 * ring and letter as it was ({@link basePatternPaint},
 * {@link baseFoldedPaint}). On the crease pattern a face the pointer lights
 * is faint already; its overlay tint is the share that takes it to the
 * board's rung, so it reads exactly as one tint at that rung would.
 *
 * Pure: no React, no store, no engine.
 */
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { Point } from '../../lib/geometry';
import type { StackHitIndex } from '../../cp-workspace/picking/stackHitIndex';
import { cellsFill, joinFills, ringsFill, TINT } from '../../cp-workspace/renderer/fillTint';
import type { FillGeometry, Rgba } from '../../cp-workspace/renderer/types';
import type { LayerFace } from '../engine/faceIndex';
import type { LayerChangedSpots, LayerSide, LayerStacks } from '../engine/layerOrderEngine';
import type { LayerPaneId } from './layerPaneInput';

// ---------------------------------------------------------------------------
// The props

/** What the panes show of the paper: a lens on it, which never changes what is saved. */
export interface LayerPanesView {
  /** The side the folded pane shows. Constraints are paper-relative, so this is a lens (spec §5). */
  readonly side: LayerSide;
  /** Every layer drawn see-through, the buried ones included. */
  readonly xray: boolean;
  /** Tint the spots whose face on top isn't decided yet ({@link LayerFaceMarks.undecided}). */
  readonly undecided: boolean;
  /**
   * How far the folded pane turns the paper, in the host's terms
   * (`LayerOrderLook.turnDeg`, from `look.side`): the host's turn as the
   * dialog opens, then wherever Rotate has moved it.
   */
  readonly turnDeg: number;
}

/**
 * The order the folded pane draws, per side: each spot's faces, top first,
 * as the engine answers them (`LayerStacks`) — a fitting preview's while one
 * shows, else the order on screen.
 */
export interface LayerPanesStacks {
  readonly front: LayerStacks;
  readonly back: LayerStacks;
}

/** Spots of the folded paper, by the scene's subface number, per side. */
export interface LayerSidesSpots {
  readonly front: readonly number[];
  readonly back: readonly number[];
}

/** The slot a face pick fills now: what the pickable faces are offered as. */
export type LayerPanePicking = 'subject' | 'object';

/** The spots the last change moved, fading once; `n` tells one flash from the next. */
export interface LayerPaneFlash {
  readonly changed: LayerChangedSpots;
  readonly n: number;
}

/** The faces the panes mark, by role, and the spots they light. Faces are the kernel's (`faceIndex.ts`). */
export interface LayerFaceMarks {
  /** What a pick takes now: a subject from every face with choices, or objects from the subject's open faces. */
  readonly picking: LayerPanePicking;
  /**
   * The faces a pick can take now; every other face is inert. Choosing
   * objects, they carry letters too, the nearest `LAYER_ORDER_LABEL_CAP` of
   * them (`layerPaneLabels.ts`). Empty while the builder is inert.
   */
  readonly pickable: readonly LayerFace[];
  readonly subject: LayerFace | null;
  /** The objects picked, any number (D21). */
  readonly objects: readonly LayerFace[];
  /** The face under the pointer, or a finger's, when a pick could take it. */
  readonly pointed: LayerFace | null;
  /** A pressed or hovered constraint row's faces: its subject and all its objects. */
  readonly row: readonly LayerFace[];
  /** The faces a clash names: danger tints and rings, dotted letters, on both panes. */
  readonly clash: readonly LayerFace[];
  /** Pointing at the clash's reason strengthens its tints (Round3:473, 883). */
  readonly clashStrong: boolean;
  /** The spots a fitting preview would change, per side. */
  readonly changed: LayerChangedSpots | null;
  /** The spots the last commit or step changed: one 1.6 s fade (Round3:172-176). */
  readonly flash: LayerPaneFlash | null;
  /** The spots whose face on top isn't decided yet, per side (the model's `openSpotsOf`). */
  readonly undecided: LayerSidesSpots;
  /**
   * A crease the dialog's notice names, as the two faces it joins (D19): lit
   * along its line on both panes, beside the face the notice names.
   */
  readonly crease: readonly [LayerFace, LayerFace] | null;
}

const NO_SPOTS: LayerSidesSpots = { front: [], back: [] };

/** Nothing marked: the panes draw the paper alone. */
export const NO_FACE_MARKS: LayerFaceMarks = {
  picking: 'subject',
  pickable: [],
  subject: null,
  objects: [],
  pointed: null,
  row: [],
  clash: [],
  clashStrong: false,
  changed: null,
  flash: null,
  undecided: NO_SPOTS,
  crease: null,
};

/** What follows the pointer: the face pointed at and a pressed or hovered row's faces. */
export type LayerPointerMarks = Pick<LayerFaceMarks, 'pointed' | 'row'>;

const NO_POINTER: LayerPointerMarks = { pointed: null, row: [] };

/** `marks` with nothing following the pointer: what the base paint and the base letters read. */
export function baseMarks(marks: LayerFaceMarks): LayerFaceMarks {
  return marks.pointed === null && marks.row.length === 0 ? marks : { ...marks, ...NO_POINTER };
}

// ---------------------------------------------------------------------------
// What the panes draw for them

/** A mark's colour: `--face-pick`, or the theme's danger for a clash. */
export type LayerPaneInk = 'pick' | 'danger';

/** One tint: whole faces, or spots (the scene's subfaces), at one rung of the ladder. */
export type LayerPaneTint =
  | { readonly faces: readonly LayerFace[]; readonly ink: LayerPaneInk; readonly alpha: number }
  | { readonly spots: readonly number[]; readonly ink: LayerPaneInk; readonly alpha: number };

/** A face's ring, inside it, `widthPx` wide on screen. */
export interface LayerPaneRing {
  readonly face: LayerFace;
  readonly ink: LayerPaneInk;
  readonly widthPx: number;
}

/** A pane's marks, in drawing order: tints first, each over the one before, then the rings. */
export interface LayerPanePaint {
  readonly tints: readonly LayerPaneTint[];
  readonly rings: readonly LayerPaneRing[];
}

/** The subject's ring: the only 2 px one. */
export const SUBJECT_RING_PX = 2;
/** Every other ring. */
export const FACE_RING_PX = 1.5;

/** A clash's rung: stronger while its reason is pointed at. */
function clashAlpha(marks: LayerFaceMarks): number {
  return marks.clashStrong ? TINT.picked : TINT.moving;
}

/** The faces drawn as picks: those of `faces` the clash doesn't name. */
function notInClash(faces: readonly LayerFace[], clash: ReadonlySet<LayerFace>): LayerFace[] {
  return faces.filter((face) => !clash.has(face));
}

/** The faces whose ring the base paint draws: a clash's, the subject's, the objects'. */
function baseRingFaces(marks: LayerFaceMarks): Set<LayerFace> {
  const faces = new Set<LayerFace>([...marks.clash, ...marks.objects]);
  if (marks.subject !== null) faces.add(marks.subject);
  return faces;
}

/** One ring per face, the strongest role's: a clash's, the subject's, then an object's. */
function baseRings(marks: LayerFaceMarks): LayerPaneRing[] {
  const rings = new Map<LayerFace, LayerPaneRing>();
  const put = (face: LayerFace, ink: LayerPaneInk, widthPx: number) => {
    if (!rings.has(face)) rings.set(face, { face, ink, widthPx });
  };
  for (const face of marks.clash) put(face, 'danger', FACE_RING_PX);
  if (marks.subject !== null) put(marks.subject, 'pick', SUBJECT_RING_PX);
  for (const face of marks.objects) put(face, 'pick', FACE_RING_PX);
  return [...rings.values()];
}

/** The tints that are only there when they hold something. */
function push(tints: LayerPaneTint[], tint: LayerPaneTint): void {
  if ('faces' in tint ? tint.faces.length > 0 : tint.spots.length > 0) tints.push(tint);
}

/** The faces the crease pattern tints faintly: the pickable ones no stronger base role holds. */
function faintPatternFaces(marks: LayerFaceMarks): LayerFace[] {
  const strong = baseRingFaces(marks);
  return marks.pickable.filter((face) => !strong.has(face));
}

/**
 * The crease-pattern pane's marks but what follows the pointer: whole faces,
 * under the creases, so a tint never veils a crease's colour. Faces never
 * overlap here.
 */
export function basePatternPaint(marks: LayerFaceMarks): LayerPanePaint {
  const clash = new Set(marks.clash);
  const subject = marks.subject !== null && !clash.has(marks.subject) ? marks.subject : null;
  const tints: LayerPaneTint[] = [];
  push(tints, { faces: faintPatternFaces(marks), ink: 'pick', alpha: TINT.faint });
  push(tints, { faces: subject === null ? [] : [subject], ink: 'pick', alpha: TINT.emphasis });
  push(tints, { faces: notInClash(marks.objects, clash), ink: 'pick', alpha: TINT.hover });
  push(tints, { faces: marks.clash, ink: 'danger', alpha: clashAlpha(marks) });
  return { tints, rings: baseRings(marks) };
}

/**
 * The folded pane's marks but what follows the pointer, over the paper, for
 * `scene`: the side shown, its spots stacked in the order on screen
 * (`restackedScene`).
 *
 * At most one tint of the faint and changed kind falls on a spot, so none
 * stacks on another: a spot the preview changes; else, choosing objects, a
 * spot with one on top; else a spot of the subject's, a rung stronger, the
 * subject's whole face when no spot of it is taken.
 */
export function baseFoldedPaint(
  marks: LayerFaceMarks,
  scene: OristudioCpFoldedPaperScene,
  view: LayerPanesView
): LayerPanePaint {
  const clash = new Set(marks.clash);
  const side = view.side;
  const changed = new Set(marks.changed?.[side] ?? []);
  const offered = marks.picking === 'object' ? new Set(notInClash(marks.pickable, clash)) : new Set<LayerFace>();
  const subject = marks.subject !== null && !clash.has(marks.subject) ? marks.subject : null;
  const offeredSpots: number[] = [];
  const subjectSpots: number[] = [];
  let subjectAll = true;
  scene.subfaces.forEach((subface, spot) => {
    const top = subface.faces_top_to_bottom[0];
    const taken = changed.has(spot) || (top !== undefined && offered.has(top));
    if (top !== undefined && offered.has(top) && !changed.has(spot)) offeredSpots.push(spot);
    if (subject !== null && subface.faces_top_to_bottom.includes(subject)) {
      if (taken) subjectAll = false;
      else subjectSpots.push(spot);
    }
  });
  const tints: LayerPaneTint[] = [];
  if (view.undecided) push(tints, { spots: marks.undecided[side], ink: 'pick', alpha: TINT.faint });
  push(tints, { spots: offeredSpots, ink: 'pick', alpha: TINT.faint });
  push(tints, { spots: [...changed], ink: 'pick', alpha: TINT.picked });
  if (subject !== null) {
    push(
      tints,
      subjectAll ? { faces: [subject], ink: 'pick', alpha: TINT.hover } : { spots: subjectSpots, ink: 'pick', alpha: TINT.hover }
    );
  }
  push(tints, { faces: marks.clash, ink: 'danger', alpha: clashAlpha(marks) });
  return { tints, rings: baseRings(marks) };
}

/**
 * The alpha that takes paper already tinted at `under` in the same ink to
 * `target`, drawn over it: two tints compose as `1 − (1 − a)(1 − b)`.
 */
export function overAlpha(target: number, under: number): number {
  return under >= target ? 0 : 1 - (1 - target) / (1 - under);
}

/**
 * What follows the pointer on `pane`, for the overlay channel: a pressed or
 * hovered row's faces (the picked rung on the crease pattern, the hover rung
 * on the folded paper) and the face pointed at (the hover rung), each ringed
 * unless a base role already rings it. The subject and the objects keep their
 * own tints, and a clash's face is drawn as the clash. On the crease pattern
 * a faint face takes the share that brings it to its rung (see the module
 * docs); on the folded paper the board composes the tints, and so do these.
 */
export function pointerPanePaint(marks: LayerFaceMarks, pane: LayerPaneId): LayerPanePaint {
  if (marks.pointed === null && marks.row.length === 0) return { tints: [], rings: [] };
  const clash = new Set(marks.clash);
  const ringed = baseRingFaces(marks);
  const faint = pane === 'pattern' ? new Set(faintPatternFaces(marks)) : new Set<LayerFace>();
  const rowFaces = notInClash(marks.row, clash);
  const rowRung = pane === 'pattern' ? TINT.picked : TINT.hover;
  const pointed =
    marks.pointed !== null && marks.pointed !== marks.subject && !marks.objects.includes(marks.pointed) && !clash.has(marks.pointed)
      ? marks.pointed
      : null;
  const tints: LayerPaneTint[] = [];
  // Faint faces and the rest take different alphas to land on the same rung.
  const tintAt = (faces: readonly LayerFace[], rung: number) => {
    push(tints, { faces: faces.filter((face) => !faint.has(face)), ink: 'pick', alpha: rung });
    push(tints, { faces: faces.filter((face) => faint.has(face)), ink: 'pick', alpha: overAlpha(rung, TINT.faint) });
  };
  tintAt(rowFaces, rowRung);
  if (pointed !== null) tintAt([pointed], TINT.hover);
  const rings: LayerPaneRing[] = [];
  const seen = new Set(ringed);
  for (const face of [...rowFaces, ...(pointed !== null ? [pointed] : [])]) {
    if (seen.has(face)) continue;
    seen.add(face);
    rings.push({ face, ink: 'pick', widthPx: FACE_RING_PX });
  }
  return { tints, rings };
}

/** The colours a pane's marks are drawn in, resolved from the theme. */
export interface LayerPaneInks {
  readonly pick: Rgba;
  readonly danger: Rgba;
}

/**
 * A pane's tints as one fill, in the pane's frame, in their order: a face's
 * whole ring (`faceRing(face)`: on the crease pattern, or its folded
 * outline), a spot as the index holds it. Null when nothing is tinted.
 */
export function paneTintFills(
  tints: readonly LayerPaneTint[],
  inks: LayerPaneInks,
  faceRing: (face: LayerFace) => readonly Point[] | undefined,
  spots: StackHitIndex | null
): FillGeometry | null {
  let fill: FillGeometry | null = null;
  for (const tint of tints) {
    const rgba = inks[tint.ink];
    const next =
      'faces' in tint
        ? ringsFill(
            tint.faces.flatMap((face) => {
              const ring = faceRing(face);
              return ring && ring.length >= 3 ? [ring] : [];
            }),
            rgba,
            tint.alpha
          )
        : spots
          ? cellsFill(spots, tint.spots, rgba, tint.alpha)
          : null;
    fill = joinFills(fill, next);
  }
  return fill;
}
