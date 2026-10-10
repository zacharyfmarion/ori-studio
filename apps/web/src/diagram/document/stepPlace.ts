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
  type DiagramPlaceOffset,
  type DiagramPlaceReset,
  type DiagramPlaceScale,
  type DiagramStep,
  type DiagramStepPlace,
} from './diagramDocument';

/** The offsets, in the order a placement is written. */
export const PLACE_OFFSETS: readonly DiagramPlaceOffset[] = ['frame', 'number', 'picture', 'text'];

/** What an offset is kept to, mm: a tenth. One that comes to none both ways is no offset. */
export const PLACE_OFFSET_STEP_MM = 0.1;

/**
 * A change to a placement: each field set to a value, or cleared with null;
 * one left out stays as it is. A value is kept as {@link normalizeStepPlace}
 * keeps it, so an offset of none clears too — but one that is no offset or
 * pin at all (not two finite numbers, a pin not above zero) changes nothing:
 * only null clears.
 */
export type DiagramStepPlacePatch = { [K in keyof DiagramStepPlace]?: DiagramStepPlace[K] | null };

/** A length to a tenth of a mm ({@link PLACE_OFFSET_STEP_MM}), as a decimal writes it, never a negative zero. */
function toTenth(mm: number): number {
  const tenths = Math.round(mm * 10);
  return tenths === 0 ? 0 : tenths / 10;
}

/** Whether a value is an offset at all: two finite numbers, whatever their size. */
function isOffset(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every((each) => typeof each === 'number' && Number.isFinite(each));
}

/**
 * An offset as it is kept: two finite numbers, each to a tenth of a mm. Null
 * for one that is not, and for one that comes to none both ways (under
 * 0.05 mm each), which is where the layout puts it.
 */
export function placeOffset(value: unknown): [number, number] | null {
  if (!isOffset(value)) return null;
  const offset: [number, number] = [toTenth(value[0]), toTenth(value[1])];
  return offset[0] === 0 && offset[1] === 0 ? null : offset;
}

/**
 * A pinned scale as it is kept: exactly one of `mmPerUnit` and `frameMm`,
 * finite and above zero. Null for anything else. How large it may print is
 * the layout's to hold, which knows the picture's units; this does not.
 */
export function placeScale(value: unknown): DiagramPlaceScale | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1) return null;
  const [key] = keys;
  const measure = (value as Record<string, unknown>)[key!];
  if (typeof measure !== 'number' || !Number.isFinite(measure) || !(measure > 0)) return null;
  if (key === 'mmPerUnit') return { mmPerUnit: measure };
  if (key === 'frameMm') return { frameMm: measure };
  return null;
}

/**
 * A placement as it is kept ({@link placeOffset}, {@link placeScale}), every
 * field in the order it is written; undefined when nothing is left of it.
 */
export function normalizeStepPlace(place: DiagramStepPlace | undefined): DiagramStepPlace | undefined {
  if (!place) return undefined;
  const kept: DiagramStepPlace = {};
  for (const part of PLACE_OFFSETS) {
    const offset = place[part] === undefined ? null : placeOffset(place[part]);
    if (offset) kept[part] = offset;
  }
  const scale = place.scale === undefined ? null : placeScale(place.scale);
  if (scale) kept.scale = scale;
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/**
 * A placement with `patch` applied, as it is kept: undefined when nothing is
 * left. A field the patch gives no offset or pin at all keeps what it had
 * ({@link DiagramStepPlacePatch}): a Size typed as 0 never drops a pin.
 */
export function patchedStepPlace(
  place: DiagramStepPlace | undefined,
  patch: DiagramStepPlacePatch
): DiagramStepPlace | undefined {
  const next: DiagramStepPlace = { ...place };
  for (const part of PLACE_OFFSETS) {
    const value = patch[part];
    if (value === null) delete next[part];
    else if (isOffset(value)) next[part] = value;
  }
  if (patch.scale === null) delete next.scale;
  else if (patch.scale !== undefined && placeScale(patch.scale) !== null) next.scale = patch.scale;
  return normalizeStepPlace(next);
}

/** Whether two placements, or their absence, say the same, field for field. */
export function samePlace(a: DiagramStepPlace | undefined, b: DiagramStepPlace | undefined): boolean {
  return a === b || JSON.stringify(normalizeStepPlace(a)) === JSON.stringify(normalizeStepPlace(b));
}

/** A placement with the fields `part` names taken out: undefined when nothing is left. */
export function resetPlace(place: DiagramStepPlace | undefined, part: Exclude<DiagramPlaceReset, 'all'>): DiagramStepPlace | undefined {
  if (!place) return undefined;
  const parts: readonly (keyof DiagramStepPlace)[] = part === 'position' ? PLACE_OFFSETS : [part];
  const next: DiagramStepPlace = { ...place };
  for (const each of parts) delete next[each];
  return normalizeStepPlace(next);
}

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
