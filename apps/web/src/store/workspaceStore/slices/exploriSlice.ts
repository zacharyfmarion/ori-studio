import { ANALYTICS_EVENTS, bucketCount, COUNT_BUCKETS, DURATION_MS_BUCKETS, track } from '../../../analytics';
import { designKind } from '../../../designKinds';
import { acquireDesignHandle } from '../../../engines/designHandles';
import { useLayoutStore } from '../../layoutStore';
import {
  createExploriDocument,
  exploriEdgeLength,
  parseExploriDocument,
  serializeExploriDocument,
  type ExploriDocument,
} from '../../../explori/document';
import { exploriDocument, replaceExploriDocument } from '../../../explori/handles';
import { queryExplori, ExploriError } from '../../../explori/exploriService';
import { exploriMatchQuality } from '../../../explori/matchQuality';
import { exploriTilingLabel, type ExploriDbConfig, type ExploriResult } from '../../../explori/types';
import type { Point } from '../../../lib/geometry';
import { reflectPointAcrossSymmetryAxis, symmetrySide } from '../../../lib/symmetryGeometry';
import {
  EXPLORI_SYMMETRY_AXIS,
  addExploriPair,
  mirrorExploriNodeId,
  removeExploriPair,
} from '../../../explori/symmetry';
import type { TreeSelectionTarget, TreeVertexUpdate } from '../../../tree-editor/model';
import { installExploriDesign, patchExploriDesign, selectExploriDesign } from '../designTabs';
import type { ExploriSendSource } from '../../../analytics/events';
import type { ExploriSlice, WorkspaceSliceCreator } from '../types';

/**
 * The ExplOri design's actions.
 *
 * Every one of them is **addressed**: it captures `activeDesignId` before doing
 * anything, and passes that id to every read and write. The rule is the same as
 * the box-pleat slice's, and here it matters most for `runExploriQuery`, which
 * has a whole network round trip between the user asking and the answer landing.
 *
 * Undo is serialized documents, like the other kinds': the document is small
 * JSON and round-tripping it is what makes cross-design undo impossible by
 * construction, since the only history reachable is the addressed design's.
 */

const HISTORY_LIMIT = 100;

/**
 * One in-flight edit per design, queued.
 *
 * Every edit reads the document, transforms it, and writes it back — with an
 * `await` on the handle in between. Two edits started inside that window both
 * read the *same* base document and the second's write silently discards the
 * first's, which in the tree editor reads as a click that did nothing. Clicks
 * are exactly the gesture people repeat quickly, so this is not a rare race.
 *
 * Keyed by design, so two designs never wait on each other.
 */
const editQueues = new Map<string, Promise<unknown>>();

function queued<T>(designId: string, work: () => Promise<T>): Promise<T> {
  const previous = editQueues.get(designId) ?? Promise.resolve();
  const next = previous.then(work, work);
  // Swallowed on the *queue* only: the caller still sees the rejection, but one
  // failed edit must not poison every edit behind it.
  editQueues.set(designId, next.then(undefined, () => undefined));
  return next;
}

export const createExploriSlice: WorkspaceSliceCreator<ExploriSlice> = (set, get) => {
  /** Read the design's live document, or null when the design is of another kind. */
  const documentFor = async (designId: string): Promise<{ handle: number; document: ExploriDocument } | null> => {
    const design = selectExploriDesign(get(), designId);
    if (!design) return null;
    const handle = await acquireDesignHandle(designId, 'explori');
    if (handle === null) return null;
    const document = exploriDocument(handle) ?? design.document;
    return { handle, document };
  };

  /**
   * Apply an edit to one design's document, pushing an undo entry.
   *
   * `designId` is taken, not defaulted. Every caller reaches this after an
   * `await` on the handle, which is exactly the window a tab switch lives in.
   */
  const edit = (
    designId: string,
    change: (document: ExploriDocument) => ExploriDocument | null
  ): Promise<boolean> => queued(designId, () => applyEdit(designId, change));

  const applyEdit = async (
    designId: string,
    change: (document: ExploriDocument) => ExploriDocument | null
  ): Promise<boolean> => {
    const held = await documentFor(designId);
    if (!held) return false;
    const next = change(held.document);
    if (!next) return false;
    replaceExploriDocument(held.handle, next);
    const design = selectExploriDesign(get(), designId);
    if (!design) return false;
    set(
      patchExploriDesign(get(), designId, {
        document: next,
        historyPast: [...design.historyPast, serializeExploriDocument(held.document)].slice(
          -HISTORY_LIMIT
        ),
        historyFuture: [],
      })
    );
    return true;
  };

  /** Move through the undo stacks in one direction. */
  const travel = (designId: string, direction: 'undo' | 'redo'): Promise<boolean> =>
    queued(designId, () => applyTravel(designId, direction));

  const applyTravel = async (designId: string, direction: 'undo' | 'redo'): Promise<boolean> => {
    const held = await documentFor(designId);
    if (!held) return false;
    const design = selectExploriDesign(get(), designId);
    if (!design) return false;
    const from = direction === 'undo' ? design.historyPast : design.historyFuture;
    if (from.length === 0) return false;
    const text = from[from.length - 1];
    const restored = parseExploriDocument(text);
    replaceExploriDocument(held.handle, restored);
    const current = serializeExploriDocument(held.document);
    set(
      patchExploriDesign(get(), designId, {
        document: restored,
        historyPast:
          direction === 'undo' ? design.historyPast.slice(0, -1) : [...design.historyPast, current],
        historyFuture:
          direction === 'undo'
            ? [...design.historyFuture, current]
            : design.historyFuture.slice(0, -1),
      })
    );
    return true;
  };

  /** Reflect the moves of paired nodes onto their partners. */
  const withMirroredMoves = (
    document: ExploriDocument,
    updates: readonly TreeVertexUpdate[]
  ): TreeVertexUpdate[] => {
    if (!document.symmetry.enabled) return [...updates];
    const moved = new Set(updates.map((update) => update.id));
    const mirrored: TreeVertexUpdate[] = [...updates];
    const emitted = new Set<number>();
    for (const update of updates) {
      const partner = mirrorExploriNodeId(document, update.id);
      if (partner === null || partner === update.id) continue;
      if (moved.has(partner) || emitted.has(partner)) continue;
      emitted.add(partner);
      mirrored.push({
        id: partner,
        loc: reflectPointAcrossSymmetryAxis(update.loc, EXPLORI_SYMMETRY_AXIS),
      });
    }
    return mirrored;
  };

  const applyMoves = (
    document: ExploriDocument,
    updates: readonly TreeVertexUpdate[]
  ): ExploriDocument => {
    const moved = new Map(updates.map((update) => [update.id, update.loc]));
    const nodes = document.nodes.map((node) =>
      moved.has(node.id) ? { ...node, loc: moved.get(node.id)! } : node
    );
    const next = { ...document, nodes };
    // Lengths are read out of the drawing here, so moving a node *is* setting
    // its edge's length. There is no second number to keep in step.
    return {
      ...next,
      edges: next.edges.map((edge) => ({ ...edge, length: exploriEdgeLength(next, edge) })),
    };
  };

  return {
    /**
     * Make this design's document live in the store.
     *
     * The registry owns the document; the store holds a copy so components can
     * subscribe to it. Acquiring the handle is what hydrates a parked design, so
     * this is also how a background tab's saved tree first appears — without it
     * the pane would render the empty default the tab was created with.
     */
    ensureExploriDocument: async () => {
      const designId = get().activeDesignId;
      const held = await documentFor(designId);
      if (!held) return false;
      const design = selectExploriDesign(get(), designId);
      if (!design || design.document === held.document) return true;
      set(patchExploriDesign(get(), designId, { document: held.document }));
      return true;
    },

    /**
     * Claim the active tab for ExplOri and mint its document.
     *
     * The tab is claimed *before* the handle is acquired: acquiring goes through
     * the kind's codec, which the registry only reaches once the design says it
     * is ExplOri.
     */
    createExploriDesign: async () => {
      const designId = get().activeDesignId;
      set(installExploriDesign(get(), {}, designId));
      return get().ensureExploriDocument();
    },

    setExploriTreeSelection: (selection: TreeSelectionTarget | null) => {
      const designId = get().activeDesignId;
      set(patchExploriDesign(get(), designId, { selection }));
    },

    addExploriLeaf: async (parentId: number, loc: Point, axisTolerance: number) => {
      const designId = get().activeDesignId;
      return edit(designId, (document) => {
        const parent = document.nodes.find((node) => node.id === parentId);
        if (!parent) return null;
        const onAxis =
          document.symmetry.enabled &&
          symmetrySide(loc, EXPLORI_SYMMETRY_AXIS, axisTolerance) === 0;
        const id = document.nextNodeId;
        let next: ExploriDocument = {
          ...document,
          nodes: [...document.nodes, { id, loc, name: '' }],
          edges: [
            ...document.edges,
            { id: document.nextEdgeId, vertices: [parentId, id], length: 1 },
          ],
          nextNodeId: id + 1,
          nextEdgeId: document.nextEdgeId + 1,
        };
        // Off the axis, the new leaf gets a twin on the other side — hung from
        // the parent's own mirror, so the two subtrees stay symmetric rather
        // than merely the two tips.
        if (document.symmetry.enabled && !onAxis) {
          const mirrorParentId = mirrorExploriNodeId(document, parentId);
          if (mirrorParentId !== null) {
            const twinId = next.nextNodeId;
            next = {
              ...next,
              nodes: [
                ...next.nodes,
                { id: twinId, loc: reflectPointAcrossSymmetryAxis(loc, EXPLORI_SYMMETRY_AXIS), name: '' },
              ],
              edges: [
                ...next.edges,
                { id: next.nextEdgeId, vertices: [mirrorParentId, twinId], length: 1 },
              ],
              nextNodeId: twinId + 1,
              nextEdgeId: next.nextEdgeId + 1,
              symmetry: {
                ...next.symmetry,
                pairs: addExploriPair(next.symmetry.pairs, id, twinId),
              },
            };
          }
        }
        return {
          ...next,
          edges: next.edges.map((edge) => ({ ...edge, length: exploriEdgeLength(next, edge) })),
        };
      });
    },

    moveExploriNodes: async (updates: readonly TreeVertexUpdate[]) => {
      const designId = get().activeDesignId;
      return edit(designId, (document) => applyMoves(document, withMirroredMoves(document, updates)));
    },

    deleteExploriNode: async (nodeId: number) => {
      const designId = get().activeDesignId;
      return edit(designId, (document) => {
        if (nodeId === 0) return null;
        const partner = document.symmetry.enabled ? mirrorExploriNodeId(document, nodeId) : null;
        const removing = new Set([nodeId, ...(partner !== null && partner !== nodeId ? [partner] : [])]);
        // Only a leaf may go: deleting an interior node would orphan whatever
        // hangs below it, and there is no sensible reattachment to guess at.
        for (const id of removing) {
          const degree = document.edges.filter((edge) => edge.vertices.includes(id)).length;
          if (degree > 1) return null;
        }
        return {
          ...document,
          nodes: document.nodes.filter((node) => !removing.has(node.id)),
          edges: document.edges.filter(
            (edge) => !removing.has(edge.vertices[0]) && !removing.has(edge.vertices[1])
          ),
          symmetry: {
            ...document.symmetry,
            pairs: document.symmetry.pairs.filter(
              (pair) => !removing.has(pair.v1) && !removing.has(pair.v2)
            ),
          },
        };
      });
    },

    renameExploriNode: async (nodeId: number, name: string) => {
      const designId = get().activeDesignId;
      return edit(designId, (document) => ({
        ...document,
        nodes: document.nodes.map((node) => (node.id === nodeId ? { ...node, name } : node)),
      }));
    },

    setExploriEdgeLength: async (edgeId: number, length: number, updates: readonly TreeVertexUpdate[]) => {
      const designId = get().activeDesignId;
      return edit(designId, (document) => {
        const moved = applyMoves(document, withMirroredMoves(document, updates));
        return {
          ...moved,
          edges: moved.edges.map((edge) =>
            edge.id === edgeId ? { ...edge, length } : edge
          ),
        };
      });
    },

    toggleExploriSymmetry: async () => {
      const designId = get().activeDesignId;
      return edit(designId, (document) => ({
        ...document,
        symmetry: { ...document.symmetry, enabled: !document.symmetry.enabled },
      }));
    },

    unpairExploriNode: async (nodeId: number) => {
      const designId = get().activeDesignId;
      return edit(designId, (document) => ({
        ...document,
        symmetry: { ...document.symmetry, pairs: removeExploriPair(document.symmetry.pairs, nodeId) },
      }));
    },

    setExploriDbConfigs: async (dbConfigs: ExploriDbConfig[]) => {
      const designId = get().activeDesignId;
      // Choosing marks it chosen: from here the selection is the user's and the
      // drawing stops deciding it.
      return edit(designId, (document) => ({ ...document, dbConfigs, dbConfigsDirty: true }));
    },

    setExploriResultLimit: async (resultLimit: number) => {
      const designId = get().activeDesignId;
      return edit(designId, (document) => ({ ...document, resultLimit }));
    },

    selectExploriResult: async (result: ExploriResult | null, detailIndex: number | null) => {
      const designId = get().activeDesignId;
      set(patchExploriDesign(get(), designId, { detailIndex }));
      if (result && detailIndex !== null) {
        track(ANALYTICS_EVENTS.exploriResultOpened, {
          rank_bucket: bucketCount(result.rank, COUNT_BUCKETS),
          quality: exploriMatchQuality(result.distance),
        });
      }
      return edit(designId, (document) => ({ ...document, selected: result }));
    },

    runExploriQuery: async () => {
      // Captured before the first await, and passed to every read and write
      // below: a search is a network round trip, which is exactly the window in
      // which the user can switch to another design.
      const designId = get().activeDesignId;
      const held = await documentFor(designId);
      if (!held) return false;
      set(patchExploriDesign(get(), designId, { searching: true, error: null }));
      const startedAt = performance.now();
      try {
        const response = await queryExplori(held.document);
        set(
          patchExploriDesign(get(), designId, {
            searching: false,
            results: response.results,
            detailIndex: null,
            error: null,
          })
        );
        // Shape and counts only. The tree itself, its lengths and the tiling ids
        // that came back are the user's design and never leave in an event.
        track(ANALYTICS_EVENTS.exploriSearch, {
          node_count_bucket: bucketCount(held.document.nodes.length, COUNT_BUCKETS),
          edge_count_bucket: bucketCount(held.document.edges.length, COUNT_BUCKETS),
          db_config_count: held.document.dbConfigs.length,
          result_limit: held.document.resultLimit,
          result_count_bucket: bucketCount(response.results.length, COUNT_BUCKETS),
          duration_ms_bucket: bucketCount(performance.now() - startedAt, DURATION_MS_BUCKETS),
          mirror_draw: held.document.symmetry.enabled,
        });
        return true;
      } catch (error) {
        set(
          patchExploriDesign(get(), designId, {
            searching: false,
            error:
              error instanceof ExploriError
                ? error.message
                : 'The search could not be completed.',
          })
        );
        track(ANALYTICS_EVENTS.exploriSearchFailed, {
          reason: error instanceof ExploriError ? error.code : 'unknown',
        });
        return false;
      }
    },

    /**
     * Send the chosen result's crease pattern to the Edit canvas.
     *
     * Goes through the *descriptor's* `sendToEdit` rather than reimplementing
     * the conversion, which is what that field is for — the kind knows how its
     * document becomes a crease pattern, and the store only has to route the
     * result into Edit.
     */
    sendExploriToEdit: async (source: ExploriSendSource = 'detail') => {
      const designId = get().activeDesignId;
      const held = await documentFor(designId);
      if (!held || !held.document.selected) return false;
      const kind = designKind('explori');
      if (!kind) return false;
      await get().ensureEditCreasePattern();
      const payload = await kind.sendToEdit(held.handle, {
        editGridDivisions:
          get().oristudioCpDocument?.document.crease_pattern.grid.grid_size ?? 0,
        title: exploriTilingLabel(held.document.selected),
      });
      const ok = await get().importAddOristudioCpText(
        payload.text,
        payload.format,
        payload.label,
        payload.filename
      );
      if (ok) {
        useLayoutStore.getState().activatePanel('crease-pattern');
        track(ANALYTICS_EVENTS.exploriSentToEdit, {
          source,
          quality: exploriMatchQuality(held.document.selected.distance),
        });
      }
      return ok;
    },

    undoExplori: async () => travel(get().activeDesignId, 'undo'),
    redoExplori: async () => travel(get().activeDesignId, 'redo'),

    resetExploriDesign: async () => {
      const designId = get().activeDesignId;
      return edit(designId, () => createExploriDocument());
    },
  };
};
