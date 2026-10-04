import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { reportError } from '../../monitoring';
import { referencesResultsSnapshot, subscribeReferencesResults } from '../../cp-workspace/references/referencesResults';
import type { PrecreaseComponent, SheetAnalysis } from '../../cp-workspace/references/sheetFrames';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DiagramReferencesBrowserState } from '../../store/workspaceStore/types';
import {
  anchorTakesCard,
  stepNumber,
  stepNumbers,
  stepsAround,
  stepsOf,
  type DiagramDocument,
} from '../document/diagramDocument';
import {
  browserFindCards,
  browserPlanCards,
  sheetPattern,
  type BrowserCard,
  type BrowserPattern,
  type BrowserPlan,
} from './referencesBrowserPlans';
import { pullFromReferences, type PulledCard } from './referencesPulledSteps';
import { useDecodedPlan, useReferencesSheets, type BrowserPatternsState } from './useReferencesSheets';
import {
  browserSelection,
  pullableCards,
  sameLine,
  shownCardIn,
  type BrowserSelection,
  type BrowserStep,
} from './referencesBrowserSelection';

export type { BrowserPatternsState } from './useReferencesSheets';

/** Where the cards of the list shown stand. */
export type BrowserCardsState =
  | { status: 'none' }
  | { status: 'loading' }
  /** A plan this build cannot read, or a Find answer for another state of the pattern. */
  | { status: 'unreadable' }
  | { status: 'stale' }
  | { status: 'ready'; cards: BrowserCard[]; finished: boolean; settings: BrowserPlan['settings'] | null };

export interface ReferencesBrowser {
  state: DiagramReferencesBrowserState;
  patterns: BrowserPatternsState;
  /** The pattern shown, in Sequence. */
  pattern: BrowserPattern | null;
  /**
   * Whether that is the pattern the browser's state names — by its plan, or,
   * once that plan is gone, by its sheet — rather than the first for want of one.
   */
  patternNamed: boolean;
  cards: BrowserCardsState;
  /** The steps already made from the shown pattern's cards: card index to step number. */
  inDiagram: ReadonlyMap<number, number>;
  /** How many steps each pattern already gave the diagram, by its id. */
  patternUse: ReadonlyMap<string, number>;
  /** The card the replaced step was made from, when it is in the list shown. */
  shownCard: number | null;
  selection: BrowserSelection;
  /** The steps the selection would add, in order: what the footer offers. */
  pullable: PulledCard[];
  /** A pull is finding its sheet: the verbs wait for it. */
  pulling: boolean;
  /** The turn-over just before the selection, offered with it. */
  turnOverBefore: number | null;
  withTurnOver: boolean;
  setWithTurnOver: (value: boolean) => void;
  /** The diagram's step the anchor names, 1-based; null for the end. */
  anchorNumber: number | null;
  /**
   * Whether the anchor's own step takes the first card: an empty step to
   * fill, or a References step to replace, while it still is one.
   */
  anchorTakesFirst: boolean;
  choosePattern: (id: string) => void;
  setMode: (mode: 'sequence' | 'find') => void;
  /** A press on a card: it is added or taken away; with Shift, so is every card from the last one pressed (`browserSelection.press`). */
  press: (index: number, modifiers: { range: boolean }) => void;
  /**
   * The keyboard's walk: to the card before or after the one the keyboard is
   * on, or the first or last, skipping any that does not read, choosing
   * nothing. The card it lands on, or null with none to land on.
   */
  move: (to: BrowserStep) => number | null;
  /** A card took focus (Tab, a press, the dialog's own move): the keyboard is on it now. */
  focusOn: (index: number) => void;
  /** The walk with Shift: the card it lands on is pressed as Shift+press does. It returns that card. */
  extend: (to: BrowserStep) => number | null;
  /** Space: press the card the keyboard is on. */
  toggle: () => void;
  selectAll: () => void;
  clear: () => void;
  /** Add the selection where the browser was opened for. */
  add: () => void;
  close: () => void;
  openReferences: () => void;
}

/**
 * The References browser, a modal over the Diagram (D20): the patterns with a
 * plan, their cards, the selection, and the pull, bound to the store.
 *
 * The patterns are References' sheets (`sheetFrames` in the precrease worker,
 * held while the browser is open) that the plan cache holds a current plan
 * for; it is listed again whenever the cache says it changed. A plan is
 * unpacked once per pattern shown, and its cards drawn as References draws
 * them (`referencesBrowserPlans.ts`). Find shows the answer References has
 * on screen, while it is for the pattern as it is now.
 */
export function useReferencesBrowser(state: DiagramReferencesBrowserState): ReferencesBrowser {
  const { t } = useTranslation();
  const diagram = useWorkspaceStore((store) => store.diagram);
  const landmarksFirst = useWorkspaceStore((store) => store.referencesView.landmarksFirst);
  const activeCandidate = useWorkspaceStore((store) => store.referencesView.activeCandidate);
  // References' sheets and the planned patterns, held while the browser is open.
  const { geometry, revision, analysis, patterns } = useReferencesSheets();
  const listed = patterns.status === 'ready' ? patterns.patterns : [];
  const named = listed.find((candidate) => candidate.id === state.pattern) ?? sheetPattern(listed, state.sheet) ?? null;
  const pattern = named ?? listed[0] ?? null;

  // The shown pattern's plan, unpacked once.
  const decoded = useDecodedPlan(state.mode === 'sequence' ? pattern : null);

  const findResults = useSyncExternalStore(subscribeReferencesResults, () => referencesResultsSnapshot().results);
  const sequenceCards = useMemo((): BrowserCardsState => {
    if (!pattern || !geometry) return { status: 'none' };
    if (!decoded) return { status: 'loading' };
    if (!decoded.plan) return { status: 'unreadable' };
    try {
      const plan = browserPlanCards(t, decoded.plan, pattern, geometry, landmarksFirst, revision);
      return { status: 'ready', cards: plan.cards, finished: plan.finished, settings: plan.settings };
    } catch (error) {
      reportError(error, { surface: 'diagram:references-browser' });
      return { status: 'unreadable' };
    }
  }, [pattern, geometry, decoded, t, landmarksFirst, revision]);
  const findCards = useMemo((): BrowserCardsState => {
    if (!findResults) return { status: 'none' };
    if (findResults.revision !== revision) return { status: 'stale' };
    const candidate = findResults.candidates[activeCandidate] ?? findResults.candidates[0];
    if (!candidate) return { status: 'none' };
    return { status: 'ready', cards: browserFindCards(t, findResults, candidate), finished: false, settings: null };
  }, [findResults, revision, activeCandidate, t]);
  const cards = state.mode === 'sequence' ? sequenceCards : findCards;
  const shownList = cards.status === 'ready' ? cards.cards : NO_CARDS;

  // What is already in the diagram, from the plans the browser lists.
  const { inDiagram, patternUse } = useMemo(
    () => diagramUse(diagram, state.mode === 'sequence' ? pattern : null, shownList),
    [diagram, state.mode, pattern, shownList]
  );
  const shownCard = useMemo(
    () => (state.mode === 'sequence' ? shownCardIn(shownList, pattern?.id ?? null, state.shown) : null),
    [state.mode, state.shown, pattern, shownList]
  );

  // The selection, for the list on screen: another pattern or mode starts
  // afresh. Until the first press in a list it is what the list opens with —
  // the replaced step's card, once the plan is read — however soon the list
  // itself was known.
  const listKey = `${state.mode}|${state.mode === 'sequence' ? (pattern?.id ?? '') : (findResults?.revision ?? '')}`;
  const [picked, setPicked] = useState<{ list: string | null; selection: BrowserSelection }>({
    list: null,
    selection: browserSelection.empty(),
  });
  const selection = picked.list === listKey ? picked.selection : browserSelection.initial(shownCard);
  // A change to the selection as it stands by then: a Shift+arrow extends it
  // and focuses the card it lands on, whose onFocus asks again in the same
  // event — and must see the extension, not this render's selection.
  const select = (change: (current: BrowserSelection) => BrowserSelection) =>
    setPicked((prev) => {
      const current = prev.list === listKey ? prev.selection : browserSelection.initial(shownCard);
      const next = change(current);
      return next === current && prev.list === listKey ? prev : { list: listKey, selection: next };
    });
  const [withTurnOver, setWithTurnOver] = useState(true);

  const outline = useMemo(
    () => sheetOutline(state.mode === 'sequence' ? (pattern?.component ?? null) : findComponent(analysis, findResults)),
    [state.mode, pattern, analysis, findResults]
  );
  // Nothing is added without the sheet it goes on: a Find answer before the
  // patterns are found, or when they could not be.
  const finished = cards.status === 'ready' && cards.finished;
  // A replaced card is one step's picture: no turn-over comes with it.
  const offersTurnOver = state.anchor.kind !== 'replace';
  const { pullable, turnOverBefore } = useMemo(() => {
    if (!outline) return { pullable: [], turnOverBefore: null };
    const pulled = pullableCards(shownList, selection.indices, { finished, withTurnOver: withTurnOver && offersTurnOver });
    return offersTurnOver ? pulled : { ...pulled, turnOverBefore: null };
  }, [outline, shownList, selection.indices, finished, withTurnOver, offersTurnOver]);
  // A pull finds its sheet in the segmentation first: held meanwhile, so a
  // second press cannot add the cards twice.
  const [pulling, setPulling] = useState(false);
  const pull = useCallback(
    (chosen: PulledCard[]) => {
      if (chosen.length === 0 || !outline || pulling) return;
      setPulling(true);
      void pullFromReferences({
        cards: chosen,
        outline,
        mode: state.mode,
        settings: state.mode === 'sequence' && cards.status === 'ready' ? cards.settings : null,
        plan: state.mode === 'sequence' ? (pattern?.id ?? null) : null,
        anchor: state.anchor,
        opening: state.opening,
      }).finally(() => setPulling(false));
    },
    [outline, pulling, state.mode, state.anchor, state.opening, cards, pattern]
  );

  const store = useWorkspaceStore.getState;
  const anchorStep = 'stepId' in state.anchor ? state.anchor.stepId : null;
  // After a turn, the step before it: the cards go after both.
  const anchorNumber =
    diagram && anchorStep !== null
      ? (stepNumber(diagram, anchorStep) ?? stepsAround(diagram, anchorStep).before)
      : null;
  const anchorTakesFirst = anchorTakesCard(diagram, state.anchor);

  return {
    state,
    patterns,
    pattern,
    patternNamed: named !== null,
    cards,
    inDiagram,
    patternUse,
    shownCard,
    selection,
    pullable,
    pulling,
    turnOverBefore,
    withTurnOver,
    setWithTurnOver,
    anchorNumber,
    anchorTakesFirst,
    choosePattern: (id) => store().setDiagramReferencesBrowser({ pattern: id }),
    setMode: (mode) => store().setDiagramReferencesBrowser({ mode }),
    press: (index, { range }) => select((current) => browserSelection.press(current, shownList, index, { range, finished })),
    move: (to) => {
      const next = browserSelection.step(shownList, selection.focus, to);
      if (next !== null) select((current) => browserSelection.moveTo(current, next));
      return next;
    },
    focusOn: (index) =>
      select((current) => (current.focus === index ? current : browserSelection.moveTo(current, index))),
    extend: (to) => {
      const next = browserSelection.step(shownList, selection.focus, to);
      if (next !== null) select((current) => browserSelection.press(current, shownList, next, { range: true, finished }));
      return next;
    },
    toggle: () => {
      const at = selection.focus ?? browserSelection.step(shownList, null, 'next');
      if (at !== null) select((current) => browserSelection.press(current, shownList, at, { range: false, finished }));
    },
    selectAll: () => select(() => browserSelection.all(shownList, finished)),
    clear: () => select(() => browserSelection.empty()),
    add: () => pull(pullable),
    close: () => store().closeDiagramReferencesBrowser(),
    openReferences: () => store().openReferencesWorkspace(),
  };
}

const NO_CARDS: readonly BrowserCard[] = [];




/**
 * The steps made from the shown pattern's plan (its cache key, recorded as a
 * step is pulled), by the card each was made from — a fold by its line, which
 * stays put while Landmarks first renumbers the cards — and how many steps
 * each listed pattern gave.
 */
function diagramUse(
  diagram: DiagramDocument | null,
  pattern: BrowserPattern | null,
  cards: readonly BrowserCard[]
): { inDiagram: Map<number, number>; patternUse: Map<string, number> } {
  const inDiagram = new Map<number, number>();
  const patternUse = new Map<string, number>();
  if (!diagram) return { inDiagram, patternUse };
  const numbers = stepNumbers(diagram);
  stepsOf(diagram).forEach((step) => {
    const source = step.source;
    if (source?.kind !== 'references-step' || source.plan === undefined) return;
    patternUse.set(source.plan, (patternUse.get(source.plan) ?? 0) + 1);
    if (!pattern || source.plan !== pattern.id || !source.line) return;
    const card = cards.find((candidate) => sameLine(candidate.step?.card.line ?? null, source.line));
    if (card && !inDiagram.has(card.index)) inDiagram.set(card.index, numbers.get(step.id)!);
  });
  return { inDiagram, patternUse };
}

/** The sheet a Find answer is on, in this analysis of the creases. */
function findComponent(
  analysis: SheetAnalysis | null | undefined,
  results: ReturnType<typeof referencesResultsSnapshot>['results']
): PrecreaseComponent | null {
  if (!analysis || !results) return null;
  return analysis.components.find((component) => component.id === results.target.component) ?? null;
}

function sheetOutline(component: PrecreaseComponent | null): readonly (readonly [number, number])[] | null {
  return component && component.outline.length > 0 ? component.outline : null;
}
