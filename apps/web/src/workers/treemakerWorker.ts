import { expose } from 'comlink';
import init, {
  apply_edit,
  build_crease_pattern,
  export_fold,
  export_v4,
  fold_artifacts,
  free_tree,
  load_tmd,
  new_design,
  optimize_edges,
  optimize_scale,
  optimize_strain,
  save_tmd5,
  sequence_analyze_fold,
  sequence_plan_fold,
  sequence_plan_fold_with_target,
  tree_snapshot,
} from '../generated/treemaker-wasm/treemaker_wasm';
import type {
  EditReport,
  FoldArtifacts,
  OptimizationReport,
  SequencePlan,
  SequencePlanFoldResult,
  SequenceTargetState,
  TreeEdit,
  TreeSnapshot,
  WasmErrorEnvelope,
} from '../engine/types';
import { foldArtifactsFromFold } from '../lib/creasePatternImport';
import {
  segmentFoldDocument,
} from '../lib/creasePatternSegmentation';

let ready: Promise<void> | null = null;

async function ensureReady() {
  ready ??= init().then(() => undefined);
  await ready;
}

function normalizeError(error: unknown): WasmErrorEnvelope {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    'message' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    return error as WasmErrorEnvelope;
  }
  return {
    code: 'wasm_error',
    message: error instanceof Error ? error.message : String(error),
  };
}

async function call<T>(fn: () => T): Promise<T> {
  await ensureReady();
  try {
    return fn();
  } catch (error) {
    throw normalizeError(error);
  }
}

/**
 * Attach the triangulated simulation mesh to a TreeMaker design's fold
 * artifacts. The engine hands over the crease pattern only; the mesh is built
 * here by the same TypeScript preparation an editable crease pattern goes
 * through, which is also the one the solver itself re-runs on entry.
 *
 * In the worker rather than in `computeFoldArtifacts` for two reasons: it covers
 * both callers of `foldArtifacts` (loading artifacts and Build CP), and
 * triangulating a large pattern takes seconds that the main thread should not
 * spend.
 *
 * An engine-level `simulation_model_error` — a design whose crease pattern is
 * not complete — is left to stand: there is nothing worth meshing behind it.
 */
function withSimulationModel(artifacts: FoldArtifacts): FoldArtifacts {
  if (artifacts.simulation_model_error) return artifacts;
  const prepared = foldArtifactsFromFold(artifacts.fold);
  return {
    ...artifacts,
    fold: prepared.fold,
    simulation_model: prepared.simulation_model,
    simulation_model_error: prepared.simulation_model_error,
  };
}

/**
 * Attach crease-pattern segments to fold artifacts. Runs here in the worker so
 * the O(V+E+F) graph walk never touches the main thread, even for large
 * documents. Segmentation failures must not break folding, so they are
 * swallowed (the document simply behaves as a single pattern).
 */
function withSegments(artifacts: FoldArtifacts): FoldArtifacts {
  try {
    artifacts.segments = segmentFoldDocument(artifacts.fold);
  } catch {
    artifacts.segments = [];
  }
  return artifacts;
}

const api = {
  async newDesign(config?: { paper_width?: number; paper_height?: number }): Promise<number> {
    return call(() => new_design(config ?? null));
  },
  async loadTmd(text: string): Promise<number> {
    return call(() => load_tmd(text));
  },
  async snapshot(handle: number): Promise<TreeSnapshot> {
    return call(() => tree_snapshot(handle) as TreeSnapshot);
  },
  async applyEdit(handle: number, edit: TreeEdit): Promise<EditReport> {
    return call(() => apply_edit(handle, edit) as EditReport);
  },
  async optimizeScale(handle: number): Promise<OptimizationReport> {
    return call(() => optimize_scale(handle) as OptimizationReport);
  },
  async optimizeEdges(handle: number): Promise<OptimizationReport> {
    return call(() => optimize_edges(handle) as OptimizationReport);
  },
  async optimizeStrain(handle: number): Promise<OptimizationReport> {
    return call(() => optimize_strain(handle) as OptimizationReport);
  },
  async buildCreasePattern(handle: number): Promise<TreeSnapshot> {
    return call(() => {
      build_crease_pattern(handle);
      return tree_snapshot(handle) as TreeSnapshot;
    });
  },
  async foldArtifacts(handle: number): Promise<FoldArtifacts> {
    return call(() => withSegments(withSimulationModel(fold_artifacts(handle) as FoldArtifacts)));
  },
  async sequenceAnalyzeFold(
    foldJson: string,
    options?: { solution_limit?: number; require_unique_layer_order?: boolean }
  ): Promise<SequenceTargetState> {
    return call(() => sequence_analyze_fold(foldJson, options ?? null) as SequenceTargetState);
  },
  async sequencePlanFold(
    foldJson: string,
    options?: {
      solution_limit?: number;
      max_steps?: number;
      max_states?: number;
      require_unique_layer_order?: boolean;
    }
  ): Promise<SequencePlan> {
    return call(() => sequence_plan_fold(foldJson, options ?? null) as SequencePlan);
  },
  async sequencePlanFoldWithTarget(
    foldJson: string,
    options?: {
      solution_limit?: number;
      max_steps?: number;
      max_states?: number;
      require_unique_layer_order?: boolean;
    }
  ): Promise<SequencePlanFoldResult> {
    return call(
      () => sequence_plan_fold_with_target(foldJson, options ?? null) as SequencePlanFoldResult
    );
  },
  async saveTmd5(handle: number): Promise<string> {
    return call(() => save_tmd5(handle));
  },
  async exportV4(handle: number): Promise<string> {
    return call(() => export_v4(handle));
  },
  async exportFold(handle: number): Promise<string> {
    return call(() => export_fold(handle));
  },
  async freeTree(handle: number): Promise<void> {
    return call(() => free_tree(handle));
  },
};

export type TreemakerWorkerApi = typeof api;

expose(api);
