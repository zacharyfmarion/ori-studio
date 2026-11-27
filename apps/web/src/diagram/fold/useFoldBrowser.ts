import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trackDiagramFoldMergeChanged } from '../../analytics/trackFoldIo';
import { foldSession } from '../../store/workspaceStore/foldSession';
import { useLayoutStore } from '../../store/layoutStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DiagramFoldBrowserState } from '../../store/workspaceStore/types';
import { useFoldSequenceView } from '../../fold/sequence/useFoldSequenceView';
import {
  anchorTakesCard,
  stepNumber,
  stepNumbers,
  stepsAround,
  stepsOf,
  type DiagramDocument,
  type DiagramFoldMoment,
  type DiagramPullAnchor,
} from '../document/diagramDocument';
import { pullableCards, type BrowserSelection } from '../references/referencesBrowserSelection';
import { usePullSelection, type PullSelection } from '../references/usePullSelection';
import { pullFromFold } from './foldBrowserActions';
import { boundaryKey, diagramJoins, foldMergeLayout, type FoldDrawnSource, type FoldMergeKind } from './foldMergeLayout';
import { foldBrowserCards, type FoldBrowserCard, type FoldPullTarget } from './foldPull';
import { useFoldStepGroups } from './useFoldStepGroups';

/** Where the Fold browser's list stands. */
export type FoldBrowserCardsState =
  /** The project has no Fold sequence with a step. */
  | { status: 'empty' }
  | {
      status: 'ready';
      sequence: string;
      cards: readonly FoldBrowserCard[];
      /** Some steps would merge (`foldStepMerge.ts`): the option does something. */
      mergeable?: boolean;
      /** Every place two steps could be joined, by its key (`boundaryKey`), and what joining there makes. */
      places?: ReadonlyMap<string, FoldMergeKind>;
    };

/** A Diagram step drawn from a Fold sequence, as the browser reads it to start each group as the diagram has it. */
export interface FoldDrawnStep extends FoldDrawnSource {
  readonly sequence: string;
}

/** How the browser asks for its cards: Merge symmetric steps, the reader's own joins and splits, and what the diagram already draws. */
export interface FoldMergeChoice {
  /** Merge symmetric steps: mirror images and Repeats start joined. */
  readonly mirrors: boolean;
  /** Each place the reader joined (true) or split (false), by its key. */
  readonly choices: ReadonlyMap<string, boolean>;
  /** The diagram's steps drawn from Fold. */
  readonly drawn: readonly FoldDrawnStep[];
}

/**
 * Where the Fold browser's steps come from and how they are added (plan
 * D17): the app's Fold session ({@link APP_FOLD_PROVIDER}), or a fake one in a
 * test. `useCards` is a hook, called once per render of the browser.
 */
export interface FoldBrowserProvider {
  /** The shown sequence's active path as cards — each run drawn as one a card, as `choice` says — kept current. */
  useCards: (choice: FoldMergeChoice) => FoldBrowserCardsState;
  /** Add `targets` where `anchor` says, from the browser opening `opening`; how many entries it added. */
  pull: (targets: readonly FoldPullTarget[], anchor: DiagramPullAnchor, opening: number) => Promise<number>;
  /** Show Fold. */
  openFold: () => void;
}

/**
 * The Fold session's shown sequence as cards: held while the browser is
 * open, so it replays. What it offers to merge is told as it lands its steps
 * (`useFoldStepGroups`); each place is joined as the reader chose, else as
 * the diagram already draws it, else as Merge symmetric steps says for a
 * mirror image or Repeat — a turned copy starts apart (`foldMergeLayout`).
 */
function useAppFoldCards(choice: FoldMergeChoice): FoldBrowserCardsState {
  const { t } = useTranslation();
  useEffect(() => foldSession().retain(), []);
  const view = useFoldSequenceView();
  const { entries, words, frames, exists, document, failed } = view;
  const merges = useFoldStepGroups(foldSession(), document.id, entries);
  return useMemo(() => {
    if (!exists || document.steps.length === 0) return { status: 'empty' };
    const ids = entries.flatMap((entry) => (entry.id !== null ? [entry.id] : []));
    const drawn = diagramJoins(
      choice.drawn.filter((step) => step.sequence === document.id),
      ids
    );
    const layout = merges
      ? foldMergeLayout(merges.groups, merges.repeats, (key, kind) => {
          return choice.choices.get(key) ?? drawn.get(key) ?? (kind !== 'turn' && choice.mirrors);
        })
      : null;
    return {
      status: 'ready',
      sequence: document.id,
      cards: foldBrowserCards(t, { document, entries, words, frames, failed }, layout?.runs, layout?.offers),
      mergeable: !!merges && merges.groups.length + merges.repeats.length > 0,
      places: merges ? mergePlaces(merges) : NO_PLACES,
    };
  }, [t, exists, document, entries, words, frames, failed, merges, choice]);
}

/** The app's Fold browser: the Fold session, and a pull that captures from it into the diagram. */
export const APP_FOLD_PROVIDER: FoldBrowserProvider = {
  useCards: useAppFoldCards,
  pull: (targets, anchor, opening) => pullFromFold(targets, anchor, { via: 'diagram_browser', opening }),
  openFold: () => useLayoutStore.getState().activateWorkspace('fold'),
};

export interface FoldBrowser extends PullSelection {
  state: DiagramFoldBrowserState;
  cards: FoldBrowserCardsState;
  /** The steps already made from a card of the sequence shown: card index to step number. */
  inDiagram: ReadonlyMap<number, number>;
  /** The entries the selection would add, in order. */
  pullable: FoldPullTarget[];
  pulling: boolean;
  /** The turn just before the selection, offered with it. */
  turnOverBefore: number | null;
  withTurnOver: boolean;
  setWithTurnOver: (value: boolean) => void;
  /** The diagram's step the anchor names, 1-based; null for the end. */
  anchorNumber: number | null;
  /** Whether the anchor's own step takes the first step: an empty step to fill, while it still is one. */
  anchorTakesFirst: boolean;
  /** Merge symmetric steps: the remembered setting, which Send steps to Diagram follows too. */
  merge: boolean;
  /** Whether anything on the path would merge, so the option is worth offering. */
  mergeable: boolean;
  /** Merge symmetric steps on or off: remembered, and every mirror image and Repeat on the path joined or split now. */
  setMerge: (value: boolean) => void;
  /** Draw a merged card's steps each as its own card. */
  split: (card: FoldBrowserCard) => void;
  /** Join a card with the next one, as its offer says (`FoldBrowserCard.join`). */
  join: (card: FoldBrowserCard) => void;
  add: () => void;
  close: () => void;
  openFold: () => void;
}

/**
 * The Fold browser, a modal over the Diagram (plan D17), as the References
 * browser is (D20): the shown Fold sequence's active path as cards, the
 * selection (`usePullSelection`), and the pull, bound to the store. Every
 * card can be chosen once its step has landed; Finished, once the path ends
 * on a step that folds. A merged card can be split and two cards joined
 * while the browser is open; the selection follows its steps.
 */
export function useFoldBrowser(state: DiagramFoldBrowserState, provider: FoldBrowserProvider = APP_FOLD_PROVIDER): FoldBrowser {
  const diagram = useWorkspaceStore((store) => store.diagram);
  const merge = useSettingsStore((store) => store.diagramFoldMergePrecreases);
  const [choices, setChoices] = useState<ReadonlyMap<string, boolean>>(NO_CHOICES);
  const drawn = useMemo(() => drawnSteps(diagram), [diagram]);
  const choice = useMemo<FoldMergeChoice>(() => ({ mirrors: merge, choices, drawn }), [merge, choices, drawn]);
  const cards = provider.useCards(choice);
  const shown = cards.status === 'ready' ? cards.cards : NO_CARDS;
  // Another grouping is another list: a card's index names another step once runs merge or part.
  const listKey = cards.status === 'ready' ? `${cards.sequence}:${mergedRuns(shown)}` : '';
  // The lists shown lately, by key: the selection follows its steps from the one before (`carryFoldSelection`).
  // Kept as information from earlier renders: a new list is added as it is first drawn.
  const [lists, setLists] = useState<readonly ShownList[]>([]);
  if (lists.at(-1)?.key !== listKey) setLists((was) => [...was.filter((list) => list.key !== listKey).slice(-3), { key: listKey, cards: shown }]);
  const carry = useCallback(
    (from: string, selection: BrowserSelection) => {
      const before = lists.find((list) => list.key === from)?.cards;
      return before && from.split(':')[0] === listKey.split(':')[0] ? carryFoldSelection(selection, before, shown) : null;
    },
    [lists, listKey, shown]
  );
  const { selection, ...choose } = usePullSelection(shown, listKey, null, true, carry);
  const [withTurnOver, setWithTurnOver] = useState(true);
  const { pullable, turnOverBefore } = useMemo(
    () => pullableCards(shown, selection.indices, { finished: true, withTurnOver }),
    [shown, selection.indices, withTurnOver]
  );
  const inDiagram = useMemo(
    () => (cards.status === 'ready' ? diagramUse(diagram, cards.sequence, shown) : NO_USE),
    [diagram, cards, shown]
  );
  // Each step is captured as the pull lands: held meanwhile, so a second press cannot add them twice.
  const [pulling, setPulling] = useState(false);
  const { pull } = provider;
  const add = useCallback(() => {
    if (pullable.length === 0 || pulling) return;
    setPulling(true);
    void pull(pullable, state.anchor, state.opening).finally(() => setPulling(false));
  }, [pull, pullable, pulling, state.anchor, state.opening]);
  const anchorStep = 'stepId' in state.anchor ? state.anchor.stepId : null;
  // After a turn, the step before it: the steps go after both.
  const anchorNumber =
    diagram && anchorStep !== null ? (stepNumber(diagram, anchorStep) ?? stepsAround(diagram, anchorStep).before) : null;
  const places = cards.status === 'ready' ? (cards.places ?? NO_PLACES) : NO_PLACES;
  return {
    state,
    cards,
    inDiagram,
    selection,
    ...choose,
    pullable,
    pulling,
    turnOverBefore,
    withTurnOver,
    setWithTurnOver,
    anchorNumber,
    anchorTakesFirst: anchorTakesCard(diagram, state.anchor),
    merge,
    mergeable: cards.status === 'ready' && cards.mergeable === true,
    setMerge: (value) => {
      useSettingsStore.getState().setDiagramFoldMergePrecreases(value);
      // Every mirror image and Repeat switches now, the diagram's own runs too; a turned copy keeps the reader's choice.
      setChoices((was) => {
        const next = new Map(was);
        for (const [key, kind] of places) if (kind !== 'turn') next.set(key, value);
        return next;
      });
    },
    split: (card) => {
      if (!card.merged) return;
      const { kind } = card.merged;
      setChoices((was) => {
        const next = new Map(was);
        for (let k = 1; k < card.ids.length; k += 1) next.set(boundaryKey(card.ids[k - 1]!, card.ids[k]!), false);
        return next;
      });
      trackDiagramFoldMergeChanged({ action: 'split', kind });
    },
    join: (card) => {
      const offer = card.join;
      if (!offer) return;
      setChoices((was) => new Map(was).set(offer.key, true));
      trackDiagramFoldMergeChanged({ action: 'join', kind: offer.kind });
    },
    add,
    close: () => useWorkspaceStore.getState().closeDiagramFoldBrowser(),
    openFold: () => {
      useWorkspaceStore.getState().closeDiagramFoldBrowser();
      provider.openFold();
    },
  };
}

/** A list the browser showed: its key, and its cards. */
interface ShownList {
  readonly key: string;
  readonly cards: readonly FoldBrowserCard[];
}

const NO_CARDS: readonly FoldBrowserCard[] = [];
const NO_USE: ReadonlyMap<number, number> = new Map();
const NO_CHOICES: ReadonlyMap<string, boolean> = new Map();
const NO_PLACES: ReadonlyMap<string, FoldMergeKind> = new Map();

/**
 * Every place two steps could be joined, and what joining there makes: in a
 * group, a mirror image where the later step mirrors one before it in the
 * group, else a turned copy; a Repeat run's place before its Repeat.
 */
function mergePlaces(merges: NonNullable<ReturnType<typeof useFoldStepGroups>>): Map<string, FoldMergeKind> {
  const places = new Map<string, FoldMergeKind>();
  for (const group of merges.groups) {
    for (let k = 1; k < group.steps.length; k += 1) {
      const row = group.related[k]!;
      places.set(boundaryKey(group.steps[k - 1]!, group.steps[k]!), row.includes('mirror') ? 'mirror' : 'turn');
    }
  }
  for (const run of merges.repeats) {
    const last = run.steps.length - 1;
    if (last > 0) places.set(boundaryKey(run.steps[last - 1]!, run.steps[last]!), 'repeat');
  }
  return places;
}

/** The diagram's steps drawn from Fold, before their state folds: what the browser starts each group as. */
function drawnSteps(diagram: DiagramDocument | null): FoldDrawnStep[] {
  if (!diagram) return [];
  return stepsOf(diagram).flatMap((step) => {
    const source = step.source;
    if (source?.kind !== 'fold-step') return [];
    return [
      {
        sequence: source.sequence,
        step: source.step,
        ...(source.through !== undefined ? { through: source.through } : {}),
        moment: source.moment,
      },
    ];
  });
}

/**
 * A selection of `before`'s cards as one of `after`'s, the same list with
 * runs merged or parted: a card is chosen when it shows a step a chosen card
 * showed; the pivot and the keyboard land on the card that shows what theirs
 * showed first.
 */
export function carryFoldSelection(
  selection: BrowserSelection,
  before: readonly FoldBrowserCard[],
  after: readonly FoldBrowserCard[]
): BrowserSelection {
  const chosen = new Set([...selection.indices].flatMap((index) => before[index]?.ids ?? []));
  const cardOf = (index: number | null) => {
    const id = index === null ? undefined : before[index]?.ids[0];
    const found = id === undefined ? -1 : after.findIndex((card) => card.ids.includes(id));
    return found < 0 ? null : found;
  };
  return {
    indices: new Set(after.flatMap((card) => (card.ids.some((id) => chosen.has(id)) ? [card.index] : []))),
    pivot: cardOf(selection.pivot),
    focus: cardOf(selection.focus),
  };
}

/** The merged runs among the cards, as a key: which steps each joins, first to last. */
function mergedRuns(cards: readonly FoldBrowserCard[]): string {
  return cards
    .flatMap((card) => (card.through !== undefined ? [`${card.number ?? ''}-${card.through}`] : []))
    .join(',');
}

/**
 * The steps the diagram already made from the shown sequence's cards: card
 * index to the first such step's number. A step drawn from a run of Fold
 * steps (`through`) uses every card from its first step's to its last's, so
 * one merged card or the run's cards each, however the list shows them.
 */
function diagramUse(
  diagram: DiagramDocument | null,
  sequence: string,
  cards: readonly FoldBrowserCard[]
): Map<number, number> {
  const used = new Map<number, number>();
  if (!diagram) return used;
  const numbers = stepNumbers(diagram);
  /** The card that shows a Fold step at `moment`: its own, or a merged run's it begins or ends. */
  const cardOf = (id: string, moment: DiagramFoldMoment) =>
    cards.findIndex((card) => {
      const target = card.step;
      return target?.kind === 'step' && target.moment === moment && (target.step === id || target.through === id);
    });
  for (const step of stepsOf(diagram)) {
    const source = step.source;
    if (source?.kind !== 'fold-step' || source.sequence !== sequence) continue;
    const first = cardOf(source.step, source.moment);
    const last = source.through === undefined ? first : cardOf(source.through, source.moment);
    if (first < 0 || last < first) continue;
    for (let index = first; index <= last; index += 1) {
      // A run's cards are its steps': a turn between them is none of it.
      if ((index === first || cards[index]?.kind === 'fold') && !used.has(index)) used.set(index, numbers.get(step.id)!);
    }
  }
  return used;
}
