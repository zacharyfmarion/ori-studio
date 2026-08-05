import type { Remote } from 'comlink';
import { connectEngine, isEngineConnected } from '../../engines/engineHost';
import { projectFromSnapshot } from '../../engine/snapshotMapper';
import type {
  OptimizationReport,
  TreeEdit,
  TreeSnapshot,
  WasmErrorEnvelope,
} from '../../engine/types';
import type { Point } from '../../lib/geometry';
import type { AppStatus, Selection } from '../../lib/sampleProject';
import type { TreemakerWorkerApi } from '../../workers/treemakerWorker';
import { emptyFoldArtifactResourceState } from './foldArtifactResource';

export type EngineClient = Remote<TreemakerWorkerApi>;

// The worker and its comlink client are owned by `engines/engineHost`, which is
// what makes "is this engine still alive?" answerable. What remains here is the
// single-tree state Phase 2 replaces with the documents map.
let handle: number | null = null;
let blankPromise: Promise<TreeSnapshot> | null = null;

export function engineError(error: unknown): WasmErrorEnvelope {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    'message' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    // Rebuilt rather than passed through: a coded `Error` subclass (see
    // lib/projectFileError.ts) satisfies this shape too, and the store should
    // hold a plain envelope, not a live Error with a stack hanging off it.
    const envelope = error as { code: string; message: unknown };
    return { code: envelope.code, message: String(envelope.message) };
  }
  return {
    code: 'engine',
    message: error instanceof Error ? error.message : String(error),
  };
}

export async function getEngine(): Promise<EngineClient> {
  return connectEngine('treemaker');
}

async function replaceHandle(nextHandle: number) {
  if (handle !== null && isEngineConnected('treemaker')) {
    // Guarded on the engine being connected rather than on a local client
    // reference: with the host owning the worker, a crash drops the client and
    // every handle it held, so there is nothing left to free.
    const api = await connectEngine('treemaker');
    await api.freeTree(handle).catch(() => undefined);
  }
  handle = nextHandle;
}

export async function createStarterTree(api: EngineClient): Promise<TreeSnapshot> {
  const nextHandle = await api.newDesign({ paper_width: 1, paper_height: 1 });
  try {
    await api.applyEdit(nextHandle, {
      type: 'add_node',
      loc: { x: 0.5, y: 0.46 },
      label: 'root',
    });
    for (const [x, y] of [
      [0.2, 0.2],
      [0.82, 0.22],
      [0.5, 0.82],
    ] as const) {
      await api.applyEdit(nextHandle, {
        type: 'add_node',
        loc: { x, y },
        connect_to: 1,
        edge_length: 1,
      });
    }
    const snapshot = await api.snapshot(nextHandle);
    await replaceHandle(nextHandle);
    return snapshot;
  } catch (error) {
    await api.freeTree(nextHandle).catch(() => undefined);
    throw error;
  }
}

export async function createBlankTree(api: EngineClient): Promise<TreeSnapshot> {
  const nextHandle = await api.newDesign({ paper_width: 1, paper_height: 1 });
  try {
    const snapshot = await api.snapshot(nextHandle);
    await replaceHandle(nextHandle);
    return snapshot;
  } catch (error) {
    await api.freeTree(nextHandle).catch(() => undefined);
    throw error;
  }
}

export async function loadTreeFromText(api: EngineClient, text: string): Promise<TreeSnapshot> {
  const nextHandle = await api.loadTmd(text);
  try {
    const snapshot = await api.snapshot(nextHandle);
    await replaceHandle(nextHandle);
    return snapshot;
  } catch (error) {
    await api.freeTree(nextHandle).catch(() => undefined);
    throw error;
  }
}

export async function initializeBlankTree(api: EngineClient): Promise<TreeSnapshot> {
  if (handle !== null) return api.snapshot(handle);
  blankPromise ??= createBlankTree(api).finally(() => {
    blankPromise = null;
  });
  return blankPromise;
}

export async function ensureTreeHandle(): Promise<{
  api: EngineClient;
  treeHandle: number;
  initializedSnapshot?: TreeSnapshot;
}> {
  const api = await getEngine();
  let initializedSnapshot: TreeSnapshot | undefined;
  if (handle === null) {
    initializedSnapshot = await initializeBlankTree(api);
  }
  if (handle === null) {
    throw new Error('Engine did not create a tree handle');
  }
  return { api, treeHandle: handle, initializedSnapshot };
}

export function statusAfterEdit(snapshot: TreeSnapshot): AppStatus {
  return snapshot.edges.length > 0 ? 'needs_optimization' : 'ready';
}

export function statusFromSnapshot(snapshot: TreeSnapshot): AppStatus {
  if (snapshot.creases.length > 0) return 'crease_pattern_ready';
  if (snapshot.edges.length === 0) return 'ready';
  return snapshot.summary.is_feasible ? 'optimized' : 'needs_optimization';
}

export function nextSelectionForEdit(
  edit: TreeEdit,
  snapshot: TreeSnapshot,
  createdNode?: number,
  createdEdge?: number
): Selection {
  if (createdNode !== undefined) return { kind: 'node', id: createdNode };
  if (createdEdge !== undefined) return { kind: 'edge', id: createdEdge };
  if ('id' in edit) {
    if (edit.type === 'move_node' || edit.type === 'update_node_label') {
      return { kind: 'node', id: edit.id };
    }
    if (edit.type === 'update_edge') return { kind: 'edge', id: edit.id };
  }
  if (snapshot.nodes.length > 0) return { kind: 'node', id: snapshot.nodes[0].id };
  return { kind: 'tree' };
}

export function projectStateFromSnapshot(snapshot: TreeSnapshot, title?: string) {
  return {
    project: projectFromSnapshot(snapshot, title),
    engineReady: true,
    status: 'ready' as const,
    error: null,
    ...emptyFoldArtifactResourceState(),
    sequenceTarget: null,
    sequencePlan: null,
    sequenceSimulationFocus: { kind: 'whole' as const },
    sequencePlanning: false,
    sequenceError: null,
  };
}

export type { OptimizationReport, Point, TreeEdit, TreeSnapshot, WasmErrorEnvelope };
