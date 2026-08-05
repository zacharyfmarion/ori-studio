import type { OptimizationReport } from '../../engine/types';
import { createEmptyProject } from '../../lib/sampleProject';
import type { Selection, ToolMode, TreeProject } from '../../lib/sampleProject';
import type { SymmetryAuthoringPair } from '../../lib/symmetryAuthoring';
import type { HistoryEntry } from './types';

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
  overrides: Partial<TreemakerDesignState> = {}
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
 * What a tab is authoring, discriminated by its kind.
 *
 * The union is the point. A tab holding `kind: 'treemaker'` beside a box-pleat
 * document is not something to guard against with an invariant test — it does not
 * typecheck. The kind has to exist before the design has any content (a fresh
 * circle-packed design is a genuinely empty tree), so it cannot be derived from
 * content; storing it is only safe if the content is stored *with* it.
 *
 * Box-pleat's arm arrives in phase 2c. Until then a box-pleat tab carries no
 * content here and its state stays in the flat `oristudioBp*` fields — which is
 * why that arm is currently payload-free rather than absent.
 */
export type DesignTabContent =
  | { kind: null }
  | { kind: 'treemaker'; treemaker: TreemakerDesignState }
  | { kind: 'box-pleat' };

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
  createTreemakerDesignState({ project: EMPTY_PROJECT })
);
