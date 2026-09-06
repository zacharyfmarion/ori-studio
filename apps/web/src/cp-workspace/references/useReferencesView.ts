import { useMemo } from 'react';
import { vertexPointsFromTransport, type CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import {
  cpVertexId,
  DEFAULT_ORISTUDIO_CP_LINE_STYLE,
  DEFAULT_ORISTUDIO_CP_LINE_WIDTH,
  DEFAULT_ORISTUDIO_CP_POINT_SIZE,
  type OristudioCpLineStyle,
} from '../../lib/creasePatternViewport';
import type { WheelGesturePreference } from '../../lib/wheelGesture';
import { useSettingsStore } from '../../store/settingsStore';
import { useThemeStore } from '../../store/themeStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { ReferencesSelection } from './ReferencesCpView';
import type { ReferencesCandidateResult, ReferencesResults } from './referencesResults';
import {
  clampStepIndex,
  referencesStepOverlay,
  type ModelBounds,
  type ReferencesGhostSegment,
  type ReferencesMarker,
} from './referencesStepGeometry';

/**
 * What the References view renders, read from the stores in one place.
 *
 * The view itself is store-free; this hook is its binding (AGENTS.md > Panel
 * components: store bindings for one concern live in a `use*` hook beside its
 * modules). It reads the compact transport and the user's Edit-canvas
 * appearance so the pattern looks here as it does there, and the document
 * revision the results are keyed on.
 */
export interface ReferencesViewState {
  hasDocument: boolean;
  geometry: CpGeometryTransport | null;
  /**
   * Identity of the geometry the results were computed for. Every CP mutation
   * bumps `foldArtifactRevision` (through `staleFoldArtifactResourceState`) and
   * `oristudioCpRevision`; a fresh load advances `loadSerial`. Any of the three
   * moving means the picked ids and the frames may no longer describe the
   * pattern on screen.
   */
  revision: string;
  /** Refit the camera on a new document only — never on an edit. */
  framingKey: string;
  lineStyle: OristudioCpLineStyle;
  mode: 'mvf';
  lineWidth: number;
  pointSize: number;
  wheelGesture: WheelGesturePreference;
  snapRadius: number;
  /** Theme name; the view re-reads its CSS colours when it changes. */
  themeKey: string;
}

export function useReferencesView(): ReferencesViewState {
  const document = useWorkspaceStore((state) => state.oristudioCpDocument);
  const cpRevision = useWorkspaceStore((state) => state.oristudioCpRevision);
  const foldArtifactRevision = useWorkspaceStore((state) => state.foldArtifactRevision);
  const viewport = useWorkspaceStore((state) => state.oristudioCpViewport);
  const wheelGesture = useSettingsStore((state) => state.cpWheelGesture);
  const snapRadius = useSettingsStore((state) => state.cpSnapRadius);
  const themeKey = useThemeStore((state) => state.currentTheme.name);

  const loadSerial = document?.loadSerial ?? -1;
  return {
    hasDocument: document !== null,
    geometry: document?.geometry ?? null,
    revision: `${loadSerial}:${cpRevision}:${foldArtifactRevision}`,
    framingKey: `load-${loadSerial}`,
    lineStyle: viewport.lineStyle ?? DEFAULT_ORISTUDIO_CP_LINE_STYLE,
    // The editor renders the classic mountain/valley/flat palette; the
    // axial-gusset mode belongs to TreeMaker output and is never shown here.
    mode: 'mvf',
    lineWidth: viewport.lineWidth ?? DEFAULT_ORISTUDIO_CP_LINE_WIDTH,
    pointSize: viewport.pointSize ?? DEFAULT_ORISTUDIO_CP_POINT_SIZE,
    wheelGesture,
    snapRadius,
    themeKey,
  };
}

const EMPTY_IDS: ReadonlySet<number> = new Set();
const EMPTY_GHOSTS: readonly ReferencesGhostSegment[] = [];
const EMPTY_MARKERS: readonly ReferencesMarker[] = [];

/** Everything the view draws beyond the document, for the active candidate and step. */
export interface ReferencesHighlights {
  highlightLineIds: ReadonlySet<number>;
  highlightVertexIdx: ReadonlySet<number>;
  selected: ReferencesSelection | null;
  ghostSegments: readonly ReferencesGhostSegment[];
  markers: readonly ReferencesMarker[];
  /** The active step's references, for framing. */
  stepBounds: ModelBounds | null;
}

/**
 * Derive the view's highlight props from the current results.
 *
 * `current` says whether the results describe the geometry on screen; stale
 * results draw nothing, because their crease ids and vertex positions may name
 * something else now — the overlay says "out of date" instead.
 */
export function useReferencesHighlights(
  geometry: CpGeometryTransport | null,
  results: ReferencesResults | null,
  current: boolean,
  activeCandidate: number,
  activeStep: number
): ReferencesHighlights {
  const candidate: ReferencesCandidateResult | null =
    current && results ? (results.candidates[activeCandidate] ?? results.candidates[0] ?? null) : null;

  const target = current ? results?.target : undefined;

  const highlightLineIds = useMemo<ReadonlySet<number>>(() => {
    if (!target || target.kind !== 'crease') return EMPTY_IDS;
    return new Set(target.cpLineIds);
  }, [target]);

  // Vertex requests are keyed on coordinates (`cpVertexId`); the draw index is
  // looked up from them here, against the geometry actually on screen.
  const highlightVertexIdx = useMemo<ReadonlySet<number>>(() => {
    if (!target || target.kind !== 'vertex' || !geometry) return EMPTY_IDS;
    const key = cpVertexId(target.point);
    const idx = vertexPointsFromTransport(geometry).findIndex((v) => cpVertexId(v) === key);
    return idx >= 0 ? new Set([idx]) : EMPTY_IDS;
  }, [target, geometry]);

  const selected = useMemo<ReferencesSelection | null>(() => {
    if (!target) return null;
    if (target.kind === 'crease') return { kind: 'line', id: target.lineId };
    const [idx] = highlightVertexIdx;
    return idx === undefined ? null : { kind: 'vertex', idx };
  }, [target, highlightVertexIdx]);

  const overlay = useMemo(() => {
    if (!candidate || !results) return null;
    return referencesStepOverlay(
      candidate.solution,
      candidate.modelSteps,
      results.originals,
      clampStepIndex(candidate.solution, activeStep)
    );
  }, [candidate, results, activeStep]);

  return {
    highlightLineIds,
    highlightVertexIdx,
    selected,
    ghostSegments: overlay?.ghosts ?? EMPTY_GHOSTS,
    markers: overlay?.markers ?? EMPTY_MARKERS,
    stepBounds: overlay?.bounds ?? null,
  };
}
