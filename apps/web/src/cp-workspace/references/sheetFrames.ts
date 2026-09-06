/**
 * The precrease planner's frames analysis, as TypeScript sees it.
 *
 * The types mirror the serde structs in `crates/oristudio-precrease` (see the
 * `//!` docs in `crates/oristudio-precrease-wasm/src/lib.rs`), serialised
 * `json_compatible`: `Option<T>` is `T | null`, enums tagged with `kind` or as
 * `snake_case` strings. The helpers below only *index* that analysis — which
 * component owns a picked segment, which segments meet at a picked vertex —
 * and never compute geometry: frames, merges, the y-flip and the model ↔
 * ReferenceFinder maps all live in Rust and cross as data (plan decision D6).
 */
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import { SEG_ATTR_STRIDE } from '../../engine/oristudioCpGeometry';
import type { Point } from '../../lib/geometry';
import { cpVertexId, ORIEDITA_PAPER_BOUNDS } from '../../lib/creasePatternViewport';

export interface PrecreaseFrame {
  origin: [number, number];
  x_axis: [number, number];
  y_axis: [number, number];
  width: number;
  height: number;
}

/** ReferenceFinder's `(w, h)` for a sheet, with `max(w, h) = 1`. */
export interface PrecreaseRfRect {
  width: number;
  height: number;
}

/** A 2×3 affine `[a, b, c, d, e, f]` in the canvas convention. */
export type PrecreaseAffine = [number, number, number, number, number, number];

export interface PrecreaseFrameAffines {
  model_to_unit: PrecreaseAffine;
  unit_to_model: PrecreaseAffine;
  model_to_rf: PrecreaseAffine;
  rf_to_model: PrecreaseAffine;
}

/** `{ p : p · n = d }` in unit-sheet coordinates, sign canonicalised in Rust. */
export interface PrecreaseLine {
  n: [number, number];
  d: number;
}

export type PrecreaseLineKind = 'border' | 'mountain' | 'valley' | 'auxiliary' | 'unassigned';

export interface PrecreaseMergedLine {
  line: PrecreaseLine;
  /** Indices of the segments on it, in the caller's (0-based) numbering. */
  segment_indices: number[];
  is_border: boolean;
  kinds: PrecreaseLineKind[];
  merge_residual: number;
  on_outline: boolean;
}

export type PrecreaseExactnessClass = 'exact' | 'snappable' | 'off_lattice';

export interface PrecreaseResiduals {
  merge_max: number;
  vertex_max: number;
  angle_max: number;
  offset_max: number;
  outline: number;
}

export interface PrecreaseExactness {
  class: PrecreaseExactnessClass;
  residuals: PrecreaseResiduals;
  off_lattice_lines: number;
  off_lattice_vertices: number;
  near_duplicate_lines: number;
  inconsistent_vertices: number;
  family: string | null;
  line_displacements: number[];
}

export type PrecreaseRefusalKind =
  | 'non_rectangular'
  | 'open_outline'
  | 'non_simple_outline'
  | 'degenerate_outline';

export interface PrecreaseRefusal {
  kind: PrecreaseRefusalKind;
  vertices: [number, number][];
}

export interface PrecreaseComponent {
  id: number;
  /** The sheet frame; `null` when the border loop was refused. */
  frame: PrecreaseFrame | null;
  rf_rect: PrecreaseRfRect | null;
  affines: PrecreaseFrameAffines | null;
  /** Model-space corners of the loop (or its vertices when refused). */
  outline: [number, number][];
  outline_residual: number;
  /** The sheet came from the paper fallback, not from border creases. */
  is_fallback: boolean;
  border_segment_indices: number[];
  segment_indices: number[];
  unit_segments: [number, number, number, number][];
  merged_lines: PrecreaseMergedLine[];
  exactness: PrecreaseExactness | null;
  refused: PrecreaseRefusal | null;
}

export type PrecreaseWarning =
  | { kind: 'no_border_fallback'; paper: [number, number, number, number] }
  | { kind: 'overlapping_sheets'; segments: number }
  | { kind: 'zero_length_segments'; count: number }
  | { kind: 'degenerate_border_segments'; count: number };

export interface SheetAnalysis {
  components: PrecreaseComponent[];
  unassigned_segments: number[];
  warnings: PrecreaseWarning[];
  segment_count: number;
  tol: number;
  snap_radius: number;
}

export interface PrecreaseTolerances {
  tol: number;
  snap_radius: number;
}

/** What `sheetFrames` takes: the transport's segments as the bridge wants them. */
export interface PrecreaseInput {
  /** `[x1, y1, x2, y2, …]` in model space, one quad per crease segment. */
  segments: Float64Array;
  /** One Oriedita colour code per segment (`segAttr`'s first slot). */
  colors: Int32Array;
}

/**
 * The compact transport's crease segments, laid out for the bridge.
 *
 * `segEndpoints` already is `[x1, y1, x2, y2] * n`, so it is passed through as
 * is; the colour codes are gathered out of the five-slot `segAttr`. Aux lines
 * (`auxEndpoints`) are deliberately not included: they are the editor's
 * scaffolding, not creases of the pattern.
 */
export function precreaseInputFromTransport(geometry: CpGeometryTransport): PrecreaseInput {
  const count = geometry.segEndpoints.length / 4;
  const colors = new Int32Array(count);
  for (let i = 0; i < count; i += 1) {
    colors[i] = geometry.segAttr[i * SEG_ATTR_STRIDE];
  }
  return { segments: geometry.segEndpoints, colors };
}

/**
 * Oriedita's default paper (±200) as the bridge's `paper_fallback`, used only
 * when the pattern has no border creases (plan decision D10).
 */
export function paperFallbackRect(): Float64Array {
  const { minX, minY, maxX, maxY } = ORIEDITA_PAPER_BOUNDS;
  return Float64Array.from([minX, minY, maxX, maxY]);
}

/**
 * The component that owns crease segment `segmentIndex` (0-based), whether as
 * one of its interior creases or as part of its border loop, or null when the
 * segment is inside no sheet.
 */
export function componentForSegment(
  analysis: SheetAnalysis,
  segmentIndex: number
): PrecreaseComponent | null {
  for (const component of analysis.components) {
    if (
      component.segment_indices.includes(segmentIndex) ||
      component.border_segment_indices.includes(segmentIndex)
    ) {
      return component;
    }
  }
  return null;
}

/**
 * The segments (0-based) with an endpoint at `point`, keyed on the same
 * coordinate quantisation the editor's vertex dots use (`cpVertexId`), so a
 * vertex request is keyed on where it is rather than on an array index that a
 * concurrent edit can shift.
 */
export function segmentsAtVertex(geometry: CpGeometryTransport, point: Point): number[] {
  const key = cpVertexId(point);
  const endpoints = geometry.segEndpoints;
  const count = endpoints.length / 4;
  const found: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const base = i * 4;
    if (
      cpVertexId({ x: endpoints[base], y: endpoints[base + 1] }) === key ||
      cpVertexId({ x: endpoints[base + 2], y: endpoints[base + 3] }) === key
    ) {
      found.push(i);
    }
  }
  return found;
}

/**
 * The component a picked vertex belongs to: the sheet owning any crease that
 * meets there, preferring one that has a frame over a refused loop the vertex
 * also touches (a border vertex shared by two loops is attributed to the one
 * that can answer). Null when no crease meets there or none is inside a sheet.
 */
export function componentForVertex(
  analysis: SheetAnalysis,
  geometry: CpGeometryTransport,
  point: Point
): PrecreaseComponent | null {
  let refused: PrecreaseComponent | null = null;
  for (const segmentIndex of segmentsAtVertex(geometry, point)) {
    const component = componentForSegment(analysis, segmentIndex);
    if (!component) continue;
    if (component.frame) return component;
    refused ??= component;
  }
  return refused;
}

/** The crease segments (0-based) that lie on the same merged line as `segmentIndex`. */
export function collinearSegments(component: PrecreaseComponent, segmentIndex: number): number[] {
  const merged = component.merged_lines.find((line) => line.segment_indices.includes(segmentIndex));
  return merged ? merged.segment_indices : [segmentIndex];
}

/** Both endpoints of crease segment `segmentIndex` (0-based) in model space. */
export function segmentEndpoints(
  geometry: CpGeometryTransport,
  segmentIndex: number
): { a: Point; b: Point } | null {
  const base = segmentIndex * 4;
  const endpoints = geometry.segEndpoints;
  if (segmentIndex < 0 || base + 3 >= endpoints.length) return null;
  return {
    a: { x: endpoints[base], y: endpoints[base + 1] },
    b: { x: endpoints[base + 2], y: endpoints[base + 3] },
  };
}

/**
 * Find the crease segment (0-based) with these endpoints, in either order, or
 * -1. How a crease target survives an edit: the segment index it was picked
 * under may now name a different crease, while its endpoints still name it.
 */
export function findSegmentByEndpoints(geometry: CpGeometryTransport, a: Point, b: Point): number {
  const ka = cpVertexId(a);
  const kb = cpVertexId(b);
  const endpoints = geometry.segEndpoints;
  const count = endpoints.length / 4;
  for (let i = 0; i < count; i += 1) {
    const base = i * 4;
    const k0 = cpVertexId({ x: endpoints[base], y: endpoints[base + 1] });
    const k1 = cpVertexId({ x: endpoints[base + 2], y: endpoints[base + 3] });
    if ((k0 === ka && k1 === kb) || (k0 === kb && k1 === ka)) return i;
  }
  return -1;
}
