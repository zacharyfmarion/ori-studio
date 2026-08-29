/**
 * Every store binding a check-suppression region needs, in one place.
 *
 * The panel is a composition site, so the region chips take their data from here
 * rather than from a memo assembled up there: which regions exist, which one is
 * selected, what each is costing the user in hidden findings, and the verbs that
 * change any of it. `CpRegionLayer` calls this directly, the way
 * `CpDiagnosticHud` calls `useCpDiagnosticList`.
 *
 * It also owns the undo protocol for chip-driven edits. `preGestureRef` holds the
 * annotation list as it stood before a gesture began, and every mutation here is
 * bracketed by begin/commit so a whole opacity drag is one entry rather than
 * forty — the same invariant `useCpAnnotations` keeps for images and text, and
 * kept separately for the same reason it is kept at all: it is only checkable
 * when the code that depends on it is in one place. The two never interleave —
 * the shared selection overlay drives move/resize/rotate through
 * `useCpAnnotations`, and nothing here touches a box's transform.
 */
import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { OristudioCpDiagnosticEntry } from '../../engine/oristudioCpTypes';
import {
  bottomAnnotationZ,
  isSuppressionRegionAnnotation,
  type CanvasAnnotation,
} from '../annotations/annotation';
import {
  CP_CHECK_CLASSES,
  createCpSuppressionRegion,
  hasAttachedSolveInput,
  type CpCheckClass,
  type CpSuppressionRegion,
  type CreateCpSuppressionRegionInput,
} from '../annotations/suppressionRegion';
import { boxContainsModelPoint } from '../annotations/annotationTransform';
import { cpCheckSuppressionRules, isCpDiagnosticSuppressed } from '../diagnostics/checkSuppression';
import { visibleCpDiagnostics } from '../diagnostics/visibleEntries';

/** One region, plus everything its chip has to say about it. */
export interface CpRegionView {
  region: CpSuppressionRegion;
  /** Whether this region currently holds the canvas-object selection. */
  selected: boolean;
  /**
   * Findings this region alone is hiding — see {@link cpRegionHiddenCounts}.
   *
   * The safety affordance the whole design rests on, and why a region may not be
   * `hidden`: a filter whose cost cannot be seen is how "no errors" comes to mean
   * "no errors we told you about".
   */
  hiddenCount: number;
  /**
   * Whether this region carries an attached `ExactSolveInput`, and so is offered
   * the Solve chip rather than the base one.
   *
   * Data, never a geometric "does this box contain a solvable pattern" test — one
   * of those runs continuously and can flicker mid-edit, exactly when it must not.
   */
  solvable: boolean;
}

/**
 * The verbs alone, with no `regions` view.
 *
 * Split out because the panel commits the rail tool's drag box and so needs
 * `addRegion`, and nothing else here — while {@link UseCpRegions.regions} costs
 * a pass over every diagnostic per consumer. A second subscriber to that would
 * double the work to answer a question it never asks.
 */
export interface UseCpRegionActions {
  /** Take (or release) the canvas-object selection. */
  selectRegion: (id: string | null) => void;
  /** Place a new region, as one undo entry. Returns what was added. */
  addRegion: (input: CreateCpSuppressionRegionInput) => CpSuppressionRegion;
  /** Flip one check class on a region, as one undo entry. */
  toggleRegionCheckClass: (id: string, cpCheckClass: CpCheckClass) => void;
  /** Set a region's opacity. Bracket it yourself — see {@link beginGesture}. */
  setRegionOpacity: (id: string, opacity: number) => void;
  bringRegionToFront: (id: string) => void;
  sendRegionToBack: (id: string) => void;
  removeRegion: (id: string) => void;
  /** Snapshot before a multi-step edit (an opacity drag), so it undoes as one. */
  beginGesture: () => void;
  /** Close the snapshot opened by {@link beginGesture} under `label`. */
  commitGesture: (label: string) => void;
}

export interface UseCpRegions extends UseCpRegionActions {
  /** Every region in the document, in annotation order. */
  regions: readonly CpRegionView[];
}

const NO_REGIONS: readonly CpRegionView[] = [];
const NO_COUNTS: ReadonlyMap<string, number> = new Map();

/**
 * How many findings each region is hiding, keyed by region id.
 *
 * A hidden finding is charged to **the rule that decided it** — the last rule
 * whose scope contains it, which is what `cpSuppressedClassesAt` consulted and
 * therefore the only region that can honestly be said to be hiding it. Every
 * hidden finding is charged to exactly one owner: a region, or the document-wide
 * rule, whose own total the HUD already reports. Nothing is double-counted and
 * nothing goes unowned.
 *
 * The obvious alternative — *what comes back if you delete this region* — reads
 * better on a single region and fails on two. Stack two boxes that both silence
 * Kawasaki and neither is charged, because deleting either leaves the other
 * hiding the same findings; the count is then zero on both chips over a canvas
 * that is quietly not being checked, which is precisely the failure this number
 * exists to prevent.
 *
 * The consequence to be aware of is the other direction: a region that merely
 * repeats what the document already suppresses **is** charged, even though
 * deleting it changes nothing. That is the right way round — the statement is
 * "these many findings inside this box are being hidden", which is true.
 *
 * `entries` is the *unfiltered* union — what the canvas would show with no rules
 * at all — because a count of what is hidden cannot be computed from what is
 * visible.
 */
export function cpRegionHiddenCounts(
  entries: readonly OristudioCpDiagnosticEntry[],
  documentSuppress: readonly CpCheckClass[] | null | undefined,
  annotations: readonly CanvasAnnotation[]
): ReadonlyMap<string, number> {
  const regions = annotations.filter(isSuppressionRegionAnnotation);
  if (regions.length === 0) return NO_COUNTS;
  const counts = new Map<string, number>();
  for (const region of regions) counts.set(region.id, 0);
  if (entries.length === 0) return counts;

  // The filter's own order: by `z`, ties by array position. Shared with
  // `cpCheckSuppressionRules` and with `annotationAtModelPoint`, so the region a
  // finding is charged to is the same one a click at that point would select.
  const ordered = regions.length > 1 ? [...regions].sort((a, b) => a.z - b.z) : regions;
  const rules = cpCheckSuppressionRules(documentSuppress, annotations);

  for (const entry of entries) {
    if (!isCpDiagnosticSuppressed(entry, rules)) continue;
    const point = entry.point;
    // No position, so no region could have been consulted for it: a `Check1` line
    // pair can only have been hidden by the document rule.
    if (!point) continue;
    let owner: CpSuppressionRegion | null = null;
    for (const region of ordered) {
      if (boxContainsModelPoint(region, point)) owner = region;
    }
    if (owner) counts.set(owner.id, (counts.get(owner.id) ?? 0) + 1);
  }
  return counts;
}

/** The canonical suppression list with `cpCheckClass` flipped. */
export function toggledCheckClasses(
  suppress: readonly CpCheckClass[],
  cpCheckClass: CpCheckClass
): CpCheckClass[] {
  const on = suppress.includes(cpCheckClass);
  // Rebuilt from the canonical order rather than pushed or spliced, so two
  // regions suppressing the same set hold equal arrays — the same rule
  // `normalizeCheckClasses` applies on create and on load.
  return CP_CHECK_CLASSES.filter((candidate) =>
    candidate === cpCheckClass ? !on : suppress.includes(candidate)
  );
}

/**
 * The region verbs, without subscribing to anything the verbs do not need.
 *
 * Every mutation here reads the annotation list imperatively through
 * `getState()`, so this hook subscribes to no store slice at all and a consumer
 * that only *writes* regions — the rail tool's commit, in the panel — does not
 * re-render when one moves.
 */
export function useCpRegionActions(): UseCpRegionActions {
  const { t } = useTranslation();
  const addAnnotation = useWorkspaceStore((state) => state.addAnnotation);
  const updateAnnotation = useWorkspaceStore((state) => state.updateAnnotation);
  const removeAnnotation = useWorkspaceStore((state) => state.removeAnnotation);
  const setSelectedAnnotation = useWorkspaceStore((state) => state.setSelectedAnnotation);
  const recordAnnotationHistory = useWorkspaceStore((state) => state.recordAnnotationHistory);

  const preGestureRef = useRef<readonly CanvasAnnotation[] | null>(null);
  const beginGesture = useCallback(() => {
    preGestureRef.current = useWorkspaceStore.getState().oristudioCpAnnotations;
  }, []);
  const commitGesture = useCallback(
    (label: string) => {
      const previous = preGestureRef.current;
      preGestureRef.current = null;
      if (previous) recordAnnotationHistory([...previous], label);
    },
    [recordAnnotationHistory]
  );

  const selectRegion = useCallback(
    (id: string | null) => setSelectedAnnotation(id),
    [setSelectedAnnotation]
  );

  const addRegion = useCallback(
    (input: CreateCpSuppressionRegionInput) => {
      const previous = useWorkspaceStore.getState().oristudioCpAnnotations;
      const region = createCpSuppressionRegion({
        ...input,
        // Under the whole annotation stack unless the caller says otherwise. A
        // region is a backdrop — the renderer's z-slot order is grid → region →
        // images → creases — and `annotationAtModelPoint` returns the topmost, so
        // a full-paper region on top would swallow every click meant for an image
        // sitting inside it. Resolved after the spread, or an `input` that carries
        // an explicit `z: undefined` would overwrite it back to the factory's 0.
        z: input.z ?? bottomAnnotationZ(previous) - 1,
      });
      addAnnotation(region);
      recordAnnotationHistory(
        [...previous],
        t('panels:cpRegion.addRegion', 'Add suppression region')
      );
      return region;
    },
    [addAnnotation, recordAnnotationHistory, t]
  );

  const toggleRegionCheckClass = useCallback(
    (id: string, cpCheckClass: CpCheckClass) => {
      const region = useWorkspaceStore
        .getState()
        .oristudioCpAnnotations.find((annotation) => annotation.id === id);
      if (!region || !isSuppressionRegionAnnotation(region)) return;
      beginGesture();
      updateAnnotation(id, { suppress: toggledCheckClasses(region.suppress, cpCheckClass) });
      commitGesture(t('panels:cpRegion.changeChecks', 'Change suppressed checks'));
    },
    [beginGesture, commitGesture, updateAnnotation, t]
  );

  // Unbracketed on purpose: the opacity slider is a drag, and `AnnotationActions`
  // opens the gesture on its first input and closes it on the native `change`.
  const setRegionOpacity = useCallback(
    (id: string, opacity: number) => updateAnnotation(id, { opacity }),
    [updateAnnotation]
  );

  const bringRegionToFront = useCallback(
    (id: string) => {
      const previous = useWorkspaceStore.getState().oristudioCpAnnotations;
      const top = previous.reduce((max, annotation) => Math.max(max, annotation.z), 0);
      beginGesture();
      updateAnnotation(id, { z: top + 1 });
      commitGesture(t('panels:cpRegion.bringToFront', 'Bring region to front'));
    },
    [beginGesture, commitGesture, updateAnnotation, t]
  );

  const sendRegionToBack = useCallback(
    (id: string) => {
      const previous = useWorkspaceStore.getState().oristudioCpAnnotations;
      const bottom = previous.reduce((min, annotation) => Math.min(min, annotation.z), 0);
      beginGesture();
      updateAnnotation(id, { z: bottom - 1 });
      commitGesture(t('panels:cpRegion.sendToBack', 'Send region to back'));
    },
    [beginGesture, commitGesture, updateAnnotation, t]
  );

  const removeRegion = useCallback(
    (id: string) => {
      beginGesture();
      removeAnnotation(id);
      commitGesture(t('panels:cpRegion.delete', 'Delete region'));
    },
    [beginGesture, commitGesture, removeAnnotation, t]
  );

  return useMemo(
    () => ({
      selectRegion,
      addRegion,
      toggleRegionCheckClass,
      setRegionOpacity,
      bringRegionToFront,
      sendRegionToBack,
      removeRegion,
      beginGesture,
      commitGesture,
    }),
    [
      addRegion,
      beginGesture,
      bringRegionToFront,
      commitGesture,
      removeRegion,
      selectRegion,
      sendRegionToBack,
      setRegionOpacity,
      toggleRegionCheckClass,
    ]
  );
}

export function useCpRegions(): UseCpRegions {
  const actions = useCpRegionActions();
  const annotations = useWorkspaceStore((state) => state.oristudioCpAnnotations);
  const selectedAnnotationId = useWorkspaceStore((state) => state.oristudioCpSelectedAnnotationId);
  const camvResult = useWorkspaceStore((state) => state.oristudioCpCamvResult);
  const lastCommandResult = useWorkspaceStore(
    (state) => state.oristudioCpDocument?.lastCommandResult ?? null
  );
  const camvIssuesVisible = useWorkspaceStore(
    (state) => state.oristudioCpViewport.camvIssuesVisible !== false
  );
  const documentSuppress = useWorkspaceStore(
    (state) => state.oristudioCpViewport.suppressedCheckClasses
  );

  /**
   * The union of findings before any rule is applied.
   *
   * The master "Foldability issues" switch is still honoured, and deliberately:
   * with the overlay off a region is not the reason nothing is showing, so
   * charging it with a hidden count would be a lie in the direction that matters.
   */
  const unfilteredEntries = useMemo(
    () => visibleCpDiagnostics(camvResult, lastCommandResult, camvIssuesVisible).entries,
    [camvIssuesVisible, camvResult, lastCommandResult]
  );

  const regions = useMemo<readonly CpRegionView[]>(() => {
    const found = annotations.filter(isSuppressionRegionAnnotation);
    if (found.length === 0) return NO_REGIONS;
    const counts = cpRegionHiddenCounts(unfilteredEntries, documentSuppress, annotations);
    return found.map((region) => ({
      region,
      selected: region.id === selectedAnnotationId,
      hiddenCount: counts.get(region.id) ?? 0,
      solvable: hasAttachedSolveInput(region),
    }));
  }, [annotations, documentSuppress, selectedAnnotationId, unfilteredEntries]);

  return useMemo(() => ({ ...actions, regions }), [actions, regions]);
}
