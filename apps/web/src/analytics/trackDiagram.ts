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
  DIAGRAM_TITLE_BLOCK_CREDIT_BUCKETS,
  bucketCount,
} from './events';
import type {
  DiagramAnnotationColor,
  DiagramAnnotationSnap,
  DiagramMarkStyleOption,
  DiagramMarkStyleValue,
  DiagramStarFillName,
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
  DiagramRepackScope,
  DiagramRepackVia,
  DiagramPictureUploadOutcome,
  DiagramPoseAction,
  DiagramPulledInto,
  DiagramPulledMarks,
  DiagramPulledMode,
  DiagramImportedMarkEdit,
  DiagramMarksLiftedVia,
  PaperExportMarkShown,
  DiagramSourceWorkspace,
  DiagramExampleOutcome,
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
  DiagramTitleBlockBand,
  DiagramTitleBlockChoice,
  DiagramTitleBlockCreditChange,
  DiagramTitleBlockSize,
  DiagramTitleBlockTextShown,
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
export function trackDiagramStepAdded(picture: DiagramStepAddedSource, via: DiagramStepAddedVia): void {
  track(ANALYTICS_EVENTS.diagramStepAdded, { picture, via });
}

/** A turn was added between steps (D22): a turn-over or a rotation, and where it was made. */
export function trackDiagramTurnAdded(kind: 'turn-over' | 'rotate', via: DiagramTurnAddedVia): void {
  const turn: DiagramTurnAddedKind = kind === 'turn-over' ? 'turn_over' : 'rotate';
  track(ANALYTICS_EVENTS.diagramTurnAdded, { turn, via });
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
    kb_bucket: sizeBytes === null ? 'unknown' : bucketCount(sizeBytes / 1024, DIAGRAM_UPLOAD_KB_BUCKETS),
    upload_count_bucket: bucketCount(count, DIAGRAM_UPLOAD_COUNT_BUCKETS),
  });
}

/** A step opened in detail, and in which half. */
export function trackDiagramStepOpened(via: DiagramStepOpenedVia, detail: DiagramStepOpenedMode): void {
  track(ANALYTICS_EVENTS.diagramStepOpened, { via, detail });
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
  /** A star's fill, as the rail's Fill laid it (Revision 3). */
  fill?: DiagramStarFillName;
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
  { placed, size, ...detail }: DiagramAnnotationAddedDetail = {}
): void {
  track(ANALYTICS_EVENTS.diagramAnnotationAdded, {
    mark: tool,
    snap,
    ...(placed === undefined ? {} : { divisions: placed }),
    ...(size === undefined ? {} : { text_size: size }),
    ...detail,
  });
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
 * One of a mark's own options changed (Revision 3): its kind, which option,
 * and what it became — equal divisions' Short Dividers on or off, a star's
 * Fill, an x-ray's Depth (bucketed) or Anchor (picked, or Auto again) — or
 * how: a star, an eye, an oval or a rectangle resized or turned by its
 * transform box (`handle`), or its Rotation typed in the Layers pane
 * (`field`). Whether the options the marks gained are used. Never where the
 * mark is, its size, its angle or how deep it goes past three.
 */
export function trackDiagramMarkStyled(mark: DiagramAnnotationTool, option: DiagramMarkStyleOption, value: DiagramMarkStyleValue): void {
  track(ANALYTICS_EVENTS.diagramMarkStyled, { mark, option, value });
}

/**
 * A solid line's colour changed in the Layers pane (17a), or a label's (17b): its kind and the
 * colour, by name — whether a line's colour is changed after it is drawn,
 * and to what. Once per pick: a custom colour dragged about in the picker is
 * one. Never the colour itself.
 */
export function trackDiagramAnnotationRecolored(mark: DiagramAnnotationTool, color: DiagramAnnotationColor): void {
  track(ANALYTICS_EVENTS.diagramAnnotationRecolored, { mark, color });
}

/**
 * A mark first put behind a flap (15e): its kind, which of its ends, and how
 * many layers lie over them — whether people mark what is hidden, and on
 * what. Once, when the first end goes behind; never where.
 */
export function trackDiagramAnnotationBehind(
  mark: DiagramAnnotationTool,
  ends: DiagramBehindEnds,
  layers: DiagramBehindLayers
): void {
  track(ANALYTICS_EVENTS.diagramAnnotationBehind, { mark, ends, layers });
}

/**
 * A mark flipped over in Annotate, from the Layers pane: its kind and which
 * way — whether flipping is used, and on what. Each flip; never where.
 */
export function trackDiagramAnnotationFlipped(mark: DiagramAnnotationTool, axis: DiagramFlipAxis): void {
  track(ANALYTICS_EVENTS.diagramAnnotationFlipped, { mark, axis });
}

/**
 * A fold arrow shaped by hand for the first time — its arc made a path — by
 * the Edit Path gesture that did it, and for a fold-and-unfold arrow the half
 * that edit touched (`half`). Once per arrow, not per edit: whether arrows
 * are shaped at all, which way in people find, and whether a return is
 * reshaped first. Never where.
 */
export function trackDiagramArrowShaped(
  mark: DiagramShapedArrowKind,
  gesture: DiagramArrowShapeGesture,
  half?: DiagramShapedArrowHalf
): void {
  track(ANALYTICS_EVENTS.diagramArrowShaped, half === undefined ? { mark, gesture } : { mark, gesture, half });
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
  picture: DiagramPictureKind,
  { spread, side }: { spread?: DiagramSpreadTracking; side?: DiagramPictureSide } = {}
): void {
  track(ANALYTICS_EVENTS.diagramPicturePosed, {
    action,
    picture,
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
export function trackDiagramPictureRemoved(picture: DiagramPictureKind): void {
  track(ANALYTICS_EVENTS.diagramPictureRemoved, { picture });
}

/** A step's picture exported, by the file's kind: never its name. */
export function trackDiagramPictureExported(format: DiagramPictureExportFormat): void {
  track(ANALYTICS_EVENTS.diagramPictureExported, { format });
}

/** A step's picture captured from the crease pattern, and what became of it. */
export function trackDiagramPictureCaptured(
  picture: DiagramCaptureKind,
  outcome: DiagramCaptureOutcome,
  via: DiagramCaptureVia
): void {
  track(ANALYTICS_EVENTS.diagramPictureCaptured, { picture, outcome, via });
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
export function trackDiagramImportedMarkEdited(mark: DiagramAnnotationTool, edit: DiagramImportedMarkEdit): void {
  track(ANALYTICS_EVENTS.diagramImportedMarkEdited, { mark, edit });
}

/**
 * An old References step's card's marks made annotations by Make Marks
 * Editable (17e): where it was pressed, and how many of its card's marks the
 * step holds now — on an enlarged step, those its frame holds — bucketed.
 * Never a mark.
 */
export function trackDiagramReferencesMarksLifted(via: DiagramMarksLiftedVia, count: number): void {
  track(ANALYTICS_EVENTS.diagramReferencesMarksLifted, { via, count_bucket: bucketCount(count, COUNT_BUCKETS) });
}

/** The Diagram's view switched, by the tabs or a verb that shows the pages. */
export function trackDiagramViewSwitched(view: DiagramView): void {
  track(ANALYTICS_EVENTS.diagramViewSwitched, { view });
}

/** The empty Diagram's example pressed, and what became of it. Never which file. */
export function trackDiagramExampleOpened(outcome: DiagramExampleOutcome): void {
  track(ANALYTICS_EVENTS.diagramExampleOpened, { outcome });
}

/** The empty Diagram's video walkthrough followed. */
export function trackDiagramTutorialOpened(): void {
  track(ANALYTICS_EVENTS.diagramTutorialOpened);
}

/**
 * A page setting changed. Which one, never its value — except the style,
 * named as a built-in, the export style or `custom`, never a preset's name;
 * where the title block's model or pattern now comes from, never which step;
 * and for the title block's text and sizes, what a reader of the page would
 * see change, never the text or the size: whether its subtitle or note
 * prints, how its credits changed and how many it has, bucketed, whether
 * a size is the default, and whether the band follows the paper's colour —
 * never the colour.
 */
export function trackDiagramPageSetupChanged(
  setting: DiagramPageSetting,
  detail: {
    style?: DiagramStyleChoiceName;
    titleBlockChoice?: DiagramTitleBlockChoice;
    titleBlockCreditChange?: DiagramTitleBlockCreditChange;
    /** How many credits the block holds after the change, sent bucketed. */
    titleBlockCredits?: number;
    titleBlockSubtitle?: DiagramTitleBlockTextShown;
    titleBlockNote?: DiagramTitleBlockTextShown;
    titleBlockSize?: DiagramTitleBlockSize;
    titleBlockBand?: DiagramTitleBlockBand;
  } = {}
): void {
  track(ANALYTICS_EVENTS.diagramPageSetupChanged, {
    setting,
    ...(detail.style ? { style: detail.style } : {}),
    ...(detail.titleBlockChoice ? { title_block_choice: detail.titleBlockChoice } : {}),
    ...(detail.titleBlockCreditChange ? { title_block_credit_change: detail.titleBlockCreditChange } : {}),
    ...(detail.titleBlockCredits !== undefined
      ? { title_block_credit_bucket: bucketCount(detail.titleBlockCredits, DIAGRAM_TITLE_BLOCK_CREDIT_BUCKETS) }
      : {}),
    ...(detail.titleBlockSubtitle ? { title_block_subtitle: detail.titleBlockSubtitle } : {}),
    ...(detail.titleBlockNote ? { title_block_note: detail.titleBlockNote } : {}),
    ...(detail.titleBlockSize ? { title_block_size: detail.titleBlockSize } : {}),
    ...(detail.titleBlockBand ? { title_block_band: detail.titleBlockBand } : {}),
  });
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
 * `steps` the diagram's steps, `empty` those with no picture, `enlarged`
 * those enlarged (Revision 2), `placed` those placed by hand and
 * `outsideMargin` those placed with a part past the margin — the one
 * placement notice the export lists, sent as `clash_bucket` — all bucketed.
 * `pages` is what the pages printed besides the steps, for the PDF and the
 * SVG: whether the first carried the title block. Step files have none.
 * Enums and buckets only: never the title, a step or a size.
 */
export function trackDiagramExported(
  format: DiagramExportFormat,
  how: { preset: DiagramPdfPreset } | DiagramStepFilesExported | null,
  counts: { files: number; steps: number; empty: number; enlarged: number; placed?: number; outsideMargin?: number },
  pages?: { titleBlock: boolean }
): void {
  const shown = (value: boolean) => (value ? 'shown' : 'hidden');
  track(ANALYTICS_EVENTS.diagramExported, {
    format,
    ...(pages ? { title_block: shown(pages.titleBlock) } : {}),
    ...(how === null
      ? {}
      : 'preset' in how
        ? { preset: how.preset }
        : {
            file_type: how.fileType,
            resolution: how.dpi === null ? 'none' : String(how.dpi),
            number: shown(how.number),
            text: shown(how.text),
            canvas: how.sameSize ? 'same' : 'cropped',
            background: how.transparent ? 'transparent' : 'white',
          }),
    file_count_bucket: bucketCount(counts.files, DIAGRAM_PAGE_COUNT_BUCKETS),
    step_count_bucket: bucketCount(counts.steps, COUNT_BUCKETS),
    empty_step_bucket: bucketCount(counts.empty, DIAGRAM_EMPTY_STEP_BUCKETS),
    // The same ladder: none, one, a few, many.
    enlarged_step_bucket: bucketCount(counts.enlarged, DIAGRAM_EMPTY_STEP_BUCKETS),
    placed_step_bucket: bucketCount(counts.placed ?? 0, DIAGRAM_EMPTY_STEP_BUCKETS),
    // Steps placed past the margin since 2026-10-12; before, steps with any placement clash.
    clash_bucket: bucketCount(counts.outsideMargin ?? 0, DIAGRAM_EMPTY_STEP_BUCKETS),
  });
}

/**
 * What a placement set: a part moved, its picture's size, or its caption's
 * measure — by a width grip or the Step pane (`text_width`), or by the
 * caption's bottom grip, which asks for a number of lines (`text_lines`).
 */
export type DiagramPlacedPart = 'frame' | 'number' | 'picture' | 'text' | 'size' | 'text_width' | 'text_lines';
/** What a placement reset took back: a part, its picture's size, its caption's measure, or the whole step's placement. */
export type DiagramResetPart = 'frame' | 'number' | 'picture' | 'text' | 'size' | 'text_width' | 'step';

/** Placement events contain choices and buckets only, never coordinates or sizes. */
export function trackDiagramStepPlaced(part: DiagramPlacedPart, via: 'drag' | 'keys' | 'pane', layout: 'grid' | 'flow'): void {
  track(ANALYTICS_EVENTS.diagramStepPlaced, { part, via, layout });
}
export function trackDiagramPlacementReset(part: DiagramResetPart, scope: 'step' | 'page' | 'diagram', via: 'pane' | 'menu' | 'drag_home' | 'keys'): void {
  track(ANALYTICS_EVENTS.diagramPlacementReset, { part, scope, via });
}
export function trackDiagramPlacementsReflowed(count: number): void {
  track(ANALYTICS_EVENTS.diagramPlacementsReflowed, { count_bucket: bucketCount(count, COUNT_BUCKETS) });
}

/** Re-pack Page or Re-pack All Pages, when it let an arrangement go: which, and where it was pressed. Never a page. */
export function trackDiagramPagesRepacked(scope: DiagramRepackScope, via: DiagramRepackVia): void {
  track(ANALYTICS_EVENTS.diagramPagesRepacked, { scope, via });
}
