import {
  ANALYTICS_EVENTS,
  COUNT_BUCKETS,
  DIAGRAM_UPLOAD_COUNT_BUCKETS,
  DIAGRAM_UPLOAD_KB_BUCKETS,
  bucketCount,
} from './events';
import type {
  DiagramCaptureKind,
  DiagramCaptureOutcome,
  DiagramCaptureVia,
  DiagramPictureExportFormat,
  DiagramPictureFormat,
  DiagramPictureKind,
  DiagramPictureUploadOutcome,
  DiagramPoseAction,
  DiagramSourceWorkspace,
  DiagramStepAddedSource,
  DiagramStepAddedVia,
  DiagramStepOpenedVia,
  ReferencesSentToDiagramMode,
  ReferencesSentToDiagramVia,
} from './events';
import { track } from './runtime';

/**
 * A step was added to the diagram.
 *
 * Hand-placed because adding a step is a store action reached from several
 * controls, none of which dispatches a `MENU_ACTION_ID`. Enums only: never the
 * instruction, the picture or its name.
 */
export function trackDiagramStepAdded(source: DiagramStepAddedSource, via: DiagramStepAddedVia): void {
  track(ANALYTICS_EVENTS.diagramStepAdded, { source, via });
}

/**
 * One file of an upload, and what became of it. `sizeBytes` is the file's, when
 * it is known (a desktop pick is sized only by reading it); `count` is how many
 * files the upload carried. Enums and buckets only: never the file's name.
 */
export function trackDiagramPictureUploaded(
  format: DiagramPictureFormat,
  outcome: DiagramPictureUploadOutcome,
  sizeBytes: number | null,
  count: number
): void {
  track(ANALYTICS_EVENTS.diagramPictureUploaded, {
    format,
    outcome,
    size_bucket: sizeBytes === null ? 'unknown' : bucketCount(sizeBytes / 1024, DIAGRAM_UPLOAD_KB_BUCKETS),
    count_bucket: bucketCount(count, DIAGRAM_UPLOAD_COUNT_BUCKETS),
  });
}

/** A step opened in detail. */
export function trackDiagramStepOpened(via: DiagramStepOpenedVia): void {
  track(ANALYTICS_EVENTS.diagramStepOpened, { via });
}

/** A pose verb on an uploaded picture, and what the picture is. */
export function trackDiagramPicturePosed(action: DiagramPoseAction, kind: DiagramPictureKind): void {
  track(ANALYTICS_EVENTS.diagramPicturePosed, { action, kind });
}

/** A step's picture removed, and what it was. */
export function trackDiagramPictureRemoved(kind: DiagramPictureKind): void {
  track(ANALYTICS_EVENTS.diagramPictureRemoved, { kind });
}

/** A step's picture exported, by the file's kind: never its name. */
export function trackDiagramPictureExported(format: DiagramPictureExportFormat): void {
  track(ANALYTICS_EVENTS.diagramPictureExported, { format });
}

/** A step's picture captured from the crease pattern, and what became of it. */
export function trackDiagramPictureCaptured(
  kind: DiagramCaptureKind,
  outcome: DiagramCaptureOutcome,
  via: DiagramCaptureVia
): void {
  track(ANALYTICS_EVENTS.diagramPictureCaptured, { kind, outcome, via });
}

/** A step's source opened in its own workspace. */
export function trackDiagramSourceOpened(workspace: DiagramSourceWorkspace): void {
  track(ANALYTICS_EVENTS.diagramSourceOpened, { workspace });
}

/**
 * Cards sent from References to the diagram: where from, by which verb, how
 * many (bucketed), and whether the first filled a waiting step.
 */
export function trackReferencesStepSentToDiagram(
  mode: ReferencesSentToDiagramMode,
  via: ReferencesSentToDiagramVia,
  count: number,
  filled: boolean
): void {
  track(ANALYTICS_EVENTS.referencesStepSentToDiagram, {
    mode,
    via,
    count_bucket: bucketCount(count, COUNT_BUCKETS),
    into: filled ? 'waiting_step' : 'new_steps',
  });
}
