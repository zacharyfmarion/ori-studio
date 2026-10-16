import { newDiagram } from '../../diagram/document/newDiagram';
import {
  emptyOristudioCpSelection,
  getEditableCpModelBounds,
} from "../../lib/creasePatternViewport";
import { boxCornersModel } from "../../lib/transformBox";
import { foldedFigureUserBounds } from "../../cp-workspace/adapters/cpFoldedToScene";
import { useWorkspaceStore } from "../workspaceStore";
import type { OristudioCpHistoryEntry, WorkspaceState } from "./types";
import {
  getOristudioCpClient,
  refreshOristudioCpDocument,
  restoreOristudioCpDocumentInPlace,
  creasePatternHoldsNothingOfItsOwn,
} from "./oristudioCpRuntime";
import {
  retainFoldedFigureHandles,
  releaseFoldedFigureHandles,
} from "../../cp-workspace/folded/foldedFigureHandles";
import { staleFoldArtifactResourceState } from "./foldArtifactResource";
import {
  snapshotEntry,
  recordSnapshot,
  undoSnapshot,
  redoSnapshot,
} from "./snapshotHistory";
import { trimDiagramHistory } from "./diagramState";
import {
  insertionIndex,
  insertSteps,
  type DiagramStep,
  type KnownDiagramAsset,
} from "../../diagram/document/diagramDocument";
import { retainPageCounts } from "../../diagram/pages/pageCounts";
import { followPageArrangements } from "../../diagram/pages/pageArrangements";
import { settlePlaces } from "../../diagram/pages/stepPlaces";
import {
  batchPlacement,
  geometryBounds,
  placedGeometry,
} from "../../diagram/import/batchPlacement";
import type { CpGeometryTransport } from "../../engine/oristudioCpGeometry";

export interface ImportTarget {
  loadId: number;
  cpLoadSerial: number | null;
  cpRevision: number;
  diagram: WorkspaceState["diagram"];
  anchor: string | null;
  annotations: WorkspaceState["oristudioCpAnnotations"];
  figures: WorkspaceState["oristudioCpFoldedFigures"];
  simulations: WorkspaceState["oristudioCpInlineSimulations"];
}
export interface ImportGroup {
  geometry?: CpGeometryTransport;
  steps: DiagramStep[];
  assets?: KnownDiagramAsset[];
}
export function importTarget(): ImportTarget {
  const s = useWorkspaceStore.getState();
  return {
    loadId: s.diagramLoadId,
    cpLoadSerial: s.oristudioCpDocument?.loadSerial ?? null,
    cpRevision: s.oristudioCpRevision,
    diagram: s.diagram,
    anchor: s.diagramSelectedStepId,
    annotations: s.oristudioCpAnnotations,
    figures: s.oristudioCpFoldedFigures,
    simulations: s.oristudioCpInlineSimulations,
  };
}
function captureCp(
  s: WorkspaceState,
  label: string,
  compoundId: string,
): OristudioCpHistoryEntry {
  retainFoldedFigureHandles(s.oristudioCpFoldedFigures);
  return {
    document: s.oristudioCpDocument!.document,
    selection: s.oristudioCpSelection,
    annotations: s.oristudioCpAnnotations,
    foldedFigures: s.oristudioCpFoldedFigures,
    activeFoldedFigureId: s.oristudioCpActiveFoldedFigureId,
    inlineSimulations: s.oristudioCpInlineSimulations,
    label,
    timestamp: new Date().toISOString(),
    compoundId,
  };
}
function matches(target: ImportTarget, s: WorkspaceState): boolean {
  return (
    !s.diagramReadOnly &&
    s.diagramLoadId === target.loadId &&
    (s.oristudioCpDocument?.loadSerial ?? null) === target.cpLoadSerial &&
    s.oristudioCpRevision === target.cpRevision &&
    s.diagram === target.diagram &&
    s.oristudioCpAnnotations === target.annotations &&
    s.oristudioCpFoldedFigures === target.figures &&
    s.oristudioCpInlineSimulations === target.simulations
  );
}

/** Provision the same empty Edit canvas as visiting Edit, without changing the active workspace. */
export async function ensureDiagramImportTarget(
  target: ImportTarget,
): Promise<ImportTarget> {
  if (target.cpLoadSerial !== null) return target;
  const before = useWorkspaceStore.getState();
  if (!matches(target, before))
    throw new Error("The destination changed. Start the import again.");
  // A refused file or pending share needs its existing load flow, not a new blank document.
  if (before.cpLoadFailure || before.pendingSharedCp)
    throw new Error(
      "Open the Edit workspace to resolve its pending file before importing crease patterns.",
    );
  await before.ensureEditCreasePattern();
  const after = useWorkspaceStore.getState();
  if (
    after.diagramLoadId !== target.loadId ||
    after.diagram !== target.diagram ||
    after.diagramReadOnly
  )
    throw new Error("The destination changed. Start the import again.");
  if (!after.oristudioCpDocument)
    throw new Error(
      after.oristudioCpError ??
        "Could not create an Edit canvas for the import.",
    );
  return { ...importTarget(), anchor: target.anchor };
}
/** The only publication point: one kernel mutation followed by one store publication. */
export async function commitDiagramImport(
  groups: ImportGroup[],
  target: ImportTarget,
  columns: number,
  gap: number,
): Promise<number> {
  const get = useWorkspaceStore.getState,
    set = useWorkspaceStore.setState;
  const before = get();
  if (!matches(target, before) || before.diagramImportBusy)
    throw new Error("The destination changed. Start the import again.");
  // Keep the established single-picture fill and batch insertion behavior.
  if (
    groups.length &&
    groups.every(
      (g) =>
        !g.geometry &&
        g.assets?.length === 1 &&
        g.steps.length === 1 &&
        g.steps[0]?.source?.kind === "upload",
    )
  ) {
    return (
      before.addDiagramPictures(
        groups.flatMap((g) => g.assets!),
        { loadId: target.loadId, anchorStepId: target.anchor },
      )?.stepIds.length ?? 0
    );
  }
  const cpGroups = groups.filter(
    (g): g is ImportGroup & { geometry: CpGeometryTransport } =>
      Boolean(g.geometry),
  );
  if (cpGroups.length && !before.oristudioCpDocument)
    throw new Error("Open an Edit document before importing crease patterns.");
  const replaceStarter =
    before.oristudioCpAnnotations.length === 0 &&
    before.oristudioCpFoldedFigures.length === 0 &&
    before.oristudioCpInlineSimulations.length === 0 &&
    !!before.oristudioCpDocument &&
    creasePatternHoldsNothingOfItsOwn(before.oristudioCpDocument.document);
  let existing =
    !replaceStarter && before.oristudioCpDocument
      ? before.oristudioCpDocument.geometry
        ? geometryBounds(before.oristudioCpDocument.geometry)
        : getEditableCpModelBounds(before.oristudioCpDocument.document)
      : null;
  const occupiedPoints = [
    ...before.oristudioCpAnnotations.flatMap(boxCornersModel),
    ...before.oristudioCpInlineSimulations.flatMap((simulation) =>
      boxCornersModel(simulation.box),
    ),
    ...foldedFigureUserBounds(before.oristudioCpFoldedFigures).flatMap(
      ({ bounds }) => [
        { x: bounds.minX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY },
      ],
    ),
  ];
  for (const { x, y } of occupiedPoints) {
    existing = existing
      ? {
          minX: Math.min(existing.minX, x),
          minY: Math.min(existing.minY, y),
          maxX: Math.max(existing.maxX, x),
          maxY: Math.max(existing.maxY, y),
        }
      : { minX: x, maxX: x, minY: y, maxY: y };
  }
  const placements = batchPlacement(
    cpGroups.map((g) => geometryBounds(g.geometry)),
    existing,
    columns,
    gap,
  );
  let cpIndex = 0;
  const steps: DiagramStep[] = [],
    assets = { ...(before.diagram?.assets ?? {}) };
  for (const group of groups) {
    const placement = group.geometry ? placements[cpIndex++]! : null;
    for (const step of group.steps) {
      const source = step.source;
      if (placement && source?.kind === "cp") {
        const r = source.scope.region,
          b = r.bounds,
          p = placement;
        steps.push({
          ...step,
          source: {
            ...source,
            scope: {
              kind: "segment",
              region: {
                segmentIdHint: null,
                boundary: r.boundary.map((ring) =>
                  ring.map((v) => ({ x: v.x + p.x, y: v.y + p.y })),
                ),
                bounds: {
                  minX: b.minX + p.x,
                  maxX: b.maxX + p.x,
                  minY: b.minY + p.y,
                  maxY: b.maxY + p.y,
                },
              },
            },
          },
        });
      } else steps.push(step);
    }
    for (const asset of group.assets ?? []) assets[asset.id] = asset;
  }
  if (!steps.length) return 0;
  const base = before.diagram ?? newDiagram();
  const inserted = insertSteps(
    { ...base, assets },
    steps,
    insertionIndex(base, target.anchor),
  );
  const next = settlePlaces(
    base,
    followPageArrangements(base, retainPageCounts(base, inserted)),
  ).document;
  const label = "Import steps",
    compoundId = cpGroups.length ? crypto.randomUUID() : undefined;
  const entry = {
    ...snapshotEntry(before.diagram, label),
    ...(compoundId ? { compoundId } : {}),
  };
  set({ diagramImportBusy: true });
  try {
    let cp = before.oristudioCpDocument;
    if (cpGroups.length && cp) {
      const api = await getOristudioCpClient();
      if (!matches(target, get()))
        throw new Error("The destination changed. Start the import again.");
      await api.appendDisjoint(
        cp.handle,
        cpGroups.map((g, i) => placedGeometry(g.geometry, placements[i]!)),
        replaceStarter,
      );
      try {
        cp = await refreshOristudioCpDocument();
        if (!cp || !matches(target, get()))
          throw new Error("The destination changed while importing.");
      } catch (error) {
        // The kernel mutation succeeded but publication did not. Restore the
        // original handle directly; a second failed refresh must not prevent rollback.
        if (
          get().oristudioCpDocument?.loadSerial ===
          before.oristudioCpDocument!.loadSerial
        ) {
          await api.restoreDocument(
            before.oristudioCpDocument!.handle,
            before.oristudioCpDocument!.document,
          );
        }
        throw error;
      }
    }
    const cpEntry = compoundId ? captureCp(before, label, compoundId) : null;
    if (cpEntry)
      for (const entry of before.oristudioCpHistoryFuture)
        releaseFoldedFigureHandles(entry.foldedFigures);
    const cpPast = cpEntry
      ? [...before.oristudioCpHistoryPast, cpEntry]
      : before.oristudioCpHistoryPast;
    // Match ordinary Edit history's retention policy.
    for (const evicted of cpPast.slice(0, Math.max(0, cpPast.length - 100)))
      releaseFoldedFigureHandles(evicted.foldedFigures);
    set({
      diagram: next,
      diagramHistory: trimDiagramHistory(
        recordSnapshot(before.diagramHistory, entry),
        next,
      ),
      diagramSelectedStepId: steps[0]!.id,
      diagramSelectedAnnotationId: null,
      dirty: true,
      projectMessage: label,
      ...(cpEntry && cp
        ? {
            oristudioCpDocument: cp,
            oristudioCpRevision: before.oristudioCpRevision + 1,
            oristudioCpHistoryPast: cpPast.slice(-100),
            oristudioCpSelection: emptyOristudioCpSelection(),
            oristudioCpCamvResult: null,
            oristudioCpActiveDiagnosticId: null,
            oristudioCpHistoryFuture: [],
            ...staleFoldArtifactResourceState(before.foldArtifactRevision),
          }
        : {}),
      diagramImportBusy: false,
    });
    return steps.length;
  } finally {
    set({ diagramImportBusy: false });
  }
}

/** Returns null for ordinary history. A compound entry travels only when both histories agree. */
export function compoundImportTravel(
  direction: "undo" | "redo",
): Promise<boolean> | null {
  const get = useWorkspaceStore.getState,
    set = useWorkspaceStore.setState,
    s = get();
  const cp =
    direction === "undo"
      ? s.oristudioCpHistoryPast.at(-1)
      : s.oristudioCpHistoryFuture[0];
  const diagram =
    direction === "undo"
      ? s.diagramHistory.past.at(-1)
      : s.diagramHistory.future[0];
  if (!cp?.compoundId && !diagram?.compoundId) return null;
  // The caller only invokes this for its own compound head; an ordinary edit on the other surface must still travel normally.
  if (!cp?.compoundId || cp.compoundId !== diagram?.compoundId) {
    set({
      projectMessage:
        "Undo or redo the later edits in the other workspace first.",
    });
    return Promise.resolve(false);
  }
  if (s.diagramImportBusy || s.oristudioCpHistoryBusy || !s.oristudioCpDocument)
    return Promise.resolve(false);
  const id = cp.compoundId,
    currentDiagram = { ...snapshotEntry(s.diagram, cp.label), compoundId: id };
  const result =
    direction === "undo"
      ? undoSnapshot(s.diagramHistory, currentDiagram)
      : redoSnapshot(s.diagramHistory, currentDiagram);
  if (!result) return Promise.resolve(false);
  set({ diagramImportBusy: true, oristudioCpHistoryBusy: true });
  return (async () => {
    try {
      const restored = await restoreOristudioCpDocumentInPlace(
        cp.document,
        s.oristudioCpDocument!.source,
        null,
      );
      const current = captureCp(s, cp.label, id);
      releaseFoldedFigureHandles(cp.foldedFigures);
      set({
        oristudioCpDocument: restored,
        oristudioCpRevision: s.oristudioCpRevision + 1,
        oristudioCpSelection: cp.selection,
        oristudioCpCamvResult: null,
        oristudioCpActiveDiagnosticId: null,
        oristudioCpAnnotations: cp.annotations,
        oristudioCpFoldedFigures: cp.foldedFigures,
        oristudioCpActiveFoldedFigureId: cp.activeFoldedFigureId,
        oristudioCpInlineSimulations: cp.inlineSimulations ?? [],
        oristudioCpHistoryPast:
          direction === "undo"
            ? s.oristudioCpHistoryPast.slice(0, -1)
            : [...s.oristudioCpHistoryPast, current],
        oristudioCpHistoryFuture:
          direction === "undo"
            ? [current, ...s.oristudioCpHistoryFuture]
            : s.oristudioCpHistoryFuture.slice(1),
        diagram: result.restore.snapshot,
        diagramHistory: result.history,
        diagramSelectedStepId: null,
        diagramSelectedAnnotationId: null,
        dirty: true,
        ...staleFoldArtifactResourceState(s.foldArtifactRevision),
      });
      return true;
    } catch (error) {
      set({
        projectMessage:
          error instanceof Error
            ? error.message
            : "Could not restore imported steps.",
      });
      return false;
    } finally {
      set({ diagramImportBusy: false, oristudioCpHistoryBusy: false });
    }
  })();
}
