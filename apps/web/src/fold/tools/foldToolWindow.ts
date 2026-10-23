import { pleatToolWindow } from './pleat/pleatToolWindow';
/**
 * The Fold tool window (plan D14), as a plain descriptor its one renderer
 * draws (`components/fold/FoldToolWindow`) — Simulate's `tools/actions.ts` →
 * `SimulatorToolWindow` shape.
 *
 * A fold tool's window has two phases:
 *
 * - **locate**: the line is being located. Numbered steps for the line mode,
 *   the one in hand marked, what snaps, and the line-mode select.
 * - **preview**: the line is located and the engine has said what it would
 *   move. The V / M / P control, Swap for the moving side, the layers at the
 *   line (the cross-section picker and the flap chips), a refusal with its
 *   fixes, and Cancel / commit.
 *
 * The Precrease tool adds its extent control in both phases — the whole line,
 * a segment or a pinch — and a segment's or a pinch's clicks along the line
 * to its steps (`tools/precrease/precreaseToolWindow`).
 *
 * The Divide line's window says how to use it. Rotate's previews from the
 * start: its amount, exact angle and direction (`tools/rotate/rotateToolWindow`).
 * So do the sequence tools': Unfold to step's step to return to
 * (`fold/return/unfoldToolWindow`), Repeat's range, axis and how it is added
 * (`fold/repeat/repeatToolWindow`).
 *
 * React-free and store-free: it takes a view and bound verbs and returns data.
 */
import type { TFunction } from 'i18next';
import {
  evaluateOrieditaRatioExpression,
  formatOrieditaRatioHalf,
  formatOrieditaRatioNumber,
  parseOrieditaRatioHalfInput,
  ratioExpressionFromHalves,
  ratioHalvesFromExpression,
} from '../../lib/oristudioCpToolSettings';
import { FOLD_MARK_MAX_PARTS } from '../document/foldSequenceDocument';
import type { FoldCrossSection } from '../engine/foldEngineWire';
import {
  foldFlapChips,
  foldLayersSummary,
  foldSectionPicker,
  isWoven,
  type FoldFlapChip,
  type FoldSectionPickerModel,
} from './crossSection';
import {
  FOLD_KINDS,
  FOLD_LINE_MODES,
  foldToolLabel,
  isFoldKind,
  isFoldLineMode,
  isSinkTool,
  isVertexTool,
  usesLineMode,
  lineModeLabel,
  lineModeSteps,
  type FoldKind,
  type FoldKeyLabel,
  type FoldLineModeId,
  type FoldSecondLineModeId,
  type FoldShortcutId,
} from './foldToolCatalog';
import type { FoldDirection } from '../document/foldSequenceDocument';
import type { FoldReverseKind } from '../engine/foldEngineReverseWire';
import { crimpToolWindow } from './crimp/crimpToolWindow';
import type { FoldRailVerbs, FoldToolsView } from './foldRailGroups';
import type { FoldDivideSettings } from './foldToolState';
import type { FoldExtentMode } from './precrease/precreaseExtent';
import {
  extentCommitLabel,
  extentControl,
  extentKeyNote,
  extentLocateSteps,
  extentNotes,
  extentPreviewItems,
  type FoldExtentWindowView,
} from './precrease/precreaseToolWindow';
import {
  reverseToolWindow,
  type FoldKindChoice,
  type FoldReverseControls,
  type FoldReversePreference,
  type FoldReverseWindowView,
} from './reverse/reverseToolWindow';
import { sinkToolWindow, type FoldSinkControls, type FoldSinkWindowView } from './sink/sinkToolWindow';
import { rotateToolWindow, type FoldRotateControls, type FoldRotateWindowView } from './rotate/rotateToolWindow';
import {
  repeatToolWindow,
  type FoldRepeatControls,
  type FoldRepeatWindowVerbs,
  type FoldRepeatWindowView,
} from '../repeat/repeatToolWindow';
import { unfoldToolWindow, type FoldUnfoldWindowVerbs, type FoldUnfoldWindowView } from '../return/unfoldToolWindow';
import type { TurnRotation } from '../../lib/steps/turn';
import { tuckToolWindow, type FoldTuckControls, type FoldTuckWindowView } from './tuck/tuckToolWindow';
import {
  vertexToolWindow,
  type FoldVertexControls,
  type FoldVertexWindowVerbs,
  type FoldVertexWindowView,
} from './vertex/vertexToolWindow';
import {
  foldRefusalNotice,
  neededFlaps,
  sectionFlapNames,
  type FoldFixVerbs,
  type FoldRefused,
  type FoldRefusalNoticeModel,
} from './refusalNotice';

/** A located line under preview: what the engine said about it, tier by tier (D14 Interaction cost). */
export interface FoldPreview {
  /** Tier 2: the section at the line, with its flaps; null while the worker computes it. */
  section: FoldCrossSection | null;
  /** For a woven section, the interval under the pointer; null for the first. */
  interval: number | null;
  /**
   * What the seed asks for: every flap on the moving side, or these (indices
   * into the section's flaps) — by default the top flap alone.
   */
  seed: 'all' | readonly number[];
  /** Tier 3: the flaps the fold moved beyond the seed (`FoldAnalysis.added`), once it has landed. */
  added: readonly number[];
  /** Why it does not land; null while it does, or has not been asked. */
  refused: FoldRefused | null;
  /** Refused as its point staying put, and a point at the same spot on paper that folds lands it: the refusal offers it. */
  movingPoint?: boolean;
  /**
   * A reverse fold refused for its tip, and only the flaps its drawn line
   * crosses land it: those flaps (indices into the section's flaps), which
   * the refusal offers.
   */
  narrowerSeed?: readonly number[];
  /** Tier 3 is in flight: nothing to commit yet. */
  landing: boolean;
  /**
   * The layers and the refusal shown are the last seed's, standing in while
   * this one's are on their way (`foldShownPreview`): the window keeps its
   * height, and says they are not yet this fold's by dimming them.
   */
  held?: boolean;
  /** A free line drawn on the crease pattern across layers the folded form puts apart (`FoldBuiltStep.acrossLayers`). */
  acrossLayers?: boolean;
  /** Enter was pressed while the preview was landing: the fold commits as soon as it has. */
  queued?: boolean;
  /** The ways its layers can stack are still being searched for; Escape stops the search with the tool. */
  searching?: boolean;
  /** A precrease of part of its line whose points along it are still to be clicked: nothing to commit yet. */
  incomplete?: boolean;
}

export interface FoldToolWindowView extends FoldToolsView {
  freeLineSnap?: boolean;
  /** How many of the line mode's references are picked. */
  picks: number;
  /** The located line, or null while it is being located. */
  preview: FoldPreview | null;
  /**
   * The Divide line's settings, and how many marks the step on screen holds
   * (what Clear marks clears); absent where the surface offers none.
   */
  divide?: { settings: FoldDivideSettings; marks: number };
  /** The reverse tool's kind and choices, while it previews (`tools/reverse/reverseToolWindow`). */
  reverse?: FoldReverseWindowView;
  // The crimp's and the tuck's (`tools/crimp/crimpToolWindow`, `tools/tuck/tuckToolWindow`).
  /** How a crimp's second line is located; absent for every other tool. */
  secondLineMode?: FoldSecondLineModeId;
  /** The crimp tool's kind and choices, while it previews: a reverse fold's, on both lines. */
  crimp?: FoldReverseWindowView;
  /** The tuck tool's direction, and its targets and orders while it previews. */
  tuck?: FoldTuckWindowView;
  /** A vertex tool's direction and choices (`tools/vertex/vertexToolWindow`). */
  vertex?: FoldVertexWindowView;
  /** A sink tool's point and choices, while it previews (`tools/sink/sinkToolWindow`). */
  sink?: FoldSinkWindowView;
  /** The Precrease tool's extent and its points along the line (`tools/precrease`); absent for every other tool. */
  extent?: FoldExtentWindowView;
  /** The Rotate tool's rotation (`tools/rotate`); absent where the surface offers none. */
  rotate?: FoldRotateWindowView;
  // The sequence tools' (`fold/return`, `fold/repeat`); absent where the surface offers none.
  /** Unfold to step's targets and the one taken. */
  unfold?: FoldUnfoldWindowView;
  /** Repeat's range, axes and where its preparation stands. */
  repeat?: FoldRepeatWindowView;
}

/** What the window can promise on this device. */
export interface FoldToolHost {
  /** A finger: no keys to hold or press, so none are offered. */
  coarse: boolean;
  /** The platform's name for Alt: Option or Alt (`altModifierLabel`). */
  alt: string;
  /** The label of a Fold key, for a note that names one; without it none is named. */
  keyLabel?: FoldKeyLabel;
}

/** The window's calls; the store binds them. */
export interface FoldToolWindowVerbs
  extends Pick<FoldRailVerbs, 'selectTool' | 'selectLineMode'>,
    FoldFixVerbs,
    FoldVertexWindowVerbs {
  setFreeLineSnap?: (enabled: boolean) => void;
  swapSide: () => void;
  /** Pick or unpick a flap (an index into the section's flaps). */
  toggleFlap: (flap: number) => void;
  /** The flap under the pointer in the picker or the chips, for the canvas to light; null when none. */
  hoverFlap?: (flap: number | null) => void;
  cancel: () => void;
  commit: () => void;
  /** Change how the next Divide-line mark divides its segment. */
  setDivide?: (divide: Partial<FoldDivideSettings>) => void;
  /** Clear the marks made on the step on screen: one undo entry. */
  clearMarks?: () => void;
  /** Explicit first-line edits in a two-line tool do not follow the active lane. */
  selectLineMode: (id: FoldLineModeId, line?: 'first') => void;
  // A compound fold's choices (`tools/reverse/reverseToolWindow`).
  setReverseKind?: (kind: FoldReverseKind | null) => void;
  /** Step through the ways the tip opens, or the layer orders listed. */
  stepOpening?: (delta: number) => void;
  stepOrder?: (delta: number) => void;
  // The crimp's and the tuck's.
  setSecondLineMode?: (mode: FoldSecondLineModeId) => void;
  setTuckDirection?: (direction: FoldDirection) => void;
  /** Step through the layers listed to tuck against. */
  stepTuckTarget?: (delta: number) => void;
  toggleTuckPinned?: (face: number) => void;
  /** Step through a closed sink's pockets (`tools/sink/sinkToolWindow`). */
  stepPocket?: (delta: number) => void;
  /** How much of its line a precrease creases (`tools/precrease`). */
  setExtent?: (mode: FoldExtentMode) => void;
  /** How far and which way Rotate turns the model (`tools/rotate`). */
  setRotation?: (rotation: TurnRotation) => void;
  // The sequence tools'.
  unfold?: FoldUnfoldWindowVerbs;
  repeat?: FoldRepeatWindowVerbs;
}

/** The Divide line's controls: count or exact ratio (Edit's ratio expression), and clearing what is made. */
export interface FoldDivideControls {
  mode: {
    label: string;
    value: FoldDivideSettings['mode'];
    options: readonly { id: FoldDivideSettings['mode']; label: string }[];
    set: (mode: FoldDivideSettings['mode']) => void;
  };
  /** The equal parts, in count mode; null in ratio mode. */
  parts: { label: string; value: number; min: number; max: number; set: (parts: number) => void } | null;
  /** The two halves of the ratio, as Edit's ratio fields spell them, in ratio mode; null in count mode. */
  ratio: {
    left: { label: string; value: string; set: (value: string) => boolean };
    right: { label: string; value: string; set: (value: string) => boolean };
    /** "Computed ratio 1 : 1.414". */
    readout: string;
  } | null;
  clear: { label: string; disabled: boolean; run: () => void };
  disabled: boolean;
}

export interface FoldToolInstructions {
  heading: string;
  /**
   * What the fold does and what it needs first, above the steps: the words a
   * first-time folder reads before the first click (a compound fold's).
   */
  intro?: string | null;
  items: readonly string[];
  /** The step in hand; past the last, every step is done. */
  current: number;
  /** What snaps, and the keys that change it: a line each, under the steps. */
  notes: readonly string[];
}

export interface FoldLineModeSelect {
  label: string;
  value: FoldLineModeId;
  options: readonly { id: FoldLineModeId; label: string }[];
  disabled: boolean;
  set: (id: string) => void;
}

export interface FoldKindControl {
  label: string;
  /** Null while the tool in hand is no plain fold. */
  value: FoldKind | null;
  options: readonly { value: FoldKind; label: string }[];
  disabled: boolean;
  set: (kind: FoldKind) => void;
}

export interface FoldMovingSideControl {
  label: string;
  swapLabel: string;
  shortcut: FoldShortcutId;
  disabled: boolean;
  swap: () => void;
}

export interface FoldLayersSection {
  title: string;
  /** "2 of 4 layers moving"; null until the section is known. */
  summary: string | null;
  /** Null while the worker computes the section: `finding` says so. */
  picker: FoldSectionPickerModel | null;
  finding: string | null;
  /** How the picker works, under it. */
  help: string;
  chips: readonly FoldFlapChip[];
  disabled: boolean;
  toggle: (flap: number) => void;
  hover: (flap: number | null) => void;
}

export interface FoldWindowButton {
  label: string;
  shortcut: FoldShortcutId;
  disabled: boolean;
  run: () => void;
}

/**
 * A step of the path to choose, by its key: Unfold to step's step to return
 * to, Repeat's first step. Only the steps the tool can take are offered.
 */
export interface FoldStepChoice {
  label: string;
  value: string | null;
  options: readonly { id: string; label: string }[];
  disabled: boolean;
  set: (id: string) => void;
}

/**
 * Why the tool in hand cannot do what it was asked, in the window's dock: an
 * engine refusal with its fixes (`refusalNotice`), or a sequence tool's own
 * (`repeat_axis_drawn`, `return_source_changed`, …), under a code of its own.
 */
export type FoldWindowNotice = Omit<FoldRefusalNoticeModel, 'code'> & { code: string };

export interface FoldToolWindowModel {
  freeLineSnap?: { label: string; help: string; checked: boolean; disabled: boolean; set: (enabled: boolean) => void };
  reversePreference?: FoldKindChoice<FoldReversePreference>;
  phase: 'locate' | 'preview' | 'divide';
  title: string;
  meta: string;
  instructions: FoldToolInstructions;
  lineMode: FoldLineModeSelect | null;
  kind: FoldKindControl | null;
  movingSide: FoldMovingSideControl | null;
  layers: FoldLayersSection | null;
  refusal: FoldWindowNotice | null;
  /** The Divide line's settings; null for every other tool, or where the surface offers none. */
  divide: FoldDivideControls | null;
  /**
   * A compound fold's kind and choices (`tools/reverse/reverseToolWindow`): a
   * reverse fold's, or a crimp's; absent for every other tool.
   */
  compound?: FoldReverseControls;
  /** How a crimp's second line is located, while its lines are; absent for every other tool. */
  secondLine?: FoldSecondLineSelect | null;
  /** A tuck's target and order (`tools/tuck/tuckToolWindow`); absent for every other tool. */
  tuck?: FoldTuckControls | null;
  /** A vertex fold's direction and choices (`tools/vertex/vertexToolWindow`); absent for every other tool. */
  vertex?: FoldVertexControls;
  /** A sink's kind, line, depth and choices (`tools/sink/sinkToolWindow`); absent for every other tool. */
  sink?: FoldSinkControls;
  /** How much of its line a precrease creases (`tools/precrease`); absent for every other tool. */
  extent?: FoldKindChoice<FoldExtentMode> | null;
  /** Rotate's amount, exact angle and direction (`tools/rotate`); absent for every other tool. */
  rotate?: FoldRotateControls;
  /** The step a sequence tool acts toward: Unfold to step's target, Repeat's first step. */
  steps?: FoldStepChoice | null;
  /** Repeat's axis, how it is saved, and a layer order to choose (`fold/repeat`); absent for every other tool. */
  repeat?: FoldRepeatControls;
  footer: { cancel: FoldWindowButton; commit: FoldWindowButton } | null;
  /** The layers and the refusal are the last seed's, until this one's are in (`FoldPreview.held`). */
  held?: boolean;
}

/** A crimp's second line mode: a free line or an existing crease. */
export interface FoldSecondLineSelect {
  label: string;
  value: FoldSecondLineModeId;
  options: readonly { id: FoldSecondLineModeId; label: string }[];
  disabled: boolean;
  set: (id: string) => void;
}

function divideControls(
  t: TFunction,
  divide: NonNullable<FoldToolWindowView['divide']>,
  verbs: FoldToolWindowVerbs,
  readOnly: boolean
): FoldDivideControls | null {
  const { setDivide, clearMarks } = verbs;
  if (!setDivide || !clearMarks) return null;
  const { settings } = divide;
  const halves = ratioHalvesFromExpression(settings.ratio);
  const computed = evaluateOrieditaRatioExpression(settings.ratio);
  const half = (side: 'left' | 'right') => (value: string) => {
    const parsed = parseOrieditaRatioHalfInput(value);
    if (!parsed) return false;
    setDivide({
      ratio: ratioExpressionFromHalves(side === 'left' ? parsed : halves.left, side === 'right' ? parsed : halves.right),
    });
    return true;
  };
  return {
    mode: {
      label: t('tools:fold.divide.mode', 'Divide'),
      value: settings.mode,
      options: [
        { id: 'count', label: t('tools:fold.divide.count', 'Equal parts') },
        { id: 'ratio', label: t('tools:fold.divide.ratio', 'Ratio') },
      ],
      set: (mode) => setDivide({ mode }),
    },
    parts:
      settings.mode === 'count'
        ? {
            label: t('tools:fold.divide.parts', 'Parts'),
            value: settings.parts,
            min: 2,
            max: FOLD_MARK_MAX_PARTS,
            set: (parts) => setDivide({ parts }),
          }
        : null,
    ratio:
      settings.mode === 'ratio'
        ? {
            left: { label: t('tools:fold.divide.left', 'From the start'), value: formatOrieditaRatioHalf(halves.left), set: half('left') },
            right: { label: t('tools:fold.divide.right', 'To the end'), value: formatOrieditaRatioHalf(halves.right), set: half('right') },
            readout: t('tools:fold.divide.computed', 'Computed ratio {{s}} : {{t}}', {
              s: formatOrieditaRatioNumber(computed.ratioS),
              t: formatOrieditaRatioNumber(computed.ratioT),
            }),
          }
        : null,
    clear: {
      label: t('tools:fold.divide.clear', {
        count: divide.marks,
        defaultValue_one: 'Clear the mark made here',
        defaultValue_other: 'Clear the {{count}} marks made here',
      }),
      disabled: readOnly || divide.marks === 0,
      run: clearMarks,
    },
    disabled: readOnly,
  };
}

export function settingsMeta(t: TFunction, count: number): string {
  if (count === 0) return t('tools:fold.window.instructions', 'Instructions');
  return t('tools:fold.window.settings', {
    count,
    defaultValue_one: '{{count}} setting',
    defaultValue_other: '{{count}} settings',
  });
}

/** What a drawn line's points snap to while Snap to points is on: the note, and the switch's help. */
function freeSnapNote(t: TFunction, coarse: boolean): string {
  return coarse
    ? t('tools:fold.note.freeSnapTouch', 'Snap to nearby point targets; otherwise use exactly where you tap.')
    : t('tools:fold.note.freeSnap', 'Snap to nearby point targets; otherwise use exactly where you click.');
}

/** What snaps under each line mode, and on a pointer with keys, the keys that change it. */
export function lineModeNotes(t: TFunction, mode: FoldLineModeId, host: FoldToolHost, snapFree = false): string[] {
  const clear = t('tools:fold.note.clear', 'Esc clears the picks.');
  if (mode === 'free') {
    if (snapFree) {
      if (host.coarse) return [freeSnapNote(t, true)];
      return [freeSnapNote(t, false),
        t('tools:fold.note.freePoint', 'Hold {{modifier}} to put a point down anywhere, without snapping.', { modifier: host.alt }), clear];
    }
    return host.coarse
      ? [t('tools:fold.note.freeTouch', 'No snapping: the line runs exactly through the points you tap.')]
      : [t('tools:fold.note.free', 'No snapping: the line runs exactly through the points you click.'), clear];
  }
  if (mode === 'crease') {
    return [t('tools:fold.note.crease', 'Folding along a precrease refolds it; along a folded edge, it unfolds the flap.')];
  }
  const snap = t('tools:fold.note.snap', 'Points snap to corners, marks, crease crossings, midpoints and edges.');
  if (host.coarse) return [snap];
  return [
    snap,
    t('tools:fold.note.freePoint', 'Hold {{modifier}} to put a point down anywhere, without snapping.', {
      modifier: host.alt,
    }),
    clear,
  ];
}

/**
 * How to locate the line, step by step, then pick and commit: `action` is
 * the tool's name, the commit button's. `then` is what the tool picks once
 * the line is in, said as its last step — a plain fold's fold and layers by
 * default.
 */
export function locateInstructions(
  t: TFunction,
  view: FoldToolWindowView,
  action: string,
  host: FoldToolHost,
  then?: string
): FoldToolInstructions {
  const finish =
    then ??
    (host.coarse
      ? t('tools:fold.steps.finishTouch', 'Pick the fold and the layers, then tap {{action}}.', { action })
      : t('tools:fold.steps.finish', 'Pick the fold and the layers, then press Enter.'));
  // A precrease of part of its line: its points along the line, once it is located.
  const extent = view.tool === 'precrease' ? view.extent : undefined;
  const items = [...lineModeSteps(t, view.lineMode, host.coarse), ...extentLocateSteps(t, extent, host.coarse), finish];
  return {
    heading: t('tools:fold.window.instructions', 'Instructions'),
    items,
    current: Math.min(Math.max(0, view.picks), items.length - 1),
    notes: [...lineModeNotes(t, view.lineMode, host, view.freeLineSnap), ...(extent ? extentKeyNote(t, host) : [])],
  };
}

function previewInstructions(
  t: TFunction,
  kind: FoldKind,
  host: FoldToolHost,
  preview: FoldPreview,
  extent: FoldExtentWindowView | undefined,
  action: string
): FoldToolInstructions {
  // A precrease of part of its line: its points along the line first.
  const along = extent ? extentPreviewItems(t, extent, host.coarse) : null;
  return {
    heading: t('tools:fold.window.instructions', 'Instructions'),
    items: [
      ...(along?.along ?? []),
      t('tools:fold.steps.pickLayers', 'Pick which layers move.'),
      host.coarse
        ? t('tools:fold.steps.commitTouch', 'Tap {{action}} to fold.', { action: along ? action : foldToolLabel(t, kind) })
        : t('tools:fold.steps.commit', 'Press Enter to fold.'),
    ],
    // Picking layers is optional: the top flap folds unless the folder picks
    // others, so the window leads with the pick and never marks it done.
    current: along ? (along.current ?? along.along.length) : 0,
    notes: [
      // What a click along the line snaps to, while one is in hand.
      ...(extent && along && along.current !== null ? extentNotes(t, extent, host) : []),
      ...(extent ? extentKeyNote(t, host) : []),
      ...(preview.acrossLayers
        ? [
            t(
              'tools:fold.note.acrossLayers',
              'These points lie on layers that are folded apart, so the line runs through them where they lie in the folded form. The crease pattern shows the creases it makes.'
            ),
          ]
        : []),
      ...queuedNote(t, preview),
    ],
  };
}

/**
 * Enter pressed before the preview landed — or before its step was built, a
 * reverse fold's tip still being asked about: said, so the press is not
 * taken for lost. A queued commit is only ever one still waiting.
 */
export function queuedNote(t: TFunction, preview: FoldPreview): string[] {
  return preview.queued && !preview.refused
    ? [t('tools:fold.note.queued', 'Folding as soon as the preview is ready…')]
    : [];
}

export function lineModeSelect(t: TFunction, view: FoldToolWindowView, verbs: FoldToolWindowVerbs): FoldLineModeSelect {
  return {
    label: t('tools:fold.window.lineMode', 'Locate line'),
    value: view.lineMode,
    options: FOLD_LINE_MODES.map((id) => ({ id, label: lineModeLabel(t, id) })),
    disabled: view.readOnly !== null,
    set: (id) => {
      if (isFoldLineMode(id)) verbs.selectLineMode(id);
    },
  };
}

export function layersSection(
  t: TFunction,
  preview: FoldPreview,
  verbs: FoldToolWindowVerbs,
  disabled: boolean,
  coarse = false
): FoldLayersSection {
  const { section } = preview;
  const seed = {
    picked: new Set(
      preview.seed === 'all' ? (section?.flaps.map((_, flap) => flap) ?? []) : preview.seed
    ),
    added: new Set(preview.added),
    needed: neededFlaps(preview.refused),
  };
  const picker = section ? foldSectionPicker(t, section, seed, { interval: preview.interval }) : null;
  const woven = section !== null && isWoven(section);
  const help = coarse
    ? woven
      ? t(
          'tools:fold.window.layersHelpWovenTouch',
          'These layers weave through each other, so the stack shown is the one where you last touched the line. Tap a layer to include or exclude its flap.'
        )
      : t(
          'tools:fold.window.layersHelpTouch',
          'Tap a layer to include or exclude its flap. Brackets show where a fold joins two layers.'
        )
    : woven
      ? t(
          'tools:fold.window.layersHelpWoven',
          'These layers weave through each other, so the stack shown is the one under the pointer. Click a layer to include or exclude its flap.'
        )
      : t(
          'tools:fold.window.layersHelp',
          'Click a layer to include or exclude its flap. Brackets show where a fold joins two layers.'
        );
  return {
    title: t('tools:fold.window.layers', 'Layers'),
    summary: picker ? foldLayersSummary(t, picker) : null,
    picker,
    finding: picker ? null : t('tools:fold.window.finding', 'Finding the layers at the line…'),
    help,
    chips: section ? foldFlapChips(t, section, seed) : [],
    disabled,
    toggle: (flap) => verbs.toggleFlap(flap),
    hover: (flap) => verbs.hoverFlap?.(flap),
  };
}

/**
 * The window for the tool in hand, or null when it has none: the planned
 * inside reverse fold, which the rail never hands over.
 */
export function foldToolWindow(
  t: TFunction,
  view: FoldToolWindowView,
  verbs: FoldToolWindowVerbs,
  host: FoldToolHost
): FoldToolWindowModel | null {
  const shown = toolWindow(t, view, verbs, host);
  const model = shown && view.preview?.held ? { ...shown, held: true } : shown;
  const construction = view.vertex
    ? { swivelInput: view.vertex.swivelInput, squashHinge: view.vertex.squashHinge, lineTaken: view.vertex.lineTaken }
    : {};
  const freeLine = (usesLineMode(view.tool, construction) && view.lineMode === 'free') ||
    ((view.tool === 'crimp' || view.tool === 'pleat') && (view.lineMode === 'free' || (view.secondLineMode ?? 'free') === 'free')) ||
    // Repeat's axis, drawn as a free line while one may be drawn.
    (view.tool === 'repeat' && view.repeat?.drawing === true && view.lineMode === 'free');
  if (!model || !freeLine || view.freeLineSnap === undefined || !verbs.setFreeLineSnap) return model;
  return { ...model, freeLineSnap: {
    label: t('tools:fold.window.snapFreeLine', 'Snap to points'),
    help: freeSnapNote(t, host.coarse),
    checked: view.freeLineSnap,
    disabled: view.readOnly !== null,
    set: verbs.setFreeLineSnap,
  } };
}

function toolWindow(
  t: TFunction,
  view: FoldToolWindowView,
  verbs: FoldToolWindowVerbs,
  host: FoldToolHost
): FoldToolWindowModel | null {
  const readOnly = view.readOnly !== null;
  if (view.tool === 'divide-line') {
    const divide = view.divide ? divideControls(t, view.divide, verbs, readOnly) : null;
    return {
      phase: 'divide',
      title: foldToolLabel(t, 'divide-line'),
      meta: settingsMeta(t, divide ? 1 : 0),
      instructions: {
        heading: t('tools:fold.window.instructions', 'Instructions'),
        items: [
          host.coarse
            ? t('tools:fold.steps.divideTouch', 'Tap an edge or crease to divide it.')
            : t('tools:fold.steps.divide', 'Click an edge or crease to divide it.'),
          t('tools:fold.steps.divideUse', 'Use the new points as references for any fold.'),
        ],
        current: 0,
        // What can be divided is the step's to say: no note says it again.
        notes: [],
      },
      lineMode: null,
      kind: null,
      movingSide: null,
      layers: null,
      refusal: null,
      divide,
      footer: null,
    };
  }
  if (view.tool === 'inside-reverse') return reverseToolWindow(t, view, verbs, host);
  if (view.tool === 'pleat') return pleatToolWindow(t, view, verbs, host);
  if (view.tool === 'crimp') return crimpToolWindow(t, view, verbs, host);
  if (view.tool === 'tuck') return tuckToolWindow(t, view, verbs, host);
  if (isVertexTool(view.tool)) return view.vertex ? vertexToolWindow(t, view, view.vertex, verbs, host) : null;
  if (isSinkTool(view.tool)) return sinkToolWindow(t, view, verbs, host);
  if (view.tool === 'rotate') return view.rotate ? rotateToolWindow(t, view, view.rotate, verbs, host) : null;
  if (view.tool === 'unfold-to') return view.unfold ? unfoldToolWindow(t, view, view.unfold, verbs, host) : null;
  if (view.tool === 'repeat') return view.repeat ? repeatToolWindow(t, view, view.repeat, verbs, host) : null;
  if (!isFoldKind(view.tool)) return null;
  const kind = view.tool;
  const title = foldToolLabel(t, kind);
  const { preview } = view;
  // A precrease's extent: the control in both phases, so a pinch can be
  // chosen before its line is located, and its points along the line after.
  const extentView = kind === 'precrease' ? view.extent : undefined;
  const extent = extentView ? extentControl(t, extentView, verbs.setExtent, readOnly, host.coarse) : null;
  const action = extentCommitLabel(t, extentView, title);

  if (!preview) {
    return {
      phase: 'locate',
      title,
      meta: settingsMeta(t, extent ? 2 : 1),
      instructions: locateInstructions(t, view, action, host),
      lineMode: lineModeSelect(t, view, verbs),
      kind: null,
      movingSide: null,
      layers: null,
      refusal: null,
      divide: null,
      ...(extent ? { extent } : {}),
      footer: null,
    };
  }

  return {
    phase: 'preview',
    title,
    meta: settingsMeta(t, extent ? 4 : 3),
    instructions: previewInstructions(t, kind, host, preview, extentView, action),
    lineMode: null,
    kind: {
      label: t('tools:fold.window.kind', 'Fold'),
      value: kind,
      options: FOLD_KINDS.map((value) => ({ value, label: foldToolLabel(t, value) })),
      disabled: readOnly,
      set: (next) => verbs.selectTool(next),
    },
    movingSide: {
      label: t('tools:fold.window.movingSide', 'Moving side'),
      swapLabel: t('tools:fold.window.swap', 'Swap'),
      shortcut: 'fold.swapSide',
      disabled: readOnly,
      swap: verbs.swapSide,
    },
    // A fold refused before its layers were found has none to show: the
    // refusal says why, and "finding the layers" would never end.
    layers: preview.section || !preview.refused ? layersSection(t, preview, verbs, readOnly, host.coarse) : null,
    refusal: preview.refused
      ? foldRefusalNotice(
          t,
          preview.refused,
          {
            kind,
            readOnly,
            ...sectionFlapNames(preview.section),
            ...(extentView ? { extent: { mode: extentView.mode, allLayers: preview.seed === 'all' } } : {}),
            ...(preview.movingPoint ? { movingPoint: true } : {}),
          },
          verbs
        )
      : null,
    divide: null,
    ...(extent ? { extent } : {}),
    footer: {
      cancel: {
        label: t('tools:fold.window.cancel', 'Cancel'),
        shortcut: 'viewport.cancel',
        disabled: false,
        run: verbs.cancel,
      },
      commit: {
        label: action,
        shortcut: 'fold.commit',
        disabled: readOnly || preview.landing || preview.refused !== null || preview.incomplete === true,
        run: verbs.commit,
      },
    },
  };
}
