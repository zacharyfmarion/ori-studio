/**
 * The sink tools' window (plan Phase 11, D14), as the plain descriptor the
 * one Fold window renderer draws (`components/fold/FoldToolWindow`).
 *
 * It locates the line as every fold does — the steps for the line mode and
 * the line-mode select, with what the line is to a sink: its depth, and for
 * an open sink, why it must be exactly square — and then, previewing:
 *
 * - **the kind**, Open or Closed, as a segmented control that switches
 *   between the two tools, while there is a choice: both fit, or the other
 *   fits where the one in hand does not — one whose preconditions fail
 *   shown, disabled, with which one in its tooltip (research §5.4: any tilt
 *   kills an open sink; a point with no pocket has no closed one). The open
 *   sink's square line is said while its line is located, and its fix is
 *   the refusal's;
 * - **the depth**: how far ℓ lies from the point's tip along its centre line;
 * - **the tip side**, Swap, and **the point**, through the layer picker and
 *   the chips — a sink takes one point; an unsink's is found for the folder;
 * - **the pocket**, when a closed sink's point has more than one, front or
 *   back as the viewer sees them, and **the layer order**, when the
 *   completion leaves more than one: a stepper each, the first listed taken
 *   until another is chosen (the canvas's chooser steps the same list);
 * - a refusal in the folder's words with the engine's fixes — the square
 *   line, the other sink, a point to pick — and Cancel and the fold.
 *
 * React-free and store-free.
 */
import type { TFunction } from 'i18next';
import { formatOrieditaRatioNumber } from '../../../lib/oristudioCpToolSettings';
import type { FoldSinkKind, FoldSinkRefusalCode } from '../../engine/foldEngineSinkWire';
import { foldSinkKindLabel, foldToolLabel, type FoldSinkToolId } from '../foldToolCatalog';
import {
  layersSection,
  lineModeSelect,
  locateInstructions,
  queuedNote,
  settingsMeta,
  type FoldToolHost,
  type FoldToolInstructions,
  type FoldToolWindowModel,
  type FoldToolWindowVerbs,
  type FoldToolWindowView,
} from '../foldToolWindow';
import { foldRefusalNotice, sectionFlapNames, sinkRefusalTitle } from '../refusalNotice';
import { choiceStepper, type FoldChoiceStepper, type FoldKindChoice } from '../reverse/reverseToolWindow';
import type { FoldPocketName } from './sinkStep';

/** What a sink tool's window is drawn from, beside every tool's view. */
export interface FoldSinkWindowView {
  tool: FoldSinkToolId;
  /** The engine has described the point — for an unsink, found the sunk points — so what fits is known. */
  known: boolean;
  /** Why an open sink of the point is refused before anything lands, by its code; null when none is. */
  openRefusal: FoldSinkRefusalCode | null;
  /** How many pockets a closed sink of the point can go into: none means no closed sink. */
  pocketsFound: number;
  /** How many pockets a closed sink chooses among (else 0), the one taken, and its name as the viewer sees it. */
  pockets: number;
  pocket: number;
  pocketName: FoldPocketName;
  /** How many layer orders the sink leaves, when it leaves several (else 0), and the one taken. */
  orders: number;
  order: number;
  /** How far ℓ lies from the point's tip along its centre line, in the sheet's units; null without one. */
  depth: number | null;
  /** How many sunk points lie on an unsink's side while the folder has named none (else 0). */
  sunk: number;
}

/** The sink tools' own controls in the window. */
export interface FoldSinkControls {
  /**
   * Open or Closed, switching the tool, while there is a choice: both fit,
   * or the sink in hand does not and the other does. Null for an unsink, and
   * while the sink in hand is the only one that fits (owner feedback,
   * 2026-10-12: a control with no choice in it is not shown).
   */
  kind: FoldKindChoice<FoldSinkKind> | null;
  depth: { label: string; value: string; help: string } | null;
  pocket: FoldChoiceStepper | null;
  order: FoldChoiceStepper | null;
}

function kindOf(tool: FoldSinkToolId): FoldSinkKind | null {
  return tool === 'open-sink' ? 'open' : tool === 'closed-sink' ? 'closed' : null;
}

/** Why each kind does not fit, as the refusal it would get names it; null while it may. */
function kindReasons(t: TFunction, sink: FoldSinkWindowView): Record<FoldSinkKind, string | null> {
  if (!sink.known) return { open: null, closed: null };
  return {
    open: sink.openRefusal ? sinkRefusalTitle(t, sink.openRefusal) : null,
    closed: sink.pocketsFound === 0 ? sinkRefusalTitle(t, 'sink_no_pocket') : null,
  };
}

/** What the sinks that fit say beside the choice: both, or only the other one than the sink in hand. */
function kindNote(t: TFunction, reasons: Record<FoldSinkKind, string | null>): string {
  if (reasons.open === null && reasons.closed === null) {
    return t(
      'tools:fold.sink.bothFit',
      'Both sinks fit here: an open sink turns every layer inside out, a closed one keeps them together.'
    );
  }
  return reasons.open === null
    ? t('tools:fold.sink.onlyOpen', 'Only the open sink fits here.')
    : t('tools:fold.sink.onlyClosed', 'Only the closed sink fits here.');
}

function pocketStepper(
  t: TFunction,
  sink: FoldSinkWindowView,
  verbs: FoldToolWindowVerbs,
  readOnly: boolean
): FoldChoiceStepper | null {
  const value =
    sink.pocketName === 'front'
      ? t('tools:fold.sink.pocketFront', 'Front')
      : sink.pocketName === 'back'
        ? t('tools:fold.sink.pocketBack', 'Back')
        : undefined;
  return choiceStepper(t, t('tools:fold.sink.pocket', 'Pocket'), sink.pocket, sink.pockets, verbs.stepPocket, readOnly, value);
}

/**
 * Whether the folder has a sink to choose: the engine has described the
 * point, and the other sink fits — beside the one in hand, or in its place.
 */
function sinkChoice(sink: FoldSinkWindowView, kind: FoldSinkKind, reasons: Record<FoldSinkKind, string | null>): boolean {
  const other: FoldSinkKind = kind === 'open' ? 'closed' : 'open';
  return sink.known && reasons[other] === null;
}

function sinkControls(t: TFunction, sink: FoldSinkWindowView, verbs: FoldToolWindowVerbs, readOnly: boolean): FoldSinkControls {
  const kind = kindOf(sink.tool);
  const reasons = kindReasons(t, sink);
  const option = (value: FoldSinkKind) => ({
    value,
    short: value === 'open' ? t('tools:fold.sink.open', 'Open') : t('tools:fold.sink.closed', 'Closed'),
    label: foldSinkKindLabel(t, value),
    disabled: reasons[value] !== null,
    reason: reasons[value],
  });
  return {
    kind:
      kind === null || !sinkChoice(sink, kind, reasons)
        ? null
        : {
            label: t('tools:fold.sink.kind', 'Sink'),
            value: kind,
            options: [option('open'), option('closed')],
            disabled: readOnly,
            note: kindNote(t, reasons),
            set: (next) => verbs.selectTool(next === 'open' ? 'open-sink' : 'closed-sink'),
          },
    depth:
      sink.depth !== null && sink.tool !== 'unsink'
        ? {
            label: t('tools:fold.sink.depth', 'Depth'),
            value: t('tools:fold.sink.depthValue', '{{depth}} from the tip', {
              depth: formatOrieditaRatioNumber(sink.depth),
            }),
            help: t(
              'tools:fold.sink.depthHelp',
              'How far the line lies from the point’s tip along its centre line, the paper’s side being 1. Locate the line farther down to sink the point deeper.'
            ),
          }
        : null,
    pocket: sink.tool === 'closed-sink' ? pocketStepper(t, sink, verbs, readOnly) : null,
    order: choiceStepper(t, t('tools:fold.reverse.order', 'Layer order'), sink.order, sink.orders, verbs.stepOrder, readOnly),
  };
}

/** What a sink's line is, said under the line mode's steps while it is located. */
function locateNote(t: TFunction, tool: FoldSinkToolId): string {
  switch (tool) {
    case 'open-sink':
      return t(
        'tools:fold.note.openSinkSquare',
        'The line across the point sets how deep it sinks, and must be exactly square to its centre line: Axiom 4 draws one.'
      );
    case 'closed-sink':
      return t('tools:fold.note.closedSinkLine', 'The line across the point sets how deep it sinks.');
    case 'unsink':
      return t('tools:fold.note.unsinkRing', 'The line is a crease of the ring the sink left, along the sunk point’s top.');
  }
}

function previewInstructions(
  t: TFunction,
  action: string,
  host: FoldToolHost,
  view: FoldToolWindowView,
  sink: FoldSinkWindowView
): FoldToolInstructions {
  const unsink = sink.tool === 'unsink';
  return {
    heading: t('tools:fold.window.instructions', 'Instructions'),
    items: [
      unsink
        ? t('tools:fold.steps.pickSunkPoint', 'The sunk point is found for you: pick another in the layers to pull that out.')
        : t('tools:fold.steps.pickPoint', 'Pick which point sinks: a sink takes one.'),
      host.coarse
        ? t('tools:fold.steps.commitTouch', 'Tap {{action}} to fold.', { action })
        : t('tools:fold.steps.commit', 'Press Enter to fold.'),
    ],
    current: 0,
    notes: [
      ...(unsink && sink.sunk > 1
        ? [
            t('tools:fold.note.severalSunk', {
              count: sink.sunk,
              defaultValue_one: '{{count}} sunk point lies here: the first is taken.',
              defaultValue_other: '{{count}} sunk points lie here: the first is taken.',
            }),
          ]
        : []),
      ...(view.preview ? queuedNote(t, view.preview) : []),
    ],
  };
}

/** A sink tool's window: locating its line, then previewing the sink (see the module docs). */
export function sinkToolWindow(
  t: TFunction,
  view: FoldToolWindowView,
  verbs: FoldToolWindowVerbs,
  host: FoldToolHost
): FoldToolWindowModel {
  const readOnly = view.readOnly !== null;
  const { preview, sink } = view;
  const tool = sink?.tool ?? (view.tool === 'closed-sink' || view.tool === 'unsink' ? view.tool : 'open-sink');
  const title = foldToolLabel(t, tool);
  if (!preview || !sink) {
    // Once the line is in: the point that sinks, as the preview's steps pick
    // it — an unsink's is found for the folder.
    const then =
      tool === 'unsink'
        ? host.coarse
          ? t('tools:fold.steps.commitTouch', 'Tap {{action}} to fold.', { action: title })
          : t('tools:fold.steps.commit', 'Press Enter to fold.')
        : host.coarse
          ? t('tools:fold.steps.sinkFinishTouch', 'Pick the point, then tap {{action}}.', { action: title })
          : t('tools:fold.steps.sinkFinish', 'Pick the point, then press Enter.');
    const located = locateInstructions(t, view, title, host, then);
    // An unsink's line is a crease of the ring: what folding along any crease does is not its to say.
    const lineNotes = tool === 'unsink' && view.lineMode === 'crease' ? [] : located.notes;
    return {
      phase: 'locate',
      title,
      meta: settingsMeta(t, 1),
      instructions: { ...located, notes: [locateNote(t, tool), ...lineNotes] },
      lineMode: lineModeSelect(t, view, verbs),
      kind: null,
      movingSide: null,
      layers: null,
      refusal: null,
      divide: null,
      footer: null,
    };
  }
  const controls = sinkControls(t, sink, verbs, readOnly);
  const settings = 2 + (controls.kind ? 1 : 0) + (controls.pocket ? 1 : 0) + (controls.order ? 1 : 0);
  return {
    phase: 'preview',
    title,
    meta: settingsMeta(t, settings),
    instructions: previewInstructions(t, title, host, view, sink),
    lineMode: null,
    kind: null,
    movingSide: {
      label:
        tool === 'unsink'
          ? t('tools:fold.sink.sunkSide', 'Sunk side')
          : t('tools:fold.reverse.tipSide', 'Tip side'),
      swapLabel: t('tools:fold.window.swap', 'Swap'),
      shortcut: 'fold.swapSide',
      disabled: readOnly,
      swap: verbs.swapSide,
    },
    layers: preview.section || !preview.refused ? layersSection(t, preview, verbs, readOnly, host.coarse) : null,
    refusal: preview.refused
      ? foldRefusalNotice(
          t,
          preview.refused,
          { kind: 'sink', readOnly, ...sectionFlapNames(preview.section), sink: { tool } },
          verbs
        )
      : null,
    divide: null,
    sink: controls,
    footer: {
      cancel: {
        label: t('tools:fold.window.cancel', 'Cancel'),
        shortcut: 'viewport.cancel',
        disabled: false,
        run: verbs.cancel,
      },
      commit: {
        label: title,
        shortcut: 'fold.commit',
        disabled: readOnly || preview.landing || preview.refused !== null,
        run: verbs.commit,
      },
    },
  };
}
