/**
 * How an enlarged step stands against the area it was captured from (review
 * fix 4, `implementation-plans/diagram-review-fixes.md`), as a linked
 * picture stands against its pattern (`capture/linkStatus.ts`): the area as
 * the step recorded it (`DiagramStepZoom.areaWas`), or moved, resized,
 * reshaped, re-anchored or given another Size or Edge by hand since;
 * deleted; or not known — a file written before steps recorded it, until the
 * first hand edit of its area records it (`areaRecord.ts`).
 *
 * One predicate per question: {@link outOfDate} is what every surface says
 * and offers Update or Update All for — the card's chip, the Step pane's
 * notice and its Update, the area's step and its row in Layers.
 *
 * Derived, never stored: an Undo of the area's edit gives back the status
 * with the diagram. Pure: no store.
 */
import { lacksPaperFaces } from '../capture/stepPaperFaces';
import {
  isLockedStep,
  isTurn,
  stepById,
  stepNumber,
  type DiagramDocument,
  type DiagramStep,
} from '../document/diagramDocument';
import { areaChangedFor } from './areaRecord';
import { areaSource, areaWasOf, stepsFrom } from './zoomCapture';
import { paperFacesOf } from './zoomImprint';

/** A step by its id and its number. */
export interface AreaStepRef {
  id: string;
  number: number;
}

export type EnlargedAreaStatus =
  /** The area is as the step's frame was captured from it. */
  | { kind: 'current'; areaStep: AreaStepRef }
  /** The area was edited by hand since, where Update would place or print the step otherwise (`areaChangedFor`). */
  | { kind: 'changed'; areaStep: AreaStepRef }
  /** The area is gone: its step, while that is in the diagram; null once it is gone too. */
  | { kind: 'deleted'; areaStep: AreaStepRef | null }
  /** Nothing recorded to tell by: the area's step, while the area is in the diagram. */
  | { kind: 'unknown'; areaStep: AreaStepRef | null };

function stepRef(document: DiagramDocument, stepId: string): AreaStepRef | null {
  const number = stepNumber(document, stepId);
  return number === null ? null : { id: stepId, number };
}

/**
 * An enlarged step against its area, from the diagram as it is; null for a
 * step that is not enlarged, or a newer build's. An area on a newer build's
 * step cannot be read, so a step whose record names one is not known.
 */
export function areaStatus(document: DiagramDocument, stepId: string): EnlargedAreaStatus | null {
  const step = stepById(document, stepId);
  if (!step?.zoom || isLockedStep(step)) return null;
  const { from, areaWas } = step.zoom;
  const source = areaSource(document, from);
  if (source && 'area' in source) {
    const areaStep = stepRef(document, source.step.id)!;
    if (!areaWas) return { kind: 'unknown', areaStep };
    return { kind: areaChangedFor(step.zoom, areaWasOf(source.step.id, source.area)) ? 'changed' : 'current', areaStep };
  }
  if (!areaWas) return { kind: 'unknown', areaStep: null };
  const was = stepById(document, areaWas.stepId);
  if (was && isLockedStep(was)) return { kind: 'unknown', areaStep: null };
  return { kind: 'deleted', areaStep: was ? stepRef(document, was.id) : null };
}

/**
 * An enlarged step's frame copied in picture units on a step whose paper it
 * could be anchored to: its steps have their faces, or a Refresh would give
 * them, and a capture from the area anchors it.
 */
export function frameUnanchored(step: DiagramStep): boolean {
  return (
    step.zoom !== undefined &&
    step.picture !== null &&
    step.zoom.imprint === undefined &&
    (lacksPaperFaces(step) || paperFacesOf(step) !== null)
  );
}

/**
 * An unanchored frame that Update anchors now ({@link frameUnanchored}): its
 * step and its area's have their faces, so no Refresh comes first. One that
 * needs a Refresh first is said so (`StepZoomNotice` `refresh`), and is not
 * out of date until then.
 */
export function updateAnchors(step: DiagramStep, areaStep: DiagramStep | null): boolean {
  return frameUnanchored(step) && !lacksPaperFaces(step) && areaStep !== null && !lacksPaperFaces(areaStep);
}

/**
 * Whether an enlarged step is out of date, its area in the diagram: the area
 * changed since its frame was captured from it, or its frame is a copy in
 * picture units that a capture now anchors. The one question every surface
 * asks: what the card and the Step pane say, and what Update and Update All
 * are offered for and place. Not a step with no record, nor one only moved
 * or sized on itself by hand: Update would undo the step's own edit.
 */
export function outOfDate(document: DiagramDocument, stepId: string): boolean {
  const status = areaStatus(document, stepId);
  if (!status || status.areaStep === null || status.kind === 'deleted') return false;
  if (status.kind === 'changed') return true;
  const step = stepById(document, stepId);
  return step !== null && updateAnchors(step, stepById(document, status.areaStep.id));
}

/**
 * The steps Update All places again for these areas (review fix 4): every
 * step enlarged from one of them that is {@link outOfDate}, wherever it sits,
 * in the diagram's order.
 */
export function stepsToUpdate(document: DiagramDocument, areaIds: readonly string[]): string[] {
  const from = new Set(areaIds.flatMap((areaId) => stepsFrom(document, areaId)));
  return document.steps
    .filter((entry) => !isTurn(entry) && from.has(entry.id) && outOfDate(document, entry.id))
    .map((entry) => entry.id);
}
