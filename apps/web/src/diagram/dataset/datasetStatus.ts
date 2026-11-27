/**
 * What each step's link says and what Refresh would do with it, as the step
 * cards and the Refresh all count work them out (`useDiagramLinkStatuses`,
 * `useDiagramCardLinks`), without their React and store wrappers. Test-only.
 *
 * - A crease-pattern or References link: `linkStatus` against the snapshot
 *   and the sheet index built from the same handle.
 * - A Fold link: `foldStepLinkStatus` with no replay, which is what the app
 *   shows before its Fold session has replayed (Phase 2 replays).
 * - What the reader made of the step that a code change could alter without
 *   touching its picture — paper faces, marks, zoom — digested in the form a
 *   save writes, with the flags derived from them.
 */
import type { CpSheetIndex } from '../../engine/oristudioCpSheetIndex';
import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import type { HeldFoldSequence } from '../../fold/document/foldSequenceFile';
import { linkedSourceOf, linkStatus, needsPose, refreshKind } from '../capture/linkStatus';
import { lacksPaperFaces } from '../capture/stepPaperFaces';
import { annotationsOutOfStep, isTurn, type DiagramDocument } from '../document/diagramDocument';
import { writeDiagram } from '../document/diagramFile';
import { foldStepLinkStatus } from '../fold/foldStepLink';
import { capturedStyleChange, lightingChanged } from '../pictures/lighting';
import { stepZoomStatus } from '../zoom/zoomActions';
import { sha256 } from './datasetCorpus';
import type { StatusRecord } from './datasetResults';

export interface StatusInputs {
  diagram: DiagramDocument;
  /** The pattern's snapshot and sheet index, or null for a project without one. */
  document: OristudioCpDocumentSnapshot | null;
  sheets: CpSheetIndex | null;
  sequences: readonly HeldFoldSequence[];
}

/** Every step's status, by step id. */
export function statusRecords({ diagram, document, sheets, sequences }: StatusInputs): Map<string, StatusRecord> {
  const records = new Map<string, StatusRecord>();
  const written = writeDiagram(diagram).steps as Record<string, unknown>[];
  const style = diagram.style;
  diagram.steps.forEach((entry, index) => {
    if (isTurn(entry)) return;
    const step = entry;
    const source = linkedSourceOf(step);
    const link = !source
      ? 'none'
      : source.kind === 'fold-step'
        ? foldStepLinkStatus(source, { sequences: [...sequences], replay: null })
        : linkStatus(source, document, sheets);
    const kept = written[index] as { picture?: { kind?: string; paperFaces?: unknown }; annotations?: unknown; annotatedPictureKey?: unknown; zoom?: unknown };
    records.set(step.id, {
      link,
      refresh: refreshKind(step, source ? (link as Parameters<typeof refreshKind>[1]) : undefined, style),
      lightingChanged: lightingChanged(step, style),
      readSha256: sha256(
        JSON.stringify({
          paperFaces: kept?.picture?.kind === 'scene' ? (kept.picture.paperFaces ?? null) : null,
          annotations: kept?.annotations ?? [],
          annotatedPictureKey: kept?.annotatedPictureKey ?? null,
          zoom: kept?.zoom ?? null,
          facesMissing: lacksPaperFaces(step),
          marksOutOfStep: annotationsOutOfStep(step),
          zoomStatus: stepZoomStatus(diagram, step.id),
          styleChange: capturedStyleChange(step, style),
          needsPose: needsPose(step),
        })
      ),
    });
  });
  return records;
}
