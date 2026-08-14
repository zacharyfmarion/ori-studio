import { Grid3x3 } from 'lucide-react';
import { bpCpToEditorConvention } from '../lib/bpCreaseConvention';
import { normalizeOrieditaGridSize } from '../lib/creasePatternViewport';
import { boxPleatCpBounds, boxPleatPackingCircles } from '../lib/packingCircles';
import { bpFlapRadius, sheet as toViewSheet } from '../engine/oristudioBpSnapshotMapper';
import type { OristudioBpClient } from '../store/workspaceStore/oristudioBpRuntime';
import type { WorkspaceCapabilityId } from '../lib/workspaceCapabilities';
import type {
  DesignKindCodec,
  DesignKindDescriptor,
  SendToEditPayload,
  SendToEditRequest,
} from './types';

/**
 * TreeMaker/CP-specific commands that make no sense while authoring a Box-Pleat
 * design, so the Design and Crease Pattern menus don't surface TreeMaker actions.
 * File/Edit(undo,redo,clipboard)/View stay available.
 *
 * Narrower than the `BP_HIDDEN_CAPABILITIES` set this replaces, deliberately: the
 * old set also spread in every tree-only Edit command, which is now covered by
 * TreeMaker declaring them `owned` (hidden in every non-TreeMaker context).
 *
 * The `cp.*` and `optimize.*` families move to `hiddenPrefixes` below. `cp.` has
 * to be listed there rather than relying on the CP editor's own "hide `cp.*`
 * outside the CP editor" rule, because that rule deliberately exempts `cp.build`
 * (it lives in the Design menu) — and box-pleat hides `cp.build` too.
 */
const BOX_PLEAT_HIDDEN_CAPABILITIES: readonly WorkspaceCapabilityId[] = [
  'view.conditions',
  'file.exportV5',
  'file.exportV4',
  'file.exportCp',
  'file.exportFold',
  'file.exportOri',
  'file.exportOrh',
  'file.exportSvg',
  'file.exportPng',
  'file.exportFoldedFold',
  'file.exportObj',
  'file.exportStl',
];

export function createBoxPleatCodec(
  getClient: () => Promise<OristudioBpClient>
): DesignKindCodec {
  return {
    async create() {
      const api = await getClient();
      // Upstream's starter project, which is what choosing Box-pleated produces
      // today. Note it arrives with content — see `editCount` in the tabs plan;
      // "has content" is not the right close-confirmation predicate for this kind.
      return api.newSampleProject();
    },
    async hydrate(text: string) {
      const api = await getClient();
      return api.loadProject(text);
    },
    async serialize(handle: number) {
      const api = await getClient();
      return api.exportBps(handle);
    },
    async free(handle: number) {
      const api = await getClient();
      await api.freeProject(handle).catch(() => undefined);
    },
  };
}

export function createBoxPleatSendToEdit(getClient: () => Promise<OristudioBpClient>) {
  return async function sendToEdit(
    handle: number,
    request: SendToEditRequest
  ): Promise<SendToEditPayload> {
    const api = await getClient();
    // Scale the export so one BP grid cell maps onto one Edit grid cell — without
    // changing the Edit grid. Both use the same paper convention, so the scale is
    // just bpSheetMaxCells / editGridDivisions (the paper width cancels). When the
    // two match, the design fills the paper as before.
    //
    // The sheet is read from the handle rather than from store state, so this
    // works for a design that is not the one currently on screen.
    const project = await api.snapshot(handle);
    const sheet = project.design.layout.sheet;
    const bpCells = Math.max(sheet.width, sheet.height);
    const editDivisions = normalizeOrieditaGridSize(request.editGridDivisions || bpCells);
    const cpScale = editDivisions > 0 ? bpCells / editDivisions : 1;
    // Match BP Studio's Export CP defaults: keep the sheet orientation and
    // include auxiliary hinge creases (dropping them yields a sparse CP that
    // doesn't match BP Studio's export).
    const cpText = await api.exportCp(handle, false, true, cpScale);
    const payload: SendToEditPayload = {
      text: bpCpToEditorConvention(cpText),
      format: 'cp',
      label: 'Sent BP to Edit',
      filename: 'box-pleat.cp',
    };
    if (!request.includeCircles) return payload;

    // Only the flaps that are circles. A flap with a width or a height has a
    // rounded-rectangle clearance region the Edit document cannot represent —
    // see `boxPleatPackingCircles` for why four corner discs, though exact, are
    // the wrong answer.
    //
    // A flap's radius is the snapshot mapper's definition, not a second one.
    const treeEdges = project.design.tree.edges;
    const flaps = project.design.layout.flaps.map((flap) => ({
      anchor: { x: flap.x, y: flap.y },
      width: flap.width,
      height: flap.height,
      radius: bpFlapRadius(flap, treeEdges),
    }));
    const viewSheet = toViewSheet(sheet);
    const circles = boxPleatPackingCircles(flaps, viewSheet);
    if (circles.length === 0) return payload;
    return {
      ...payload,
      label: 'Sent BP to Edit with circles',
      circles,
      circleSourceBounds: boxPleatCpBounds(viewSheet),
    };
  };
}

export function createBoxPleatDesignKind(
  getClient: () => Promise<OristudioBpClient>
): DesignKindDescriptor {
  return {
    id: 'box-pleat',
    engine: 'oristudio-bp',
    osfKind: 'box-pleat',
    analyticsId: 'box-pleat',
    chooser: {
      order: 0,
      copy: (t) => ({
        title: t('panels:design.methodChooser.boxPleated.title', 'Box-pleated'),
        description: t(
          'panels:design.methodChooser.boxPleated.description',
          'Author a tree, then pack flaps and rivers on a grid.'
        ),
      }),
      Icon: Grid3x3,
      // Box-pleating runs on the independent BP worker, not the treemaker
      // engine, so it needn't wait for `engineReady`.
      isAvailable: ({ status }) => status !== 'error',
    },
    panes: [
      {
        id: 'tree',
        component: 'design',
        title: (t) => t('panels:design.paneTitle.bpTree', 'Tree editor'),
        placement: { kind: 'primary' },
        editingContext: 'bp-tree',
      },
      {
        id: 'packing',
        component: 'bp-editor',
        title: (t) => t('panels:design.paneTitle.bpPacking', 'BP Editor'),
        placement: { kind: 'split', direction: 'right' },
        editingContext: 'bp-packing',
      },
    ],
    capabilities: {
      // Box-pleat claims no commands exclusively: everything it uses is either
      // shared (File/Edit/View) or already scoped to its own panes.
      owned: [],
      hiddenIds: BOX_PLEAT_HIDDEN_CAPABILITIES,
      hiddenPrefixes: ['optimize.', 'cp.'],
    },
    history: (tab) =>
      tab.kind === 'box-pleat'
        ? { past: tab.boxPleat.historyPast.length, future: tab.boxPleat.historyFuture.length }
        : { past: 0, future: 0 },
    deletableTarget: (tab) => {
      if (tab.kind !== 'box-pleat') return null;
      const tree = tab.boxPleat.document?.snapshot.tree;
      if (!tree) return null;
      const selection = tab.boxPleat.selection;
      const root = tree.rootVertexId;
      if (selection.kind === 'bp-vertex') {
        return selection.id !== root ? selection.id : null;
      }
      if (selection.kind !== 'bp-edge') return null;
      const edge = tree.edges.find((candidate) => candidate.id === selection.id);
      if (!edge) return null;
      // The endpoint further from the root, found by walking the edges — the
      // vertex list is not needed and is not always populated (a snapshot built
      // for a test carries only the topology this question depends on).
      const adjacency = new Map<number, number[]>();
      for (const other of tree.edges) {
        adjacency.set(other.vertices[0], [
          ...(adjacency.get(other.vertices[0]) ?? []),
          other.vertices[1],
        ]);
        adjacency.set(other.vertices[1], [
          ...(adjacency.get(other.vertices[1]) ?? []),
          other.vertices[0],
        ]);
      }
      const parent = new Map<number, number>();
      const queue = [root];
      const seen = new Set([root]);
      while (queue.length > 0) {
        const current = queue.shift() as number;
        for (const next of adjacency.get(current as number) ?? []) {
          if (seen.has(next)) continue;
          seen.add(next);
          parent.set(next, current as number);
          queue.push(next);
        }
      }
      const [a, b] = edge.vertices;
      const childId = parent.get(a) === b ? a : b;
      return childId !== root ? childId : null;
    },
    // Nothing to write until the worker has produced a document.
    isSavable: (tab) => tab.kind === 'box-pleat' && tab.boxPleat.document !== null,
    codec: createBoxPleatCodec(getClient),
    sendToEdit: createBoxPleatSendToEdit(getClient),
  };
}
