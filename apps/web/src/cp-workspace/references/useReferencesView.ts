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
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { creaseFingerprint } from '../cpSegmentationArtifacts';
import type { ReferencesSelection } from './ReferencesCpView';
import type {
  ReferencesCandidateResult,
  ReferencesPlanVariant,
  ReferencesResults,
  ReferencesTargetRecord,
} from './referencesResults';
import type { ReferencesViewStep } from './referencesSequenceView';
import { findingBounds, planStepScene } from './referencesPlanGeometry';
import { referencesStepPrimitives } from './referencesStepGeometry';
import type { StepDiagramModel } from './referenceFinderDiagramToPrimitives';
import {
  clampStepIndex,
  referencesStepOverlay,
  type ModelBounds,
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
   * Identity of the geometry the results were computed for: the load serial and
   * a content hash of the creases themselves.
   *
   * Deliberately *not* `oristudioCpRevision` / `foldArtifactRevision`. Neither
   * counter means "the creases changed": `foldArtifactRevision` advances on a
   * box-, lasso- or polygon-select (`SYNC_CP_LINE_SELECTION_AFTER_OPERATIONS`
   * in `projectSlice`, which records history for a selection that changes no
   * geometry), so keyed on it a valid answer was marked "Out of date" by
   * selecting in Edit and coming back. And dropping only that one would break
   * the other direction: CP undo/redo bumps `foldArtifactRevision` *alone*
   * (`historySlice`), so a hash is what covers both. Same reasoning, and the
   * same hash, as `cpSegmentationArtifacts`.
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

/**
 * The staleness key for a document state — see {@link ReferencesViewState.revision}.
 *
 * Exported so what it does and does not distinguish is pinned directly, rather
 * than only through a panel that says "Out of date".
 */
export function referencesRevisionKey(document: OristudioCpDocumentState | null): string {
  if (!document) return 'none';
  return `${document.loadSerial}:${creaseFingerprint(document.document)}`;
}

export function useReferencesView(): ReferencesViewState {
  const document = useWorkspaceStore((state) => state.oristudioCpDocument);
  const viewport = useWorkspaceStore((state) => state.oristudioCpViewport);
  const wheelGesture = useSettingsStore((state) => state.cpWheelGesture);
  const snapRadius = useSettingsStore((state) => state.cpSnapRadius);
  const themeKey = useThemeStore((state) => state.currentTheme.name);

  const loadSerial = document?.loadSerial ?? -1;
  return {
    hasDocument: document !== null,
    geometry: document?.geometry ?? null,
    revision: referencesRevisionKey(document),
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

/** Everything the view draws beyond the document, for the active candidate and step. */
export interface ReferencesHighlights {
  highlightLineIds: ReadonlySet<number>;
  highlightVertexIdx: ReadonlySet<number>;
  selected: ReferencesSelection | null;
  /**
   * The step as diagram primitives, in model space — the same list the
   * filmstrip card draws, so the two pictures cannot disagree about what a step
   * contains. Split into GPU lines and DOM symbols by `diagramToScene`.
   */
  diagram: StepDiagramModel | null;
  /** The active step's references, for framing. */
  stepBounds: ModelBounds | null;
}

/**
 * Derive the view's highlight props from the pick and the current results.
 *
 * Two different questions, deliberately answered from two different sources.
 *
 * *What did I click?* is `picked` — the resolved target record for the geometry
 * on screen, published the moment the pick resolves and kept through the query,
 * through an error, and through a Stop. Drawing it from `results` instead left
 * the clicked crease unmarked for the whole 70 ms-to-6 s wait, and for good on
 * either terminal path, while the toolbar went on saying "Crease".
 *
 * *What did ReferenceFinder say?* is `results`, and `current` says whether that
 * answer still describes the geometry on screen. Stale results draw nothing,
 * because their crease ids and vertex positions may name something else now —
 * the overlay says "out of date" instead. `picked` carries its own revision and
 * the caller has already dropped it when it does not match, so it is honest
 * about staleness for the same reason and does not need the guard again.
 */
export function useReferencesHighlights(
  geometry: CpGeometryTransport | null,
  results: ReferencesResults | null,
  current: boolean,
  picked: ReferencesTargetRecord | null,
  activeCandidate: number,
  activeStep: number
): ReferencesHighlights {
  const candidate: ReferencesCandidateResult | null =
    current && results ? (results.candidates[activeCandidate] ?? results.candidates[0] ?? null) : null;

  // The collinear run is genuinely a *result* — the frames analysis found it —
  // so it stays keyed on the answer, not on the pick.
  const answered = current ? results?.target : undefined;

  const highlightLineIds = useMemo<ReadonlySet<number>>(() => {
    if (!answered || answered.kind !== 'crease') return EMPTY_IDS;
    return new Set(answered.cpLineIds);
  }, [answered]);

  // Vertex requests are keyed on coordinates (`cpVertexId`); the draw index is
  // looked up from them here, against the geometry actually on screen. No extra
  // staleness guard is needed: a vertex that is no longer there yields no index.
  const highlightVertexIdx = useMemo<ReadonlySet<number>>(() => {
    if (!picked || picked.kind !== 'vertex' || !geometry) return EMPTY_IDS;
    const key = cpVertexId(picked.point);
    const idx = vertexPointsFromTransport(geometry).findIndex((v) => cpVertexId(v) === key);
    return idx >= 0 ? new Set([idx]) : EMPTY_IDS;
  }, [picked, geometry]);

  const selected = useMemo<ReferencesSelection | null>(() => {
    if (!picked) return null;
    if (picked.kind === 'crease') return { kind: 'line', id: picked.lineId };
    const [idx] = highlightVertexIdx;
    return idx === undefined ? null : { kind: 'vertex', idx };
  }, [picked, highlightVertexIdx]);

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
    diagram: overlay && results ? referencesStepPrimitives(overlay, results.originals) : null,
    stepBounds: overlay?.bounds ?? null,
  };
}

const NO_HIGHLIGHTS: ReferencesHighlights = {
  highlightLineIds: EMPTY_IDS,
  highlightVertexIdx: EMPTY_IDS,
  selected: null,
  diagram: null,
  stepBounds: null,
};

/**
 * The selection itself, outside the hook so the memo below is a single call
 * the React compiler can keep: a memo whose body branches and returns early
 * cannot be preserved, and the branching is what this does.
 */
function planHighlights(
  variants: readonly ReferencesPlanVariant[],
  viewSteps: readonly ReferencesViewStep[],
  activeStep: number,
  activeFinding: number | null,
  showPinches: boolean
): ReferencesHighlights {
  if (variants.length === 0) return NO_HIGHLIGHTS;
  if (activeFinding !== null) {
    // A finding has no step to show: frame the line and highlight the creases
    // on it, so "which line is this?" has an answer on the view. Findings are
    // the same whichever order the steps are presented in.
    for (const variant of variants) {
      const finding = variant.sequence.findings[activeFinding];
      if (!finding) continue;
      return {
        ...NO_HIGHLIGHTS,
        highlightLineIds: new Set(finding.cp_line_ids),
        stepBounds: findingBounds(variant.model, activeFinding),
      };
    }
  }
  const target = viewSteps[activeStep];
  // A turn-over is not a fold, so it has no references and no new crease to
  // overlay; the pattern itself is the picture.
  if (!target || target.kind !== 'fold') return NO_HIGHLIGHTS;
  const entry = variants[target.component];
  if (!entry) return NO_HIGHLIGHTS;
  const overlay = planStepScene(entry.sequence, entry.model, target.step, { showPinches });
  return {
    highlightLineIds: new Set(overlay.highlightLineIds),
    highlightVertexIdx: EMPTY_IDS,
    selected: null,
    diagram: overlay.diagram,
    stepBounds: overlay.bounds,
  };
}

/**
 * The same highlight props, derived from a whole-pattern breakdown instead of
 * a ReferenceFinder candidate.
 *
 * The plan's geometry is already in model space (`useReferencesBreakdown` maps
 * it once, when the plan lands), so this is pure selection: which step, or
 * which finding, and what it draws. Stale plans draw nothing for the same
 * reason stale candidates do — their crease ids may now name other creases.
 */
export function useReferencesPlanHighlights(
  variants: readonly ReferencesPlanVariant[],
  viewSteps: readonly ReferencesViewStep[],
  activeStep: number,
  activeFinding: number | null,
  showPinches: boolean
): ReferencesHighlights {
  return useMemo(
    () => planHighlights(variants, viewSteps, activeStep, activeFinding, showPinches),
    [variants, viewSteps, activeStep, activeFinding, showPinches]
  );
}
