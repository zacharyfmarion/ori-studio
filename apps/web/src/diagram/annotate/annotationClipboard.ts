/**
 * Annotations on the workspace clipboard (Zach, 2026-10-05): what Copy takes
 * of a step's marks, and what Paste puts on a step — fresh copies, in place
 * on another step, so a mark carried from step to step lands where it was;
 * down and right on the step a copy came from, so it shows beside its
 * original; and each further paste on a step a further step on, so repeats
 * never stack. Equal divisions belong to the line they measure: on the step
 * they came from they stay on it, each copy's line set further out, as
 * drafting stacks dimension lines (ED12). Cut takes the original away, so its
 * first paste goes back where it was.
 *
 * Copied marks remember the view they were drawn in (Revision 2): their
 * units — an enlarged step's window, or the whole picture — and, while they
 * are in step with it, their picture, by its key. Pasted onto a step in other
 * units they go through the picture: onto the same picture — one enlarged
 * step to another of it, an enlarged step to its whole picture, or back —
 * they land on the same paper; onto another, at the same place on its
 * picture, as a paste between two whole pictures always has. Between two
 * windows of different pictures they keep their place in the window: each
 * frames the paper its area framed. So does each mark from a whole picture
 * that, at the same place on another picture, its enlarged step would draw
 * nowhere — beyond a window of its window each way, selected but unseen
 * (18d). Everything a paste does, its offset too, is held within the reach
 * of the units they go to.
 *
 * A mark lifted from a References card (17d) stays the card's only pasted
 * onto a step showing the same card, front or back, baked or lifted, where
 * no copy of it lies yet — so a cut pasted back where it was is still the
 * card's. A copy pasted beside the original, or beside another copy, is a
 * mark the author made, as is one pasted anywhere else.
 *
 * Pure: no DOM, no store.
 */
import { showsCard, untagged } from '../document/cardMarks';
import {
  randomDiagramId,
  stepDiagramCardKey,
  type DiagramAnnotation,
  type DiagramIdFactory,
  type DiagramStep,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { marksInWindow } from '../zoom/stepView';
import { stepWindow, unitsMove } from '../zoom/zoomFrames';
import { stepReach, type PictureBox } from '../zoom/zoomModel';
import {
  DIVISIONS_OFFSET_MM,
  PICTURE_REACH,
  carryAnnotation,
  divisionsOffsetOf,
  moveAnnotation,
  withAnnotationReach,
} from './annotationModel';

/** The view a step's marks are drawn in. */
export interface DiagramAnnotationView {
  /** The picture they are in step with, by its key; null while they are out of step with their step's. */
  pictureKey: string | null;
  /** Their units: the step's window when it is enlarged, else null, its whole picture. */
  window: PictureBox | null;
  /** The References card the step shows (17d, `stepDiagramCardKey`); absent on any other picture. */
  card?: string;
}

/** Annotations copied from a step, as the clipboard holds them. */
export interface DiagramAnnotationClipboardPayload {
  kind: 'diagram-annotations';
  /** As they were when copied: an edit made since does not reach them. */
  annotations: readonly KnownDiagramAnnotation[];
  /**
   * How many lie where the next paste on each step would: the copies pasted
   * there — and on the step they were copied from, the originals.
   */
  pastes: Readonly<Record<string, number>>;
  /** The view they were copied from; absent from a step with no picture. */
  view?: DiagramAnnotationView;
}

/** The view a step's marks are drawn on now: its picture's and its units; null for a step with no picture. */
export function annotationView(step: DiagramStep): DiagramAnnotationView | null {
  if (!step.picture) return null;
  const card = showsCard(step) ? stepDiagramCardKey(step.picture.key) : null;
  return { pictureKey: step.picture.key, window: stepWindow(step), ...(card !== null ? { card } : {}) };
}

/** The view copied marks were drawn in: a step's units, and its picture while its marks are in step with it. */
export function copiedView(step: DiagramStep): DiagramAnnotationView | undefined {
  const view = annotationView(step);
  if (!view) return undefined;
  return step.annotatedPictureKey === view.pictureKey ? view : { ...view, pictureKey: null };
}

/** How far down and right a paste is put from the one before it on a step, in picture units. */
export const PASTE_OFFSET = 0.03;

/** How much further out a pasted copy of equal divisions stands than the one before it on a step, in mm (ED12). */
export const PASTE_DIVISIONS_OFFSET_MM = 2.5;

/**
 * `annotations` of the step `stepId` on the clipboard: copied, the originals
 * still lie where they are; cut (`cut`), they do not.
 */
export function annotationClipboard(
  annotations: readonly KnownDiagramAnnotation[],
  stepId: string,
  { cut = false, view }: { cut?: boolean; view?: DiagramAnnotationView } = {}
): DiagramAnnotationClipboardPayload {
  return {
    kind: 'diagram-annotations',
    annotations: [...annotations],
    pastes: cut ? {} : { [stepId]: 1 },
    ...(view ? { view } : {}),
  };
}

/** The whole picture's units as a box: its longer side one, from its corner. */
const WHOLE: PictureBox = { x: 0, y: 0, width: 1, height: 1 };

/**
 * Marks copied in `from` as they lie in `onto`'s units: through the picture —
 * the same paper, on the same picture; the same place on the picture, on
 * another — but between windows of two pictures, where they keep their place
 * in the window. Onto another picture's window from a whole picture, a mark
 * the window would draw nowhere at the same place on the picture
 * (`marksInWindow`) keeps its place in the window too, as one from a window
 * would (18d): an eye or a star from across a whole step lands where it
 * shows, not where a window draws nothing of it. Each mark is asked on its
 * own: one pasted with a mark the window draws is not left where it draws
 * nothing (18d review). One the window draws, though beside it — a line across
 * the model — still lands at the same place on the picture (16g; Revision 2,
 * decision 7). Run within the reach of `onto`'s units.
 */
function intoView(
  annotations: readonly KnownDiagramAnnotation[],
  from: DiagramAnnotationView | undefined,
  onto: DiagramAnnotationView | null
): readonly KnownDiagramAnnotation[] {
  if (!from || !onto) return annotations;
  const samePicture = from.pictureKey !== null && from.pictureKey === onto.pictureKey;
  if (from.window && onto.window && !samePicture) return annotations;
  const [a, b] = [from.window ?? WHOLE, onto.window ?? WHOLE];
  if (a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height) return annotations;
  const move = unitsMove(a, b);
  const carried = annotations.map((annotation) => carryAnnotation(annotation, move));
  if (onto.window === null || samePicture) return carried;
  const drawn = new Set<DiagramAnnotation>(marksInWindow(onto.window, carried));
  return carried.map((annotation, index) => (drawn.has(annotation) ? annotation : annotations[index]!));
}

/**
 * The copies a paste puts on the step `stepId`: each with a fresh id, moved
 * down and right by {@link PASTE_OFFSET} for each that already lies there
 * ({@link DiagramAnnotationClipboardPayload.pastes}) — equal divisions left on
 * their line, standing {@link PASTE_DIVISIONS_OFFSET_MM} further out for
 * each, up to the furthest a line may stand. `onto`, the step: they are first
 * put in its units ({@link DiagramAnnotationView}), and everything is kept
 * within its reach, as a move is — an enlarged step's window's, which reaches
 * as far as its whole picture's, so a mark across the model from a small
 * frame lands where it was copied rather than at four windows out.
 */
export function pastedAnnotations(
  clipboard: DiagramAnnotationClipboardPayload,
  stepId: string,
  newId: DiagramIdFactory = randomDiagramId,
  onto?: DiagramStep
): KnownDiagramAnnotation[] {
  const earlier = clipboard.pastes[stepId] ?? 0;
  const offset = PASTE_OFFSET * earlier;
  const view = onto ? annotationView(onto) : null;
  // The card's marks stay its own only on a step that shows the same card, as the one copy there (17d).
  const cards = earlier === 0 && clipboard.view?.card !== undefined && clipboard.view.card === view?.card;
  return withAnnotationReach(onto ? stepReach(onto) : PICTURE_REACH, () =>
    intoView(clipboard.annotations.map((annotation) => (cards ? annotation : untagged(annotation))), clipboard.view, view).map((annotation) => {
      const copy =
        annotation.kind === 'divisions'
          ? {
              ...annotation,
              offset: Math.min(DIVISIONS_OFFSET_MM.max, divisionsOffsetOf(annotation) + PASTE_DIVISIONS_OFFSET_MM * earlier),
            }
          : moveAnnotation(annotation, [offset, offset]);
      return { ...copy, id: newId('annotation') };
    })
  );
}

/** The clipboard once its annotations have been pasted on `stepId` again. */
export function pastedOnto(clipboard: DiagramAnnotationClipboardPayload, stepId: string): DiagramAnnotationClipboardPayload {
  return { ...clipboard, pastes: { ...clipboard.pastes, [stepId]: (clipboard.pastes[stepId] ?? 0) + 1 } };
}
