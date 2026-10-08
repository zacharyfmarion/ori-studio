/**
 * Make Marks Editable (17e, RM8 and §9 of
 * `implementation-plans/diagram-references-annotations.md`): a References
 * step whose card's marks are still part of its picture — every step pulled
 * before marks were lifted (17d), and one pulled whole past what a step held
 * — keeps painting as it always did until this is pressed, in Annotate's
 * notice on the step (the Step pane's, or the Layers pane's), the Step pane's
 * Picture section or the step card's menu. Then its card is split as a fresh
 * pull splits it: every mark, the Show menu's choice aside, lifted into
 * annotations over its sheet, the author's own marks kept over them, as one
 * undo step. The reader never converts a file; nothing else does either.
 *
 * What the toast and the count say is what the step holds after: on an
 * enlarged step the marks its frame leaves out are not lifted (§5), and the
 * toast says how many, with Undo — as it does for marks the author had
 * edited that the card's fresh ones replaced (a copy pasted onto the step).
 *
 * Offered only where it can do it (`editableCardMarks`): a step whose marks
 * and the author's would be more than a step holds shows the verb disabled,
 * with the reason, rather than offering it and refusing.
 */
import { toast } from 'sonner';
import { trackDiagramReferencesMarksLifted, type DiagramMarksLiftedVia } from '../../analytics';
import i18n from '../../i18n';
import { DEFAULT_PAPER_EXPORT_MARKS } from '../../lib/paperExportSettings';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { editedCardMarksGone, isCardMark } from '../document/cardMarks';
import { stepById, stepNumber, type DiagramStep } from '../document/diagramDocument';
import { replacedEdited, undoNewest } from './cardMarksToast';
import { editableCardMarks, liftedCardPicture } from './referencesCardMarks';

/**
 * Lift the card's marks on step `stepId` into annotations (17e), counted by
 * where it was pressed, and say so. False when there was nothing to lift, it
 * would not fit, or the diagram cannot change.
 */
export function makeStepMarksEditable(stepId: string, via: DiagramMarksLiftedVia): boolean {
  const store = useWorkspaceStore.getState();
  const diagram = store.diagram;
  const was = diagram ? stepById(diagram, stepId) : null;
  if (!diagram || !was || store.diagramReadOnly || was.picture?.kind !== 'step-diagram') return false;
  if (!editableCardMarks(was, diagram.style)?.fits) return false;
  // Every mark, as a fresh pull with the Show menu showing them all lifts them, in the diagram's style.
  const lifted = liftedCardPicture(was.picture, DEFAULT_PAPER_EXPORT_MARKS, diagram.style);
  if (!lifted || !store.makeDiagramStepMarksEditable(stepId, lifted, { loadId: store.diagramLoadId })) return false;
  const now = useWorkspaceStore.getState().diagram;
  const after = now ? stepById(now, stepId) : null;
  if (!now || !after) return true;
  const made = madeEditable(was, after, lifted.annotations.length);
  trackDiagramReferencesMarksLifted(via, made.placed);
  sayMadeEditable(made, stepNumber(now, stepId) ?? 0);
  return true;
}

/**
 * What Make Marks Editable did to a step, `was` to `after`: the card's marks
 * it holds now, those of the `lifted` an enlarged step's frame left out, and
 * the marks of the card the author had edited that went.
 */
interface MadeEditable {
  placed: number;
  outsideFrame: number;
  replaced: number;
}

function madeEditable(was: DiagramStep, after: DiagramStep, lifted: number): MadeEditable {
  const before = new Set(was.annotations.map((annotation) => annotation.id));
  const placed = after.annotations.filter((annotation) => isCardMark(after, annotation) && !before.has(annotation.id)).length;
  return { placed, outsideFrame: Math.max(0, lifted - placed), replaced: editedCardMarksGone(was, after) };
}

/** The toast: how many marks are editable now, and, with Undo, what went that the step showed or the author made. */
function sayMadeEditable({ placed, outsideFrame, replaced }: MadeEditable, number: number): void {
  const t = i18n.t;
  const title =
    placed > 0
      ? t('toasts:diagram.references.marksEditable', {
          count: placed,
          number,
          defaultValue_one: 'Step {{number}}’s mark is editable now',
          defaultValue_other: 'Step {{number}}’s {{count}} marks are editable now',
        })
      : t('toasts:diagram.references.noMarksInFrame', 'None of step {{number}}’s marks are in its enlarged frame', {
          number,
        });
  const notes = [
    outsideFrame > 0
      ? t('toasts:diagram.references.marksOutsideFrame', {
          count: outsideFrame,
          defaultValue_one: 'A mark outside the enlarged frame was left out',
          defaultValue_other: '{{count}} marks outside the enlarged frame were left out',
        })
      : null,
    replaced > 0 ? replacedEdited(replaced) : null,
  ].filter((note): note is string => note !== null);
  if (notes.length === 0) {
    toast.success(title);
    return;
  }
  const options = { description: notes.join(' · '), action: undoNewest() };
  if (placed > 0) toast.success(title, options);
  else toast.message(title, options);
}
