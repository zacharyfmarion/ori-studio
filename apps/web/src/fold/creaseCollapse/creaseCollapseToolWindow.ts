/**
 * Collapse's window (`implementation-plans/fold-collapse-existing-creases.md`),
 * as the plain descriptor the one Fold window renderer draws
 * (`components/fold/FoldToolWindow`).
 *
 * - **One line** says what to do: click creases to set them.
 * - **The letter in hand** — Valley, Mountain or Open — is a segmented
 *   control, each by the mark the rest of Fold draws it with.
 * - **What is set** is said in words, never by an icon: how many creases,
 *   then where it stands — landing, how many layer orders, or why it does not
 *   fold. That line is always there, empty or not, so nothing a change
 *   brings moves the control being used.
 * - **The footer**: Cancel lets go of every crease set; Collapse adds the
 *   step, through the layer order chooser when there is more than one.
 *
 * React-free and store-free.
 */
import type { TFunction } from 'i18next';
import type { FoldCollapseTo } from '../document/foldSequenceDocument';
import { foldToolDescription, foldToolLabel } from '../tools/foldToolCatalog';
import {
  settingsMeta,
  type FoldToolHost,
  type FoldToolWindowModel,
  type FoldToolWindowVerbs,
  type FoldToolWindowView,
} from '../tools/foldToolWindow';

/** Where a Collapse stands: nothing set, being worked out, landed, refused, or failed (the worker, not the paper). */
export type FoldCreaseCollapseStatus = 'empty' | 'working' | 'landed' | 'refused' | 'failed';

/** Why the creases set do not fold, as the window words it. */
export type FoldCreaseCollapseProblem = 'vertex' | 'order' | 'other';

/** What Collapse's window is drawn from, beside every tool's view. */
export interface FoldCreaseCollapseWindowView {
  to: FoldCollapseTo;
  /** How many creases are set. */
  picks: number;
  status: FoldCreaseCollapseStatus;
  /** Why it does not fold, while refused. */
  problem: FoldCreaseCollapseProblem | null;
  /** How many layer orders it lands in, once landed. */
  orders: number | null;
}

export interface FoldCreaseCollapseWindowVerbs {
  setTo: (to: FoldCollapseTo) => void;
}

/** The letter control and the reserved status line (`FoldCreaseCollapseControls`). */
export interface FoldCreaseCollapseControls {
  letter: {
    label: string;
    value: FoldCollapseTo;
    options: readonly { value: FoldCollapseTo; label: string }[];
    disabled: boolean;
    set: (to: FoldCollapseTo) => void;
  };
  /** How many creases are set, in words. */
  count: string;
  /** Where it stands, in words; null leaves the line empty, its room kept. */
  status: string | null;
  /** The status is why it does not fold. */
  refused: boolean;
}

/** Each letter by its own name: the words the Step pane folds by. */
export function collapseToLabel(t: TFunction, to: FoldCollapseTo): string {
  switch (to) {
    case 'valley':
      return t('tools:fold.collapse.valley', 'Valley');
    case 'mountain':
      return t('tools:fold.collapse.mountain', 'Mountain');
    case 'open':
      return t('tools:fold.collapse.open', 'Open');
  }
}

function statusLine(t: TFunction, view: FoldCreaseCollapseWindowView): string | null {
  switch (view.status) {
    case 'empty':
      return null;
    case 'working':
      return t('tools:fold.collapse.working', 'Working out the fold…');
    case 'failed':
      return t('tools:fold.collapse.failed', 'The fold could not be worked out. Change a crease to try again.');
    case 'landed':
      return view.orders !== null && view.orders > 1
        ? t('tools:fold.collapse.orders', { count: view.orders, defaultValue_one: 'Folds flat.', defaultValue_other: 'Folds flat, {{count}} layer orders.' })
        : t('tools:fold.collapse.folds', 'Folds flat.');
    case 'refused':
      switch (view.problem) {
        case 'vertex':
          return t('tools:fold.collapse.notFlat', 'The creases at the marked point can’t fold flat with these letters.');
        case 'order':
          return t('tools:fold.collapse.noOrder', 'No layer order fits these letters.');
        default:
          return t('tools:fold.collapse.cannot', 'These creases can’t collapse as set.');
      }
  }
}

/** Collapse's window (see the module docs). */
export function creaseCollapseToolWindow(
  t: TFunction,
  view: FoldToolWindowView,
  collapse: FoldCreaseCollapseWindowView,
  verbs: FoldToolWindowVerbs,
  host: FoldToolHost
): FoldToolWindowModel {
  const readOnly = view.readOnly !== null;
  const controls: FoldCreaseCollapseControls = {
    letter: {
      label: t('tools:fold.collapse.letter', 'Set to'),
      value: collapse.to,
      options: (['valley', 'mountain', 'open'] as const).map((value) => ({ value, label: collapseToLabel(t, value) })),
      disabled: readOnly,
      set: verbs.creaseCollapse?.setTo ?? (() => {}),
    },
    count: t('tools:fold.collapse.count', { count: collapse.picks, defaultValue_one: '{{count}} crease set', defaultValue_other: '{{count}} creases set' }),
    status: statusLine(t, collapse),
    refused: collapse.status === 'refused',
  };
  const notes = host.coarse ? [] : [t('tools:fold.collapse.enter', 'Enter collapses; Esc lets go of the creases set.')];
  return {
    phase: collapse.picks > 0 ? 'preview' : 'locate',
    title: foldToolLabel(t, 'collapse'),
    meta: settingsMeta(t, 1),
    instructions: {
      heading: t('tools:fold.window.instructions', 'Instructions'),
      intro: foldToolDescription(t, 'collapse'),
      items: [t('tools:fold.collapse.click', 'Click a crease to set it to the letter below.')],
      current: collapse.picks > 0 ? 1 : 0,
      notes,
    },
    lineMode: null,
    kind: null,
    movingSide: null,
    layers: null,
    refusal: null,
    divide: null,
    creaseCollapse: controls,
    footer: {
      cancel: {
        label: t('tools:fold.window.cancel', 'Cancel'),
        shortcut: 'viewport.cancel',
        disabled: collapse.picks === 0,
        run: verbs.cancel,
      },
      commit: {
        label: foldToolLabel(t, 'collapse'),
        shortcut: 'fold.commit',
        disabled: readOnly || collapse.status !== 'landed',
        run: verbs.commit,
      },
    },
  };
}
