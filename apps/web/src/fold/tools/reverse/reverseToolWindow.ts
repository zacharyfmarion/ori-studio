/**
 * The reverse tool's window (plan Phase 9, D14), as the plain descriptor the
 * one Fold window renderer draws (`components/fold/FoldToolWindow`).
 *
 * It locates the line as every fold does — the steps for the line mode and
 * the line-mode select — and then, previewing:
 *
 * - **the kind**, Inside or Outside: the one that lands is taken, and the
 *   title names it; a segmented control appears only when both land
 *   (research §5.2: on a two-layer flap and a generic line exactly one
 *   does) — a control with no choice in it is not shown (owner feedback,
 *   2026-10-12);
 * - **the tip side**, Swap, and **the flaps** to reverse, through the layer
 *   picker and the chips, as a fold's layers;
 * - **the opening**, when a flap opens more than one way, and **the layer
 *   order**, when the completion leaves more than one: a stepper each, the
 *   first listed taken until another is chosen (the canvas's chooser steps
 *   the same list);
 * - a refusal in the folder's words with the engine's fixes — the other
 *   kind, the flaps in the tip's way, the flaps that open — and Cancel and
 *   the fold.
 *
 * React-free and store-free.
 */
import type { TFunction } from 'i18next';
import { FOLD_REVERSE_KINDS, type FoldReverseKind } from '../../engine/foldEngineReverseWire';
import { foldReverseKindLabel, foldToolLabel } from '../foldToolCatalog';
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
import { foldRefusalNotice, sectionFlapNames } from '../refusalNotice';

/** What the reverse tool's window is drawn from, beside every tool's view. */
export interface FoldReverseWindowView {
  /** The kind folded. */
  kind: FoldReverseKind;
  /** Null selects the feasible kind automatically. */
  requested?: FoldReverseKind | null;
  truncated?: boolean;
  /** The kinds that land; empty while unknown, or while neither does. */
  kinds: readonly FoldReverseKind[];
  /** The engine has described the tip: what lands is known. */
  known: boolean;
  /** How many ways the tip opens, when a flap has a choice (else 0), and the one taken. */
  ways: number;
  way: number;
  /** How many orders the kind leaves, when it leaves several (else 0), and the one taken. */
  orders: number;
  order: number;
}

/** One listed choice the folder steps through: "Opening 2 of 3". */
export interface FoldChoiceStepper {
  label: string;
  /** "2 of 3". */
  value: string;
  previous: { label: string; disabled: boolean; run: () => void };
  next: { label: string; disabled: boolean; run: () => void };
}

/** One kind a compound fold's kind control offers: a reverse fold's Inside, a sink's Open. */
export interface FoldKindChoiceOption<K extends string> {
  value: K;
  /** Its name in the control: "Inside". */
  short: string;
  /** Its whole name, for its tooltip: "Inside reverse fold". */
  label: string;
  disabled: boolean;
  /** Why it is disabled, said in its tooltip. */
  reason: string | null;
}

/** A compound fold's kind control: its kinds, the one that does not fit disabled, and what fits said in a line. */
export interface FoldKindChoice<K extends string> {
  label: string;
  value: K;
  options: readonly FoldKindChoiceOption<K>[];
  disabled: boolean;
  /** What the kinds that land say, in a line: only one fits, or both. */
  note: string | null;
  set: (kind: K) => void;
}

export type FoldReverseKindOption = FoldKindChoiceOption<FoldReverseKind>;

export type FoldReversePreference = 'auto' | FoldReverseKind;

/** Select intent before locating a line, without guessing which kind can land. */
function reversePreference(t: TFunction, requested: FoldReverseKind | null, verbs: FoldToolWindowVerbs, readOnly: boolean): FoldKindChoice<FoldReversePreference> {
  const auto = t('tools:fold.reverse.auto', 'Automatic');
  return {
    label: t('tools:fold.reverse.requestedKind', 'Reverse kind'),
    value: requested ?? 'auto',
    options: [
      { value: 'auto', short: auto, label: auto, disabled: false, reason: null },
      ...FOLD_REVERSE_KINDS.map((value) => ({ value, short: value === 'inside' ? t('tools:fold.reverse.inside', 'Inside') : t('tools:fold.reverse.outside', 'Outside'), label: foldReverseKindLabel(t, value), disabled: false, reason: null })),
    ],
    disabled: readOnly,
    note: t('tools:fold.reverse.intentHelp', 'Automatic uses the kind that fits. A chosen kind stays selected if it cannot fold.'),
    set: (kind) => verbs.setReverseKind?.(kind === 'auto' ? null : kind),
  };
}

/** The reverse fold's own controls in the window. */
export interface FoldReverseControls {
  /**
   * Inside or Outside, only once the engine has said both fit: one that does
   * not fit is no choice, and the window's title names the kind folded
   * (owner feedback, 2026-10-12: a control with no choice in it is not shown).
   */
  kind: FoldKindChoice<FoldReverseKind> | null;
  opening: FoldChoiceStepper | null;
  order: FoldChoiceStepper | null;
}

/** Whether a reverse fold's or a crimp's kind is the folder's to choose: both kinds fit, as the engine says. */
export function bothKindsFit(view: Pick<FoldReverseWindowView, 'known' | 'kinds'>): boolean {
  return view.known && view.kinds.length === 2;
}

/**
 * A listed choice the folder steps through, "2 of 3" unless `value` words it
 * otherwise; null with one or none to choose from, or with nothing to step
 * them. Every compound tool's steppers are this one (the crimp's, the tuck's,
 * the vertex folds' and the sinks' too).
 */
export function choiceStepper(
  t: TFunction,
  label: string,
  index: number,
  count: number,
  step: ((delta: number) => void) | undefined,
  disabled: boolean,
  value?: string
): FoldChoiceStepper | null {
  if (count <= 1 || !step) return null;
  return {
    label,
    value:
      value ??
      t('tools:fold.reverse.ofCount', '{{index}} of {{total}}', { index: Math.min(index, count - 1) + 1, total: count }),
    previous: { label: t('tools:fold.reverse.previous', 'Previous'), disabled, run: () => step(-1) },
    next: { label: t('tools:fold.reverse.next', 'Next'), disabled, run: () => step(1) },
  };
}

function reverseControls(
  t: TFunction,
  reverse: FoldReverseWindowView,
  verbs: FoldToolWindowVerbs,
  readOnly: boolean
): FoldReverseControls {
  return {
    kind: bothKindsFit(reverse)
      ? {
          label: t('tools:fold.reverse.kind', 'Kind'),
          value: reverse.kind,
          options: FOLD_REVERSE_KINDS.map((value) => ({
            value,
            short:
              value === 'inside'
                ? t('tools:fold.reverse.inside', 'Inside')
                : t('tools:fold.reverse.outside', 'Outside'),
            label: foldReverseKindLabel(t, value),
            disabled: false,
            reason: null,
          })),
          disabled: readOnly,
          note: t('tools:fold.reverse.bothFit', 'Both kinds fit here: choose which way the tip goes.'),
          set: (kind) => verbs.setReverseKind?.(kind),
        }
      : null,
    opening: choiceStepper(t, t('tools:fold.reverse.opening', 'Opening'), reverse.way, reverse.ways, verbs.stepOpening, readOnly),
    order: choiceStepper(t, t('tools:fold.reverse.order', 'Layer order'), reverse.order, reverse.orders, verbs.stepOrder, readOnly),
  };
}

function previewInstructions(t: TFunction, action: string, host: FoldToolHost, view: FoldToolWindowView): FoldToolInstructions {
  return {
    heading: t('tools:fold.window.instructions', 'Instructions'),
    items: [
      t('tools:fold.steps.pickFlapsToReverse', 'Pick which flaps reverse.'),
      host.coarse
        ? t('tools:fold.steps.commitTouch', 'Tap {{action}} to fold.', { action })
        : t('tools:fold.steps.commit', 'Press Enter to fold.'),
    ],
    current: 0,
    notes: [
      ...(view.preview ? queuedNote(t, view.preview) : []),
      ...(view.reverse?.truncated ? [t('tools:fold.reverse.openingsTruncated', 'More openings may exist. Narrow the selected flaps to explore them.')] : []),
    ],
  };
}

/** The reverse tool's window: locating its line, then previewing the fold (see the module docs). */
export function reverseToolWindow(
  t: TFunction,
  view: FoldToolWindowView,
  verbs: FoldToolWindowVerbs,
  host: FoldToolHost
): FoldToolWindowModel {
  const readOnly = view.readOnly !== null;
  const { preview, reverse } = view;
  if (!preview || !reverse) {
    const title = foldToolLabel(t, 'inside-reverse');
    // Once the line is in: the flaps that reverse, as the preview's steps pick them.
    const then = host.coarse
      ? t('tools:fold.steps.reverseFinishTouch', 'Pick which flaps reverse, then tap {{action}}.', { action: title })
      : t('tools:fold.steps.reverseFinish', 'Pick which flaps reverse, then press Enter.');
    return {
      phase: 'locate',
      title,
      meta: settingsMeta(t, 2),
      reversePreference: reversePreference(t, reverse?.requested ?? null, verbs, readOnly),
      instructions: locateInstructions(t, view, title, host, then),
      lineMode: lineModeSelect(t, view, verbs),
      kind: null,
      movingSide: null,
      layers: null,
      refusal: null,
      divide: null,
      footer: null,
    };
  }
  const title = foldReverseKindLabel(t, reverse.kind);
  const compound = reverseControls(t, reverse, verbs, readOnly);
  const settings = 2 + (compound.kind ? 1 : 0) + (compound.opening ? 1 : 0) + (compound.order ? 1 : 0);
  return {
    phase: 'preview',
    title,
    meta: settingsMeta(t, settings),
    instructions: previewInstructions(t, title, host, view),
    lineMode: null,
    kind: null,
    movingSide: {
      label: t('tools:fold.reverse.tipSide', 'Tip side'),
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
          {
            kind: 'reverse',
            readOnly,
            ...sectionFlapNames(preview.section),
            ...(preview.narrowerSeed ? { narrowerSeed: preview.narrowerSeed } : {}),
          },
          verbs
        )
      : null,
    divide: null,
    compound,
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
