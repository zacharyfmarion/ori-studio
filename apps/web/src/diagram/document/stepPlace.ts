/**
 * A step placed by hand on the printed pages
 * (`implementation-plans/diagram-page-overrides.md`): its placement as it is
 * kept, and the edits that set and reset it.
 *
 * A placement is kept in one shape however it was made — by a drag, a nudge,
 * the Step pane or a file: offsets to a tenth of a mm, an offset of none left
 * out, a pin only when it is a scale, and no placement at all when nothing is
 * left. So an offset dragged home and one never moved are the same, and an
 * untouched file is written back as it was read.
 *
 * Which offsets clear when a step changes cell is `pages/stepPlaces.ts`'s
 * (`settlePlaces`), run once per edit by the store. Pure, React-free and
 * store-free.
 */
import {
  isLockedStep,
  isTurn,
  stepIndex,
  type DiagramDocument,
  type DiagramPlaceReset,
  type DiagramStep,
  type DiagramStepPlace,
} from './diagramDocument';

// Keep the editing API stable while the layout consumes only the value layer.
export { PLACE_OFFSETS, PLACE_OFFSET_STEP_MM, placeOffset, placeScale, normalizeStepPlace, patchedStepPlace, samePlace, resetPlace, type DiagramStepPlacePatch } from './placeValues';
import { patchedStepPlace, samePlace, resetPlace, type DiagramStepPlacePatch } from './placeValues';

/** Whether a step is placed by hand: by this build, or by a newer one this build carries. */
export function isPlacedStep(step: DiagramStep): boolean {
  return step.place !== undefined || step.placeNewer !== undefined;
}

/**
 * Why a step's placement cannot be edited here, or null when it can: a
 * newer build's step (`locked`), or a newer build's placement on a step this
 * build reads (`newer`) — which only a reset of the whole placement may drop.
 */
export function placementBlocker(step: DiagramStep): 'locked' | 'newer' | null {
  if (isLockedStep(step)) return 'locked';
  return step.placeNewer !== undefined ? 'newer' : null;
}

/** A step with `place` as its placement: the same step when it already is. */
function withPlace(step: DiagramStep, place: DiagramStepPlace | undefined): DiagramStep {
  if (samePlace(step.place, place)) return step;
  const { place: _was, ...rest } = step;
  return place ? { ...rest, place } : rest;
}

/** One step's edit, by id: a turn, an id not there or a newer build's step is left as it is. */
function editStep(document: DiagramDocument, stepId: string, edit: (step: DiagramStep) => DiagramStep): DiagramDocument {
  const index = stepIndex(document, stepId);
  const entry = document.steps[index];
  if (!entry || isTurn(entry) || isLockedStep(entry)) return document;
  const next = edit(entry);
  if (next === entry) return document;
  const steps = document.steps.slice();
  steps[index] = next;
  return { ...document, steps };
}

/**
 * A step's placement changed by `patch` ({@link DiagramStepPlacePatch}). The
 * same document when it changes nothing, and for a step whose placement
 * cannot be edited ({@link placementBlocker}). An enlarged step pins no
 * scale — its Size is its pin — so a patch that pins one there changes
 * nothing; one that clears one it kept from before goes through.
 */
export function setStepPlace(document: DiagramDocument, stepId: string, patch: DiagramStepPlacePatch): DiagramDocument {
  return editStep(document, stepId, (step) => {
    if (placementBlocker(step) !== null) return step;
    if (step.zoom && patch.scale) return step;
    return withPlace(step, patchedStepPlace(step.place, patch));
  });
}

/**
 * A step's placement reset: one offset, the pin, every offset (`position`),
 * or all of it (`all`), which alone also drops a newer build's placement.
 * The same document when there was nothing to reset.
 */
export function resetStepPlace(document: DiagramDocument, stepId: string, part: DiagramPlaceReset): DiagramDocument {
  return editStep(document, stepId, (step) => {
    if (part === 'all') return clearedPlacement(step);
    if (placementBlocker(step) !== null) return step;
    return withPlace(step, resetPlace(step.place, part));
  });
}

/**
 * Every placement of the steps `stepIds` names — or of every step, for
 * null — reset whole, a newer build's included: Reset This Page and Reset
 * All. Steps of a newer build are left as they are.
 */
export function resetStepPlaces(document: DiagramDocument, stepIds: ReadonlySet<string> | null): DiagramDocument {
  let steps: DiagramDocument['steps'] | null = null;
  document.steps.forEach((entry, index) => {
    if (isTurn(entry) || isLockedStep(entry) || (stepIds !== null && !stepIds.has(entry.id))) return;
    const cleared = clearedPlacement(entry);
    if (cleared === entry) return;
    steps ??= document.steps.slice();
    steps[index] = cleared;
  });
  return steps ? { ...document, steps } : document;
}

/**
 * A diagram as a layout that ignores hand placement reads it: every
 * placement this build would apply (`place`) left out. Placement is the
 * pages' alone; step files, which lay the pages out only to read an enlarged
 * step's window, take this. A newer build's placement, never applied, is
 * left as it is. The same diagram when nothing is placed.
 */
export function unplacedDiagram(document: DiagramDocument): DiagramDocument {
  if (!document.steps.some((entry) => !isTurn(entry) && entry.place !== undefined)) return document;
  const steps = document.steps.map((entry) => {
    if (isTurn(entry) || entry.place === undefined) return entry;
    const { place: _place, ...rest } = entry;
    return rest;
  });
  return { ...document, steps };
}

/** A step with no placement at all, a newer build's included: the same step when it had none. */
function clearedPlacement(step: DiagramStep): DiagramStep {
  if (!isPlacedStep(step)) return step;
  const { place: _place, placeNewer: _newer, ...rest } = step;
  return rest;
}
