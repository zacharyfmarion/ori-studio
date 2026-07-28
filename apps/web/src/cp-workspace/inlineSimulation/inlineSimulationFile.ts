import type { Point } from '../../lib/geometry';
import type { FoldedSourceBounds } from '../folded/foldedFigureStaleness';
import type { InlineSimulation } from './inlineSimulation';

/**
 * Reading inline simulation windows back out of an `.osf`.
 *
 * Lenient in the house style (`validateTextAnnotations`, `nativeProjectFile`): a
 * malformed entry is dropped rather than throwing, so one bad window never
 * blocks opening a project.
 *
 * Provenance is a different matter. `sourceBounds` and `sourceFingerprint` are
 * nullable in the descriptor and mean "we cannot tell whether this is stale",
 * which the staleness check reads as *not* stale — so quietly nulling a field
 * that was merely written oddly would turn the indicator off for that window
 * forever. They are preserved as written or the window is dropped, never
 * silently downgraded.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function positiveNumber(value: unknown): number | null {
  const n = finiteNumber(value);
  return n !== null && n > 0 ? n : null;
}

function point(value: unknown): Point | null {
  if (!isRecord(value)) return null;
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  return x === null || y === null ? null : { x, y };
}

/** Rings of the region's rim. Any malformed ring invalidates the whole boundary. */
function boundary(value: unknown): Point[][] | null {
  if (!Array.isArray(value)) return null;
  const rings: Point[][] = [];
  for (const ring of value) {
    if (!Array.isArray(ring)) return null;
    const points: Point[] = [];
    for (const entry of ring) {
      const p = point(entry);
      if (!p) return null;
      points.push(p);
    }
    rings.push(points);
  }
  return rings;
}

function sourceBounds(value: unknown): FoldedSourceBounds | null {
  if (!isRecord(value)) return null;
  const minX = finiteNumber(value.minX);
  const minY = finiteNumber(value.minY);
  const maxX = finiteNumber(value.maxX);
  const maxY = finiteNumber(value.maxY);
  if (minX === null || minY === null || maxX === null || maxY === null) return null;
  return { minX, minY, maxX, maxY };
}

export function validateInlineSimulation(value: unknown): InlineSimulation | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || value.id === '') return null;

  const box = isRecord(value.box) ? value.box : null;
  const center = point(box?.center);
  const width = positiveNumber(box?.width);
  const height = positiveNumber(box?.height);
  // A window with no box has nowhere to be drawn; there is nothing to restore.
  if (!center || width === null || height === null) return null;

  const view = isRecord(value.view) ? value.view : null;
  const yaw = finiteNumber(view?.yaw);
  const pitch = finiteNumber(view?.pitch);
  const zoom = positiveNumber(view?.zoom);
  if (yaw === null || pitch === null || zoom === null) return null;

  // The boundary is the region's identity: `resolveInlineSimulationSegment`
  // returns null without one, so such a window can never be given a fold and
  // would load as a permanently empty frame that refreshing cannot repair.
  // Every window this app writes has one; a missing one means the field is
  // corrupt, and dropping it is kinder than restoring something inert.
  const rings = boundary(value.sourceBoundary);
  if (!rings || rings.length === 0) return null;

  return {
    id: value.id,
    box: {
      center,
      width,
      height,
      rotation: finiteNumber(box?.rotation) ?? 0,
    },
    z: finiteNumber(value.z) ?? 0,
    view: { yaw, pitch, zoom },
    sourceBoundary: rings,
    sourceBounds: sourceBounds(value.sourceBounds),
    sourceFingerprint:
      typeof value.sourceFingerprint === 'string' ? value.sourceFingerprint : null,
    segmentIdHint: finiteNumber(value.segmentIdHint),
  };
}

export function validateInlineSimulations(value: unknown): InlineSimulation[] {
  if (!Array.isArray(value)) return [];
  const out: InlineSimulation[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const simulation = validateInlineSimulation(entry);
    // Ids key the runtime side table that holds each window's fold, so a
    // duplicate would have two windows sharing one mesh and one fold position.
    if (!simulation || seen.has(simulation.id)) continue;
    seen.add(simulation.id);
    out.push(simulation);
  }
  return out;
}
