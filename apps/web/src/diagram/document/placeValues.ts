/** Placement values and normalization, with no runtime document/store dependencies. */
import type { DiagramPlaceOffset, DiagramPlaceReset, DiagramPlaceScale, DiagramStepPlace } from './diagramDocument';

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

