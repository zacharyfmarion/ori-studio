/**
 * A simulated step's positions between the step and the simulator
 * (`implementation-plans/diagram-simulated-pose-save-on-done.md`): what a step
 * stores of the shape Pose read as it saved, and the shape Pose opens on.
 * Both in the simulator's own encodings (`simulator/simulatorShape.ts`), so a
 * reopened step is the very mesh its picture was drawn from.
 */
import type { SimulatorShapeRead } from '../../simulator/simulatorSession';
import {
  decodeSimulatorShapeState,
  encodeSimulatorShapeState,
  SIMULATOR_SHAPE_STATE_PREFIX,
  SIMULATOR_SHEET_KEY_PREFIX,
  type SimulatorShape,
} from '../../simulator/simulatorShape';
import type { DiagramSavedShape, DiagramSimulatedShape } from '../document/diagramDocument';

/** The fields Pose saves positions with: a shape with any other is another build's (decision 5). */
const SAVED_SHAPE_KEYS: ReadonlySet<string> = new Set(['sheet', 'state', 'settled']);

/**
 * What a step stores of a shape Pose read: its sheet, its state encoded, and
 * whether the solver had settled. None for a model that keeps no shape — its
 * nodes' order cannot be decided, or it is past what a shape may carry — nor
 * for one pinned or posed, which Pose has no tools to make and this record
 * cannot put back: the step is saved without one, and Pose folds it from flat
 * at its fold % next time.
 */
export function storedSimulatedShape(read: SimulatorShapeRead, settled: boolean): DiagramSavedShape | undefined {
  if (typeof read === 'string' || read.pins.length > 0 || read.posed) return undefined;
  const state = encodeSimulatorShapeState(read.state);
  return state ? { sheet: read.sheet, state, settled } : undefined;
}

/**
 * A step's stored shape as Pose saved it, or null for none, or for another
 * build's (other fields, or encodings this build has no name for), which
 * Pose does not read. `settled` unsaid is settled.
 */
export function savedShapeOf(shape: DiagramSimulatedShape | undefined): DiagramSavedShape | null {
  if (!shape || Object.keys(shape).some((key) => !SAVED_SHAPE_KEYS.has(key))) return null;
  const { sheet, state, settled } = shape;
  if (typeof sheet !== 'string' || !sheet.startsWith(SIMULATOR_SHEET_KEY_PREFIX)) return null;
  if (typeof state !== 'string' || !state.startsWith(SIMULATOR_SHAPE_STATE_PREFIX)) return null;
  if (settled !== undefined && typeof settled !== 'boolean') return null;
  return { sheet, state, settled: settled !== false };
}

/** A step's stored shape for the simulator to open on; null for none, another build's, or one that does not decode. */
export function simulatorShapeOf(shape: DiagramSimulatedShape | undefined): SimulatorShape | null {
  const saved = savedShapeOf(shape);
  const state = saved ? decodeSimulatorShapeState(saved.state) : null;
  return saved && state ? { sheet: saved.sheet, pins: [], posed: false, state } : null;
}
