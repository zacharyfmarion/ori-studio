import type { OptimizationReport } from '../../engine/types';
import { createEmptyProject } from '../../lib/sampleProject';
import type { Selection, ToolMode, TreeProject } from '../../lib/sampleProject';
import type { SymmetryAuthoringPair } from '../../lib/symmetryAuthoring';
import type { BpHistorySnapshot, HistoryEntry, OristudioBpSymmetryState } from './types';
import {
  emptyOristudioBpSelection,
  type OristudioBpDocumentState,
  type OristudioBpSelection,
} from '../../engine/oristudioBpTypes';
import { BP_TREE_SYMMETRY_ANGLE, defaultBpDocumentSymmetry } from '../../lib/bpTreeSymmetry';
import type { SnapshotEntry } from './snapshotHistory';
import { createExploriDocument, type ExploriDocument } from '../../explori/document';
import type { ExploriResult } from '../../explori/types';
import type { TreeSelectionTarget } from '../../tree-editor/model';

/**
 * The per-design state of an ExplOri (22.5° archive search) design.
 *
 * `document` is the authored query and the chosen result — everything a saved
 * file holds. `results` is the rest of the last result set, which deliberately
 * is *not* saved: the archive is not versioned, so a design whose meaning
 * depends on re-running a query is one that can silently become a different
 * design. See `explori/document.ts`.
 */
export interface ExploriDesignState {
  document: ExploriDocument;
  selection: TreeSelectionTarget | null;
  /** The last result set. Session-only; a park or a save drops it. */
  results: ExploriResult[];
  /** Set while a query is in flight, so the pane can say so. */
  searching: boolean;
  /**
   * Whether a query has come back at all this session.
   *
   * An empty `results` means two different things — "you have not searched yet"
   * and "the archive has nothing like this tree" — and the pane has to say which.
   * Session-only for the same reason `results` is: the set is not saved, so a
   * reopened design has genuinely not searched.
   */
  searched: boolean;
  /** The last query's failure, as a message already localized. */
  error: string | null;
  /** Which result the detail view is showing, by index into `results`. */
  detailIndex: number | null;
  historyPast: string[];
  historyFuture: string[];
  viewportFitRequestId: number;
}

export function createExploriDesignState(
  overrides: Partial<ExploriDesignState> = {},
): ExploriDesignState {
  return {
    document: createExploriDocument(),
    selection: { kind: 'vertex', id: 0 },
    results: [],
    searching: false,
    searched: false,
    error: null,
    detailIndex: null,
    historyPast: [],
    historyFuture: [],
    viewportFitRequestId: 0,
    ...overrides,
  };
}

/**
 * The per-design state of a TreeMaker (circle-packed) design.
 *
 * Everything here used to be a flat field on the workspace store, which was
 * correct while exactly one design could be open. It is not workspace state — it
 * is one design's state, and with tabs that distinction becomes load-bearing.
 */
export interface TreemakerDesignState {
  project: TreeProject;
  selection: Selection;
  toolMode: ToolMode;
  symmetryAuthoringPairs: SymmetryAuthoringPair[];
  /**
   * Undo/redo for this design, as serialized `.tmd5` snapshots.
   *
   * Text rather than structured state because that is already how undo works —
   * `undoTree` round-trips through `saveTmd5`/`loadTreeFromText` on every step.
   * Keeping it here is also what makes cross-tab undo impossible by construction:
   * the only history reachable from the store is the active design's.
   */
  historyPast: HistoryEntry[];
  historyFuture: HistoryEntry[];
  lastOptimization: OptimizationReport | null;
  /** Bumped when something reframes the design enough to refit the camera. */
  viewportFitRequestId: number;
}

export function createTreemakerDesignState(
  overrides: Partial<TreemakerDesignState> = {},
): TreemakerDesignState {
  return {
    project: createEmptyProject(),
    selection: { kind: 'tree' },
    toolMode: 'select',
    symmetryAuthoringPairs: [],
    historyPast: [],
    historyFuture: [],
    lastOptimization: null,
    viewportFitRequestId: 0,
    ...overrides,
  };
}

/**
 * The per-design state of a Box-Pleat design.
 *
 * `document` is nullable, and that is load-bearing rather than sloppy: choosing
 * Box-pleated is asynchronous, and the design pane shows "Preparing the box-pleat
 * editor…" during the window between the kind being claimed and the worker
 * answering. A tab therefore has to be able to *be* box-pleat before it has a
 * document — which is exactly why the kind cannot be derived from content.
 */
export interface BoxPleatDesignState {
  document: OristudioBpDocumentState | null;
  /**
   * What the user has selected in the BP surfaces. Session state, not document
   * state — it sits beside the document rather than inside it so its lifetime is
   * visible, and so replacing the document after an edit need not carry it.
   */
  selection: OristudioBpSelection;
  historyPast: SnapshotEntry<BpHistorySnapshot>[];
  historyFuture: SnapshotEntry<BpHistorySnapshot>[];
  /**
   * Bumped when something reframes the packing worth re-fitting the camera for.
   * The packing pane folds this into its `fitKey`, so ordinary edits leave the
   * camera alone but an optimize frames the result.
   */
  viewportFitRequestId: number;
  symmetry: OristudioBpSymmetryState;
}

export function createBoxPleatDesignState(
  overrides: Partial<BoxPleatDesignState> = {},
): BoxPleatDesignState {
  return {
    document: null,
    selection: emptyOristudioBpSelection(),
    historyPast: [],
    historyFuture: [],
    viewportFitRequestId: 0,
    // Defaults off (see `defaultBpDocumentSymmetry`); `loc` is re-centred on the
    // sheet on every document load (see `setLoadedBpProject`), so this pre-load
    // {0,0} is a placeholder.
    symmetry: {
      ...defaultBpDocumentSymmetry(),
      angle: BP_TREE_SYMMETRY_ANGLE,
      loc: { x: 0, y: 0 },
    },
    ...overrides,
  };
}

/**
 * What a tab is authoring, discriminated by its kind.
 *
 * The union is the point. A tab holding `kind: 'treemaker'` beside a box-pleat
 * document is not something to guard against with an invariant test — it does not
 * typecheck. The kind has to exist before the design has any content (a fresh
 * circle-packed design is a genuinely empty tree), so it cannot be derived from
 * content; storing it is only safe if the content is stored *with* it.
 *
 */
export type DesignTabContent =
  | { kind: null }
  | { kind: 'treemaker'; treemaker: TreemakerDesignState }
  | { kind: 'box-pleat'; boxPleat: BoxPleatDesignState }
  | { kind: 'explori'; explori: ExploriDesignState };

/**
 * An empty tree and an empty TreeMaker design, shared by every read that lands on
 * a design of another kind.
 *
 * Frozen and reused rather than rebuilt per call: these reads run inside Zustand
 * selectors, and a fresh object each time would fail the `Object.is` check and
 * re-render every subscriber on every unrelated store change.
 */
export const EMPTY_PROJECT: TreeProject = Object.freeze(createEmptyProject());

export const EMPTY_TREEMAKER_DESIGN: TreemakerDesignState = Object.freeze(
  createTreemakerDesignState({ project: EMPTY_PROJECT }),
);

export const EMPTY_BOX_PLEAT_DESIGN: BoxPleatDesignState = Object.freeze(
  createBoxPleatDesignState(),
);

export const EMPTY_EXPLORI_DESIGN: ExploriDesignState = Object.freeze(createExploriDesignState());
