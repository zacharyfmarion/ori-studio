import { useMemo } from 'react';
import { segmentSheetThumbnail } from '../../cp-workspace/sheets/segmentSheet';
import type { SheetThumbnail } from '../../cp-workspace/sheets/sheetThumbnail';
import { resolveRegion } from '../../cp-workspace/regions/regionReference';
import { resolveCpSegments, type CpSegment } from '../../lib/creasePatternSegmentation';
import type { DiagramStep } from '../document/diagramDocument';
import { useCpSegmentationState } from './useLinkStatus';

/** One pattern a step can be linked to: a region of the open crease pattern. */
export interface DiagramPatternSheet {
  segment: CpSegment;
  thumbnail: SheetThumbnail | null;
}

export type DiagramPatternSheets =
  | { status: 'no-pattern' }
  | { status: 'pending' }
  | { status: 'failed' }
  | { status: 'ready'; sheets: readonly DiagramPatternSheet[] };

/**
 * The patterns of the open crease pattern, for the pattern picker: its
 * regions in the kernel-space segmentation every link is made in (D3), each
 * drawn as the pattern rails draw one. Asked for only while `wanted`.
 */
export function useDiagramPatternSheets(wanted: boolean): DiagramPatternSheets {
  const segmentation = useCpSegmentationState(wanted);
  return useMemo(() => {
    if (segmentation.status !== 'ready') return segmentation;
    const { fold } = segmentation.artifacts;
    return {
      status: 'ready',
      sheets: resolveCpSegments(segmentation.artifacts).map((segment) => ({
        segment,
        thumbnail: segmentSheetThumbnail(fold, segment),
      })),
    };
  }, [segmentation]);
}

/** The pattern a region-linked step shows, among these; null for any other step, or one whose pattern is gone. */
export function linkedSheet(
  step: DiagramStep,
  sheets: readonly DiagramPatternSheet[]
): DiagramPatternSheet | null {
  if (step.source?.kind !== 'cp') return null;
  const segment = resolveRegion(
    step.source.scope.region,
    sheets.map((sheet) => sheet.segment)
  );
  return segment ? (sheets.find((sheet) => sheet.segment === segment) ?? null) : null;
}
