/**
 * Turning the whole model between two steps: the one turn type every surface
 * that shows a sequence of steps shares — a Diagram's turn entry (D22) and a
 * Fold sequence's turn step — so a turn passes from one to the other with
 * nothing to translate. A turn is no step: it takes no number, and the steps
 * either side of it read 3 and 4.
 *
 * Pure: no DOM, no store.
 */

/** The axis a turn-over turns the model about: vertical turns it side to side, horizontal top to bottom. */
export type TurnOverAxis = 'vertical' | 'horizontal';

/** Which way a rotation turns the model, as the viewer sees it. */
export type TurnDirection = 'cw' | 'ccw';

/** The parts of a turn a rotation names by a fraction: 1/8, 1/4 and 1/2. */
export type TurnRotationPreset = 'eighth' | 'quarter' | 'half';

export const TURN_ROTATION_PRESETS: readonly TurnRotationPreset[] = ['eighth', 'quarter', 'half'];

export const TURN_DIRECTIONS: readonly TurnDirection[] = ['cw', 'ccw'];

/**
 * How far, and which way, a rotation turns the model: a part of a turn, or an
 * exact angle in degrees, more than 0 and less than a whole turn, kept to a
 * millionth ({@link isTurnDegreesPrecise}).
 *
 * Fold's angles are normalised: at most 180 — further one way is less the
 * other — and never a preset's own (45, 90 or 180), which is that preset
 * ({@link turnRotationOfDegrees}). So a Fold rotation has one spelling, and
 * Fold's file and the engine's wire take only those ({@link readTurnRotation}).
 * A Diagram's angle of the author's own (Custom, `diagram/document/
 * diagramRotation.ts`) is printed as typed — 270° clockwise, or 90° rather
 * than 1/4 — so it is any angle in that range; a Diagram turn never goes back
 * to Fold. A file written before exact angles reads and writes exactly as it
 * did.
 *
 * A build that knows only the presets reads `amount: 'degrees'`, or the
 * `degrees` key, as a newer build's turn, never as a preset.
 */
export type TurnRotation =
  | { amount: TurnRotationPreset; direction: TurnDirection }
  | { amount: 'degrees'; degrees: number; direction: TurnDirection };

/** How a rotation names how far it turns: a preset, or exact degrees. */
export type TurnRotationAmount = TurnRotation['amount'];

/** What a turn is, without its id: over, about an axis, or round by a part of a turn or an angle. */
export type TurnKind =
  | { kind: 'turn-over'; axis: TurnOverAxis }
  | { kind: 'rotate'; rotate: TurnRotation };

/** The numbers of the steps either side of a turn; null at an end. */
export interface TurnBetween {
  before: number | null;
  after: number | null;
}

/** Each preset's angle, in degrees. */
export const TURN_PRESET_DEGREES: Readonly<Record<TurnRotationPreset, number>> = {
  eighth: 45,
  quarter: 90,
  half: 180,
};

/** An exact angle is kept to a millionth of a degree: what is typed, without the float noise of reducing it. */
const DEGREES_PRECISION = 1e6;

/** Whether an angle is kept as a rotation keeps one: to a millionth of a degree. A finer one is a newer build's. */
export function isTurnDegreesPrecise(degrees: number): boolean {
  return Math.round(degrees * DEGREES_PRECISION) / DEGREES_PRECISION === degrees;
}

/** How far a rotation turns, in degrees: more than 0, at most 180. */
export function turnRotationDegrees(rotation: TurnRotation): number {
  return rotation.amount === 'degrees' ? rotation.degrees : TURN_PRESET_DEGREES[rotation.amount];
}

/**
 * A rotation of `degrees` the way `direction` says, normalised, or null for
 * none: an angle that is not a finite number, or that turns the model by no
 * angle at all (0, a whole turn). Reduced to a turn's worth; a negative angle
 * turns the other way, and one past a half turn is the rest of the turn the
 * other way (270° clockwise is 90° counterclockwise). A preset's angle is
 * that preset.
 */
export function turnRotationOfDegrees(degrees: number, direction: TurnDirection): TurnRotation | null {
  if (!Number.isFinite(degrees)) return null;
  const other: TurnDirection = direction === 'cw' ? 'ccw' : 'cw';
  let angle = Math.round((degrees % 360) * DEGREES_PRECISION) / DEGREES_PRECISION;
  let way = direction;
  if (angle < 0) {
    angle = -angle;
    way = other;
  }
  if (angle > 180) {
    angle = Math.round((360 - angle) * DEGREES_PRECISION) / DEGREES_PRECISION;
    way = way === direction ? other : direction;
  }
  if (angle === 0) return null;
  const preset = TURN_ROTATION_PRESETS.find((each) => TURN_PRESET_DEGREES[each] === angle);
  return preset ? { amount: preset, direction: way } : { amount: 'degrees', degrees: angle, direction: way };
}

/** The same rotation by a preset's part of a turn, its direction kept. */
export function withTurnPreset(rotation: TurnRotation, amount: TurnRotationPreset): TurnRotation {
  return { amount, direction: rotation.direction };
}

/** The same rotation the other way, or this way: its amount, and an exact angle, kept. */
export function withTurnDirection(rotation: TurnRotation, direction: TurnDirection): TurnRotation {
  return rotation.amount === 'degrees'
    ? { amount: 'degrees', degrees: rotation.degrees, direction }
    : { amount: rotation.amount, direction };
}

/**
 * A rotation as a file writes it, every field named in a fixed order: a
 * preset's `{ amount, direction }`, as it always was, and an exact angle's
 * `{ amount: 'degrees', degrees, direction }`.
 */
export function writeTurnRotation(rotation: TurnRotation): Record<string, unknown> {
  return rotation.amount === 'degrees'
    ? { amount: rotation.amount, degrees: rotation.degrees, direction: rotation.direction }
    : { amount: rotation.amount, direction: rotation.direction };
}

/** The keys a rotation is written with ({@link writeTurnRotation}): any other is a newer build's. */
export const TURN_ROTATION_KEYS: ReadonlySet<string> = new Set(['amount', 'degrees', 'direction']);

/**
 * A rotation from the fields a file holds, or null when they name none this
 * build reads: a preset with no `degrees`; or `degrees`, an angle already
 * normalised ({@link turnRotationOfDegrees} gives it back unchanged). What
 * null means — a locked step, a newer build's turn — is each reader's to say,
 * as is a key it does not know.
 */
export function readTurnRotation(fields: { amount?: unknown; degrees?: unknown; direction?: unknown }): TurnRotation | null {
  const direction = TURN_DIRECTIONS.find((known) => known === fields.direction);
  if (!direction) return null;
  const preset = TURN_ROTATION_PRESETS.find((known) => known === fields.amount);
  if (preset) return fields.degrees === undefined ? { amount: preset, direction } : null;
  if (fields.amount !== 'degrees' || typeof fields.degrees !== 'number') return null;
  const normalised = turnRotationOfDegrees(fields.degrees, direction);
  return normalised?.amount === 'degrees' && normalised.degrees === fields.degrees && normalised.direction === direction
    ? normalised
    : null;
}

/**
 * An exact angle as it is written in words and on a glyph: a whole number of
 * degrees as it is, a fraction to two places at most — `30`, `22.5`, `33.33`.
 */
export function formatTurnDegrees(degrees: number): string {
  return String(Math.round(degrees * 100) / 100);
}

/** A preset's part of a turn, as it is written in words and on a glyph: "1/4". */
export const TURN_FRACTION: Readonly<Record<TurnRotationPreset, string>> = {
  eighth: '1/8',
  quarter: '1/4',
  half: '1/2',
};

/** How far a rotation turns, as its glyph prints it in its middle: "1/4", or "30°". */
export function turnRotationGlyphText(rotation: TurnRotation): string {
  return rotation.amount === 'degrees' ? `${formatTurnDegrees(rotation.degrees)}°` : TURN_FRACTION[rotation.amount];
}

/** Whether two rotations turn the model the same way, field by field. */
export function sameTurnRotation(a: TurnRotation, b: TurnRotation): boolean {
  return a.amount === b.amount && a.direction === b.direction && turnRotationDegrees(a) === turnRotationDegrees(b);
}

/** Whether two turns turn the model the same way, field by field. */
export function sameTurnKind(a: TurnKind, b: TurnKind): boolean {
  if (a.kind === 'turn-over') return b.kind === 'turn-over' && a.axis === b.axis;
  return b.kind === 'rotate' && sameTurnRotation(a.rotate, b.rotate);
}
