import {
  ANALYTICS_EVENTS,
  COUNT_BUCKETS,
  DIAGRAM_EMPTY_STEP_BUCKETS,
  DIAGRAM_PAGE_COUNT_BUCKETS,
  DIAGRAM_UPLOAD_COUNT_BUCKETS,
  DIAGRAM_UPLOAD_KB_BUCKETS,
  bucketCount,
} from './events';
import type {
  DiagramAnnotationTool,
  DiagramCaptureKind,
  DiagramCaptureOutcome,
  DiagramCaptureVia,
  DiagramExportFormat,
  DiagramPdfPreset,
  DiagramPictureExportFormat,
  DiagramPictureFormat,
  DiagramPictureKind,
  DiagramPageSetting,
  DiagramPictureUploadOutcome,
  DiagramPoseAction,
  DiagramPulledInto,
  DiagramPulledMode,
  DiagramSourceWorkspace,
  DiagramShowAsName,
  DiagramShowAsVia,
  DiagramStepAddedSource,
  DiagramStepAddedVia,
  DiagramTurnAddedKind,
  DiagramTurnAddedVia,
  DiagramStepOpenedMode,
  DiagramStepOpenedVia,
  DiagramStyleChoiceName,
  DiagramView,
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

/** A turn was added between steps (D22): a turn-over or a rotation, and where it was made. */
export function trackDiagramTurnAdded(kind: 'turn-over' | 'rotate', via: DiagramTurnAddedVia): void {
  const name: DiagramTurnAddedKind = kind === 'turn-over' ? 'turn_over' : 'rotate';
  track(ANALYTICS_EVENTS.diagramTurnAdded, { kind: name, via });
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

/** A step opened in detail, and in which half. */
export function trackDiagramStepOpened(via: DiagramStepOpenedVia, mode: DiagramStepOpenedMode): void {
  track(ANALYTICS_EVENTS.diagramStepOpened, { via, mode });
}

/**
 * An annotation drawn on a step's picture, by its tool. Which marks a diagram
 * is drawn with, and whether Annotate is used at all. Never where it is, nor
 * a label's words.
 */
export function trackDiagramAnnotationAdded(tool: DiagramAnnotationTool): void {
  track(ANALYTICS_EVENTS.diagramAnnotationAdded, { tool });
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

/** A linked step shown another way (D19), and from where. */
export function trackDiagramStepShownAs(showAs: DiagramShowAsName, via: DiagramShowAsVia): void {
  track(ANALYTICS_EVENTS.diagramStepShownAs, { show_as: showAs, via });
}

/** A step's source opened in its own workspace. */
export function trackDiagramSourceOpened(workspace: DiagramSourceWorkspace): void {
  track(ANALYTICS_EVENTS.diagramSourceOpened, { workspace });
}

/** The References browser opened (D20), and where what it adds would go. */
export function trackDiagramReferencesBrowserOpened(into: DiagramPulledInto): void {
  track(ANALYTICS_EVENTS.diagramReferencesBrowserOpened, { into });
}

/** Cards pulled from the References browser into the diagram (D20): from which list, where to, how many (bucketed). */
export function trackDiagramStepsPulledFromReferences(
  mode: DiagramPulledMode,
  into: DiagramPulledInto,
  count: number
): void {
  track(ANALYTICS_EVENTS.diagramStepsPulledFromReferences, {
    mode,
    into,
    count_bucket: bucketCount(count, COUNT_BUCKETS),
  });
}

/** The Diagram's view switched, by the tabs or a verb that shows the pages. */
export function trackDiagramViewSwitched(view: DiagramView): void {
  track(ANALYTICS_EVENTS.diagramViewSwitched, { view });
}

/**
 * A page setting changed. Which one, never its value — except the style,
 * named as a built-in, the export style or `custom`, never a preset's name.
 */
export function trackDiagramPageSetupChanged(
  setting: DiagramPageSetting,
  style?: DiagramStyleChoiceName
): void {
  track(ANALYTICS_EVENTS.diagramPageSetupChanged, style ? { setting, style } : { setting });
}

/** How a diagram's steps went out as files, for `diagram exported`. */
export interface DiagramStepFilesExported {
  fileType: 'svg' | 'png';
  /** A PNG's density; none for an SVG. */
  dpi: number | null;
  number: boolean;
  text: boolean;
  sameSize: boolean;
  transparent: boolean;
}

/**
 * The diagram written out: a PDF for home or a print shop, or a ZIP of its
 * steps' files and how they were made. `files` is the PDF's pages or the ZIP's
 * files, `steps` the diagram's steps and `empty` those with no picture, all
 * bucketed. Enums and buckets only: never the title, a step or a size.
 */
export function trackDiagramExported(
  format: DiagramExportFormat,
  how: { preset: DiagramPdfPreset } | DiagramStepFilesExported,
  counts: { files: number; steps: number; empty: number }
): void {
  const shown = (value: boolean) => (value ? 'shown' : 'hidden');
  track(ANALYTICS_EVENTS.diagramExported, {
    format,
    ...('preset' in how
      ? { preset: how.preset }
      : {
          file_type: how.fileType,
          resolution: how.dpi === null ? 'none' : String(how.dpi),
          number: shown(how.number),
          text: shown(how.text),
          size: how.sameSize ? 'same' : 'cropped',
          background: how.transparent ? 'transparent' : 'white',
        }),
    file_count_bucket: bucketCount(counts.files, DIAGRAM_PAGE_COUNT_BUCKETS),
    step_count_bucket: bucketCount(counts.steps, COUNT_BUCKETS),
    empty_step_bucket: bucketCount(counts.empty, DIAGRAM_EMPTY_STEP_BUCKETS),
  });
}
