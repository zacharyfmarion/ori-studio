import type { FoldArtifacts, FoldDocument } from '../engine/types';
import { buildSegmentFold, segmentFoldDocument } from './creasePatternSegmentation';

/**
 * Formats a single crease-pattern segment can be exported to. TreeMaker tree
 * formats (v5/v4) are intentionally absent — a sub-region is geometry, not a
 * tree, so they cannot represent it. `file` formats download directly (routed
 * through the kernel serializers via `exportFoldFrameAsFormat`); `image` formats
 * open the export-image modal pre-scoped to the segment.
 */
export type SegmentFileExportFormat = 'cp' | 'fold' | 'ori' | 'orh';
export type SegmentImageExportFormat = 'svg' | 'png';
export type SegmentExportFormat = SegmentFileExportFormat | SegmentImageExportFormat;

export interface SegmentExportFormatMeta {
  format: SegmentExportFormat;
  extension: string;
  kind: 'file' | 'image';
}

export const SEGMENT_EXPORT_FORMATS: readonly SegmentExportFormatMeta[] = [
  { format: 'cp', extension: 'cp', kind: 'file' },
  { format: 'fold', extension: 'fold', kind: 'file' },
  { format: 'ori', extension: 'ori', kind: 'file' },
  { format: 'orh', extension: 'orh', kind: 'file' },
  { format: 'svg', extension: 'svg', kind: 'image' },
  { format: 'png', extension: 'png', kind: 'image' },
];

export function isSegmentImageFormat(
  format: SegmentExportFormat,
): format is SegmentImageExportFormat {
  return format === 'svg' || format === 'png';
}

/**
 * Build the untriangulated sub-fold for one segment, selected by its stable id.
 *
 * Uses `foldArtifacts.fold` (the real crease pattern) rather than the triangulated
 * simulation mesh, matching the image-export path and avoiding spurious diagonals.
 * Relies on `segmentId` being consistent across the base and simulation folds:
 * their coordinates are identical (see `creasePatternSelectionSegment`), so
 * region bounds — and therefore the top-left segment ordering — match. Returns
 * `null` when there are no artifacts or the id no longer resolves.
 */
export function buildSegmentSubFold(
  foldArtifacts: FoldArtifacts | null | undefined,
  segmentId: number,
): FoldDocument | null {
  if (!foldArtifacts) return null;
  const fold = foldArtifacts.fold;
  const segment = segmentFoldDocument(fold).find((candidate) => candidate.id === segmentId);
  return segment ? buildSegmentFold(fold, segment) : null;
}
