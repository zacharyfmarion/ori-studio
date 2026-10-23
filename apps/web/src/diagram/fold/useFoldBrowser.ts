import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { pullableCards } from '../references/referencesBrowserSelection';
import { usePullSelection, type PullSelection } from '../references/usePullSelection';
import { pullFromFold } from './foldBrowserActions';
import { foldBrowserCards, type FoldBrowserCard, type FoldPullTarget } from './foldPull';
import { useFoldPrecreaseMerges } from './useFoldPrecreaseMerges';

/** Where the Fold browser's list stands. */
export type FoldBrowserCardsState =
  /** The project has no Fold sequence with a step. */
  | { status: 'empty' }
  | {
      status: 'ready';
      sequence: string;
      cards: readonly FoldBrowserCard[];
      /** Some precrease and its mirror image would merge (`foldPrecreaseMerge.ts`): the option does something. */
      mergeable?: boolean;
    };

/**
 * Where the Fold browser's steps come from and how they are added (plan
 * D17): the app's Fold session ({@link APP_FOLD_PROVIDER}), or a fake one in a
 * test. `useCards` is a hook, called once per render of the browser.
 */
export interface FoldBrowserProvider {
  /** The shown sequence's active path as cards — each merge one card while `merge` is on — kept current. */
  useCards: (merge: boolean) => FoldBrowserCardsState;
  /** Add `targets` where `anchor` says, from the browser opening `opening`; how many entries it added. */
  pull: (targets: readonly FoldPullTarget[], anchor: DiagramPullAnchor, opening: number) => Promise<number>;
  /** Show Fold. */
  openFold: () => void;
}

/**
 * The Fold session's shown sequence as cards: held while the browser is
 * open, so it replays. Its precreases and their mirror images are told as it
 * lands them (`useFoldPrecreaseMerges`), whether or not they are merged, so
 * the option says whether it would do anything.
 */
function useAppFoldCards(merge: boolean): FoldBrowserCardsState {
  const { t } = useTranslation();
  useEffect(() => foldSession().retain(), []);
  const view = useFoldSequenceView();
  const { entries, words, exists, document, failed } = view;
  const merges = useFoldPrecreaseMerges(foldSession(), document.id, entries);
  return useMemo(
    () =>
      exists && document.steps.length > 0
        ? {
            status: 'ready',
            sequence: document.id,
            cards: foldBrowserCards(t, { document, entries, words, failed }, merge ? merges : []),
            mergeable: merges.length > 0,
          }
        : { status: 'empty' },
    [t, exists, document, entries, words, failed, merge, merges]
  );
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
  /** Merge symmetric precreases: the remembered setting, which Send steps to Diagram follows too. */
  merge: boolean;
  /** Whether anything on the path would merge, so the option is worth offering. */
  mergeable: boolean;
  setMerge: (value: boolean) => void;
  add: () => void;
  close: () => void;
  openFold: () => void;
}

/**
 * The Fold browser, a modal over the Diagram (plan D17), as the References
 * browser is (D20): the shown Fold sequence's active path as cards, the
 * selection (`usePullSelection`), and the pull, bound to the store. Every
 * card can be chosen once its step has landed; Finished, once the path ends
 * on a step that folds.
 */
export function useFoldBrowser(state: DiagramFoldBrowserState, provider: FoldBrowserProvider = APP_FOLD_PROVIDER): FoldBrowser {
  const diagram = useWorkspaceStore((store) => store.diagram);
  const merge = useSettingsStore((store) => store.diagramFoldMergePrecreases);
  const cards = provider.useCards(merge);
  const shown = cards.status === 'ready' ? cards.cards : NO_CARDS;
  // Another grouping is another list: a card's index names another step once runs merge or part.
  const listKey = cards.status === 'ready' ? `${cards.sequence}:${mergedRuns(shown)}` : '';
  const { selection, ...choose } = usePullSelection(shown, listKey, null, true);
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
    setMerge: (value) => useSettingsStore.getState().setDiagramFoldMergePrecreases(value),
    add,
    close: () => useWorkspaceStore.getState().closeDiagramFoldBrowser(),
    openFold: () => {
      useWorkspaceStore.getState().closeDiagramFoldBrowser();
      provider.openFold();
    },
  };
}

const NO_CARDS: readonly FoldBrowserCard[] = [];
const NO_USE: ReadonlyMap<number, number> = new Map();

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
