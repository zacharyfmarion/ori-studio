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
 * bracketed by begin/commit so a whole drag of the chip is one entry rather than
 * forty — the same invariant `useCpAnnotations` keeps for images and text, and
 * kept separately for the same reason it is kept at all: it is only checkable
 * when the code that depends on it is in one place.
 *
 * {@link UseCpRegionActions.moveRegion} is the one transform here, and it exists
 * because a region's *body* takes no pointer events: the creases inside it have
 * to stay editable, so the shared selection overlay never sees a move for one and
 * the chip carries the gesture instead. Resize and rotate still come from that
 * overlay's handles through `useCpAnnotations`, as they do for every other kind.
 */
import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { OristudioCpDiagnosticEntry } from '../../engine/oristudioCpTypes';
import {
  bottomAnnotationZ,
  isImageAnnotation,
  isSuppressionRegionAnnotation,
  type CanvasAnnotation,
} from '../annotations/annotation';
import type { CpImage } from '../images/cpImage';
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
  /**
   * The reference image this region owns, resolved from its `imageId`.
   *
   * Null for a region that has none *and* for one whose id no longer resolves —
   * `validateCpImage` drops an image with a bad `src` while the region survives,
   * and a chip with no image control is the honest answer to that. The chip never
   * has to know which of the two it is looking at.
   */
  image: CpImage | null;
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
  /**
   * Set a region's centre — the chip's drag. Deliberately unbracketed: a drag is
   * one gesture and forty samples, so the caller opens {@link beginGesture} on
   * the first one that moves and closes it once, on release.
   */
  moveRegion: (id: string, center: { x: number; y: number }) => void;
  /**
   * Delete a region **and the reference image it owns**, as one undo entry.
   *
   * The cascade is the point. A region's image is locked so it never takes a
   * click meant for the creases under repair, and nothing else in the product can
   * select a locked annotation — so a region deleted on its own would leave an
   * underlay the user can see and can never remove.
   */
  removeRegion: (id: string) => void;
  /** Show or hide a region's owned image, as one undo entry. */
  toggleRegionImageHidden: (id: string) => void;
  /**
   * Set a region's owned image opacity. Deliberately unbracketed, like
   * {@link moveRegion}: a slider drag is one gesture and forty samples, and
   * `AnnotationOpacitySlider` opens and closes the snapshot around the whole of
   * it.
   */
  setRegionImageOpacity: (id: string, opacity: number) => void;
  /** Delete a region's owned image and drop the link, as one undo entry. */
  removeRegionImage: (id: string) => void;
  /** Snapshot before a multi-step edit (a chip drag), so it undoes as one. */
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

  // Unbracketed on purpose: a chip drag is one gesture and forty samples, and
  // `useCpRegionChipDrag` opens the snapshot on the first sample that actually
  // moves and closes it on release.
  const moveRegion = useCallback(
    (id: string, center: { x: number; y: number }) => updateAnnotation(id, { center }),
    [updateAnnotation]
  );

  const removeRegion = useCallback(
    (id: string) => {
      const imageId = ownedImageId(id);
      beginGesture();
      removeAnnotation(id);
      // After the region, not before: `removeAnnotation` clears the canvas
      // selection when it removes the selected object, and the region is the one
      // holding it.
      if (imageId) removeAnnotation(imageId);
      commitGesture(t('panels:cpRegion.delete', 'Delete region'));
    },
    [beginGesture, commitGesture, removeAnnotation, t]
  );

  const toggleRegionImageHidden = useCallback(
    (id: string) => {
      const image = ownedImage(id);
      if (!image) return;
      beginGesture();
      updateAnnotation(image.id, { hidden: !image.hidden });
      commitGesture(t('panels:cpRegion.imageVisibility', 'Show or hide reference image'));
    },
    [beginGesture, commitGesture, updateAnnotation, t]
  );

  const setRegionImageOpacity = useCallback(
    (id: string, opacity: number) => {
      const imageId = ownedImageId(id);
      if (imageId) updateAnnotation(imageId, { opacity });
    },
    [updateAnnotation]
  );

  const removeRegionImage = useCallback(
    (id: string) => {
      const imageId = ownedImageId(id);
      if (!imageId) return;
      beginGesture();
      removeAnnotation(imageId);
      // The link goes with it. A region left pointing at a deleted image would
      // still render an image menu, one press from a crash or a no-op.
      updateAnnotation(id, { imageId: undefined });
      commitGesture(t('panels:cpRegion.imageDelete', 'Remove reference image'));
    },
    [beginGesture, commitGesture, removeAnnotation, updateAnnotation, t]
  );

  return useMemo(
    () => ({
      selectRegion,
      addRegion,
      toggleRegionCheckClass,
      moveRegion,
      removeRegion,
      toggleRegionImageHidden,
      setRegionImageOpacity,
      removeRegionImage,
      beginGesture,
      commitGesture,
    }),
    [
      addRegion,
      beginGesture,
      commitGesture,
      moveRegion,
      removeRegion,
      removeRegionImage,
      selectRegion,
      setRegionImageOpacity,
      toggleRegionCheckClass,
      toggleRegionImageHidden,
    ]
  );
}

/**
 * The image a region owns, read imperatively at the moment of the verb.
 *
 * Imperative like every other mutation in this hook, so `useCpRegionActions`
 * still subscribes to no store slice at all — a consumer that only *writes*
 * regions must not re-render when one moves.
 */
function ownedImage(regionId: string): CpImage | null {
  const annotations = useWorkspaceStore.getState().oristudioCpAnnotations;
  const region = annotations.find((annotation) => annotation.id === regionId);
  if (!region || !isSuppressionRegionAnnotation(region) || !region.imageId) return null;
  return regionOwnedImage(annotations, region);
}

function ownedImageId(regionId: string): string | null {
  return ownedImage(regionId)?.id ?? null;
}

/** Resolve a region's `imageId` against the annotation array. */
export function regionOwnedImage(
  annotations: readonly CanvasAnnotation[],
  region: CpSuppressionRegion
): CpImage | null {
  if (!region.imageId) return null;
  const found = annotations.find((annotation) => annotation.id === region.imageId);
  return found && isImageAnnotation(found) ? found : null;
}

export function useCpRegions(): UseCpRegions {
  const actions = useCpRegionActions();
  const annotations = useWorkspaceStore((state) => state.oristudioCpAnnotations);
  // Selection is deliberately *not* read here. A chip carries the same controls
  // whether or not its region holds it — a suppressor's visible half must not
  // shrink — so subscribing would re-render every chip on a selection change to
  // produce identical DOM.
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
      hiddenCount: counts.get(region.id) ?? 0,
      solvable: hasAttachedSolveInput(region),
      image: regionOwnedImage(annotations, region),
    }));
  }, [annotations, documentSuppress, unfilteredEntries]);

  return useMemo(() => ({ ...actions, regions }), [actions, regions]);
}
