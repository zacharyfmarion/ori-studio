/**
 * Repeat's window, as the plain descriptor the one Fold window renderer draws
 * (`components/fold/FoldToolWindow`).
 *
 * Repeat folds a range of steps — from the one chosen through the step on
 * screen — again across a symmetry axis, on the other side or behind as the
 * folded state says, and previews it as every tool previews its step, from
 * the moment the range and the axis are set (`useFoldRepeatTool`). Its
 * window:
 *
 * - **Start with**: the range's first step, among the ones it can start from;
 * - **Symmetry axis**: the verified symmetry axes of the range's starting
 *   state, by where they run on the paper — the canvas draws them too, to
 *   hover and click; or one located on either pane with the line modes
 *   (**Locate line**, and Snap to points for a free line), taken only when
 *   it is one of them;
 * - **Show as individual steps**, how the repeat is added;
 * - the preparation's progress, a layer order to choose when a source
 *   operation has several, and why a repeat stopped, in Repeat's own words
 *   (`repeatWords`);
 * - and its footer: Cancel (Stop while it prepares) and Repeat on the other
 *   side or Repeat behind — or, rebuilding a saved one, Update from source
 *   steps — which adds the repeat previewed, and prepares it again once a
 *   preparation was stopped.
 *
 * React-free and store-free.
 */
import type { TFunction } from 'i18next';
import { foldReturnEntryLabel } from '../return/foldReturnWords';
import type { FoldPathEntry } from '../sequence/foldSequencePath';
import { foldToolLabel } from '../tools/foldToolCatalog';
import {
  lineModeSelect,
  settingsMeta,
  type FoldToolHost,
  type FoldToolWindowModel,
  type FoldToolWindowVerbs,
  type FoldToolWindowView,
  type FoldWindowNotice,
} from '../tools/foldToolWindow';
import type { RepeatSide, RepeatSymmetry } from './repeatGeometry';
import type { RepeatAxisView } from './repeatPrepared';
import { repeatAxisName, repeatAxisRefusal, repeatFailure, type RepeatStop } from './repeatWords';

/** Where a repeat stands, as the window says it. */
export type FoldRepeatPhase =
  /** No range to repeat: the flat sheet is on screen (`sheet`), or the steps are still folding. */
  | { kind: 'unavailable'; why: 'sheet' | 'waiting' }
  /** The starting state's symmetry axes are being found. */
  | { kind: 'loading' }
  /** The repeat is being prepared, or is about to be. */
  | { kind: 'preparing' }
  /** The last preparation was stopped, or an order choice backed out of: nothing is previewed, nothing was added. */
  | { kind: 'stopped' }
  /** No axis for the range, the source changed, the worker failed, or the engine refused the preview. */
  | { kind: 'failed'; stop: RepeatStop }
  /** Stopped at source operation `step` (0-based). */
  | { kind: 'blocked'; step: number; stop: RepeatStop }
  /**
   * Source operation `step` has `count` matching layer orders: `index` the
   * one previewed, null before one is; `waiting` while it lands.
   */
  | { kind: 'choosing'; step: number; count: number; index: number | null; waiting: boolean; failed: boolean }
  /** Prepared and previewed: what the commit adds. `busy` while the preview lands, or the repeat is added. */
  | { kind: 'ready'; busy: boolean };

/** What Repeat's window is drawn from, beside every tool's view. */
export interface FoldRepeatWindowView {
  /** The range and the steps it may start with; null while there is none. */
  range: { entries: readonly FoldPathEntry[]; starts: readonly FoldPathEntry[]; first: string; count: number } | null;
  /** The range's verified axes, each a line on the sheet and the side it repeats on; null while they are being found. */
  axes: readonly RepeatSymmetry[] | null;
  /** Per axis, whether its repeat lands, as far as it is prepared (`repeatPrepared`): a refused one is offered disabled, with why. */
  states?: readonly RepeatAxisView[];
  /** The one taken; -1 for none. */
  axis: number;
  /** The one under the pointer, previewed in its place; -1 for none. */
  hovered: number;
  /** The side the axis previewed repeats on; null while there is none. */
  side: RepeatSide | null;
  individual: boolean;
  /** A saved repeat is being rebuilt in place: it is added as it was. */
  rebuilding: boolean;
  phase: FoldRepeatPhase;
  /** The canvas takes a drawn axis now: there are axes to draw, and nothing is being chosen or added. */
  drawing: boolean;
  /**
   * A drawn line that is no verified axis, with the axis nearest it, offered
   * in its place (-1 for none near), and whether the picks located a line at
   * all (an axiom may have no root through them); null while none was drawn.
   */
  drawn: { nearest: number; line: boolean; refused?: RepeatAxisView } | null;
}

/** Repeat's own calls, beside every tool's. */
export interface FoldRepeatWindowVerbs {
  setFirst: (id: string) => void;
  /** Mirror across the axis listed at `index`. */
  setAxis: (index: number) => void;
  /** Preview the axis listed at `index` in the taken one's place, while the pointer is on it; null when it leaves. */
  hoverAxis: (index: number | null) => void;
  setIndividual: (individual: boolean) => void;
  /** A source operation's matching layer orders: step through them, take the one shown, or go back. */
  stepOrder: (delta: number) => void;
  acceptOrder: () => void;
  backFromOrder: () => void;
}

/** Repeat's own controls in the window. */
export interface FoldRepeatControls {
  axis: {
    label: string;
    value: string | null;
    placeholder: string;
    /** `disabled` with its `description`, why: an axis whose repeat is refused. */
    options: readonly { id: string; label: string; disabled?: boolean; description?: string }[];
    disabled: boolean;
    set: (id: string) => void;
  };
  /** How the repeat is added; null while a saved one is rebuilt, which is added as it was. */
  individual: { label: string; checked: boolean; disabled: boolean; set: (individual: boolean) => void } | null;
  /** How many operations it repeats, and how they are added. */
  summary: string | null;
  /** A source operation's matching layer orders, while one is being chosen (the shared order chooser). */
  order: {
    index: number;
    count: number;
    ready: boolean;
    waiting: boolean;
    failed: boolean;
    step: (delta: number) => void;
    back: () => void;
    accept: () => void;
  } | null;
}

/** How many operations the range repeats, on which side, and how they will be added. */
function summaryOf(t: TFunction, count: number, individual: boolean, side: RepeatSide | null): string {
  if (side === 'behind')
    return individual
      ? t('panels:fold.repeat.individualCountBehind', {
          count,
          defaultValue_one: 'Repeat {{count}} operation behind, as an individual entry.',
          defaultValue_other: 'Repeat {{count}} operations through the current step behind, as individual entries.',
        })
      : t('panels:fold.repeat.groupCountBehind', {
          count,
          defaultValue_one: 'Repeat {{count}} operation behind, as one numbered step.',
          defaultValue_other: 'Repeat {{count}} operations through the current step behind, as one numbered step.',
        });
  if (side === 'same')
    return individual
      ? t('panels:fold.repeat.individualCountSame', {
          count,
          defaultValue_one: 'Repeat {{count}} operation on the other side, as an individual entry.',
          defaultValue_other: 'Repeat {{count}} operations through the current step on the other side, as individual entries.',
        })
      : t('panels:fold.repeat.groupCountSame', {
          count,
          defaultValue_one: 'Repeat {{count}} operation on the other side, as one numbered step.',
          defaultValue_other: 'Repeat {{count}} operations through the current step on the other side, as one numbered step.',
        });
  return individual
    ? t('panels:fold.repeat.individualCount', {
        count,
        defaultValue_one: 'Repeat {{count}} operation as an individual entry.',
        defaultValue_other: 'Repeat {{count}} operations through the current step as individual entries.',
      })
    : t('panels:fold.repeat.groupCount', {
        count,
        defaultValue_one: 'Repeat {{count}} operation as one numbered step.',
        defaultValue_other: 'Repeat {{count}} operations through the current step as one numbered step.',
      });
}

/** Where the repeat stands, in a note under the steps; null when a refusal says it instead. */
function statusNote(t: TFunction, repeat: FoldRepeatWindowView): string | null {
  const { phase } = repeat;
  switch (phase.kind) {
    case 'unavailable':
      return phase.why === 'sheet'
        ? t('panels:fold.return.empty', 'Fold a step first.')
        : t('panels:fold.repeat.waiting', 'Waiting for the steps to finish folding…');
    case 'loading':
      return t('panels:fold.repeat.findingAxes', 'Finding the symmetry axes of the model before the range…');
    case 'preparing':
      return t('panels:fold.repeat.preparing', 'Preparing repeated folds…');
    case 'stopped':
      return t('panels:fold.repeat.stopped', 'Stopped before the repeat was ready. No steps were added.');
    case 'choosing':
      return t(
        'panels:fold.repeat.choiceAt',
        'Source operation {{number}} has {{count}} matching layer orders. Choose one to continue.',
        { number: phase.step + 1, count: phase.count }
      );
    case 'ready':
      return t('panels:fold.repeat.previewShown', 'The canvas shows the repeated folds and the creases they add.');
    case 'failed':
    case 'blocked':
      return null;
  }
}

/** Why the repeat cannot go on, in the window's dock, with Repeat's advice. */
function repeatNotice(
  t: TFunction,
  repeat: FoldRepeatWindowView,
  axisNames: readonly string[],
  setAxis: (index: number) => void,
  readOnly: boolean
): FoldWindowNotice | null {
  const title = t('panels:fold.repeat.failureTitle', 'Cannot repeat');
  // What a refusal's advice may offer: another axis, and a range starting after the operation that stopped.
  const otherAxis = (repeat.axes?.length ?? 0) > 1;
  const { phase } = repeat;
  // A line just drawn is what the folder last did: its refusal is said over a stopped repeat's.
  if (repeat.drawn && repeat.drawing) return drawnNotice(t, repeat.drawn, axisNames, setAxis, readOnly);
  // The whole range, not one operation of it: said as a failure.
  if (phase.kind === 'failed' || (phase.kind === 'blocked' && phase.stop.code === 'repeat_nothing')) {
    return { code: phase.stop.code, title, text: repeatFailure(t, phase.stop, { otherAxis, laterStart: false }), actions: [] };
  }
  if (phase.kind === 'blocked') {
    const laterStart = repeat.range !== null && phase.step < repeat.range.count - 1;
    return {
      code: phase.stop.code,
      title,
      text: t('panels:fold.repeat.blockedAt', 'Stopped at source operation {{number}}: {{reason}}', {
        number: phase.step + 1,
        reason: repeatFailure(t, phase.stop, { otherAxis, laterStart }),
      }),
      actions: [],
    };
  }
  return null;
}

/** A drawn line that is no verified axis: refused, the nearest axis offered in its place. */
function drawnNotice(
  t: TFunction,
  { nearest, line, refused }: NonNullable<FoldRepeatWindowView['drawn']>,
  axisNames: readonly string[],
  setAxis: (index: number) => void,
  readOnly: boolean
): FoldWindowNotice {
  // An axis, but one whose repeat is refused: offered disabled in the list, it is no choice drawn either.
  if (refused?.stop) {
    return {
      code: 'repeat_axis_drawn',
      title: t('panels:fold.repeat.failureTitle', 'Cannot repeat'),
      text: t('panels:fold.repeat.drawnAxisRefused', 'Repeating across this axis is refused. {{reason}}', {
        reason: repeatAxisRefusal(t, refused.stop, refused.step ?? null),
      }),
      actions: nearestAction(t, nearest, axisNames, setAxis, readOnly),
    };
  }
  return {
    code: 'repeat_axis_drawn',
    title: t('panels:fold.repeat.notAnAxis', 'Not a symmetry axis'),
    text: line
      ? t('panels:fold.repeat.invalidAxis', 'This line does not pair matching material and layers in the starting model.')
      : t('panels:fold.repeat.noDrawnLine', 'These picks locate no line here. Pick again, or choose an axis.'),
    actions: nearestAction(t, nearest, axisNames, setAxis, readOnly),
  };
}

/** The axis nearest a refused line, offered in its place. */
function nearestAction(
  t: TFunction,
  nearest: number,
  axisNames: readonly string[],
  setAxis: (index: number) => void,
  readOnly: boolean
): FoldWindowNotice['actions'] {
  return nearest >= 0 && axisNames[nearest]
    ? [
        {
          id: 'nearest-axis',
          label: t('panels:fold.repeat.useNearest', 'Use {{axis}}', { axis: axisNames[nearest] }),
          disabled: readOnly,
          run: () => setAxis(nearest),
        },
      ]
    : [];
}

/** Repeat's window: its range, axis and how it is added, where the repeat stands, and its footer. */
export function repeatToolWindow(
  t: TFunction,
  view: FoldToolWindowView,
  repeat: FoldRepeatWindowView,
  verbs: FoldToolWindowVerbs,
  host: FoldToolHost
): FoldToolWindowModel {
  const readOnly = view.readOnly !== null;
  const own = verbs.repeat;
  const title = foldToolLabel(t, 'repeat');
  const { phase, range } = repeat;
  // The range and the axis may change while the repeat prepares, which prepares it anew; not while it is added.
  const adding = (phase.kind === 'choosing' && phase.waiting) || (phase.kind === 'ready' && phase.busy);
  const action = repeat.rebuilding
    ? t('panels:fold.repeat.update', 'Update from source steps')
    : repeat.side === 'behind'
      ? t('panels:fold.repeat.commitBehind', 'Repeat behind')
      : repeat.side === 'same'
        ? t('panels:fold.repeat.commitSame', 'Repeat on the other side')
        : t('panels:fold.repeat.label', 'Repeat');
  const axisNames = (repeat.axes ?? []).map((axis) => repeatAxisName(t, axis.sheet));
  const refusedAll = axisNames.length > 0 && axisNames.every((_, index) => repeat.states?.[index]?.kind === 'refused');
  const choosing = phase.kind === 'choosing' && phase.index !== null ? phase : null;
  const status = statusNote(t, repeat);
  return {
    phase: 'preview',
    title,
    meta: settingsMeta(t, repeat.rebuilding ? 2 : 3),
    instructions: {
      heading: t('tools:fold.window.instructions', 'Instructions'),
      items: [
        t('tools:fold.steps.repeatStart', 'Choose the first step to repeat. The range ends at the step on screen.'),
        host.coarse
          ? t(
              'tools:fold.steps.repeatAxesTouch',
              'Tap a symmetry axis drawn on the paper, or locate one with Locate line, on either pane.'
            )
          : t(
              'tools:fold.steps.repeatAxes',
              'Point at a symmetry axis drawn on the paper to preview it, and click it to take it — or locate one with Locate line, on either pane.'
            ),
        host.coarse
          ? t('tools:fold.steps.repeatCommitTouch', 'Tap {{action}} to add the repeated folds.', { action })
          : t('tools:fold.steps.repeatCommit', 'Press Enter to add the repeated folds.'),
      ],
      // The range and the axis are set from the start: both choices are optional.
      current: repeat.axis < 0 ? 1 : 2,
      notes: status ? [status] : [],
    },
    // An axis of the folder's own, located as any fold's line is, while one may be drawn.
    lineMode: repeat.drawing ? lineModeSelect(t, view, verbs) : null,
    kind: null,
    movingSide: null,
    layers: null,
    refusal: repeatNotice(t, repeat, axisNames, own?.setAxis ?? (() => {}), readOnly),
    divide: null,
    steps: range
      ? {
          label: t('panels:fold.repeat.from', 'Start with'),
          value: range.first,
          options: range.starts.map((entry) => ({ id: entry.id ?? entry.key, label: foldReturnEntryLabel(t, entry, range.entries) })),
          disabled: readOnly || adding || choosing !== null,
          set: (id) => own?.setFirst(id),
        }
      : null,
    repeat: {
      axis: {
        label: t('panels:fold.repeat.axis', 'Symmetry axis'),
        value: repeat.axis >= 0 ? String(repeat.axis) : null,
        placeholder: t('panels:fold.repeat.chooseAxis', 'Choose symmetry axis'),
        // An axis whose repeat is refused is there, disabled, with why; one still being prepared is a choice.
        // Where every one is refused there is no choice to offer: only the one taken, its refusal said below.
        options: refusedAll
          ? axisNames.flatMap((label, index) => (index === repeat.axis ? [{ id: String(index), label }] : []))
          : axisNames.map((label, index) => {
              const state = repeat.states?.[index];
              return state?.kind === 'refused' && state.stop
                ? { id: String(index), label, disabled: true, description: repeatAxisRefusal(t, state.stop, state.step ?? null) }
                : { id: String(index), label };
            }),
        disabled: readOnly || adding || choosing !== null || axisNames.length === 0,
        set: (id) => {
          const index = Number(id);
          if (Number.isInteger(index) && index >= 0 && index < axisNames.length) own?.setAxis(index);
        },
      },
      individual: repeat.rebuilding
        ? null
        : {
            label: t('panels:fold.repeat.individual', 'Show as individual steps'),
            checked: repeat.individual,
            disabled: readOnly || adding,
            set: (individual) => own?.setIndividual(individual),
          },
      summary: range && !repeat.rebuilding ? summaryOf(t, range.count, repeat.individual, repeat.side) : null,
      order: choosing
        ? {
            index: choosing.index ?? 0,
            count: choosing.count,
            ready: !choosing.waiting && !choosing.failed && !readOnly,
            waiting: choosing.waiting,
            failed: choosing.failed,
            step: (delta) => own?.stepOrder(delta),
            back: () => own?.backFromOrder(),
            accept: () => own?.acceptOrder(),
          }
        : null,
    },
    // The order chooser has its own Back and Use this order.
    footer: choosing
      ? null
      : {
          cancel: {
            label: phase.kind === 'preparing' ? t('panels:fold.repeat.stop', 'Stop') : t('tools:fold.window.cancel', 'Cancel'),
            shortcut: 'viewport.cancel',
            disabled: false,
            run: verbs.cancel,
          },
          // Adds the repeat previewed; once a preparation was stopped, prepares it again.
          commit: {
            label: action,
            shortcut: 'fold.commit',
            disabled: readOnly || !((phase.kind === 'ready' && !phase.busy) || phase.kind === 'stopped'),
            run: verbs.commit,
          },
        },
  };
}
