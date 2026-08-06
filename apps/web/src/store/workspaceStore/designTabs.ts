import type { DesignKindId } from '../../designKinds';
import {
  EMPTY_BOX_PLEAT_DESIGN,
  EMPTY_EXPLORI_DESIGN,
  EMPTY_TREEMAKER_DESIGN,
  createBoxPleatDesignState,
  createExploriDesignState,
  createTreemakerDesignState,
  type BoxPleatDesignState,
  type DesignTabContent,
  type TreemakerDesignState,
  type ExploriDesignState,
} from './designContent';
import type { DesignMethod } from './designVariant';
import type { Selection, ToolMode, TreeProject } from '../../lib/sampleProject';
import type { SymmetryAuthoringPair } from '../../lib/symmetryAuthoring';
import type { OptimizationReport } from '../../engine/types';
import type { HistoryEntry } from './types';
import type { SerializedDockview } from 'dockview';

/**
 * One design open in the Design workspace.
 *
 * Replaces the single `designMethod` scalar. The method is not a property of the
 * workspace — it is a property of the design being authored, and once several can
 * be open at once a workspace-level field cannot say which one it describes.
 *
 * Deliberately an **array** rather than a map plus an order list: the order *is*
 * the tab order, and keeping two structures in step would be exactly the kind of
 * duplicated fact this refactor exists to remove. Tab counts are small enough
 * that the linear lookups do not matter.
 */
interface DesignTabIdentity {
  /** Stable for the life of the tab; also the document id written to `.osf`. */
  id: string;
  /** User-editable tab name. */
  title: string;
  /**
   * How this design's panes are arranged, as dockview's serialized form.
   *
   * Per tab, not per workspace: two designs of the same kind can be laid out
   * differently, and one of a *different* kind has different panes entirely. It
   * rides along in the `.osf` (`viewState.paneLayout`) rather than local storage,
   * so reopening a project restores how it was being looked at.
   *
   * Typed loosely on purpose — the store carries it, dockview interprets it, and
   * `null` means "the kind's default arrangement".
   */
  paneLayout: SerializedDockview | null;
  /**
   * True while this tab's content exists only as serialized text.
   *
   * Opening a file registers every design's text with the document registry but
   * installs only the **active** design into the store — that is what keeps
   * opening a twelve-design project cheap. The others therefore hold an *empty*
   * project until someone reads their text back, and the canvas renders the
   * store, not the engine. Without this flag a background tab opened blank and
   * the design looked lost.
   *
   * One-shot: cleared the moment hydration starts, so a double activation cannot
   * run it twice.
   */
  pendingHydration: boolean;
}

/**
 * One design open in the Design workspace: its identity plus what it is
 * authoring.
 *
 * `kind` is `null` while the tab is still showing the chooser. That is a real
 * tab — it has a position and a title — which is what lets "close the last tab"
 * re-provision an empty one instead of leaving the workspace with nothing to
 * render.
 *
 * Intersecting with {@link DesignTabContent} rather than carrying a loose `kind`
 * field is what makes a tab's kind and its content inseparable; see the comment
 * on that type.
 */
export type DesignTab = DesignTabIdentity & DesignTabContent;

export const DEFAULT_DESIGN_TITLE = 'Untitled Design';

/**
 * Session-monotonic counter behind {@link nextDesignTabId}.
 *
 * Ids only have to be unique within one workspace, and readable ones make a
 * devtools session and an `.osf` far easier to follow than UUIDs. Uniqueness
 * against ids that arrived from a file is handled by {@link nextDesignTabId}
 * taking the tabs already present.
 */
let idCounter = 0;

export function nextDesignTabId(existing: readonly DesignTab[] = []): string {
  const taken = new Set(existing.map((tab) => tab.id));
  let id: string;
  do {
    idCounter += 1;
    id = `design-${idCounter}`;
  } while (taken.has(id));
  return id;
}

/** Reset the id counter. Tests only, so ids are predictable per test. */
export function resetDesignTabIds(): void {
  idCounter = 0;
}

/**
 * A title that does not collide with the tabs already open.
 *
 * The first tab is plain `Untitled Design`; only a duplicate takes a suffix, so a
 * lone tab never carries a pointless `1`.
 */
export function uniqueDesignTitle(
  existing: readonly DesignTab[],
  base: string = DEFAULT_DESIGN_TITLE
): string {
  const taken = new Set(existing.map((tab) => tab.title));
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}

export function createDesignTab(
  existing: readonly DesignTab[] = [],
  overrides: {
    kind?: DesignKindId | null;
    title?: string;
    paneLayout?: SerializedDockview | null;
    pendingHydration?: boolean;
  } = {}
): DesignTab {
  const identity: DesignTabIdentity = {
    id: nextDesignTabId(existing),
    title: overrides.title ?? uniqueDesignTitle(existing),
    paneLayout: overrides.paneLayout ?? null,
    // A tab created here is created *with* its content; only a tab read from a
    // file starts as text alone.
    pendingHydration: overrides.pendingHydration ?? false,
  };
  return { ...identity, ...contentForKind(overrides.kind ?? null) };
}

/**
 * A tab's identity, separated from what it is authoring.
 *
 * Every writer that swaps a tab's content arm rebuilds the tab, and each one used
 * to list the identity fields by hand — so adding one (`paneLayout`) would have
 * silently dropped it on the next method change or install. Spreading this
 * instead means a new identity field is carried everywhere by construction.
 */
function identityOf(tab: DesignTab): DesignTabIdentity {
  return {
    id: tab.id,
    title: tab.title,
    paneLayout: tab.paneLayout,
    pendingHydration: tab.pendingHydration,
  };
}

/** A fresh, empty content arm for a kind. */
function contentForKind(kind: DesignKindId | null): DesignTabContent {
  if (kind === 'treemaker') return { kind, treemaker: createTreemakerDesignState() };
  if (kind === 'box-pleat') return { kind, boxPleat: createBoxPleatDesignState() };
  if (kind === 'explori') return { kind, explori: createExploriDesignState() };
  return { kind: null };
}

/** The state slice these helpers read. Narrow, so tests need not build a store. */
export interface DesignTabsSlice {
  designTabs: DesignTab[];
  activeDesignId: string;
}

/**
 * The tab being authored.
 *
 * Total by construction: `designTabs` is never empty and `activeDesignId` always
 * names one of them (see the invariant note on the state fields). The fallback to
 * the first tab exists so a corrupted pairing degrades to a working workspace
 * rather than a crash — it should never be reached, and a dev assertion says so.
 */
export function activeDesignTab(state: DesignTabsSlice): DesignTab {
  const active = state.designTabs.find((tab) => tab.id === state.activeDesignId);
  if (active) return active;
  if (import.meta.env.DEV) {
    console.error(
      `[ori-studio] activeDesignId "${state.activeDesignId}" matches no tab; falling back to the first`
    );
  }
  return state.designTabs[0];
}

/** The design method of a tab, in the shape the layout and routing already speak. */
export function designMethodOf(tab: DesignTab): DesignMethod {
  return tab.kind ?? 'none';
}

/**
 * The active design's method.
 *
 * The replacement for reading `state.designMethod`. A selector rather than a
 * stored field, so it cannot disagree with the tab it describes.
 */
export function selectDesignMethod(state: DesignTabsSlice): DesignMethod {
  return designMethodOf(activeDesignTab(state));
}

/**
 * Whether the user has actually worked on this design — the predicate behind the
 * close confirmation.
 *
 * "Has content" is the obvious test and it is **wrong**. Choosing Box-pleated
 * runs `createSampleOristudioBpProject`, so a brand-new, untouched box-pleat tab
 * already holds a full sample tree and is already `dirty`; a content test would
 * prompt on every close of a tab nobody touched.
 *
 * Undo history is the right signal, and it needs no new bookkeeping: it is pushed
 * by the document's own mutations and not by provisioning, and it lives on the
 * tab, so it is per-design already. It is also kind-agnostic — a third design
 * kind inherits the right behaviour with no descriptor field at all.
 */
export function isDesignTouched(tab: DesignTab): boolean {
  if (tab.kind === 'treemaker') return tab.treemaker.historyPast.length > 0;
  if (tab.kind === 'box-pleat') return tab.boxPleat.historyPast.length > 0;
  if (tab.kind === 'explori') return tab.explori.historyPast.length > 0;
  return false;
}

/**
 * Replace one tab, returning the field to `set()`.
 *
 * Every write to a design goes through here, so there is one place that knows how
 * a tab is located.
 *
 * `designId` defaults to the active tab, which is right for a synchronous action:
 * nothing can move between reading the state and writing it. An **async** action
 * must pass the id it captured before its first await instead — the engine round
 * trip is exactly the window in which the user can switch tabs, and defaulting
 * there would write one design's result into another.
 */
function mapDesignTab(
  state: DesignTabsSlice,
  designId: string,
  next: (tab: DesignTab) => DesignTab
): Pick<DesignTabsSlice, 'designTabs'> {
  return {
    designTabs: state.designTabs.map((tab) => (tab.id === designId ? next(tab) : tab)),
  };
}

/** The tab an addressed write targets, or null if it has since been closed. */
function designTabById(state: DesignTabsSlice, designId: string): DesignTab | null {
  return state.designTabs.find((tab) => tab.id === designId) ?? null;
}

/**
 * Rename the active tab.
 *
 * Deliberately narrower than a general patch: `kind` is not settable here, because
 * setting a kind without its content is the state {@link DesignTabContent} exists
 * to make unrepresentable. Use `installTreemakerDesign` / `markActiveTabBoxPleat` /
 * `clearActiveDesignContent` instead.
 */
export function withActiveTab(
  state: DesignTabsSlice,
  patch: { title: string }
): Pick<DesignTabsSlice, 'designTabs'> {
  return mapDesignTab(state, state.activeDesignId, (tab) => ({ ...tab, title: patch.title }));
}

/**
 * Mark a design's content as materialized, so hydration never runs twice.
 *
 * Cleared *before* the read rather than after: hydration is asynchronous, and a
 * second activation while the first is in flight would otherwise start it again
 * and race two installs onto one tab.
 */
export function markDesignTabHydrated(
  state: DesignTabsSlice,
  designId: string
): Pick<DesignTabsSlice, 'designTabs'> {
  return mapDesignTab(state, designId, (tab) => ({ ...tab, pendingHydration: false }));
}

/** Record a design's pane arrangement. Identity-only, so any kind can use it. */
export function withDesignPaneLayout(
  state: DesignTabsSlice,
  designId: string,
  paneLayout: SerializedDockview | null
): Pick<DesignTabsSlice, 'designTabs'> {
  return mapDesignTab(state, designId, (tab) => ({ ...tab, paneLayout }));
}

/**
 * The active design's TreeMaker state, or `null` when the active design is of
 * another kind.
 *
 * The honest accessor — use it where the difference matters: every write, and any
 * reader that behaves differently for "no tree" than for "an empty tree".
 */
export function selectTreemakerDesign(
  state: DesignTabsSlice,
  designId: string = state.activeDesignId
): TreemakerDesignState | null {
  const tab = designId === state.activeDesignId ? activeDesignTab(state) : designTabById(state, designId);
  return tab?.kind === 'treemaker' ? tab.treemaker : null;
}

/**
 * The active design's TreeMaker state, falling back to an empty one.
 *
 * The **total** accessor, and what most read sites want. It preserves today's
 * behaviour exactly: before tabs, selecting a box-pleat design left `project` as
 * an empty `TreeProject` rather than removing it, so every incidental reader —
 * capability counts, the error boundary, the crease-pattern panel — already copes
 * with an empty tree and never saw a null.
 */
export function selectTreemakerDesignOrEmpty(
  state: DesignTabsSlice,
  designId?: string
): TreemakerDesignState {
  return selectTreemakerDesign(state, designId) ?? EMPTY_TREEMAKER_DESIGN;
}

/**
 * Field selectors over the active TreeMaker design.
 *
 * One per flat field these replaced, so a call site reads almost exactly as it
 * did — `selectProject(state)` becomes `selectProject(state)` — and the diff stays
 * reviewable. All total, all falling back to the empty design, all returning the
 * stored reference so Zustand's `Object.is` comparison behaves as before.
 */
/**
 * The field selectors take an optional design id for the same reason the writers
 * do: an async action reads its design's own state *after* an await, and the
 * active tab may no longer be the one it started in.
 */
export function selectProject(state: DesignTabsSlice, designId?: string): TreeProject {
  return selectTreemakerDesignOrEmpty(state, designId).project;
}

export function selectSelection(state: DesignTabsSlice, designId?: string): Selection {
  return selectTreemakerDesignOrEmpty(state, designId).selection;
}

export function selectToolMode(state: DesignTabsSlice): ToolMode {
  return selectTreemakerDesignOrEmpty(state).toolMode;
}

export function selectSymmetryAuthoringPairs(state: DesignTabsSlice, designId?: string): SymmetryAuthoringPair[] {
  return selectTreemakerDesignOrEmpty(state, designId).symmetryAuthoringPairs;
}

export function selectHistoryPast(state: DesignTabsSlice, designId?: string): HistoryEntry[] {
  return selectTreemakerDesignOrEmpty(state, designId).historyPast;
}

export function selectHistoryFuture(state: DesignTabsSlice, designId?: string): HistoryEntry[] {
  return selectTreemakerDesignOrEmpty(state, designId).historyFuture;
}

export function selectLastOptimization(state: DesignTabsSlice): OptimizationReport | null {
  return selectTreemakerDesignOrEmpty(state).lastOptimization;
}

export function selectDesignViewportFitRequestId(
  state: DesignTabsSlice,
  designId?: string
): number {
  return selectTreemakerDesignOrEmpty(state, designId).viewportFitRequestId;
}

/**
 * Install a TreeMaker design into the active tab: kind *and* content, in one step.
 *
 * Load and create paths use this. Because kind and content can never be set
 * separately, a tab cannot claim a method it has no design for — which is exactly
 * the contradiction that storing the kind would otherwise make possible.
 */
export function installTreemakerDesign(
  state: DesignTabsSlice,
  design: Partial<TreemakerDesignState> = {},
  designId: string = state.activeDesignId
): Pick<DesignTabsSlice, 'designTabs'> {
  return mapDesignTab(state, designId, (tab) => ({
    ...identityOf(tab),
    kind: 'treemaker',
    treemaker: createTreemakerDesignState(design),
  }));
}

/**
 * Patch the active tab's existing TreeMaker state.
 *
 * Edit paths use this. A no-op when the active design is of another kind:
 * reaching here means a tree action ran against a design that is not a tree,
 * which is a routing bug — better surfaced than papered over by installing a tree
 * the user never asked for.
 */
export function patchTreemakerDesign(
  state: DesignTabsSlice,
  patch: Partial<TreemakerDesignState>,
  designId: string = state.activeDesignId
): Pick<DesignTabsSlice, 'designTabs'> {
  const current = selectTreemakerDesign(state, designId);
  if (!current) {
    if (import.meta.env.DEV) {
      // With a stack: a guard that only says "someone did this" cannot be acted
      // on, and every one of these is a write landing on the wrong design.
      console.error(
        '[ori-studio] patchTreemakerDesign ran against a design that is not TreeMaker; ignoring',
        patch,
        new Error('patchTreemakerDesign caller').stack
      );
    }
    return { designTabs: state.designTabs };
  }
  return mapDesignTab(state, designId, (tab) => ({
    ...identityOf(tab),
    kind: 'treemaker',
    treemaker: { ...current, ...patch },
  }));
}

/**
 * The active design's Box-Pleat state, or `null` when the active design is of
 * another kind. The honest accessor; use it for every write.
 */
export function selectBoxPleatDesign(
  state: DesignTabsSlice,
  designId: string = state.activeDesignId
): BoxPleatDesignState | null {
  const tab = designId === state.activeDesignId ? activeDesignTab(state) : designTabById(state, designId);
  return tab?.kind === 'box-pleat' ? tab.boxPleat : null;
}

/** The active design's Box-Pleat state, falling back to an empty one. */
export function selectBoxPleatDesignOrEmpty(
  state: DesignTabsSlice,
  designId?: string
): BoxPleatDesignState {
  return selectBoxPleatDesign(state, designId) ?? EMPTY_BOX_PLEAT_DESIGN;
}

/**
 * The active design's ExplOri state, or `null` when the active design is of
 * another kind. The honest accessor; use it for every write.
 */
export function selectExploriDesign(
  state: DesignTabsSlice,
  designId: string = state.activeDesignId
): ExploriDesignState | null {
  const tab =
    designId === state.activeDesignId ? activeDesignTab(state) : designTabById(state, designId);
  return tab?.kind === 'explori' ? tab.explori : null;
}

/** The active design's ExplOri state, falling back to an empty one. */
export function selectExploriDesignOrEmpty(
  state: DesignTabsSlice,
  designId?: string
): ExploriDesignState {
  return selectExploriDesign(state, designId) ?? EMPTY_EXPLORI_DESIGN;
}

/**
 * Write to one ExplOri design, naming it.
 *
 * `designId` is required rather than defaulted, unlike the synchronous helpers:
 * every ExplOri write worth making happens after an `await` — a query returning,
 * a document being hydrated — and defaulting to the active design is precisely
 * the bug that would cause.
 */
export function patchExploriDesign(
  state: DesignTabsSlice,
  designId: string,
  patch: Partial<ExploriDesignState>
): Pick<DesignTabsSlice, 'designTabs'> {
  const current = selectExploriDesign(state, designId);
  if (!current) {
    if (import.meta.env.DEV) {
      console.error(
        '[ori-studio] patchExploriDesign ran against a design that is not ExplOri; ignoring',
        patch,
        new Error('patchExploriDesign caller').stack
      );
    }
    return { designTabs: state.designTabs };
  }
  return mapDesignTab(state, designId, (tab) => ({
    ...identityOf(tab),
    kind: 'explori',
    explori: { ...current, ...patch },
  }));
}

export function selectOristudioBpDocument(state: DesignTabsSlice, designId?: string) {
  return selectBoxPleatDesignOrEmpty(state, designId).document;
}

export function selectOristudioBpSelection(state: DesignTabsSlice, designId?: string) {
  return selectBoxPleatDesignOrEmpty(state, designId).selection;
}

export function selectOristudioBpHistoryPast(state: DesignTabsSlice, designId?: string) {
  return selectBoxPleatDesignOrEmpty(state, designId).historyPast;
}

export function selectOristudioBpHistoryFuture(state: DesignTabsSlice, designId?: string) {
  return selectBoxPleatDesignOrEmpty(state, designId).historyFuture;
}

export function selectOristudioBpViewportFitRequestId(state: DesignTabsSlice, designId?: string) {
  return selectBoxPleatDesignOrEmpty(state, designId).viewportFitRequestId;
}

export function selectOristudioBpSymmetry(state: DesignTabsSlice, designId?: string) {
  return selectBoxPleatDesignOrEmpty(state, designId).symmetry;
}

/**
 * Claim the active tab for a box-pleat design: kind *and* content together.
 *
 * The content may legitimately have `document: null` — choosing Box-pleated is
 * asynchronous, and the pane shows a loading state while the worker builds it.
 * That window is why the kind cannot be derived from content.
 */
export function installBoxPleatDesign(
  state: DesignTabsSlice,
  design: Partial<BoxPleatDesignState> = {},
  designId: string = state.activeDesignId
): Pick<DesignTabsSlice, 'designTabs'> {
  return mapDesignTab(state, designId, (tab) => ({
    ...identityOf(tab),
    kind: 'box-pleat',
    boxPleat: createBoxPleatDesignState(design),
  }));
}

/**
 * Patch the active tab's existing Box-Pleat state.
 *
 * A no-op when the active design is of another kind — see the note on
 * {@link patchTreemakerDesign}; the same reasoning applies.
 */
export function patchBoxPleatDesign(
  state: DesignTabsSlice,
  patch: Partial<BoxPleatDesignState>,
  designId: string = state.activeDesignId
): Pick<DesignTabsSlice, 'designTabs'> {
  const current = selectBoxPleatDesign(state, designId);
  if (!current) {
    if (import.meta.env.DEV) {
      console.error(
        '[ori-studio] patchBoxPleatDesign ran against a design that is not box-pleat; ignoring',
        patch,
        new Error('patchBoxPleatDesign caller').stack
      );
    }
    return { designTabs: state.designTabs };
  }
  return mapDesignTab(state, designId, (tab) => ({
    ...identityOf(tab),
    kind: 'box-pleat',
    boxPleat: { ...current, ...patch },
  }));
}

/**
 * Claim the active tab for box-pleat without a document yet.
 *
 * Kept as a named alias of `installBoxPleatDesign()` because the call sites that
 * use it are saying something specific: the *route* or the chooser has decided
 * the kind, and provisioning follows.
 */
export function markActiveTabBoxPleat(
  state: DesignTabsSlice,
  designId: string = state.activeDesignId
): Pick<DesignTabsSlice, 'designTabs'> {
  return installBoxPleatDesign(state, {}, designId);
}

/**
 * Replace the whole tab set with one empty chooser tab.
 *
 * What "this file establishes no design" actually means. `clearActiveDesignContent`
 * clears **one** tab, which is the same thing only when one tab is open — so
 * opening a crease-pattern-only project, or starting a new one, left every other
 * design from the previous project sitting in the strip. Worse, the load had
 * already forgotten their engine documents, so visiting one showed a design whose
 * engine was empty, and the next save wrote them into the new file.
 */
export function resetDesignTabs(state: DesignTabsSlice): DesignTabsSlice {
  // Seeded from the tabs being replaced so the new tab cannot reuse an id that
  // was just forgotten — the same reason `closeDesignTab` does it.
  const replacement = createDesignTab(state.designTabs);
  return { designTabs: [replacement], activeDesignId: replacement.id };
}

/** Clear the active tab back to the chooser, dropping whatever it was authoring. */
export function clearActiveDesignContent(
  state: DesignTabsSlice,
  designId: string = state.activeDesignId
): Pick<DesignTabsSlice, 'designTabs'> {
  // Rebuilt rather than spread-with-undefined so a discarded arm cannot linger on
  // the object and resurface through a stale cast.
  return mapDesignTab(state, designId, (tab) => ({ ...identityOf(tab), kind: null }));
}

/**
 * A one-tab workspace holding a TreeMaker design.
 *
 * The seed for tests and for any caller that wants "a workspace with this tree in
 * it" in one expression, rather than building a tab and then patching it.
 */
export function singleTreemakerDesignTab(
  design: Partial<TreemakerDesignState> = {},
  title?: string
): DesignTabsSlice {
  const seeded = singleDesignTab('treemaker', title);
  return { ...seeded, ...installTreemakerDesign(seeded, design) };
}

/**
 * A one-tab workspace holding a Box-Pleat design. Companion to
 * {@link singleTreemakerDesignTab}.
 */
export function singleBoxPleatDesignTab(
  design: Partial<BoxPleatDesignState> = {},
  title?: string
): DesignTabsSlice {
  const seeded = singleDesignTab('box-pleat', title);
  return { ...seeded, ...installBoxPleatDesign(seeded, design) };
}

/** A one-tab workspace authoring `kind`. Seeds the initial state and tests. */
export function singleDesignTab(
  kind: DesignKindId | null = null,
  title?: string
): DesignTabsSlice {
  const tab = createDesignTab([], { kind, title });
  return { designTabs: [tab], activeDesignId: tab.id };
}

/**
 * The initial single tab: one design, no method chosen, chooser showing.
 *
 * A fresh session starts with a tab rather than with nothing, which is what makes
 * `activeDesignId` a plain `string` instead of `string | null` and removes the
 * "no design open" state from every consumer.
 */
export function initialDesignTabs(): DesignTabsSlice {
  return singleDesignTab(null);
}
