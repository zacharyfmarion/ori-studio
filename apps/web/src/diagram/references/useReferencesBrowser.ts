import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { reportError } from '../../monitoring';
import { decodeCachedPlan, type ReferencesCachedPlan } from '../../cp-workspace/references/referencesPlanCache';
import {
  referencesPlanCacheListing,
  referencesPlanCacheVersion,
  subscribeReferencesPlanCache,
} from '../../cp-workspace/references/referencesPlanCacheStore';
import { referencesResultsSnapshot, subscribeReferencesResults } from '../../cp-workspace/references/referencesResults';
import { referencesRevisionKey } from '../../cp-workspace/references/useReferencesView';
import {
  paperFallbackRect,
  precreaseInputFromTransport,
  type PrecreaseComponent,
  type SheetAnalysis,
} from '../../cp-workspace/references/sheetFrames';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  getPrecreaseClient,
  releasePrecreaseClient,
  retainPrecreaseClient,
} from '../../store/workspaceStore/precreaseRuntime';
import type { DiagramReferencesBrowserState } from '../../store/workspaceStore/types';
import { anchorTakesCard, stepIndex, type DiagramDocument, type DiagramPullAnchor } from '../document/diagramDocument';
import {
  browserFindCards,
  browserPlanCards,
  plannedPatterns,
  type BrowserCard,
  type BrowserPattern,
  type BrowserPlan,
} from './referencesBrowserPlans';
import { pullFromReferences, type PulledCard } from './referencesPulledSteps';
import {
  browserSelection,
  pullableCards,
  sameLine,
  shownCardIn,
  type BrowserSelection,
} from './referencesBrowserSelection';

/** Where the browser's patterns stand. */
export type BrowserPatternsState =
  | { status: 'no-pattern' }
  | { status: 'finding' }
  | { status: 'failed' }
  | { status: 'ready'; patterns: BrowserPattern[] };

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
  /** A press on a card: alone, with Shift a range from the last one pressed, with Cmd/Ctrl added or taken away. */
  press: (index: number, modifiers: { range: boolean; toggle: boolean }) => void;
  /**
   * The keyboard's walk: select the card before or after the last one
   * pressed, or the first or last, skipping any that cannot be added. The
   * card selected, or null with none to select.
   */
  move: (to: 'previous' | 'next' | 'first' | 'last') => number | null;
  selectAll: () => void;
  clear: () => void;
  /** Add the selection where the browser was opened for. */
  add: () => void;
  /** Add one card at once (a double-click). */
  addOne: (index: number) => void;
  close: () => void;
  openReferences: () => void;
}

/**
 * The References browser in the Diagram's centre (D20): the patterns with a
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
  const document = useWorkspaceStore((store) => store.oristudioCpDocument);
  const diagram = useWorkspaceStore((store) => store.diagram);
  const landmarksFirst = useWorkspaceStore((store) => store.referencesView.landmarksFirst);
  const activeCandidate = useWorkspaceStore((store) => store.referencesView.activeCandidate);
  const geometry = document?.geometry ?? null;
  const revision = referencesRevisionKey(document);

  // References' sheets, from the precrease worker, held while the browser is open.
  useEffect(() => {
    retainPrecreaseClient();
    return releasePrecreaseClient;
  }, []);
  const [frames, setFrames] = useState<{ revision: string; analysis: SheetAnalysis | null } | null>(null);
  useEffect(() => {
    if (!geometry || lastFrames?.revision === revision) return undefined;
    let live = true;
    const input = precreaseInputFromTransport(geometry);
    getPrecreaseClient()
      .sheetFrames(input.segments, input.colors, paperFallbackRect())
      .then((analysis) => {
        lastFrames = { revision, analysis };
        if (live) setFrames({ revision, analysis });
      })
      .catch((error: unknown) => {
        reportError(error, { surface: 'diagram:references-browser' });
        if (live) setFrames({ revision, analysis: null });
      });
    return () => {
      live = false;
    };
    // The analysis is of the creases, which the revision names: a new transport
    // for a selection-only change asks nothing again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);
  const analysis =
    frames?.revision === revision
      ? frames.analysis
      : lastFrames?.revision === revision
        ? lastFrames.analysis
        : undefined;

  const cacheVersion = useSyncExternalStore(subscribeReferencesPlanCache, referencesPlanCacheVersion);
  const loadSerial = document?.loadSerial ?? null;
  const patterns = useMemo((): BrowserPatternsState => {
    if (!document || !geometry) return { status: 'no-pattern' };
    if (analysis === undefined) return { status: 'finding' };
    if (analysis === null) return { status: 'failed' };
    const listing = loadSerial === null ? [] : referencesPlanCacheListing(loadSerial);
    return { status: 'ready', patterns: plannedPatterns(analysis, listing, precreaseInputFromTransport(geometry)) };
    // `cacheVersion` is when the listing can have changed: read again then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document, geometry, analysis, loadSerial, cacheVersion]);
  const listed = patterns.status === 'ready' ? patterns.patterns : [];
  const pattern = listed.find((candidate) => candidate.id === state.pattern) ?? listed[0] ?? null;

  // The shown pattern's plan, unpacked once.
  const [decoded, setDecoded] = useState<{ id: string; plan: ReferencesCachedPlan | null } | null>(null);
  const payload = pattern?.listing.payload ?? null;
  const patternId = pattern?.id ?? null;
  useEffect(() => {
    if (state.mode !== 'sequence' || patternId === null || payload === null) return undefined;
    let live = true;
    void decodeCachedPlan(payload).then((plan) => {
      if (live) setDecoded({ id: patternId, plan });
    });
    return () => {
      live = false;
    };
  }, [state.mode, patternId, payload]);

  const findResults = useSyncExternalStore(subscribeReferencesResults, () => referencesResultsSnapshot().results);
  const sequenceCards = useMemo((): BrowserCardsState => {
    if (!pattern || !geometry) return { status: 'none' };
    if (decoded?.id !== pattern.id) return { status: 'loading' };
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

  // The selection, for the list on screen: another pattern or mode starts afresh.
  const listKey = `${state.mode}|${state.mode === 'sequence' ? (pattern?.id ?? '') : (findResults?.revision ?? '')}`;
  const [picked, setPicked] = useState<{ list: string; selection: BrowserSelection }>({
    list: listKey,
    selection: browserSelection.empty(),
  });
  const selection = picked.list === listKey ? picked.selection : browserSelection.initial(shownCard);
  const select = (next: BrowserSelection) => setPicked({ list: listKey, selection: next });
  const [withTurnOver, setWithTurnOver] = useState(true);

  const finished = cards.status === 'ready' && cards.finished;
  const { pullable, turnOverBefore } = useMemo(
    () => pullableCards(shownList, selection.indices, { finished, withTurnOver }),
    [shownList, selection.indices, finished, withTurnOver]
  );

  const outline = useMemo(
    () => sheetOutline(state.mode === 'sequence' ? (pattern?.component ?? null) : findComponent(analysis, findResults)),
    [state.mode, pattern, analysis, findResults]
  );
  // A replaced step's words are the reader's unless they are still its card's (`pullReferencesSteps`).
  const shownSentence = shownCard !== null ? (shownList[shownCard]?.sentence ?? null) : null;
  const anchor = useMemo(
    (): DiagramPullAnchor =>
      state.anchor.kind === 'replace' ? { ...state.anchor, sentence: shownSentence } : state.anchor,
    [state.anchor, shownSentence]
  );
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
        anchor,
      }).finally(() => setPulling(false));
    },
    [outline, pulling, state.mode, anchor, cards, pattern]
  );

  const store = useWorkspaceStore.getState;
  const anchorStep = 'stepId' in state.anchor ? state.anchor.stepId : null;
  const anchorNumber = diagram && anchorStep !== null ? stepIndex(diagram, anchorStep) + 1 || null : null;
  const anchorTakesFirst = anchorTakesCard(diagram, state.anchor);

  return {
    state,
    patterns,
    pattern,
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
    press: (index, modifiers) => select(browserSelection.press(selection, index, modifiers)),
    move: (to) => {
      const next = browserSelection.step(shownList, selection.pivot, to);
      if (next !== null) select(browserSelection.press(selection, next, { range: false, toggle: false }));
      return next;
    },
    selectAll: () => select(browserSelection.all(shownList)),
    clear: () => select(browserSelection.empty()),
    add: () => pull(pullable),
    addOne: (index) => {
      const { pullable: one } = pullableCards(shownList, new Set([index]), { finished, withTurnOver: false });
      pull(one);
    },
    close: () => store().closeDiagramReferencesBrowser(),
    openReferences: () => store().openReferencesWorkspace(),
  };
}

const NO_CARDS: readonly BrowserCard[] = [];

/**
 * The last analysis of the creases, by their revision: the browser opened
 * again on the same pattern lists its patterns at once rather than asking the
 * worker again.
 */
let lastFrames: { revision: string; analysis: SheetAnalysis | null } | null = null;

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
  diagram.steps.forEach((step, index) => {
    const source = step.source;
    if (source?.kind !== 'references-step' || source.plan === undefined) return;
    patternUse.set(source.plan, (patternUse.get(source.plan) ?? 0) + 1);
    if (!pattern || source.plan !== pattern.id || !source.line) return;
    const card = cards.find((candidate) => sameLine(candidate.step?.card.line ?? null, source.line));
    if (card && !inDiagram.has(card.index)) inDiagram.set(card.index, index + 1);
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
