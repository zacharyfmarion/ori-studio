/**
 * Marks lifted from a References card (17d, §6 of
 * `implementation-plans/diagram-references-annotations.md`): a pulled step's
 * paper is its picture, and its folds, reference lines, rings, letters and
 * arrows are annotations, each tagged `untouched` as it arrived and `edited`
 * once the author changes it. The tag says the mark is the card's: Replace
 * from References and another way swap every tagged mark for the new card's,
 * and keep the author's own.
 *
 * A tag means something only on a step that shows a card: once its picture
 * stops being one (Remove Picture, a capture or an upload in its place) the
 * marks are released, and every one is the author's. Tagged marks are never
 * out of step with their picture — each arrives with the picture it was made
 * for, and every carry takes it along — so the "picture changed" notice
 * counts the author's marks alone, and only touching one of those puts them
 * in step again.
 *
 * Pure, and a leaf: types only from the document, so the document, the
 * carries and the clipboard can all read it.
 */
import { sameAnnotation } from '../annotate/annotationModel';
import type {
  DiagramAnnotation,
  DiagramAnnotationKind,
  DiagramImportedMark,
  DiagramStep,
  KnownDiagramAnnotation,
} from './diagramDocument';

/** A mark the card brought: one this build reads, tagged. */
export type CardMark = KnownDiagramAnnotation & { imported: DiagramImportedMark };

/** Whether a step shows a References card, whose marks it can carry as the card's. */
export function showsCard(step: Pick<DiagramStep, 'source' | 'picture'>): boolean {
  return step.source?.kind === 'references-step' && step.picture?.kind === 'step-diagram';
}

/** Whether a mark carries the tag a mark lifted from a card does, whatever its step shows: one this build reads. */
export function isTagged(annotation: DiagramAnnotation): annotation is CardMark {
  return annotation.unknown === undefined && annotation.imported !== undefined;
}

/** Whether `annotation` is a mark the step's card brought (17d): tagged, on a step that shows a card. */
export function isCardMark(step: Pick<DiagramStep, 'source' | 'picture'>, annotation: DiagramAnnotation): annotation is CardMark {
  return isTagged(annotation) && showsCard(step);
}

/** The author's marks: every mark but those the step's card brought, one this build cannot read among them. */
export function authorMarksOf(step: Pick<DiagramStep, 'source' | 'picture' | 'annotations'>): DiagramAnnotation[] {
  return step.annotations.filter((annotation) => !isCardMark(step, annotation));
}

/**
 * Whether an edit, `before` to `after`, touched the author's marks: added,
 * changed, took away or reordered one. Changing only marks the card brought
 * does not (17d), so it leaves a "picture changed" notice on the author's
 * own as it was.
 */
export function authorMarksChanged(
  before: Pick<DiagramStep, 'source' | 'picture' | 'annotations'>,
  after: Pick<DiagramStep, 'source' | 'picture' | 'annotations'>
): boolean {
  const [was, now] = [authorMarksOf(before), authorMarksOf(after)];
  return was.length !== now.length || was.some((mark, index) => mark !== now[index] && !sameAnnotation(mark, now[index]));
}

/** A mark with no tag: the author's, as one pasted where its card is not becomes. */
export function untagged(annotation: KnownDiagramAnnotation): KnownDiagramAnnotation {
  if (annotation.imported === undefined) return annotation;
  const { imported: _was, ...own } = annotation;
  return own;
}

/**
 * A step whose picture stopped being its card (Remove Picture, a capture or
 * an upload in its place): every mark released from it, the author's now,
 * and so under the "picture changed" notice. The step itself when none is
 * tagged.
 */
export function releaseCardMarks(step: DiagramStep): DiagramStep {
  if (!step.annotations.some(isTagged)) return step;
  return {
    ...step,
    annotations: step.annotations.map((annotation) => (isTagged(annotation) ? untagged(annotation) : annotation)),
  };
}

/**
 * Marks an edit returned, `after`, with their tags brought up to date against
 * what they were, `before` (17d): a mark the card brought untouched becomes
 * `edited` once it says anything else. Each is compared with its prior self
 * in the same normal form, `normal` (as the edit cleans it), so the cleaning
 * and a reach's clamp on an unrelated edit never count as edits. A mark the
 * edit did not change, a new one and one already edited keep their tags.
 */
export function withEditTags(
  before: readonly KnownDiagramAnnotation[],
  after: readonly KnownDiagramAnnotation[],
  normal: (annotation: KnownDiagramAnnotation) => KnownDiagramAnnotation
): KnownDiagramAnnotation[] {
  const untouched = new Map(before.filter((mark) => mark.imported === 'untouched').map((mark) => [mark.id, mark]));
  if (untouched.size === 0) return [...after];
  return after.map((mark) => {
    const prior = untouched.get(mark.id);
    if (!prior || mark.imported !== 'untouched' || sameAnnotation(untagged(normal(prior)), untagged(mark))) return mark;
    return { ...mark, imported: 'edited' };
  });
}

/** What an edit did to the marks a step's card brought, each by its kind: changed for the first time, or taken away. */
export interface CardMarkEdit {
  kind: DiagramAnnotationKind;
  annotation: KnownDiagramAnnotation;
  edit: 'changed' | 'deleted';
}

/**
 * The card's marks an edit of a step's marks touched (17d), `before` to
 * `after`: one tagged `untouched` that is `edited` now, and one taken away,
 * edited or not. What `diagram imported mark edited` counts.
 */
export function cardMarkEdits(before: DiagramStep, after: DiagramStep): CardMarkEdit[] {
  if (!showsCard(before)) return [];
  const now = new Map(after.annotations.map((annotation) => [annotation.id, annotation]));
  const edits: CardMarkEdit[] = [];
  for (const mark of before.annotations) {
    if (!isCardMark(before, mark)) continue;
    const next = now.get(mark.id);
    if (!next) edits.push({ kind: mark.kind, annotation: mark, edit: 'deleted' });
    else if (mark.imported === 'untouched' && next.unknown === undefined && next.imported === 'edited') {
      edits.push({ kind: mark.kind, annotation: mark, edit: 'changed' });
    }
  }
  return edits;
}

/**
 * How many marks the card brought that the author had edited are gone,
 * `before` to `after`: what a Replace or another way swapped away, for the
 * toast that offers them back.
 */
export function editedCardMarksGone(before: DiagramStep, after: DiagramStep): number {
  if (!showsCard(before)) return 0;
  const kept = new Set(after.annotations.map((annotation) => annotation.id));
  return before.annotations.filter((mark) => isCardMark(before, mark) && mark.imported === 'edited' && !kept.has(mark.id)).length;
}
