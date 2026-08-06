import type { Remote } from 'comlink';
import { connectEngine, isEngineConnected } from '../../engines/engineHost';
import { acquireDesignHandle, adoptDesignHandle } from '../../engines/designHandles';
import { readActiveDesign, type ActiveDesignRef } from './activeDesignSource';
import {
  activeDesignTab,
  installTreemakerDesign,
  patchTreemakerDesign,
  type DesignTabsSlice,
} from './designTabs';
import type { TreemakerDesignState } from './designContent';
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
// what makes "is this engine still alive?" answerable.
//
// `handle` is the *fallback* tree — the one the engine holds before any design
// tab has claimed a TreeMaker design (cold boot, and the Edit-only flows that
// reach `ensureTreeHandle` for an export). Once a design is active, its handle
// comes from `engines/designHandles`, which is what makes two TreeMaker tabs two
// trees rather than one.
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

/**
 * Snapshot a freshly built tree and give it to whoever owns trees right now.
 *
 * A design tab owns it whenever one exists — which is every one of these callers
 * (File ▸ New, load a `.tmd5`, clear the tree, undo, redo). Leaving the handle in
 * the module `let` was a real bug rather than a tidiness question: the registry
 * would build a *second*, blank tree the first time anything acquired that design
 * id, the real one would leak, and `serializeDesign` would throw because nothing
 * was registered — which is what made Duplicate silently do nothing and a tab
 * switch park an empty document.
 *
 * The tab's `kind` is deliberately not consulted. `createNewProject` runs *before*
 * the tab is marked TreeMaker, and the tree it just built belongs to that tab
 * regardless of what the tab currently says it is.
 */
async function claimTree(
  api: EngineClient,
  nextHandle: number,
  target: ActiveDesignRef | null
): Promise<TreeSnapshot> {
  try {
    const snapshot = await api.snapshot(nextHandle);
    if (target && (await adoptDesignHandle(target.id, 'treemaker', nextHandle))) {
      return snapshot;
    }
    // No design tab (an Edit-only flow, or a test store): the module keeps it.
    await replaceHandle(nextHandle);
    return snapshot;
  } catch (error) {
    await api.freeTree(nextHandle).catch(() => undefined);
    throw error;
  }
}

async function buildStarterTree(api: EngineClient): Promise<number> {
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
    return nextHandle;
  } catch (error) {
    await api.freeTree(nextHandle).catch(() => undefined);
    throw error;
  }
}

// The target is read **before** the first await in each of these, not inside
// `claimTree`. Building a tree takes a round trip to the worker, and a tab switch
// during it would otherwise hand the new tree to whichever design the user
// happened to land on.
export async function createStarterTree(api: EngineClient): Promise<TreeSnapshot> {
  const target = readActiveDesign();
  return claimTree(api, await buildStarterTree(api), target);
}

export async function createBlankTree(api: EngineClient): Promise<TreeSnapshot> {
  const target = readActiveDesign();
  return claimTree(api, await api.newDesign({ paper_width: 1, paper_height: 1 }), target);
}

export async function loadTreeFromText(api: EngineClient, text: string): Promise<TreeSnapshot> {
  const target = readActiveDesign();
  return claimTree(api, await api.loadTmd(text), target);
}

/**
 * The engine's fallback tree, created once on boot.
 *
 * Explicitly *not* claimed by the active design: booting seeds a handle, it does
 * not choose a design method, and the startup tab is the chooser. Claiming it
 * would hand a blank tree to a tab that has not decided what it is.
 */
export async function initializeBlankTree(api: EngineClient): Promise<TreeSnapshot> {
  if (handle !== null) return api.snapshot(handle);
  blankPromise ??= (async () => {
    const nextHandle = await api.newDesign({ paper_width: 1, paper_height: 1 });
    try {
      const snapshot = await api.snapshot(nextHandle);
      await replaceHandle(nextHandle);
      return snapshot;
    } catch (error) {
      await api.freeTree(nextHandle).catch(() => undefined);
      throw error;
    }
  })().finally(() => {
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

  // A TreeMaker design is active: its handle belongs to it, not to the module.
  // This is what stops two tabs sharing one tree — and it hydrates a design the
  // LRU had parked, transparently to every caller.
  const active = readActiveDesign();
  if (active && active.kind === 'treemaker') {
    const designHandle = await acquireDesignHandle(active.id, 'treemaker');
    if (designHandle !== null) return { api, treeHandle: designHandle };
  }

  // No design has claimed a tree (cold boot, or an Edit-only flow reaching here
  // for an export). Fall back to the module's own blank tree.
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

/**
 * The workspace patch for "a tree snapshot just became the active design".
 *
 * Installs the tree onto the active design tab — kind and content together, so a
 * tab can never claim TreeMaker without a tree — and resets the workspace-level
 * state derived from it.
 *
 * `design` carries any per-design state the caller wants to survive the install
 * (undo restoring its own history, for instance). It has to be passed *in* rather
 * than spread over the result afterwards: those fields now live inside
 * `designTabs`, so a later top-level key would no longer reach them.
 */
/**
 * "The engine had no tree, so here is the snapshot it just built" — patches the
 * active design, never installs one.
 *
 * The distinction matters because {@link projectStateFromSnapshot} *claims the
 * tab's kind and rebuilds the arm from defaults*. That is right for a load or a
 * File ▸ New, and wrong for the lazy-handle path: `ensureTreeHandle` materializes
 * a tree the first time any action needs one, and that can fire during an ordinary
 * edit, a paste, a condition change, or an export. Installing there would silently
 * wipe the selection, tool mode, undo stack and symmetry pairs of the design the
 * user is working on — and, worse, claim `kind: 'treemaker'` on a box-pleat tab,
 * because exports reach `ensureTreeHandle` too.
 *
 * It also deliberately omits the fold-artifact and `sequence*` resets that a real
 * install carries: materializing a cold handle is not a document swap.
 */
export function syncTreemakerProject(
  state: DesignTabsSlice,
  snapshot: TreeSnapshot,
  title?: string
) {
  const ready = { engineReady: true, status: 'ready' as const, error: null };
  // A tab that is not TreeMaker has no tree to sync, and that is an ordinary
  // state rather than a mistake: `initEngine` runs this on a cold boot, where the
  // startup tab is the chooser. Patching anyway would only trip
  // `patchTreemakerDesign`'s guard and log an error for a no-op.
  if (activeDesignTab(state).kind !== 'treemaker') return ready;
  return {
    ...patchTreemakerDesign(state, { project: projectFromSnapshot(snapshot, title) }),
    ...ready,
  };
}

export function projectStateFromSnapshot(
  state: DesignTabsSlice,
  snapshot: TreeSnapshot,
  title?: string,
  design: Partial<TreemakerDesignState> = {}
) {
  return {
    ...installTreemakerDesign(state, {
      project: projectFromSnapshot(snapshot, title),
      ...design,
    }),
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
