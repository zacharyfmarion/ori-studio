/**
 * What Import CP reads (plan D16): the crease-pattern files the CP kernel's
 * loaders take — the four Edit imports — and the samples that ship with
 * Fold, each as the engine's import source.
 *
 * A file is named by its extension and sent as bytes, whatever its encoding
 * (`.orh` is binary); the engine's loader decides whether it reads. A file's
 * name is shown to the user and never leaves the dialog: the step records a
 * closed `origin`, the analytics event the same.
 *
 * Pure: no React, no store, no engine.
 */

import { droppedFileExtension } from '../../lib/fileDrop';
import type { ImportedCreasePatternFormat } from '../../lib/fileFormats';
import { fitSheetThumbnail, type SheetStroke, type SheetStrokeRole, type SheetThumbnail } from '../../cp-workspace/sheets/sheetThumbnail';
import { FOLD_SAMPLES, foldSampleSource, type FoldSample, type FoldSampleId } from '../engine/foldEngineIoSamples';
import type { FoldImportSource } from '../engine/foldEngineIoWire';

/** The extensions the import's picker offers, in the order its filter lists them. */
export const FOLD_IMPORT_EXTENSIONS: readonly ImportedCreasePatternFormat[] = ['cp', 'fold', 'ori', 'orh'];

/** A file's format, by its extension; null for one the kernel has no loader for. */
export function foldImportFormatOf(name: string): ImportedCreasePatternFormat | null {
  const extension = droppedFileExtension(name);
  return (FOLD_IMPORT_EXTENSIONS as readonly string[]).includes(extension)
    ? (extension as ImportedCreasePatternFormat)
    : null;
}

/** A file as the engine imports it, or null when its extension names no format the kernel reads. */
export function foldImportFileSource(name: string, bytes: Uint8Array): FoldImportSource | null {
  const format = foldImportFormatOf(name);
  return format ? { format, bytes } : null;
}

/** The sample with `id`; null only for an id a newer build named. */
export function foldSample(id: FoldSampleId): FoldSample | null {
  return FOLD_SAMPLES.find((sample) => sample.id === id) ?? null;
}

export { foldSampleSource };

/** A sample's creases at a glance: its card's picture and its count. */
export interface FoldSampleSummary {
  thumbnail: SheetThumbnail | null;
  /** Its creases: every edge but the border's. */
  creases: number;
}

/** What a FOLD edge assignment is on a card: as the shared sheet card inks it. */
function strokeRole(assignment: string | undefined): SheetStrokeRole {
  switch (assignment) {
    case 'B':
      return 'edge';
    case 'M':
      return 'mountain';
    case 'V':
      return 'valley';
    case 'F':
      return 'aux';
    default:
      return 'unassigned';
  }
}

const SUMMARIES = new Map<FoldSampleId, FoldSampleSummary>();

/**
 * A sample's card: its lines fitted into the shared sheet thumbnail, read
 * straight off its FOLD (the samples are flat crease patterns, y down as the
 * app reads FOLD, so nothing flips). Memoised: the samples never change.
 */
export function foldSampleSummary(sample: FoldSample): FoldSampleSummary {
  const known = SUMMARIES.get(sample.id);
  if (known) return known;
  const summary = foldCpSummary(sample.text);
  SUMMARIES.set(sample.id, summary);
  return summary;
}

/** Saved CP snapshots use the same line renderer as the import picker. */
export function foldCpSummary(text: string): FoldSampleSummary {
  let summary: FoldSampleSummary = { thumbnail: null, creases: 0 };
  try {
    const fold = JSON.parse(text) as {
      vertices_coords?: unknown;
      edges_vertices?: unknown;
      edges_assignment?: unknown;
    };
    const coords = Array.isArray(fold.vertices_coords) ? (fold.vertices_coords as number[][]) : [];
    const edges = Array.isArray(fold.edges_vertices) ? (fold.edges_vertices as number[][]) : [];
    const assignments = Array.isArray(fold.edges_assignment) ? (fold.edges_assignment as string[]) : [];
    const strokes: SheetStroke[] = [];
    edges.forEach(([a, b], index) => {
      const from = a === undefined ? undefined : coords[a];
      const to = b === undefined ? undefined : coords[b];
      if (!from || !to) return;
      strokes.push({ x1: from[0] ?? 0, y1: from[1] ?? 0, x2: to[0] ?? 0, y2: to[1] ?? 0, role: strokeRole(assignments[index]) });
    });
    summary = {
      thumbnail: fitSheetThumbnail(strokes),
      creases: strokes.filter((stroke) => stroke.role !== 'edge').length,
    };
  } catch {
    // A sample that does not parse draws no picture; the engine says why when it is imported.
  }
  return summary;
}
