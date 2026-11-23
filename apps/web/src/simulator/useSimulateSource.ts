import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { creaseRoleOf } from '../cp-workspace/references/creaseRole';
import { regionReferenceFor, resolveRegion } from '../cp-workspace/regions/regionReference';
import { ensureCpSheetSimulationArtifacts } from '../cp-workspace/sheets/cpSheetArtifacts';
import { selectCpAuxLinesAreFacets } from '../store/workspaceStore/cpSimulationAuxLines';
import { sheetRegions, type CpSheetRegion } from '../cp-workspace/sheets/cpSheetRegions';
import { linesSheetThumbnail } from '../cp-workspace/sheets/linesSheetThumbnail';
import type { SheetGridItem } from '../cp-workspace/sheets/SheetGrid';
import { segmentSheetThumbnail } from '../cp-workspace/sheets/segmentSheet';
import { useCpSheetIndexState } from '../cp-workspace/sheets/useCpSheetIndexState';
import type { OristudioCpDocumentSnapshot } from '../engine/oristudioCpTypes';
import type { FoldDocument } from '../engine/types';
import { creaseFingerprint } from '../lib/creaseFingerprint';
import { buildSegmentSimulationFold, resolveCpSegments } from '../lib/creasePatternSegmentation';
import { selectProject } from '../store/workspaceStore/designTabs';
import { useWorkspaceStore } from '../store/workspaceStore';

/**
 * What the Simulate workspace simulates: the patterns its rail lists, the one
 * being folded, and that one's fold.
 *
 * Two sources, one shape. An editable crease pattern is read from the sheet
 * index: the rail lists its sheets, drawn from their own lines, and only the
 * sheet being shown is meshed (`ensureCpSheetSimulationArtifacts`) — tens of
 * milliseconds where meshing the whole canvas took half a minute on a canvas
 * of 204 sheets. Anything else — a design's generated pattern, or an editable
 * one with no closed border at all — is read as before, from the whole
 * canvas's fold artifacts.
 */
export type SimulateSourceStatus = 'empty' | 'loading' | 'ready' | 'error';

export interface SimulateSource {
  /** The rail's cards: every pattern there is to pick from. */
  patterns: readonly SheetGridItem[];
  /** The pattern being simulated, among {@link patterns}; null when there is no choice. */
  activeId: number | null;
  /** Simulate another of {@link patterns}. */
  select: (id: number) => void;
  /** What the simulator solves: null while it is being built, or when there is none. */
  fold: FoldDocument | null;
  status: SimulateSourceStatus;
  /** Why the fold could not be built, when it could not. */
  error: string | null;
  /** Changes whenever what is simulated does, so the new one starts flat. */
  sourceKey: string;
  /** Build it again from the crease pattern: Restart after a failure. */
  rebuild: () => void;
}

export function useSimulateSource(): SimulateSource {
  const document = useWorkspaceStore((state) => state.oristudioCpDocument?.document ?? null);
  const sheets = useSheetsSource(document);
  const artifacts = useArtifactsSource(sheets === null);
  return sheets ?? artifacts;
}

const NO_REGIONS: readonly CpSheetRegion[] = [];
const NO_PATTERNS: readonly SheetGridItem[] = [];

/**
 * The sheet index's reading, or null where it has none to give: no editable
 * pattern, an index that failed, or a pattern with no closed border.
 */
function useSheetsSource(document: OristudioCpDocumentSnapshot | null): SimulateSource | null {
  const { t } = useTranslation();
  const indexState = useCpSheetIndexState(document !== null);
  const chosen = useWorkspaceStore((state) => state.oristudioCpSimulateSheet);
  const setChosen = useWorkspaceStore((state) => state.setOristudioCpSimulateSheet);
  const index = indexState.status === 'ready' ? indexState.index : null;
  const regions = index ? sheetRegions(index) : NO_REGIONS;
  // By outline, so an edit that renumbers the sheets keeps the one shown.
  const active = (chosen ? resolveRegion(chosen, regions) : null) ?? regions[0] ?? null;

  const patterns = useMemo(
    () =>
      document && regions.length > 0
        ? regions.map((sheet) => ({
            id: sheet.id,
            thumbnail: linesSheetThumbnail(document, sheet.lineIds),
            // As the References rail sizes a sheet: every line but its aux lines.
            size: t('panels:simulatorSegments.creases', {
              defaultValue_one: '{{count}} crease',
              defaultValue_other: '{{count}} creases',
              count: sheet.lineIds.filter((id) => {
                const line = document.crease_pattern.line_segments[id - 1];
                return line !== undefined && creaseRoleOf(line) !== 'aux';
              }).length,
            }),
          }))
        : NO_PATTERNS,
    [document, regions, t]
  );

  const select = useCallback(
    (id: number) => {
      const sheet = regions[id];
      if (sheet) setChosen(regionReferenceFor(sheet));
    },
    [regions, setChosen]
  );

  // The shown sheet's mesh, built for it alone and cached with its faces. Keyed
  // by the creases and the sheet, not the snapshot: a selection replaces the
  // snapshot, and a new fold object would reload the simulator for nothing.
  const activeSheet = active?.id ?? null;
  // What the document's aux lines are changes the mesh, so it is part of the key.
  const auxLinesAreFacets = useWorkspaceStore(selectCpAuxLinesAreFacets);
  const key =
    document && activeSheet !== null
      ? `${creaseFingerprint(document)}#${activeSheet}#${auxLinesAreFacets ? 'facets' : 'drawn'}`
      : null;
  const [attempt, setAttempt] = useState(0);
  const [built, setBuilt] = useState<{
    key: string;
    attempt: number;
    fold: FoldDocument | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (key === null || activeSheet === null) return undefined;
    const current = useWorkspaceStore.getState().oristudioCpDocument?.document ?? null;
    let live = true;
    void ensureCpSheetSimulationArtifacts(current, activeSheet, auxLinesAreFacets).then((artifacts) => {
      if (!live) return;
      const [segment] = resolveCpSegments(artifacts);
      const fold = artifacts && segment ? buildSegmentSimulationFold(artifacts, segment) : null;
      setBuilt({
        key,
        attempt,
        fold: fold && (fold.faces_vertices?.length ?? 0) > 0 ? fold : null,
        error: artifacts?.simulation_model_error ?? null,
      });
    });
    return () => {
      live = false;
    };
  }, [key, activeSheet, attempt, auxLinesAreFacets]);
  const rebuild = useCallback(() => setAttempt((count) => count + 1), []);

  if (!document) return null;
  if (indexState.status === 'failed' || (index && regions.length === 0)) return null;
  const current = built && built.key === key && built.attempt === attempt ? built : null;
  return {
    patterns,
    activeId: regions.length > 1 && active ? active.id : null,
    select,
    fold: current?.fold ?? null,
    status: !current ? 'loading' : current.fold ? 'ready' : 'error',
    error: current && !current.fold ? (current.error ?? t('panels:simulator.unavailable', 'Simulator unavailable')) : null,
    sourceKey: `sheet:${key ?? 'pending'}:${attempt}`,
    rebuild,
  };
}

/** The whole canvas's fold artifacts, as the Simulate workspace has always read them. */
function useArtifactsSource(enabled: boolean): SimulateSource {
  const { t } = useTranslation();
  const creaseCount = useWorkspaceStore((state) => selectProject(state).creases.length);
  const hasEditableCp = useWorkspaceStore((state) => state.oristudioCpDocument !== null);
  const foldArtifacts = useWorkspaceStore((state) => state.foldArtifacts);
  const foldArtifactRevision = useWorkspaceStore((state) => state.foldArtifactRevision);
  const foldArtifactStatus = useWorkspaceStore((state) => state.foldArtifactStatus);
  const foldArtifactError = useWorkspaceStore((state) => state.foldArtifactError);
  const selectedSegmentId = useWorkspaceStore((state) => state.selectedSegmentId);
  const setSelectedSegment = useWorkspaceStore((state) => state.setSelectedSegment);
  const ensureFoldArtifacts = useWorkspaceStore((state) => state.ensureFoldArtifacts);
  const refreshFoldArtifacts = useWorkspaceStore((state) => state.refreshFoldArtifacts);
  const empty = creaseCount === 0 && !hasEditableCp;

  // Segment the whole document's fold and simulate only the selected pattern.
  const segments = useMemo(() => resolveCpSegments(foldArtifacts), [foldArtifacts]);
  const activeId = useMemo(() => {
    if (segments.length <= 1) return null;
    const segment = segments.find((candidate) => candidate.id === selectedSegmentId) ?? segments[0];
    return segment?.id ?? null;
  }, [segments, selectedSegmentId]);
  const fold = useMemo(() => {
    const whole = foldArtifacts?.simulation_model?.fold ?? foldArtifacts?.fold ?? null;
    if (!whole || !foldArtifacts) return null;
    const segment = activeId === null ? null : segments.find((candidate) => candidate.id === activeId);
    return segment ? buildSegmentSimulationFold(foldArtifacts, segment) : whole;
  }, [foldArtifacts, segments, activeId]);
  const patterns = useMemo(
    () =>
      foldArtifacts && segments.length > 1
        ? segments.map((segment) => ({
            id: segment.id,
            thumbnail: segmentSheetThumbnail(foldArtifacts.fold, segment),
            // Sized in faces, not creases: the fold's edges are split at every
            // crossing, so a count of them is not the count of drawn lines.
            size: t('panels:simulatorSegments.faces', {
              defaultValue_one: '{{count}} face',
              defaultValue_other: '{{count}} faces',
              count: segment.faceIndices.length,
            }),
          }))
        : NO_PATTERNS,
    [foldArtifacts, segments, t]
  );

  useEffect(() => {
    if (!enabled || empty || foldArtifacts) return;
    if (foldArtifactStatus === 'loading' || foldArtifactStatus === 'error') return;
    void ensureFoldArtifacts();
  }, [enabled, empty, foldArtifacts, foldArtifactStatus, ensureFoldArtifacts]);

  const modelError = foldArtifacts?.simulation_model_error ?? null;
  const status: SimulateSourceStatus = empty
    ? 'empty'
    : foldArtifacts
      ? modelError
        ? 'error'
        : 'ready'
      : foldArtifactStatus === 'error'
        ? 'error'
        : 'loading';
  return {
    patterns,
    activeId,
    select: setSelectedSegment,
    fold,
    status,
    error:
      status !== 'error'
        ? null
        : (modelError ?? foldArtifactError ?? t('panels:simulator.unavailable', 'Simulator unavailable')),
    sourceKey: `whole:${foldArtifacts ? foldArtifactRevision : 'empty'}:${activeId ?? 'all'}`,
    rebuild: () => void refreshFoldArtifacts(),
  };
}
