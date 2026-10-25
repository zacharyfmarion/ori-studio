import { toast } from 'sonner';
import i18n from '../../i18n';
import { newDiagram } from '../../diagram/document/newDiagram';
import {
  emptyOristudioCpSelection,
  getEditableCpModelBounds,
} from "../../lib/creasePatternViewport";
import { occupiedModelSpace } from "./occupiedModelSpace";
import {
  MAX_CP_HISTORY,
  cpHistoryDocumentOf,
  restoreCpHistoryDocument,
  withCpHistoryEntry,
} from "./cpHistory";
import { useWorkspaceStore } from "../workspaceStore";
import type { OristudioCpHistoryEntry, WorkspaceState } from "./types";
import {
  countOristudioCpDocumentChange,
  getOristudioCpClient,
  refreshOristudioCpDocument,
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
  contentBounds,
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
/** Said when what the import was prepared against is no longer there to publish into. */
const destinationChanged = () =>
  i18n.t(
    "panels:diagram.import.destinationChanged",
    "The diagram changed while importing. Start the import again.",
  );
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
/** A new compound entry of what is live: it takes a reference to each figure's handle, the live list keeps its own. */
function captureCp(
  s: WorkspaceState,
  label: string,
  compoundId: string,
): OristudioCpHistoryEntry {
  retainFoldedFigureHandles(s.oristudioCpFoldedFigures);
  return cpEntryOf(s, label, compoundId);
}
/**
 * What is live, as the entry an undo or redo pushes while it puts another
 * entry's figures back: the live figures' handles move to it as the restored
 * entry's move to the live list, so each keeps the reference it had
 * (`historySlice.ts`, `swappedCpHistoryEntry`).
 */
function cpEntryOf(
  s: WorkspaceState,
  label: string,
  compoundId: string,
): OristudioCpHistoryEntry {
  return {
    document: cpHistoryDocumentOf(s.oristudioCpDocument!),
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
    throw new Error(destinationChanged());
  // A refused file or pending share needs its existing load flow, not a new blank document.
  if (before.cpLoadFailure || before.pendingSharedCp)
    throw new Error(
      i18n.t(
        "panels:diagram.import.pendingFile",
        "Open the Edit workspace to resolve its pending file before importing crease patterns.",
      ),
    );
  await before.ensureEditCreasePattern();
  const after = useWorkspaceStore.getState();
  if (
    after.diagramLoadId !== target.loadId ||
    after.diagram !== target.diagram ||
    after.diagramReadOnly
  )
    throw new Error(destinationChanged());
  if (!after.oristudioCpDocument)
    throw new Error(
      after.oristudioCpError ??
        i18n.t("panels:diagram.import.noCanvas", "Couldn’t create an Edit canvas for the import."),
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
  if (!matches(target, before) || before.diagramImportBusy || before.oristudioCpHistoryBusy)
    throw new Error(destinationChanged());
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
    throw new Error(
      i18n.t("panels:diagram.import.openEditFirst", "Open the Edit workspace once before importing crease patterns."),
    );
  const replaceStarter =
    before.oristudioCpAnnotations.length === 0 &&
    before.oristudioCpFoldedFigures.length === 0 &&
    before.oristudioCpInlineSimulations.length === 0 &&
    !!before.oristudioCpDocument &&
    creasePatternHoldsNothingOfItsOwn(before.oristudioCpDocument.document);
  // The batch parks to the right of everything already on the canvas, in model
  // space: its creases (none on an emptied canvas) and every placed object.
  const cpDocument = before.oristudioCpDocument;
  let existing =
    replaceStarter || !cpDocument
      ? null
      : cpDocument.geometry
        ? contentBounds(cpDocument.geometry)
        : getEditableCpModelBounds(cpDocument.document);
  for (const box of occupiedModelSpace(before)) {
    existing = existing
      ? {
          minX: Math.min(existing.minX, box.minX),
          minY: Math.min(existing.minY, box.minY),
          maxX: Math.max(existing.maxX, box.maxX),
          maxY: Math.max(existing.maxY, box.maxY),
        }
      : box;
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
      // The undo entry holds the store's snapshot from here, so a selection
      // landing meanwhile must not write its flags into it (`cpSelectedLines.ts`).
      countOristudioCpDocumentChange();
      const api = await getOristudioCpClient();
      if (!matches(target, get()))
        throw new Error(destinationChanged());
      countOristudioCpDocumentChange();
      await api.appendDisjoint(
        cp.handle,
        cpGroups.map((g, i) => placedGeometry(g.geometry, placements[i]!)),
        replaceStarter,
      );
      try {
        cp = await refreshOristudioCpDocument();
        if (!cp || !matches(target, get()))
          throw new Error(destinationChanged());
      } catch (error) {
        // The kernel mutation succeeded but publication did not. Restore the
        // original handle directly; a second failed refresh must not prevent rollback.
        if (
          get().oristudioCpDocument?.loadSerial ===
          before.oristudioCpDocument!.loadSerial
        ) {
          countOristudioCpDocumentChange();
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
    set({
      diagram: next,
      diagramHistory: trimDiagramHistory(
        recordSnapshot(before.diagramHistory, entry),
        next,
      ),
      dirty: true,
      projectMessage: label,
      ...(cpEntry && cp
        ? {
            oristudioCpDocument: cp,
            oristudioCpRevision: before.oristudioCpRevision + 1,
            oristudioCpHistoryPast: withCpHistoryEntry(before.oristudioCpHistoryPast, cpEntry),
            oristudioCpSelection: emptyOristudioCpSelection(),
            oristudioCpActiveDiagnosticId: null,
            oristudioCpHistoryFuture: [],
            ...staleFoldArtifactResourceState(before.foldArtifactRevision),
          }
        : {}),
      diagramImportBusy: false,
    });
    // Through the slice's rule, which also lets go of a part or picker chosen on the anchor.
    get().selectDiagramStep(steps[0]!.id);
    // The foldability overlay keeps its result until the check of the new sheets lands, as after any edit.
    if (cpEntry) get().scheduleOristudioCamvRefresh();
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
    toast.message(
      i18n.t(
        "toasts:diagram.import.otherWorkspaceFirst",
        "Undo or redo the later edits in the other workspace first: the import changed both Edit and Diagram.",
      ),
    );
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
      if (!cp.document) throw new Error(`The undo step "${cp.label}" holds no crease pattern`);
      const restored = await restoreCpHistoryDocument(
        cp.document,
        s.oristudioCpDocument!.source,
        null,
      );
      // A swap: the entry's figures go live and the live ones into the pushed
      // entry, each handle keeping the one reference it had.
      const current = cpEntryOf(s, cp.label, id);
      // As ordinary Edit undo restores it (historySlice), the overlay result included.
      set({
        oristudioCpDocument: restored,
        oristudioCpOperationDescriptors: restored.operationDescriptors,
        oristudioCpRevision: s.oristudioCpRevision + 1,
        oristudioCpSelection: cp.selection,
        oristudioCpActiveDiagnosticId: null,
        oristudioCpError: null,
        error: null,
        status: "crease_pattern_ready",
        oristudioCpAnnotations: cp.annotations,
        oristudioCpSelectedAnnotationId: cp.annotations.some(
          (annotation) => annotation.id === s.oristudioCpSelectedAnnotationId,
        )
          ? s.oristudioCpSelectedAnnotationId
          : null,
        oristudioCpFoldedFigures: cp.foldedFigures,
        oristudioCpActiveFoldedFigureId: cp.activeFoldedFigureId,
        oristudioCpInlineSimulations: cp.inlineSimulations ?? [],
        oristudioCpHistoryPast:
          direction === "undo"
            ? s.oristudioCpHistoryPast.slice(0, -1)
            : withCpHistoryEntry(s.oristudioCpHistoryPast, current),
        oristudioCpHistoryFuture:
          direction === "undo"
            ? [current, ...s.oristudioCpHistoryFuture].slice(0, MAX_CP_HISTORY)
            : s.oristudioCpHistoryFuture.slice(1),
        diagram: result.restore.snapshot,
        diagramHistory: result.history,
        dirty: true,
        ...staleFoldArtifactResourceState(s.foldArtifactRevision),
      });
      // The selection survives if its step does; otherwise the slice's rule
      // also closes a detail or picker left open on an imported step.
      get().selectDiagramStep(get().diagramSelectedStepId);
      get().scheduleOristudioCamvRefresh();
      void get().restoreOristudioCpInlineSimulationSources();
      return true;
    } catch (error) {
      toast.error(
        i18n.t("toasts:diagram.import.restoreFailed", "Couldn’t restore the imported steps."),
        error instanceof Error ? { description: error.message } : undefined,
      );
      return false;
    } finally {
      set({ diagramImportBusy: false, oristudioCpHistoryBusy: false });
    }
  })();
}
