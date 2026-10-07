/**
 * The Diagram workspace's document: an ordered list of steps, the page they
 * are laid out on, and the paper style they are painted in.
 *
 * A diagram is a document of the *project*, beside the crease pattern and the
 * design tabs, not a view of the crease pattern (implementation-plans/
 * diagram-workspace.md, D1). Everything here is plain data and pure edits:
 * every edit returns the same object when it changes nothing, which is how the
 * store tells a no-op from an edit worth an undo entry.
 *
 * A step's number is its place among the steps; a turn between two steps —
 * the model turned over or round — has none (D22). Numbers are never stored.
 *
 * React-free, store-free and DOM-free.
 */

import type { FoldedFigureCamera } from '../../cp-workspace/folded/folded3dCamera';
import type {
  AffineSpreadOptions,
  DepthSpreadOptions,
  LayerSpreadOptions,
  SpreadKind,
} from '../../cp-workspace/folded/foldedLayerSpread';
import type { DiagramWhiteArrowWidth } from '../../cp-workspace/references/diagram/diagramInk';
import type { StepDiagramModel } from '../../cp-workspace/references/referenceFinderDiagramToPrimitives';
import type { WhiteArrowTail } from '../../cp-workspace/references/stepDiagramGeometry';
import type { RegionReference } from '../../cp-workspace/regions/regionReference';
import type { SheetThumbnail } from '../../cp-workspace/sheets/sheetThumbnail';
import type { BuiltInPaperPresetId } from '../../lib/paper/paperPresets';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import { xmlText } from '../../lib/xmlEscape';
import { withCarriedAnnotations } from '../annotate/annotationCarry';
import { cleanAnnotation, MAX_STEP_ANNOTATIONS, withAnnotationReach } from '../annotate/annotationModel';
import { stepReach } from '../zoom/zoomModel';

/** The version of this document's own shape, inside the project file. */
export const DIAGRAM_FORMAT_VERSION = 1;

/**
 * Which regional design Han characters are drawn in. The same code point has a
 * different glyph in each, and each font lacks some of the others' characters,
 * so a diagram keeps the one its author chose rather than taking the viewer's.
 */
export type DiagramHanStyle = 'sc' | 'tc' | 'jp' | 'kr';

export type DiagramPaperSize = 'a4' | 'a5' | 'b5-jis' | 'letter';
export type DiagramPageOrientation = 'portrait' | 'landscape';
export type DiagramPageLayout = 'grid' | 'flow';
/**
 * Which side of a printed spread the first page falls on. Pages pair into
 * spreads from it — `left`: 1–2, 3–4, …; `right`: 1 alone, then 2–3, 4–5, … —
 * and each page's number prints at its outer corner. In the flow layout the
 * path runs on across each spread, leaving a left page at its spine and
 * coming into the right page there at the same height.
 */
export type DiagramPageSide = 'left' | 'right';
export const DIAGRAM_PAGE_SIDES: readonly DiagramPageSide[] = ['left', 'right'];

export interface DiagramPageSetup {
  size: DiagramPaperSize;
  orientation: DiagramPageOrientation;
  /** 0–30 mm. */
  marginMm: number;
  layout: DiagramPageLayout;
  /** 2–5. */
  columns: number;
  /** 1–6. */
  rows: number;
  /** Flow layout only: the band that joins one step to the next. */
  showPath: boolean;
  /**
   * The band's printed width, mm ({@link PATH_WIDTH_MM_RANGE}); null, as in
   * every file before it could be chosen, draws it in proportion to the steps
   * (`pathWidthMm` in `diagramPageLayout.ts`). Written only when set.
   */
  pathWidthMm: number | null;
  /** The band's colour, `#rrggbb`; written only when not {@link DEFAULT_PATH_COLOR}. */
  pathColor: string;
  /** The side the first page prints on ({@link DiagramPageSide}); written to the file only when `right`. */
  firstPageSide: DiagramPageSide;
  /** Draws {@link DiagramDocument.title} in a tab at the top of every page. */
  showTitle: boolean;
  pageNumbers: { enabled: boolean; first: number };
}

/**
 * The paper style every step is painted in. A built-in preset by id, or a
 * resolved style: a user preset or the export slot is resolved when it is
 * chosen, so a printed diagram never depends on the viewer's own settings.
 */
export type DiagramStyle = { preset: BuiltInPaperPresetId } | { style: PaperStyle };

/** A quarter-turn count, clockwise. */
export type QuarterTurns = 0 | 1 | 2 | 3;

/**
 * A picture the user uploaded. Its pose is the source's own: applied when the
 * step is painted, around the shared asset, which is never rewritten (D5).
 */
export interface DiagramUploadSource {
  kind: 'upload';
  assetId: string;
  /** Clockwise, applied after {@link mirrored}. */
  rotationQuarterTurns: QuarterTurns;
  /** Flipped left to right, before the rotation. */
  mirrored: boolean;
}

/**
 * How a crease-pattern step chooses its creases (D3, D21): a whole region of
 * the pattern, picked in the Diagram and found again by its rim. The `kind`
 * leaves room for another way in a later file; a scope this build does not
 * know makes the step one it carries as it came.
 */
export type DiagramCpScope = { kind: 'segment'; region: RegionReference };

/**
 * What a crease-pattern step shows of its creases (D5): the pattern itself, the
 * flat folded model, or the folded model in 3D. Each keeps its own pose.
 */
export type DiagramCpRender =
  | {
      mode: 'crease-pattern';
      rotationDeg: number;
      /**
       * The paper filled with the style's back colour, and nothing else
       * changed: the same lines, turn and mountains and valleys as the front
       * (the Step pane's Front | Back). Written only for the back; absent, the
       * front, as every crease pattern was before.
       */
      side?: 'back';
    }
  | {
      mode: 'folded-flat';
      side: 'front' | 'back';
      rotationDeg: number;
      /** Which layer-ordering solution, 1-based. */
      foldCase: number;
      /**
       * The layers spread apart, by depth or affine (Phase 13): a choice
       * about the picture, kept by every other pose verb. Absent is none.
       */
      spread?: DiagramLayerSpread;
    }
  | { mode: 'folded-3d'; camera: FoldedFigureCamera; side: 'front' | 'back' }
  | {
      /** The simulator's model at a fold %, from a camera (D19). */
      mode: 'simulated';
      /** 0 to 100: 0 is the flat sheet, captured without Pose. */
      foldPercent: number;
      view: DiagramSimulatedView;
    };

/**
 * A flat fold's layers spread apart (`foldedLayerSpread.ts`), one of two
 * kinds: by depth — the deepest layer's step as a fraction of the model's
 * size, toward one of eight directions on the screen — or affine, DEFOX's
 * opening toward the sheet — τ, the layer held still, the skew and its axis
 * in the sheet's frame. Each value within its range below.
 */
export type DiagramLayerSpread = LayerSpreadOptions;
export type DiagramDepthSpread = DepthSpreadOptions;
export type DiagramAffineSpread = AffineSpreadOptions;

/**
 * How far a spread may go, by kind: a depth spread steps the deepest layer
 * 0.5% to 20% of the model; an affine one moves a point 0.5% to 25% of the
 * way back to the sheet along its axis (in every direction only at no skew).
 */
export const SPREAD_AMOUNT_RANGE: Readonly<Record<SpreadKind, { readonly min: number; readonly max: number }>> = {
  depth: { min: 0.005, max: 0.2 },
  affine: { min: 0.005, max: 0.25 },
};

/** An affine spread's skew: none (an even lerp toward the sheet) to all (about its axis). */
export const SPREAD_SKEW_RANGE = { min: 0, max: 1 } as const;

/** An affine spread's axis, in whole degrees: an axis at 180° is the one at 0°. */
export const SPREAD_AXIS_RANGE = { min: 0, max: 179 } as const;

/**
 * An amount a spread of `kind` may take: within {@link SPREAD_AMOUNT_RANGE},
 * to a hundredth of a percent, so a slider's float noise is not written.
 */
export function clampSpreadAmount(kind: SpreadKind, amount: number): number {
  const { min, max } = SPREAD_AMOUNT_RANGE[kind];
  const fallback = kind === 'depth' ? DEFAULT_DEPTH_SPREAD.amount : DEFAULT_AFFINE_SPREAD.amount;
  const within = Number.isFinite(amount) ? Math.min(max, Math.max(min, amount)) : fallback;
  return Number(within.toFixed(4));
}

/** A skew an affine spread may take: 0 to 1, to a hundredth. */
export function clampSpreadSkew(skew: number): number {
  const within = Number.isFinite(skew) ? Math.min(1, Math.max(0, skew)) : DEFAULT_AFFINE_SPREAD.skew;
  return Number(within.toFixed(2));
}

/** An axis an affine spread may take: whole degrees, 0 to 179, one half-turn being the same axis. */
export function clampSpreadAxis(degrees: number): number {
  if (!Number.isFinite(degrees)) return DEFAULT_AFFINE_SPREAD.axisDeg;
  return ((Math.round(degrees) % 180) + 180) % 180;
}

/**
 * The depth spread Depth starts from when no earlier step has one — Zach,
 * 2026-10-04: "depth based ON for folded figures, set to down and 2.5%". It
 * was every new flat pose's until affine took its place (2026-10-05).
 */
export const DEFAULT_DEPTH_SPREAD: DiagramDepthSpread = { kind: 'depth', amount: 0.025, toward: 'down' };

/**
 * The affine spread Affine starts from when no earlier step has one: the
 * playground's bird base, DEFOX's angle 0.95 (φ = 162°, so θ = 81°), fully
 * skewed, 3%. Held still: the top as the front sees it — the playground drew
 * that fold from the side the kernel calls its back, so its bottom is the
 * front's top (`implementation-plans/diagram-distortion.md`, 13g).
 */
export const DEFAULT_AFFINE_SPREAD: DiagramAffineSpread = {
  kind: 'affine',
  amount: 0.03,
  keep: 'top',
  skew: 1,
  axisDeg: 81,
};

/**
 * The spread a folded-flat pose starts with when no earlier step has one, and
 * Spread Layers turned on takes then — Zach, 2026-10-05: "I want affine to be
 * the default option and the first displayed, and default to on".
 */
export const DEFAULT_LAYER_SPREAD: DiagramLayerSpread = DEFAULT_AFFINE_SPREAD;

/**
 * The spread of the nearest step before `stepId` whose flat fold has one —
 * of `kind`, when one is asked for — for a step starting a spread: a
 * diagram's steps spread alike without a diagram-wide setting. Null when none
 * before it does.
 */
export function nearestEarlierSpread(
  document: DiagramDocument,
  stepId: string,
  kind?: SpreadKind
): DiagramLayerSpread | null {
  for (let index = stepIndex(document, stepId) - 1; index >= 0; index -= 1) {
    const entry = document.steps[index]!;
    if (isTurn(entry) || isLockedStep(entry) || entry.source?.kind !== 'cp') continue;
    const { render } = entry.source;
    if (render.mode === 'folded-flat' && render.spread && (kind === undefined || render.spread.kind === kind)) {
      return render.spread;
    }
  }
  return null;
}

/**
 * What a step's spread starts from: a new flat pose, or Spread Layers turned
 * on (`any`), and either kind chosen (`depth`, `affine`) — each the nearest
 * earlier step's, else its default.
 */
export interface DiagramSpreadStarts {
  any: DiagramLayerSpread;
  depth: DiagramDepthSpread;
  affine: DiagramAffineSpread;
}

/** The starts when there is no diagram to look in: the defaults. */
export const DEFAULT_SPREAD_STARTS: DiagramSpreadStarts = {
  any: DEFAULT_LAYER_SPREAD,
  depth: DEFAULT_DEPTH_SPREAD,
  affine: DEFAULT_AFFINE_SPREAD,
};

/** {@link DiagramSpreadStarts} for a step of `document`. */
export function spreadStartsFor(document: DiagramDocument, stepId: string): DiagramSpreadStarts {
  const depth = nearestEarlierSpread(document, stepId, 'depth');
  const affine = nearestEarlierSpread(document, stepId, 'affine');
  return {
    any: nearestEarlierSpread(document, stepId) ?? DEFAULT_LAYER_SPREAD,
    depth: depth?.kind === 'depth' ? depth : DEFAULT_DEPTH_SPREAD,
    affine: affine?.kind === 'affine' ? affine : DEFAULT_AFFINE_SPREAD,
  };
}

/** Whether two spreads, or their absence, are one. */
export function sameSpread(a: DiagramLayerSpread | undefined, b: DiagramLayerSpread | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a.kind !== b.kind || a.amount !== b.amount) return false;
  if (a.kind === 'depth') return b.kind === 'depth' && a.toward === b.toward;
  return b.kind === 'affine' && a.keep === b.keep && a.skew === b.skew && a.axisDeg === b.axisDeg;
}

/**
 * A simulated step's camera: the simulator viewport's orbit, its roll kept in
 * the orientation (`withRollAbsorbed`), as a folded figure's camera is — so
 * what Pose captures is what it shows, an upright set or a Shift-drag
 * included.
 */
export type DiagramSimulatedView = FoldedFigureCamera;

/** The camera a simulated step opens at: Simulate's own default view (`DEFAULT_SIMULATOR_VIEW`). */
export const DEFAULT_SIMULATED_VIEW: DiagramSimulatedView = { yaw: Math.PI / 4, pitch: -0.955, zoom: 1.4 };

/**
 * A way a linked pattern is shown (D19): its crease pattern, its folded form
 * (flat or in 3D as its creases fold), or the simulator's model of it.
 */
export type DiagramShowAs = 'crease-pattern' | 'folded' | 'simulated';

/** The ways, in the order every surface offers them. */
export const DIAGRAM_SHOW_AS: readonly DiagramShowAs[] = ['crease-pattern', 'folded', 'simulated'];

/** A crease pattern's render. */
export type DiagramCreasePatternRender = Extract<DiagramCpRender, { mode: 'crease-pattern' }>;

/** The side of the paper whose colour a crease pattern is drawn on. */
export function creasePatternSide(render: DiagramCreasePatternRender): 'front' | 'back' {
  return render.side === 'back' ? 'back' : 'front';
}

/** A crease pattern on the colour of `side`, its turn as it was: the front written as no side at all. */
export function withCreasePatternSide(
  render: DiagramCreasePatternRender,
  side: 'front' | 'back'
): DiagramCreasePatternRender {
  const { side: _was, ...front } = render;
  return side === 'back' ? { ...front, side: 'back' } : front;
}

/** How a render shows its pattern. */
export function showAsOf(render: DiagramCpRender): DiagramShowAs {
  switch (render.mode) {
    case 'crease-pattern':
      return 'crease-pattern';
    case 'simulated':
      return 'simulated';
    default:
      return 'folded';
  }
}

/** A step drawn from the open crease pattern, and linked to it (D3). */
export interface DiagramCpSource {
  kind: 'cp';
  scope: DiagramCpScope;
  /**
   * `foldedSourceFingerprint` over the creases the scope chose, from the same
   * document snapshot the capture used: what link status compares against.
   */
  fingerprint: string;
  /** The pattern as it was linked, for the picker and a step whose pattern is gone. */
  thumbnail: SheetThumbnail;
  render: DiagramCpRender;
  /**
   * The pose each other way of showing the pattern last had (D19), so a look
   * at the crease pattern and back brings the folded side, turn and layer
   * order back. Never holds the way the step is shown now; absent when empty.
   */
  remembered?: Partial<Record<DiagramShowAs, DiagramCpRender>>;
}

/**
 * The pose to show a linked pattern in, as `way` (D19): the one it is shown in
 * now when that is the way, else the one that way last had, else that way's
 * start — a crease pattern or a flat fold lying as the step lies now, from the
 * front at the first layer order. A flat fold's back at a turn is its front at
 * the opposite turn, mirrored (Turn Over, 12d), so its front's turn is the one
 * carried; a crease pattern's back is only its paper's colour, so its own turn
 * is. A flat fold asked of creases that fold in 3D becomes the 3D one where it
 * is captured (`renderForRoute`). A flat fold started here, not
 * remembered, has its layers spread by `spread` (13g: on by default — the
 * nearest earlier step's, `spreadStartsFor`); one remembered keeps its own.
 */
export function renderToShowAs(
  source: Pick<DiagramCpSource, 'render' | 'remembered'>,
  way: DiagramShowAs,
  spread?: DiagramLayerSpread
): DiagramCpRender {
  const { render } = source;
  if (showAsOf(render) === way) return render;
  const kept = source.remembered?.[way];
  if (kept && showAsOf(kept) === way && kept.mode !== 'simulated') return kept;
  // Back to Simulated from another way: its camera is kept, its picture rebuilt
  // at 0%, the one fold % a picture can be taken at without Pose.
  if (way === 'simulated') {
    return { mode: 'simulated', foldPercent: 0, view: kept?.mode === 'simulated' ? kept.view : DEFAULT_SIMULATED_VIEW };
  }
  const turn =
    render.mode === 'crease-pattern'
      ? render.rotationDeg
      : render.mode === 'folded-flat'
        ? render.side === 'back'
          ? (360 - render.rotationDeg) % 360
          : render.rotationDeg
        : 0;
  return way === 'crease-pattern'
    ? { mode: 'crease-pattern', rotationDeg: turn }
    : { mode: 'folded-flat', side: 'front', rotationDeg: turn, foldCase: 1, ...(spread ? { spread } : {}) };
}

/**
 * `after`, a new capture's source, keeping what the step's source before it
 * remembered and, when the way it is shown changes, the pose it had (D19).
 */
export function withRememberedPoses(before: DiagramStepSource | null, after: DiagramCpSource): DiagramCpSource {
  const { remembered: _ignored, ...rest } = after;
  const kept: Partial<Record<DiagramShowAs, DiagramCpRender>> =
    before?.kind === 'cp' ? { ...before.remembered } : {};
  if (before?.kind === 'cp' && showAsOf(before.render) !== showAsOf(after.render)) {
    kept[showAsOf(before.render)] = before.render;
  }
  delete kept[showAsOf(after.render)];
  return Object.keys(kept).length > 0 ? { ...rest, remembered: kept } : rest;
}

/** The planner settings a References plan was made with (D6): what made its steps the ones they are. */
export interface ReferencesPlanSettings {
  precreaseGrid: boolean;
  gridWhereNeeded: boolean;
  allowDanglingFolds: boolean;
  mergeSymmetricSteps: boolean;
}

/**
 * A step sent from References (D6): one card of its strip, kept as it was
 * drawn, with where it came from.
 *
 * The picture never follows the pattern. Planning a sheet again costs seconds
 * to minutes and need not give the same step, so the link only says whether
 * the sheet changed since the step was sent, and leads back to References.
 */
export interface DiagramReferencesSource {
  kind: 'references-step';
  /** The sheet, by its rim, in the segmentation every link is made in (D3). */
  region: RegionReference;
  /**
   * `foldedSourceFingerprint` over every line inside the sheet when the step
   * was sent: what link status compares. Null when the sheet was not found in
   * the segmentation to fingerprint, so its changes cannot be told.
   */
  fingerprint: string | null;
  /** The sheet as it was sent, for the card and the Step pane. */
  thumbnail: SheetThumbnail;
  /** A Find answer's step, or a card of the planner's sequence. */
  mode: 'sequence' | 'find';
  /** The planner settings a sequence card was planned under; null in Find. */
  settings: ReferencesPlanSettings | null;
  /** The number the strip printed on the card; null for a turn-over or the ending. */
  card: number | null;
  /** The plan step's line `n · p = d`, in the planner's unit frame; null for a card that folds none. */
  line: { n: [number, number]; d: number } | null;
  /** The side of the paper the card showed: what Reset Pose returns to. */
  side: 'front' | 'back';
  /**
   * The plan a card pulled from the References browser came from: its plan
   * cache key, as one string (`referencesPlanCacheKeyId`). Absent for a
   * Find answer, and on a step sent before the browser.
   */
  plan?: string;
  /**
   * The construction the card folds by, when its step offers more than one
   * way (`waySignature`): which of them the step shows.
   */
  way?: string;
  /**
   * The card's own sentence as it was pulled (XML-clean, as a step's text is
   * kept). While the step's instruction still equals it the words are the
   * card's, and a card replacing it brings its own; edited, they are the
   * reader's. Absent on a step sent before the browser.
   */
  sentence?: string;
}

/**
 * Where a step's picture comes from. The variants arrive with the phases that
 * build them, and a source this build does not know makes the step an
 * unknown, locked one (see {@link DiagramStep.unknown}).
 */
export type DiagramStepSource = DiagramUploadSource | DiagramCpSource | DiagramReferencesSource;

/**
 * A picture held in the assets table: an upload, or (from Phase 3) a capture
 * too large to keep inline. `key` names the picture, for the paint cache and
 * for telling whether annotations were drawn on it.
 */
export interface DiagramAssetPicture {
  kind: 'asset';
  assetId: string;
  /**
   * Picture px per crease-pattern unit, for a capture kept as a bitmap, for
   * one shared scale across a page (D10); null for an upload, whose paper's
   * size is unknown.
   */
  paperScale: number | null;
  /**
   * For a capture kept as a bitmap, the drawn style it was drawn in
   * (`diagramStyleKey`): a bitmap cannot be re-inked, so a change of style
   * makes it out of date. Absent for an upload.
   */
  styleKey?: string;
  key: string;
}

/**
 * A captured picture as a paper scene (D2): a crease pattern, a flat folded
 * model or a 3D one, drawn in the diagram's pens when it is painted. Stored as
 * one compact string, hidden items already dropped.
 */
export interface DiagramScenePicture {
  kind: 'scene';
  /** The `PaperScene`, as JSON: inert, validated on load (markup dropped). */
  sceneJson: string;
  /** Scene px per crease-pattern unit, for one shared scale across a page (D10); null when unknown. */
  paperScale: number | null;
  /** For a 3D capture, the style its light was baked under (`folded3dSceneStyleKey`); null otherwise. */
  styleKey: string | null;
  key: string;
  /**
   * A flat fold's faces on the paper, as an enlarged step anchors its frame
   * to them (Revision 2): a {@link DiagramPaperFaces} as one string of compact
   * JSON, as `sceneJson` is a scene — written pretty-printed as a value it
   * would be a line per number. Written by flat captures only; absent on a
   * capture made before it, which anchors nothing until it is refreshed.
   */
  paperFaces?: string;
}

/**
 * A flat fold's faces as anchoring an enlarged step's frame needs them
 * (Revision 2), each wireframe point once. Paper coordinates are pattern
 * units about the centre of the paper's box, shared by every step of one
 * paper; the unspread picture is the step's picture as its pose draws it
 * (side, turn, case) with no spread, in scene px. A point's drawn place is
 * never stored: with a spread on it is in the stored scene, each face whole
 * there, and with none it is its unspread place.
 */
export interface DiagramPaperFaces {
  /** Per point: its place on the paper, then on the unspread picture. */
  points: [number, number, number, number][];
  /**
   * Per face, in the kernel's face order (the `face` the stored scene's face
   * items carry): its corners as indices into `points`, in its outline's
   * order; empty for a face the kernel could not name on the paper.
   */
  rings: number[][];
  /** Per face: the longest chain of faces stacked over it as the picture is seen (`layerLevels`); the greatest is backmost. */
  levels: number[];
}

/**
 * A fold with no layer order (D4): the kernel's transparent development, which
 * has no paper scene, as our own SVG — sanitized at capture and on load.
 */
export interface DiagramFixedPicture {
  kind: 'fixed';
  svg: string;
  widthPx: number;
  heightPx: number;
  key: string;
}

/**
 * A References card's picture (D6): its step diagram in the planner's unit
 * frame, painted afresh at every size so its marks keep their weight.
 */
export interface DiagramStepDiagramPicture {
  kind: 'step-diagram';
  model: StepDiagramModel;
  /** Seen from the paper's back: x reflected about the sheet, every fold named from that side. */
  mirrored: boolean;
  key: string;
}

/** A step's captured picture. Variants arrive with their phases, as sources do. */
export type DiagramPicture =
  | DiagramAssetPicture
  | DiagramScenePicture
  | DiagramFixedPicture
  | DiagramStepDiagramPicture;

/**
 * What an annotation draws (D8): a fold arrow — kept (valley, mountain) or
 * made and unfolded — a push, a white arrow, the turn-over and rotate glyphs,
 * a crease line in the diagram's pens, a label, a circle round a point, as
 * References rings one, a right angle marked in a corner, and a callout: a
 * line from a point to a box of words, as diagrams say "repeat behind" — an
 * angle marked halved, as a bisector's equal angles are (15b), a pleat
 * arrow, its shaft a lightning bolt, as diagrams mark a crimp or a pleat (15c),
 * a close-up: a ring round an area of the picture and a larger one beside
 * it, the area drawn again inside it at a larger size (15f), and equal
 * divisions: a line set off from a line of the picture, cut into equal parts
 * by strokes across it, each part ticked, as a draftsman's dimension is
 * (Revision 2), and an enlarge area: a circle or a rounded rectangle marking
 * what a later step may show enlarged (Revision 2) — drawing one changes no
 * other step.
 */
export type DiagramAnnotationKind =
  | 'valley-arrow'
  | 'mountain-arrow'
  | 'fold-unfold-arrow'
  | 'pleat-arrow'
  | 'push-arrow'
  | 'white-arrow'
  | 'turn-over'
  | 'rotate'
  | 'valley-line'
  | 'mountain-line'
  | 'hidden-line'
  | 'label'
  | 'circle'
  | 'right-angle'
  | 'callout'
  | 'angle-mark'
  | 'divisions'
  | 'close-up'
  | 'zoom';

/**
 * How an enlarged step draws its frame (Revision 2): only where it crosses
 * paper (look 1), or all of it (look 2).
 */
export type DiagramZoomEdge = 'cut' | 'whole';

/** An enlarge area's, or an enlarged step's frame's, shape: a circle, or a rectangle with rounded corners. */
export type DiagramZoomShape = 'circle' | 'rounded';

/**
 * A circle or a rounded rectangle, centred on `centre` and turned clockwise
 * by `angle` degrees: exactly one of `radius` and `size`. In whatever units
 * it is held in — a step's picture units, or the paper's.
 */
export interface DiagramZoomOutline {
  centre: [number, number];
  /** A circle's radius. */
  radius?: number;
  /** A rounded rectangle's width and height. */
  size?: [number, number];
  /** Degrees clockwise; unsaid, 0. */
  angle?: number;
}

/**
 * An enlarged step (Revision 2): it shows a frame of its own picture,
 * captured from an earlier step at one moment and its own from then on.
 */
export interface DiagramStepZoom {
  /**
   * Provenance only: the id of the area it was captured from, directly or
   * through an enlarged step. Never read to draw.
   */
  from: string;
  shape: DiagramZoomShape;
  /**
   * The frame in this step's picture units, as drawn (onto its spread). The
   * step's marks are in the units of its upright box, the window: the window
   * is its frame. On a step with no picture yet (seeded empty), the source's
   * frame copied in picture units: what its first picture shows when the
   * imprint cannot land there.
   */
  frame?: DiagramZoomOutline;
  /**
   * The frame on the paper, in paper coordinates, and `on`, the anchor's
   * point on the paper; `picked` when the anchor was picked. Absent where the
   * capture had no faces to imprint through. A step with no faces of its own
   * keeps the one it was captured with, for a picture with faces to land —
   * until its frame is set by hand, which then is the frame.
   */
  imprint?: DiagramZoomOutline & { on: [number, number]; picked?: true };
  /** As an area's: that many times the area as it prints, 1.25–6; unsaid, Fill. */
  scale?: number;
  /** As an area's: unsaid, the shape's own. */
  edge?: DiagramZoomEdge;
}

/**
 * How many ticks an equality mark draws: across each half of an angle mark,
 * on each part of equal divisions. A second set of equal angles or parts in a
 * step takes two.
 */
export type DiagramTicks = 1 | 2 | 3;

/** How many Zs a pleat arrow's shaft has: a crimp's one, a pleat's two, up to five. */
export type DiagramPleatKinks = 1 | 2 | 3 | 4 | 5;

/**
 * The ends of a mark that lie behind a flap (15e), and for each how many of
 * the layers at that end are over it, the top one first; an end not named
 * is in front. A circle's one end is its centre, `from`.
 */
export interface DiagramBehind {
  from?: number;
  to?: number;
}

/** How far, and which way, a rotate glyph turns the model. */
export interface DiagramRotation {
  amount: 'eighth' | 'quarter' | 'half';
  direction: 'cw' | 'ccw';
}

/**
 * A node of a shaped arrow's path, in picture units like everything else an
 * annotation holds — handles too, as points rather than offsets, so any move
 * of the picture carries them by mapping each point and a mirror needs
 * nothing turned over.
 *
 * The segment from one node to the next is the cubic Bézier through the
 * first's `at` and `out` and the second's `in` and `at`; a handle left out
 * lies on its node. The tail has no `in` and the tip no `out`. A node is
 * smooth — its two handles kept in line as they are edited — unless it is a
 * `corner`; that is a rule of editing, never of reading.
 */
export interface DiagramPathNode {
  at: [number, number];
  in?: [number, number];
  out?: [number, number];
  type?: 'corner';
}

/**
 * A mark drawn on a step's picture (D8), in **picture units**: the origin at
 * the top-left of the picture's frame, y down, one unit the frame's longer
 * side. The frame is the posed picture's bounds — a References step's, its
 * sheet — so a mark stays on what it points at whatever size the picture is
 * drawn. It is compiled into the step-diagram vocabulary each time it is
 * painted (`annotate/annotationPrimitives.ts`), at the size it is painted at.
 */
export interface KnownDiagramAnnotation {
  /** `annotation-<uuid>`. */
  id: string;
  kind: DiagramAnnotationKind;
  /**
   * Where it starts: an arrow's tail, a line's end, a glyph's or a label's
   * centre, a right angle's corner, the point a callout marks, an angle
   * mark's vertex, one end of the line equal divisions measure.
   */
  from: [number, number];
  /**
   * Where it ends: an arrow's tip, the middle of a callout's box; `from` again
   * for a glyph or a label; for a right angle, a point along the diagonal into
   * the angle — only its direction is read; for an angle mark, a point along
   * its first arm — only its direction is read; for equal divisions, the
   * measured line's other end.
   */
  to: [number, number];
  /** An angle mark's second arm: a point along it, only its direction read (15b). */
  other?: [number, number];
  /** An angle mark's ticks across each half, or equal divisions' on each part; one when unsaid (15b, Revision 2). */
  ticks?: DiagramTicks;
  /** A pleat arrow's Zs; one when unsaid (15c). */
  kinks?: DiagramPleatKinks;
  /**
   * A pleat arrow whose Zs step to the left of the way it points, as the
   * picture shows it; unsaid, to the right (15c). Equal divisions whose line
   * lies to the left of the way from `from` to `to` runs; unsaid, to the
   * right. Only ever written true.
   */
  mirrored?: true;
  /** How many equal parts equal divisions cut their line into: 2 to 32, always written (Revision 2). */
  parts?: number;
  /**
   * How far equal divisions' line is set off the line they measure, in
   * millimetres as it prints — the first print length a mark stores — 0 to
   * 15, always written: at 0 it lies on it (Revision 2).
   */
  offset?: number;
  /** Equal divisions that print their count beside their line; unsaid, they do not. Only ever written true. */
  numbered?: true;
  /**
   * The ends of a fold or pleat arrow, a valley or mountain line, or a
   * circle that lie behind a flap (15e): drawn dotted from each until they
   * come out from under it, on a flat fold, the one picture that knows its
   * layers. Unsaid, in front, as every mark was before.
   */
  behind?: DiagramBehind;
  /**
   * A fold arrow's arc: its sagitta as a share of its chord, positive bulging
   * to the left of its travel as the page shows it. Flip arc negates it.
   * Absent on an arrow shaped by hand, which has a `path` instead.
   */
  bend?: number;
  /**
   * A fold arrow shaped by hand (Edit Path): its nodes, tail first, at least
   * two, the first at `from` and the last at `to`. Written only once an arrow
   * is reshaped; an arrow that never was keeps its exact arc (`bend`). A
   * white arrow always has one: it is laid straight, and shaped from there.
   */
  path?: DiagramPathNode[];
  /**
   * A fold-and-unfold arrow's return shaped by hand (Edit Path), as a path of
   * its own: from the tip — its first node where `path`'s last is, carrying
   * the return's first handle — back to beside the tail, where its head is.
   * Only with `path`: the arrow's first edit writes both, the return as it
   * was drawn, and each half is edited on its own after. Absent (an older
   * file's path), the return is derived from the path where it is drawn, and
   * follows it until the arrow's next edit writes it.
   */
  back?: DiagramPathNode[];
  /** A white arrow's width: one of three print sizes, in ink, as every mark's is (decision 14). */
  width?: DiagramWhiteArrowWidth;
  /** A white arrow's tail: drawn to a point, cut square, or cleft in a V. */
  tail?: WhiteArrowTail;
  /**
   * A white arrow filled with the arrow's ink: a solid arrow (15d). Unsaid, it
   * is filled with the page's white, as every white arrow was before.
   */
  fill?: 'black';
  /**
   * A close-up's area (15f): the radius of the ring round it, in picture
   * units. Its centre is `from`; the close-up's is `to`. An enlarge area's,
   * when it is a circle (Revision 2): its centre is `from`, and `to` again.
   */
  radius?: number;
  /**
   * How many times larger a close-up draws its area (15f): its ring is
   * `radius` times this. Two when unsaid. An enlarge area's Size, which the
   * steps enlarged from it copy: that many times the area as it prints,
   * 1.25–6; unsaid, Fill (Revision 2).
   */
  scale?: number;
  /**
   * An enlarge area that is a rounded rectangle: its width and height in
   * picture units, about its centre `from`. Exactly one of this and `radius`
   * (Revision 2).
   */
  size?: [number, number];
  /** An enlarge area's turn, in degrees clockwise, from a pose that carried it; unsaid, 0 (Revision 2). */
  angle?: number;
  /** How the steps enlarged from an area draw their frame; unsaid, its shape's own (Revision 2). */
  edge?: DiagramZoomEdge;
  /** An enlarge area's picked anchor: a point on the paper, in paper coordinates; unsaid, the default rule (Revision 2). */
  anchor?: [number, number];
  /** A label's or a callout's text. */
  text?: string;
  rotate?: DiagramRotation;
  /** The axis a turn-over turns the model about. */
  axis?: 'vertical' | 'horizontal';
  unknown?: undefined;
}

/**
 * An annotation this build cannot read, kept verbatim so a newer build's work
 * survives a round trip through this one: a kind, or a value of one of its
 * enums, this build does not know, or a field it has no name for.
 */
export interface UnknownDiagramAnnotation {
  id: string;
  unknown: Record<string, unknown>;
}

export type DiagramAnnotation = KnownDiagramAnnotation | UnknownDiagramAnnotation;

export function isKnownAnnotation(annotation: DiagramAnnotation): annotation is KnownDiagramAnnotation {
  return annotation.unknown === undefined;
}

/** Uploaded vector art, sanitized (D7): only ever shown as an image. */
export interface DiagramSvgAsset {
  id: string;
  kind: 'svg';
  /** Sanitized markup, its ids prefixed with the asset's id. */
  svg: string;
  widthPx: number;
  heightPx: number;
  /** What it costs in the file. */
  bytes: number;
}

/** An uploaded bitmap, re-encoded to a PNG or JPEG data URL at most 2048 px a side. */
export interface DiagramRasterAsset {
  id: string;
  kind: 'raster';
  src: string;
  widthPx: number;
  heightPx: number;
  bytes: number;
}

export type KnownDiagramAsset = DiagramSvgAsset | DiagramRasterAsset;

/** An asset this build cannot read, kept verbatim like an unknown annotation. */
export interface UnknownDiagramAsset {
  id: string;
  unknown: Record<string, unknown>;
}

export type DiagramAsset = KnownDiagramAsset | UnknownDiagramAsset;

export function isKnownAsset(asset: DiagramAsset): asset is KnownDiagramAsset {
  return !('unknown' in asset);
}

export interface DiagramStep {
  /** `step-<uuid>`. */
  id: string;
  /**
   * Bumped whenever the source changes. A capture started against one revision
   * is discarded if it lands after another (async captures, D4).
   */
  revision: number;
  /** `null` is an empty step. */
  source: DiagramStepSource | null;
  /** The captured result; `null` until captured. */
  picture: DiagramPicture | null;
  annotations: DiagramAnnotation[];
  /** The picture key the annotations were drawn on (D8). */
  annotatedPictureKey: string | null;
  /** The instruction under the picture. */
  text: string;
  /** Start a new page at this step. */
  breakBefore: boolean;
  /** Set when the step is enlarged (Revision 2): the frame of its picture it shows. */
  zoom?: DiagramStepZoom;
  /**
   * Set when the step was written by a newer build in a shape this one cannot
   * read: the raw step, re-emitted verbatim on save. Such a step is locked — it
   * can be moved or deleted, never edited.
   */
  unknown?: Record<string, unknown>;
}

/**
 * Turning the whole model between two steps (D22): over, about an axis, or
 * round by a part of a turn. What a turn is, without its id.
 */
export type DiagramTurnKind =
  | { kind: 'turn-over'; axis: 'vertical' | 'horizontal' }
  | { kind: 'rotate'; rotate: DiagramRotation };

/**
 * A turn in the diagram's order (D22): an entry beside the steps, selected,
 * moved, deleted and undone as a step is, with no picture, no instruction and
 * no number — the steps either side of it read 3 and 4.
 */
export type DiagramTurn = DiagramTurnKind & {
  /** `turn-<uuid>`. */
  id: string;
  /**
   * A newer build's turn, carried whole: its raw form, written back as it came.
   * Its kind is then a stand-in, never drawn or changed; it is moved or
   * deleted, and it takes no number, as any turn.
   */
  unknown?: Record<string, unknown>;
};

/** One entry in a diagram's order: a step, or a turn between steps. */
export type DiagramEntry = DiagramStep | DiagramTurn;

/** Whether an entry is a turn rather than a step. */
export function isTurn(entry: DiagramEntry): entry is DiagramTurn {
  return 'kind' in entry;
}

/** A turn written by a newer build: it can be moved or deleted, never changed or drawn. */
export function isLockedTurn(turn: DiagramTurn): boolean {
  return turn.unknown !== undefined;
}

/** Whether an entry is a step rather than a turn. */
export function isStep(entry: DiagramEntry): entry is DiagramStep {
  return !isTurn(entry);
}

export interface DiagramDocument {
  formatVersion: typeof DIAGRAM_FORMAT_VERSION;
  /** `diagram-<uuid>`. */
  id: string;
  /** The header, the page title tab and the export filename's stem. */
  title: string;
  hanStyle: DiagramHanStyle;
  style: DiagramStyle;
  page: DiagramPageSetup;
  /** The steps and the turns between them, in order (D22): a step's number counts the steps before it. */
  steps: DiagramEntry[];
  /** Uploaded art, shared by id between steps, duplicates and undo snapshots. */
  assets: Record<string, DiagramAsset>;
}

export type DiagramIdFactory = (prefix: 'diagram' | 'step' | 'turn' | 'annotation' | 'asset') => string;

export const randomDiagramId: DiagramIdFactory = (prefix) => `${prefix}-${crypto.randomUUID()}`;

export const PAGE_MARGIN_MM_RANGE = { min: 0, max: 30 } as const;
export const PAGE_COLUMNS_RANGE = { min: 2, max: 5 } as const;
export const PAGE_ROWS_RANGE = { min: 1, max: 6 } as const;
export const FIRST_PAGE_NUMBER_RANGE = { min: 1, max: 9999 } as const;
/**
 * The flow band's width, mm: from a thin line to more than twice the 26 mm an
 * A4 page of 3 × 3 steps draws it by itself — as wide as the widest it draws
 * by itself, two steps to a landscape page.
 */
export const PATH_WIDTH_MM_RANGE = { min: 4, max: 60 } as const;
/** The flow band's colour: the mockup's light warm grey. */
export const DEFAULT_PATH_COLOR = '#ecece8';

/**
 * A new diagram's page setup. It starts in the flow layout; a page setup that
 * does not say its layout reads as the grid instead ({@link UNSAID_PAGE_LAYOUT}).
 */
export const DEFAULT_PAGE_SETUP: DiagramPageSetup = {
  size: 'a4',
  orientation: 'portrait',
  marginMm: 12,
  layout: 'flow',
  columns: 3,
  rows: 3,
  showPath: true,
  pathWidthMm: null,
  pathColor: DEFAULT_PATH_COLOR,
  firstPageSide: 'left',
  showTitle: true,
  pageNumbers: { enabled: true, first: 1 },
};

export const DEFAULT_DIAGRAM_STYLE: DiagramStyle = { preset: 'diagram' };

/**
 * The Han style a new diagram starts in, from the author's interface language:
 * Japanese and Korean authors get their own forms, everyone else Simplified
 * Chinese (the app's Chinese locale is zh-CN). Changeable per diagram.
 */
export function defaultHanStyle(locale: string | null | undefined): DiagramHanStyle {
  const language = (locale ?? '').toLowerCase();
  if (language.startsWith('ja')) return 'jp';
  if (language.startsWith('ko')) return 'kr';
  if (language === 'zh-tw' || language === 'zh-hk' || language.startsWith('zh-hant')) return 'tc';
  return 'sc';
}

export function createDiagram(options: {
  title?: string;
  hanStyle?: DiagramHanStyle;
  newId?: DiagramIdFactory;
} = {}): DiagramDocument {
  const newId = options.newId ?? randomDiagramId;
  return {
    formatVersion: DIAGRAM_FORMAT_VERSION,
    id: newId('diagram'),
    title: xmlText(options.title ?? ''),
    hanStyle: options.hanStyle ?? 'sc',
    style: DEFAULT_DIAGRAM_STYLE,
    page: DEFAULT_PAGE_SETUP,
    steps: [],
    assets: {},
  };
}

export function createStep(newId: DiagramIdFactory = randomDiagramId): DiagramStep {
  return {
    id: newId('step'),
    revision: 0,
    source: null,
    picture: null,
    annotations: [],
    annotatedPictureKey: null,
    text: '',
    breakBefore: false,
  };
}

/** A turn (D22): a turn-over about the vertical axis, unless asked otherwise. */
export function createTurn(kind: DiagramTurnKind, newId: DiagramIdFactory = randomDiagramId): DiagramTurn {
  return { ...kind, id: newId('turn') };
}

/** A step written by a newer build: it can be moved or deleted, never edited. */
export function isLockedStep(step: DiagramStep): boolean {
  return step.unknown !== undefined;
}

/** Whether a step has a picture, or a source to capture one from. */
export function stepHasPicture(step: DiagramStep): boolean {
  return step.source !== null || step.picture !== null;
}

/**
 * Whether deleting the step would throw work away: an instruction, a picture
 * or its source, annotations, or a step made by a newer build. An empty step
 * goes without asking.
 */
export function stepHasContent(step: DiagramStep): boolean {
  return (
    isLockedStep(step) ||
    step.text.trim() !== '' ||
    step.source !== null ||
    step.picture !== null ||
    step.annotations.length > 0
  );
}

/** Where an entry — a step or a turn — is in the diagram's order; -1 when it is not there. */
export function stepIndex(document: DiagramDocument, stepId: string): number {
  return document.steps.findIndex((step) => step.id === stepId);
}

/** The step with this id, or null — for a turn too, which is no step. */
export function stepById(document: DiagramDocument, stepId: string): DiagramStep | null {
  const entry = document.steps[stepIndex(document, stepId)];
  return entry && isStep(entry) ? entry : null;
}

/** The turn with this id, or null. */
export function turnById(document: DiagramDocument, turnId: string): DiagramTurn | null {
  const entry = document.steps[stepIndex(document, turnId)];
  return entry && isTurn(entry) ? entry : null;
}

/** The steps alone, in order: what is numbered, captured, laid out and exported. */
export function stepsOf(document: DiagramDocument): DiagramStep[] {
  return numbering(document.steps).steps;
}

/**
 * Each step's number, by its id: its place among the steps, turns left out
 * (D22), as References numbers its folds and not its turn-overs.
 */
export function stepNumbers(document: DiagramDocument): ReadonlyMap<string, number> {
  return numbering(document.steps).numbers;
}

/** A step's number, or null for a turn or an id not in the diagram. */
export function stepNumber(document: DiagramDocument, stepId: string): number | null {
  return stepNumbers(document).get(stepId) ?? null;
}

/**
 * The numbers of the steps either side of an entry: for a turn, the steps it
 * turns the model between. Null at either end.
 */
export function stepsAround(document: DiagramDocument, entryId: string): { before: number | null; after: number | null } {
  const index = stepIndex(document, entryId);
  if (index < 0) return { before: null, after: null };
  const numbers = stepNumbers(document);
  const before = document.steps.slice(0, index).reverse().find(isStep);
  const after = document.steps.slice(index + 1).find(isStep);
  return { before: before ? numbers.get(before.id)! : null, after: after ? numbers.get(after.id)! : null };
}

/** The steps and their numbers, once per order: every step card, page cell and export reads them. */
const numberings = new WeakMap<readonly DiagramEntry[], { steps: DiagramStep[]; numbers: Map<string, number> }>();

function numbering(entries: readonly DiagramEntry[]): { steps: DiagramStep[]; numbers: Map<string, number> } {
  let found = numberings.get(entries);
  if (!found) {
    const steps = entries.filter(isStep);
    found = { steps, numbers: new Map(steps.map((step, index) => [step.id, index + 1])) };
    numberings.set(entries, found);
  }
  return found;
}

/**
 * Where an add lands: after the selected step, or at the end when nothing is
 * selected (D2's insertion rule).
 */
export function insertionIndex(document: DiagramDocument, selectedStepId: string | null): number {
  if (selectedStepId === null) return document.steps.length;
  const index = stepIndex(document, selectedStepId);
  return index < 0 ? document.steps.length : index + 1;
}

export function insertSteps(
  document: DiagramDocument,
  steps: readonly DiagramEntry[],
  index: number
): DiagramDocument {
  if (steps.length === 0) return document;
  const at = clampInteger(index, 0, document.steps.length);
  return {
    ...document,
    steps: [...document.steps.slice(0, at), ...steps, ...document.steps.slice(at)],
  };
}

export function removeSteps(document: DiagramDocument, stepIds: readonly string[]): DiagramDocument {
  const removing = new Set(stepIds);
  const steps = document.steps.filter((step) => !removing.has(step.id));
  return steps.length === document.steps.length ? document : { ...document, steps };
}

/** Move an entry — a step or a turn — so it ends up at `toIndex` among the entries (clamped). */
export function moveStep(document: DiagramDocument, stepId: string, toIndex: number): DiagramDocument {
  const from = stepIndex(document, stepId);
  if (from < 0) return document;
  const to = clampInteger(toIndex, 0, document.steps.length - 1);
  if (to === from) return document;
  const steps = document.steps.slice();
  const [step] = steps.splice(from, 1);
  steps.splice(to, 0, step);
  return { ...document, steps };
}

/**
 * Where `moveStep` puts a step for it to be number `number` (clamped): just
 * before the step that will come after it, so a turn before that step stays
 * before it; as the last number, just after the last step.
 */
export function indexForStepNumber(document: DiagramDocument, stepId: string, number: number): number {
  const rest = document.steps.filter((entry) => entry.id !== stepId);
  const others = rest.filter(isStep);
  const n = clampInteger(Math.round(number), 1, others.length + 1);
  if (n <= others.length) return rest.indexOf(others[n - 1]!);
  const last = others.at(-1);
  return last ? rest.indexOf(last) + 1 : 0;
}

/**
 * A copy of a step, placed right after it, with fresh ids for the step and its
 * annotations. Assets are shared by id, so a duplicate costs no bytes. A locked
 * step is not duplicated: its raw form names its own id, and a copy could only
 * be a second step with the same one.
 */
export function duplicateStep(
  document: DiagramDocument,
  stepId: string,
  newId: DiagramIdFactory = randomDiagramId
): { document: DiagramDocument; stepId: string } | null {
  const index = stepIndex(document, stepId);
  if (index < 0) return null;
  const original = document.steps[index];
  // A turn is not duplicated: two turns in a row are one turn, or none.
  if (isTurn(original) || isLockedStep(original)) return null;
  const copy: DiagramStep = {
    ...original,
    id: newId('step'),
    revision: 0,
    // A new page belongs to where the original starts one; the copy follows it.
    breakBefore: false,
    annotations: original.annotations.map((annotation) => {
      const id = newId('annotation');
      // One carried verbatim from a newer build is written back from its raw
      // form, so the fresh id has to go there too, or the copy is written out
      // under the original's.
      return annotation.unknown
        ? { ...annotation, id, unknown: { ...annotation.unknown, id } }
        : { ...annotation, id };
    }),
  };
  return { document: insertSteps(document, [copy], index + 1), stepId: copy.id };
}

/** The key of an upload's picture: the asset's, which never changes once stored. */
export function uploadPictureKey(assetId: string): string {
  return `asset:${assetId}`;
}

function uploadStepParts(asset: KnownDiagramAsset): Pick<DiagramStep, 'source' | 'picture'> {
  return {
    source: { kind: 'upload', assetId: asset.id, rotationQuarterTurns: 0, mirrored: false },
    picture: { kind: 'asset', assetId: asset.id, paperScale: null, key: uploadPictureKey(asset.id) },
  };
}

function withAssets(document: DiagramDocument, assets: readonly KnownDiagramAsset[]): DiagramDocument {
  if (assets.length === 0) return document;
  const table = { ...document.assets };
  for (const asset of assets) table[asset.id] = asset;
  return { ...document, assets: table };
}

/**
 * One new step per picture, in the order given, inserted at `index`. The
 * assets go into the table; each step refers to its own by id.
 */
export function insertPictureSteps(
  document: DiagramDocument,
  assets: readonly KnownDiagramAsset[],
  index: number,
  newId: DiagramIdFactory = randomDiagramId
): { document: DiagramDocument; stepIds: string[] } {
  const steps = assets.map((asset) => ({ ...createStep(newId), ...uploadStepParts(asset) }));
  return {
    document: insertSteps(withAssets(document, assets), steps, index),
    stepIds: steps.map((step) => step.id),
  };
}

/**
 * Give a step a picture: it becomes an upload of `asset`, in its upright pose,
 * and keeps its instruction and annotations. Annotations drawn on another
 * picture stay where they were, and Annotate says the picture changed.
 */
export function setStepPicture(
  document: DiagramDocument,
  stepId: string,
  asset: KnownDiagramAsset
): DiagramDocument {
  const step = stepById(document, stepId);
  if (!step || isLockedStep(step)) return document;
  return updateStep(withAssets(document, [asset]), stepId, (step) => ({
    ...step,
    ...uploadStepParts(asset),
    revision: step.revision + 1,
  }));
}

/** A linked step's picture as a capture made it: its source, and the picture with any bitmap it is kept as. */
export interface CapturedLink {
  source: DiagramCpSource;
  picture: DiagramPicture | null;
  /** The bitmap a picture too detailed to keep as vector is kept as; `picture` names it. */
  asset?: KnownDiagramAsset;
}

/**
 * Link a step to the pattern, or give a linked step a new capture: its source
 * and picture become the capture's, and it keeps its instruction and
 * annotations. A capture that changes nothing — the same source, and a picture
 * with the same key and the same faces on the paper — is no edit, so a
 * Refresh of a current step records no undo step.
 */
export function setLinkedPicture(
  document: DiagramDocument,
  stepId: string,
  link: CapturedLink
): DiagramDocument {
  const step = stepById(document, stepId);
  if (!step || isLockedStep(step)) return document;
  if (
    (step.picture?.key ?? null) === (link.picture?.key ?? null) &&
    paperFacesOn(step.picture) === paperFacesOn(link.picture) &&
    JSON.stringify(step.source) === JSON.stringify(withRememberedPoses(step.source, link.source))
  ) {
    return document;
  }
  const withAsset = withAssets(document, link.asset ? [link.asset] : []);
  return updateStep(withAsset, stepId, (current) =>
    withCarriedAnnotations(
      current,
      {
        ...current,
        source: withRememberedPoses(current.source, link.source),
        picture: link.picture,
        revision: current.revision + 1,
      },
      withAsset.assets
    )
  );
}

/**
 * A picture's faces on the paper, as stored: a capture that adds them to a
 * picture drawn the same (its key unchanged) is still an edit, which keeps
 * every mark where it is.
 */
function paperFacesOn(picture: DiagramPicture | null): string | undefined {
  return picture?.kind === 'scene' ? picture.paperFaces : undefined;
}

/** One References card, as a step is made from it. */
export interface SentReferencesStep {
  source: DiagramReferencesSource;
  picture: DiagramStepDiagramPicture;
  /** The card's sentence: the step's instruction until it is edited. */
  text: string;
}

/**
 * Where the References browser puts the cards it pulls (D20), as it was
 * opened: after a step, at the end, into an empty step (filled by the first
 * card, the rest after it), or in place of a References step's picture
 * (Replace). A replaced step's instruction follows the new card only while it
 * is still the old card's own sentence (`DiagramReferencesSource.sentence`).
 */
export type DiagramPullAnchor =
  | { kind: 'after'; stepId: string }
  | { kind: 'end' }
  | { kind: 'fill'; stepId: string }
  | { kind: 'replace'; stepId: string };

/** What References sends: a card, made a step; or a turn-over card, made a turn (D22). */
export type SentReferencesEntry = SentReferencesStep | DiagramTurnKind;

/**
 * Cards pulled from References, placed by `anchor`, in order: each a step, a
 * turn-over card a turn (D22). An anchor whose step is gone, or can no longer
 * be filled or replaced (it got a picture, it is a newer build's), places the
 * cards after it, or at the end. A step filled or replaced takes the first
 * card that makes a step; turns sent before it go before it, never into it.
 * The steps the cards became, in order — a filled or replaced step first —
 * and the turns.
 */
export function pullReferencesSteps(
  document: DiagramDocument,
  sent: readonly SentReferencesEntry[],
  anchor: DiagramPullAnchor,
  { newId = randomDiagramId }: { newId?: DiagramIdFactory } = {}
): { document: DiagramDocument; stepIds: string[]; turnIds: string[] } {
  if (sent.length === 0) return { document, stepIds: [], turnIds: [] };
  const make = (card: SentReferencesEntry): DiagramEntry =>
    'kind' in card
      ? createTurn(card, newId)
      : { ...createStep(newId), source: card.source, picture: card.picture, text: xmlText(card.text) };
  const insertAt = (index: number, cards: readonly SentReferencesEntry[], into = document) => {
    const entries = cards.map(make);
    return {
      document: insertSteps(into, entries, index),
      stepIds: entries.filter(isStep).map((step) => step.id),
      turnIds: entries.filter(isTurn).map((turn) => turn.id),
    };
  };
  if (anchor.kind === 'end') return insertAt(document.steps.length, sent);
  const at = stepIndex(document, anchor.stepId);
  const target = stepById(document, anchor.stepId);
  const firstStep = sent.findIndex((card) => !('kind' in card));
  if (at < 0 || !target || anchor.kind === 'after' || !anchorTakesCard(document, anchor) || firstStep < 0) {
    // Into a step that cannot take a card, or with no card that makes one: after it — a turn sent for
    // an empty step goes before it, which stays for the card that fills it.
    const before = target && firstStep < 0 && anchor.kind !== 'after' && anchorTakesCard(document, anchor);
    return insertAt(at < 0 ? document.steps.length : before ? at : at + 1, sent);
  }
  const first = sent[firstStep] as SentReferencesStep;
  const leading = sent.slice(0, firstStep);
  const rest = sent.slice(firstStep + 1);
  const words = (step: DiagramStep): string => {
    if (anchor.kind === 'fill') return step.text.trim() === '' ? xmlText(first.text) : step.text;
    // Replaced: still the old card's words, they become the new card's; edited, they are the reader's.
    const own = step.source?.kind === 'references-step' ? step.source.sentence : undefined;
    return own !== undefined && step.text === own ? xmlText(first.text) : step.text;
  };
  const taken = updateStep(document, target.id, (step) => ({
    ...step,
    source: first.source,
    picture: first.picture,
    text: words(step),
    revision: step.revision + 1,
  }));
  const before = insertAt(at, leading, taken);
  const after = insertAt(at + leading.length + 1, rest, before.document);
  return {
    document: after.document,
    stepIds: [target.id, ...after.stepIds],
    turnIds: [...before.turnIds, ...after.turnIds],
  };
}

/**
 * Whether the anchor's own step takes the first card: an empty step to fill,
 * or a References step to replace, while it is still there and still so. A
 * step that got a picture some other way, or was taken away, takes nothing,
 * and every card goes after it (or at the end).
 */
export function anchorTakesCard(document: DiagramDocument | null, anchor: DiagramPullAnchor): boolean {
  if (!document || (anchor.kind !== 'fill' && anchor.kind !== 'replace')) return false;
  const step = stepById(document, anchor.stepId);
  if (!step || isLockedStep(step)) return false;
  return anchor.kind === 'fill' ? !stepHasPicture(step) : step.source?.kind === 'references-step';
}

/** A step-diagram picture's key for a side: the model's own key, marked for the back. */
export function stepDiagramKey(modelKey: string, mirrored: boolean): string {
  const base = modelKey.endsWith(BACK_SUFFIX) ? modelKey.slice(0, -BACK_SUFFIX.length) : modelKey;
  return mirrored ? `${base}${BACK_SUFFIX}` : base;
}

const BACK_SUFFIX = '-back';

/**
 * Show a References step from one side or the other (D5: its pose is Turn
 * over). The picture is re-keyed, and its annotations are flipped with it
 * (D8); the source keeps the side the card was sent from.
 */
export function setReferencesSide(document: DiagramDocument, stepId: string, mirrored: boolean): DiagramDocument {
  return updateStep(document, stepId, (step) => {
    if (step.source?.kind !== 'references-step' || step.picture?.kind !== 'step-diagram') return step;
    if (step.picture.mirrored === mirrored) return step;
    const turned: DiagramStep = {
      ...step,
      picture: { ...step.picture, mirrored, key: stepDiagramKey(step.picture.key, mirrored) },
      revision: step.revision + 1,
    };
    return withCarriedAnnotations(step, turned, document.assets);
  });
}

/**
 * Fold a References step's card another way (D23): its picture becomes the
 * card drawn under that way — on the side the step shows — and the step
 * records the way and the card's sentence under it. Its instruction follows
 * only while it is still the old card's own words, as Replace's does. The
 * annotations stay where they were on a picture that changed (D8).
 */
export function setReferencesWay(
  document: DiagramDocument,
  stepId: string,
  way: { signature: string; picture: DiagramStepDiagramPicture; sentence: string }
): DiagramDocument {
  return updateStep(document, stepId, (step) => {
    if (step.source?.kind !== 'references-step' || step.picture?.kind !== 'step-diagram') return step;
    if (step.source.way === way.signature && step.picture.key === way.picture.key) return step;
    const sentence = xmlText(way.sentence);
    const own = step.source.sentence;
    const chosen: DiagramStep = {
      ...step,
      source: { ...step.source, way: way.signature, sentence },
      picture: way.picture,
      text: own !== undefined && step.text === own ? sentence : step.text,
      revision: step.revision + 1,
    };
    return withCarriedAnnotations(step, chosen, document.assets);
  });
}

/** An upload's pose: how its shared asset is turned and flipped when the step is painted. */
export interface UploadPose {
  rotationQuarterTurns: QuarterTurns;
  mirrored: boolean;
}

/** The pose turned a quarter clockwise (1) or anticlockwise (-1), as it is shown. */
export function rotatePose(pose: UploadPose, quarterTurns: 1 | -1): UploadPose {
  const turns = (((pose.rotationQuarterTurns + quarterTurns) % 4) + 4) % 4;
  return { ...pose, rotationQuarterTurns: turns as QuarterTurns };
}

/**
 * The pose flipped left to right, as it is shown. The stored pose mirrors
 * first and turns after, so a flip of a turned picture also reverses its turn.
 */
export function mirrorPose(pose: UploadPose): UploadPose {
  return {
    rotationQuarterTurns: ((4 - pose.rotationQuarterTurns) % 4) as QuarterTurns,
    mirrored: !pose.mirrored,
  };
}

/**
 * Why a step's picture cannot be posed, or `null` when it can: it must be an
 * upload, and carry no annotation this build cannot read. A pose change carries
 * annotations with the picture (D8), and one that cannot be read cannot be
 * carried — it would be left pointing at the old pose.
 */
export function poseBlocker(step: DiagramStep): 'not-upload' | 'unknown-annotations' | null {
  if (isLockedStep(step) || step.source?.kind !== 'upload') return 'not-upload';
  const carried = step.annotations.some((annotation) => annotation.unknown !== undefined);
  if (carried) return 'unknown-annotations';
  return null;
}

/** Set an upload's pose, its annotations turned with it (D8). A no-op for a step {@link poseBlocker} refuses. */
export function setUploadPose(
  document: DiagramDocument,
  stepId: string,
  pose: UploadPose
): DiagramDocument {
  return updateStep(document, stepId, (step) => {
    if (poseBlocker(step) !== null || step.source?.kind !== 'upload') return step;
    const { rotationQuarterTurns, mirrored } = step.source;
    if (rotationQuarterTurns === pose.rotationQuarterTurns && mirrored === pose.mirrored) return step;
    const posed: DiagramStep = {
      ...step,
      source: { ...step.source, rotationQuarterTurns: pose.rotationQuarterTurns, mirrored: pose.mirrored },
      revision: step.revision + 1,
    };
    return withCarriedAnnotations(step, posed, document.assets);
  });
}

/**
 * A step's annotations edited: `edit` gets the readable ones and returns them
 * as they should be; one this build cannot read keeps its place. Touching
 * them marks them drawn on the picture the step has now (D8: "until they are
 * touched"). A step with no picture takes none.
 */
export function editStepAnnotations(
  document: DiagramDocument,
  stepId: string,
  edit: (annotations: readonly KnownDiagramAnnotation[]) => readonly KnownDiagramAnnotation[]
): DiagramDocument {
  return updateStep(document, stepId, (step) => {
    if (step.picture === null) return step;
    const known = step.annotations.filter(isKnownAnnotation);
    // As this build writes them, whoever made them: within the step's reach, a label's text clean.
    const edited = withAnnotationReach(stepReach(step), () => edit(known).map(cleanAnnotation));
    if (sameAnnotations(edited, known)) return step;
    // A step holds no more than a file keeps.
    if (edited.length + (step.annotations.length - known.length) > MAX_STEP_ANNOTATIONS) return step;
    return { ...step, annotations: mergeAnnotations(step.annotations, edited), annotatedPictureKey: step.picture.key };
  });
}

/**
 * A step's annotations kept where they are on the picture it has now: what
 * the "picture changed" notice offers when they are right as they stand. A
 * no-op when they are already in step with it.
 */
export function keepStepAnnotations(document: DiagramDocument, stepId: string): DiagramDocument {
  return updateStep(document, stepId, (step) =>
    step.picture === null || step.annotations.length === 0 || step.annotatedPictureKey === step.picture.key
      ? step
      : { ...step, annotatedPictureKey: step.picture.key }
  );
}

/** Whether a step's annotations were drawn on a picture other than the one it has (D8). */
export function annotationsOutOfStep(step: DiagramStep): boolean {
  return step.annotations.length > 0 && step.annotatedPictureKey !== (step.picture?.key ?? null);
}

/**
 * The step's annotations with the readable ones replaced by `edited`: each one
 * kept in its place, one taken out gone, a new one last — so one this build
 * cannot read keeps its place among them, and a newer build draws them in the
 * order it did.
 */
function mergeAnnotations(
  annotations: readonly DiagramAnnotation[],
  edited: readonly KnownDiagramAnnotation[]
): DiagramAnnotation[] {
  if (annotations.every(isKnownAnnotation)) return [...edited];
  const byId = new Map(edited.map((annotation) => [annotation.id, annotation]));
  const merged: DiagramAnnotation[] = [];
  for (const annotation of annotations) {
    if (!isKnownAnnotation(annotation)) merged.push(annotation);
    else if (byId.has(annotation.id)) {
      merged.push(byId.get(annotation.id)!);
      byId.delete(annotation.id);
    }
  }
  return [...merged, ...byId.values()];
}

/**
 * Whether two lists say the same, field for field: a control pressed on the
 * value it already shows builds a new annotation, and must not cost an undo step.
 */
function sameAnnotations(a: readonly KnownDiagramAnnotation[], b: readonly KnownDiagramAnnotation[]): boolean {
  return (
    a.length === b.length &&
    a.every((annotation, index) => annotation === b[index] || JSON.stringify(annotation) === JSON.stringify(b[index]))
  );
}

/** Take a step's picture away, and its source with it. Its words and annotations stay. */
export function removeStepPicture(document: DiagramDocument, stepId: string): DiagramDocument {
  return updateStep(document, stepId, (step) =>
    stepHasPicture(step)
      ? { ...step, source: null, picture: null, revision: step.revision + 1 }
      : step
  );
}

/** The asset a step's picture is drawn from, when it is one this build can draw. */
export function stepAsset(document: DiagramDocument, step: DiagramStep): KnownDiagramAsset | null {
  if (isLockedStep(step) || step.picture?.kind !== 'asset') return null;
  const asset = document.assets[step.picture.assetId];
  return asset && isKnownAsset(asset) ? asset : null;
}

/**
 * The document as a file holds it: only the assets something still refers to.
 *
 * The store prunes as every edit lands, since each undo snapshot keeps its own
 * table, and the writer prunes again for a document from anywhere else (one
 * read from a hand-edited file). Three things keep an asset: a step's source or picture naming it; its id anywhere in a
 * newer build's step, annotation or asset, which this build cannot read but must not break; and
 * being of a kind this build does not know, since only that newer build knows
 * what refers to it. The same document comes back when nothing is dropped.
 */
export function withReferencedAssets(document: DiagramDocument): DiagramDocument {
  const kept = new Set<string>();
  const carried: string[] = [];
  for (const step of stepsOf(document)) {
    if (step.unknown) {
      carried.push(JSON.stringify(step.unknown));
      continue;
    }
    if (step.source?.kind === 'upload') kept.add(step.source.assetId);
    if (step.picture?.kind === 'asset') kept.add(step.picture.assetId);
    // A newer build's annotation may name an asset, as its step may.
    for (const annotation of step.annotations) {
      if (!isKnownAnnotation(annotation)) carried.push(JSON.stringify(annotation.unknown));
    }
  }
  for (const asset of Object.values(document.assets)) {
    if (!isKnownAsset(asset)) carried.push(JSON.stringify(asset.unknown));
  }
  const unknownSteps = carried.join('\n');
  let dropped = false;
  const assets: Record<string, DiagramAsset> = {};
  for (const [id, asset] of Object.entries(document.assets)) {
    if (kept.has(id) || !isKnownAsset(asset) || unknownSteps.includes(id)) assets[id] = asset;
    else dropped = true;
  }
  return dropped ? { ...document, assets } : document;
}

export function setStepText(document: DiagramDocument, stepId: string, text: string): DiagramDocument {
  const clean = xmlText(text);
  return updateStep(document, stepId, (step) =>
    step.text === clean ? step : { ...step, text: clean }
  );
}

export function setStepBreakBefore(
  document: DiagramDocument,
  stepId: string,
  breakBefore: boolean
): DiagramDocument {
  return updateStep(document, stepId, (step) =>
    step.breakBefore === breakBefore ? step : { ...step, breakBefore }
  );
}

export function setDiagramTitle(document: DiagramDocument, title: string): DiagramDocument {
  const clean = xmlText(title);
  return document.title === clean ? document : { ...document, title: clean };
}

export function setHanStyle(document: DiagramDocument, hanStyle: DiagramHanStyle): DiagramDocument {
  return document.hanStyle === hanStyle ? document : { ...document, hanStyle };
}

export function setDiagramStyle(document: DiagramDocument, style: DiagramStyle): DiagramDocument {
  return diagramStyleEquals(document.style, style) ? document : { ...document, style };
}

/** Apply a partial page setup, clamped to the legal ranges. */
export function setPageSetup(
  document: DiagramDocument,
  patch: Partial<DiagramPageSetup>
): DiagramDocument {
  const next = normalizePageSetup({ ...document.page, ...patch });
  return pageSetupEquals(document.page, next) ? document : { ...document, page: next };
}

/**
 * Whether a step can become a turn in its place (D24): one with no picture and
 * no link — the empty card that offers it — made by this build.
 */
export function canBecomeTurn(entry: DiagramEntry): entry is DiagramStep {
  return isStep(entry) && !isLockedStep(entry) && entry.source === null && entry.picture === null;
}

/**
 * An empty step made a turn in its place (D24). A turn has no words and no
 * marks, so the step's go with it; a new page it started starts at the step
 * after it instead, where the turn now leads. Null for a step that is not
 * empty (`canBecomeTurn`), a turn, or an id the diagram does not have.
 */
export function stepToTurn(
  document: DiagramDocument,
  stepId: string,
  kind: DiagramTurnKind,
  newId: DiagramIdFactory = randomDiagramId
): { document: DiagramDocument; turnId: string } | null {
  const index = stepIndex(document, stepId);
  const entry = document.steps[index];
  if (!entry || !canBecomeTurn(entry)) return null;
  const turn = createTurn(kind, newId);
  const steps = document.steps.slice();
  steps[index] = turn;
  if (entry.breakBefore) {
    const next = steps.findIndex((candidate, at) => at > index && isStep(candidate));
    const following = steps[next];
    if (following && isStep(following) && !isLockedStep(following)) steps[next] = { ...following, breakBefore: true };
  }
  return { document: { ...document, steps }, turnId: turn.id };
}

/**
 * Set what a turn is (D22): which axis it turns over, or how far and which way
 * it rotates. What it is already is no change; a newer build's turn is never
 * changed.
 */
export function setTurn(document: DiagramDocument, turnId: string, kind: DiagramTurnKind): DiagramDocument {
  const index = stepIndex(document, turnId);
  const turn = document.steps[index];
  if (!turn || !isTurn(turn) || isLockedTurn(turn) || sameTurn(turn, kind)) return document;
  const steps = document.steps.slice();
  steps[index] = createTurn(kind, () => turn.id);
  return { ...document, steps };
}

/** Whether two turns turn the model the same way, field by field. */
function sameTurn(a: DiagramTurnKind, b: DiagramTurnKind): boolean {
  if (a.kind === 'turn-over') return b.kind === 'turn-over' && a.axis === b.axis;
  return b.kind === 'rotate' && a.rotate.amount === b.rotate.amount && a.rotate.direction === b.rotate.direction;
}

/** Edit one step; a turn, an unknown id or a newer build's step is left as it is. */
function updateStep(
  document: DiagramDocument,
  stepId: string,
  edit: (step: DiagramStep) => DiagramStep
): DiagramDocument {
  const index = stepIndex(document, stepId);
  if (index < 0) return document;
  const step = document.steps[index];
  if (isTurn(step) || isLockedStep(step)) return document;
  const next = edit(step);
  if (next === step) return document;
  const steps = document.steps.slice();
  steps[index] = next;
  return { ...document, steps };
}

export const PAPER_SIZES: readonly DiagramPaperSize[] = ['a4', 'a5', 'b5-jis', 'letter'];

/**
 * The layout of a page setup that does not say: the grid, which every diagram
 * was in until the flow became a new one's (2026-10-06). Every file written
 * says its layout, so this reads a hand-edited or damaged one as it would have
 * read before — never a saved grid as a flow — and a new diagram says `flow`.
 */
export const UNSAID_PAGE_LAYOUT: DiagramPageLayout = 'grid';

/**
 * A page setup from anything, every field checked and clamped, each falling
 * back to its default on its own. Used by the edit above and by the file
 * reader, so a hand-edited file and a stepper reach the same legal values.
 */
export function normalizePageSetup(value: unknown): DiagramPageSetup {
  const source = isRecord(value) ? value : {};
  const numbers = isRecord(source.pageNumbers) ? source.pageNumbers : {};
  return {
    size: PAPER_SIZES.includes(source.size as DiagramPaperSize)
      ? (source.size as DiagramPaperSize)
      : DEFAULT_PAGE_SETUP.size,
    orientation:
      source.orientation === 'landscape' || source.orientation === 'portrait'
        ? source.orientation
        : DEFAULT_PAGE_SETUP.orientation,
    marginMm: clampNumber(source.marginMm, PAGE_MARGIN_MM_RANGE, DEFAULT_PAGE_SETUP.marginMm),
    layout: source.layout === 'flow' || source.layout === 'grid' ? source.layout : UNSAID_PAGE_LAYOUT,
    columns: clampWhole(source.columns, PAGE_COLUMNS_RANGE, DEFAULT_PAGE_SETUP.columns),
    rows: clampWhole(source.rows, PAGE_ROWS_RANGE, DEFAULT_PAGE_SETUP.rows),
    showPath: typeof source.showPath === 'boolean' ? source.showPath : DEFAULT_PAGE_SETUP.showPath,
    // Unsaid, or damaged: in proportion to the steps, as before there was a choice.
    pathWidthMm:
      typeof source.pathWidthMm === 'number' && Number.isFinite(source.pathWidthMm)
        ? clampNumber(source.pathWidthMm, PATH_WIDTH_MM_RANGE, PATH_WIDTH_MM_RANGE.min)
        : null,
    pathColor: readHexColor(source.pathColor) ?? DEFAULT_PATH_COLOR,
    // Unsaid, as in every file before there was a choice: the left.
    firstPageSide: source.firstPageSide === 'right' ? 'right' : DEFAULT_PAGE_SETUP.firstPageSide,
    showTitle:
      typeof source.showTitle === 'boolean' ? source.showTitle : DEFAULT_PAGE_SETUP.showTitle,
    pageNumbers: {
      enabled:
        typeof numbers.enabled === 'boolean'
          ? numbers.enabled
          : DEFAULT_PAGE_SETUP.pageNumbers.enabled,
      first: clampWhole(numbers.first, FIRST_PAGE_NUMBER_RANGE, DEFAULT_PAGE_SETUP.pageNumbers.first),
    },
  };
}

export function pageSetupEquals(a: DiagramPageSetup, b: DiagramPageSetup): boolean {
  return (
    a.size === b.size &&
    a.orientation === b.orientation &&
    a.marginMm === b.marginMm &&
    a.layout === b.layout &&
    a.columns === b.columns &&
    a.rows === b.rows &&
    a.showPath === b.showPath &&
    a.pathWidthMm === b.pathWidthMm &&
    a.pathColor === b.pathColor &&
    a.firstPageSide === b.firstPageSide &&
    a.showTitle === b.showTitle &&
    a.pageNumbers.enabled === b.pageNumbers.enabled &&
    a.pageNumbers.first === b.pageNumbers.first
  );
}

/** A colour as `#rrggbb`, lower case; null for anything else. */
export function readHexColor(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}

function diagramStyleEquals(a: DiagramStyle, b: DiagramStyle): boolean {
  if ('preset' in a || 'preset' in b) {
    return 'preset' in a && 'preset' in b && a.preset === b.preset;
  }
  return JSON.stringify(a.style) === JSON.stringify(b.style);
}

function clampNumber(
  value: unknown,
  range: { min: number; max: number },
  fallback: number
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(range.max, Math.max(range.min, value));
}

function clampWhole(value: unknown, range: { min: number; max: number }, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return clampInteger(Math.round(value), range.min, range.max);
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
