/**
 * Where a step's sheet is now, for a verb pressed on it: Open in Edit frames
 * it, Open in References opens on it. Found as its link status finds it
 * (`sourceSheet`), from the segmentation already worked out — a card that
 * shows its status has one — so a press never waits on it.
 */
import { peekCpSegmentationArtifacts } from '../../cp-workspace/cpSegmentationArtifacts';
import type { CpSegment } from '../../lib/creasePatternSegmentation';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DiagramCpSource, DiagramReferencesSource } from '../document/diagramDocument';
import { sourceSheet } from './linkStatus';

/** The step's sheet where it is now, or null: gone, or the segmentation not worked out yet. */
export function stepSheetNow(source: DiagramCpSource | DiagramReferencesSource): CpSegment | null {
  const document = useWorkspaceStore.getState().oristudioCpDocument?.document ?? null;
  return sourceSheet(source, document, peekCpSegmentationArtifacts(document));
}
