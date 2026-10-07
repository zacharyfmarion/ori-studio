import {
  ANALYTICS_EVENTS,
  COUNT_BUCKETS,
  DIAGRAM_EMPTY_STEP_BUCKETS,
  DIAGRAM_PAGE_COUNT_BUCKETS,
  DIAGRAM_UPLOAD_COUNT_BUCKETS,
  DIAGRAM_UPLOAD_KB_BUCKETS,
  DIAGRAM_SPREAD_AXIS_DEGREE_BUCKETS,
  DIAGRAM_SPREAD_PERCENT_BUCKETS,
  DIAGRAM_SPREAD_SKEW_PERCENT_BUCKETS,
  bucketCount,
} from './events';
import type {
  DiagramAnnotationColor,
  DiagramAnnotationSnap,
  DiagramTextSize,
  DiagramTextStyleOption,
  DiagramTextToggle,
  DiagramAnnotationTool,
  DiagramDivisionsPlaced,
  DiagramBehindEnds,
  DiagramBehindLayers,
  DiagramFlipAxis,
  DiagramArrowShapeGesture,
  DiagramShapedArrowHalf,
  DiagramShapedArrowKind,
  DiagramCaptureKind,
  DiagramCaptureOutcome,
  DiagramCaptureVia,
  DiagramExportFormat,
  DiagramPdfPreset,
  DiagramPictureExportFormat,
  DiagramPictureFormat,
  DiagramPictureKind,
  DiagramPictureSide,
  DiagramPageSetting,
  DiagramPictureUploadOutcome,
  DiagramPoseAction,
  DiagramPulledInto,
  DiagramPulledMarks,
  DiagramPulledMode,
  DiagramImportedMarkEdit,
  PaperExportMarkShown,
  DiagramSourceWorkspace,
  DiagramShowAsName,
  DiagramShowAsVia,
  DiagramSpreadTracking,
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
 * What `diagram annotation added` says about some marks alone: how equal
 * divisions were laid, a solid line's or a label's colour, and a label's
 * Bold, halo and size (17b).
 */
export interface DiagramAnnotationAddedDetail {
  placed?: DiagramDivisionsPlaced;
  color?: DiagramAnnotationColor;
  bold?: DiagramTextToggle;
  halo?: DiagramTextToggle;
  size?: DiagramTextSize;
}

/**
 * An annotation drawn on a step's picture, by its tool, and how it was put
 * down: snapped, freely, or neither — and equal divisions, whether they were
 * dragged or put on a line with a click (`placed`), a solid line, the
 * colour it was drawn in, by name (`color`, 17a), and a label, its colour,
 * Bold, halo and size, as the rail's Text Style set them (17b). Which marks a diagram is
 * drawn with, whether Annotate is used at all, and whether snapping helps.
 * Never where it is, nor a label's words, nor a colour's value.
 */
export function trackDiagramAnnotationAdded(
  tool: DiagramAnnotationTool,
  snap: DiagramAnnotationSnap,
  detail: DiagramAnnotationAddedDetail = {}
): void {
  track(ANALYTICS_EVENTS.diagramAnnotationAdded, { tool, snap, ...detail });
}

/**
 * A label's Bold, Halo or Size changed in the Layers pane (17b): which, and
 * what to — whether people style text beyond what they pull from References.
 * Never the text, nor a size but by name.
 */
export function trackDiagramTextStyled(option: DiagramTextStyleOption, value: DiagramTextToggle | DiagramTextSize): void {
  track(ANALYTICS_EVENTS.diagramTextStyled, { option, value });
}

/**
 * A solid line's colour changed in the Layers pane (17a), or a label's (17b): its kind and the
 * colour, by name — whether a line's colour is changed after it is drawn,
 * and to what. Once per pick: a custom colour dragged about in the picker is
 * one. Never the colour itself.
 */
export function trackDiagramAnnotationRecolored(kind: DiagramAnnotationTool, color: DiagramAnnotationColor): void {
  track(ANALYTICS_EVENTS.diagramAnnotationRecolored, { kind, color });
}

/**
 * A mark first put behind a flap (15e): its kind, which of its ends, and how
 * many layers lie over them — whether people mark what is hidden, and on
 * what. Once, when the first end goes behind; never where.
 */
export function trackDiagramAnnotationBehind(
  kind: DiagramAnnotationTool,
  ends: DiagramBehindEnds,
  layers: DiagramBehindLayers
): void {
  track(ANALYTICS_EVENTS.diagramAnnotationBehind, { kind, ends, layers });
}

/**
 * A mark flipped over in Annotate, from the Layers pane: its kind and which
 * way — whether flipping is used, and on what. Each flip; never where.
 */
export function trackDiagramAnnotationFlipped(kind: DiagramAnnotationTool, axis: DiagramFlipAxis): void {
  track(ANALYTICS_EVENTS.diagramAnnotationFlipped, { kind, axis });
}

/**
 * A fold arrow shaped by hand for the first time — its arc made a path — by
 * the Edit Path gesture that did it, and for a fold-and-unfold arrow the half
 * that edit touched (`half`). Once per arrow, not per edit: whether arrows
 * are shaped at all, which way in people find, and whether a return is
 * reshaped first. Never where.
 */
export function trackDiagramArrowShaped(
  kind: DiagramShapedArrowKind,
  gesture: DiagramArrowShapeGesture,
  half?: DiagramShapedArrowHalf
): void {
  track(ANALYTICS_EVENTS.diagramArrowShaped, half === undefined ? { kind, gesture } : { kind, gesture, half });
}

/**
 * A pose verb on a step's picture, and what the picture is. A spread verb
 * that leaves the layers spread also says how (Phase 13): its kind and the
 * amount bucketed, and a depth spread's direction or an affine one's layer
 * held still, with its skew and axis bucketed — never a value itself. A
 * turn-over says which side of the paper the picture shows after it, and a
 * crease pattern's paper side the side whose colour its paper takes.
 */
export function trackDiagramPicturePosed(
  action: DiagramPoseAction,
  kind: DiagramPictureKind,
  { spread, side }: { spread?: DiagramSpreadTracking; side?: DiagramPictureSide } = {}
): void {
  track(ANALYTICS_EVENTS.diagramPicturePosed, {
    action,
    kind,
    ...(spread ? spreadProperties(spread) : {}),
    ...(side ? { side } : {}),
  });
}

/** A spread's enum and bucketed properties. */
function spreadProperties(spread: DiagramSpreadTracking): Record<string, string> {
  const percent = (fraction: number) => Math.round(fraction * 10_000) / 100;
  const common = {
    spread_kind: spread.kind,
    spread_amount_bucket: bucketCount(percent(spread.amount), DIAGRAM_SPREAD_PERCENT_BUCKETS),
  };
  return spread.kind === 'depth'
    ? { ...common, spread_direction: spread.direction }
    : {
        ...common,
        spread_keep: spread.keep,
        spread_skew_bucket: bucketCount(percent(spread.skew), DIAGRAM_SPREAD_SKEW_PERCENT_BUCKETS),
        spread_axis_bucket: bucketCount(spread.axisDeg, DIAGRAM_SPREAD_AXIS_DEGREE_BUCKETS),
      };
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
  count: number,
  shown: { letters: PaperExportMarkShown; reference_lines: PaperExportMarkShown; marks: DiagramPulledMarks }
): void {
  track(ANALYTICS_EVENTS.diagramStepsPulledFromReferences, {
    mode,
    into,
    count_bucket: bucketCount(count, COUNT_BUCKETS),
    ...shown,
  });
}

/**
 * A mark a References card brought edited for the first time, or taken
 * away (17d): its kind — a pulled letter is a `label` — and which. Fired by
 * the edit, so after an undo a fresh edit counts again: a rough count of
 * whether people edit what they pull. Never the mark.
 */
export function trackDiagramImportedMarkEdited(kind: DiagramAnnotationTool, edit: DiagramImportedMarkEdit): void {
  track(ANALYTICS_EVENTS.diagramImportedMarkEdited, { kind, edit });
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
 * The diagram written out: a PDF for home or a print shop, the pages as one
 * SVG (no options: `how` is null), or a ZIP of its steps' files and how they
 * were made. `files` is the PDF's or the SVG's pages or the ZIP's files,
 * `steps` the diagram's steps, `empty` those with no picture and `enlarged`
 * those enlarged (Revision 2), all bucketed. Enums and buckets only: never
 * the title, a step or a size.
 */
export function trackDiagramExported(
  format: DiagramExportFormat,
  how: { preset: DiagramPdfPreset } | DiagramStepFilesExported | null,
  counts: { files: number; steps: number; empty: number; enlarged: number }
): void {
  const shown = (value: boolean) => (value ? 'shown' : 'hidden');
  track(ANALYTICS_EVENTS.diagramExported, {
    format,
    ...(how === null
      ? {}
      : 'preset' in how
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
    // The same ladder: none, one, a few, many.
    enlarged_step_bucket: bucketCount(counts.enlarged, DIAGRAM_EMPTY_STEP_BUCKETS),
  });
}
