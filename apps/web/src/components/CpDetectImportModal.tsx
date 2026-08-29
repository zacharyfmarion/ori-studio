import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ImagePlus, Loader2, Play, RefreshCw, Square, Upload, Wrench, X } from 'lucide-react';
import { track } from '../analytics';
import {
  cpDetectCompilerReport,
  type CpDetectDecodeReport,
  type CpDetectModelManifest,
  type CpDetectPoint,
  type CpDetectQuad,
  type CpDetectRecognizeResult,
  type CpDetectRectifiedImage,
} from '../engine/cpDetectTypes';
import { runCpExactSolve } from '../engine/cpExactSolve';
import { requestCpExactSolveStop } from '../engine/cpExactSolveRuns';
import { isCpExactSolveCancelledError } from '../engine/cpExactSolveSession';
import {
  cpExactSolveReasonLabel,
  cpExactSolveStageHint,
  cpExactSolveStageLabel,
} from '../engine/cpExactSolveMessages';
import { useCpExactSolveRun } from '../hooks/useCpExactSolveRun';
import {
  isCpExactSolveAccepted,
  primaryCpExactSolveReason,
  type CpExactSolveMovedVertex,
  type CpExactSolveOutcome,
  type CpExactSolveStage,
} from '../engine/cpExactSolveTypes';
import {
  cpSolveCompletion,
  cpSolveCompletionDetail,
  cpSolveCompletionFacts,
  cpSolveIsExactVerdict,
  cpSolveMeetsFoldabilityCheck,
} from '../cp-workspace/regions/solveCompletion';
import { getFileService, type OpenBinaryFileResult } from '../platform/fileService';
import {
  cpDetectError,
  getCpDetectClient,
  whileCpDetectClientAlive,
} from '../store/workspaceStore/cpDetectRuntime';
import { useWorkspaceStore } from '../store/workspaceStore';
import {
  lastOristudioCpImportAddPlacement,
  type OristudioCpModelBox,
} from '../store/workspaceStore/oristudioCpRuntime';
import { useLayoutStore } from '../store/layoutStore';
import { cpCamera } from '../cp-workspace/renderer/cpCameraRegistry';
import { bottomAnnotationZ, type CanvasAnnotation } from '../cp-workspace/annotations/annotation';
import {
  createCpSuppressionRegion,
  DEFAULT_SUPPRESSED_CHECK_CLASSES,
} from '../cp-workspace/annotations/suppressionRegion';
import { createCpImage, IMAGE_JPEG_QUALITY } from '../cp-workspace/images/cpImage';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import './CpDetectImportModal.css';

type BusyState =
  | 'loading_model'
  | 'opening'
  | 'rectifying'
  | 'detecting'
  | 'solving'
  | 'importing'
  | null;
type QuadHandle = keyof CpDetectQuad;
type ModalStage = 'upload' | 'crop' | 'detecting' | 'review';
type PreviewOverlayKey = 'inferred' | 'assignments';

interface PreviewOverlayState {
  inferred: boolean;
  assignments: boolean;
}

interface SourceImage {
  image: ImageData;
  name: string;
  path: string | null;
  url: string;
}

const DETECT_IMAGE_SIZE = 1024;
const DETECT_DECODER_BACKEND = 'legacy_candidate_exact_solve_v1' as const;

/**
 * `SYNTHETIC_RENDER_INSET_PX` — the border the detector's unit↔pixel mapping
 * reserves (`candidate_generation/junction_carrier_v1.rs:23`), so the paper
 * occupies pixels `[inset, image_size - inset]` and a unit coordinate `u` sits
 * at `inset + u·(image_size - 2·inset)`. That is what makes the rectified image
 * and the candidate graph register without any user alignment: they come out of
 * the *same* rectification.
 */
const DETECT_PAPER_INSET_PX = 32;

/**
 * Outward margin on the suppression region, as a fraction of the paper.
 *
 * The region has to contain the vertices *on* the paper edge — that is where a
 * candidate's boundary Kawasaki fans live — and containment is an inclusive
 * `<=` on floating-point coordinates that were arrived at by a different route
 * than the box's own. A margin small enough to stay far inside `import_add`'s
 * 100-unit gap makes that robust instead of exact-comparison luck.
 */
const REGION_PAPER_MARGIN_RATIO = 0.02;

/**
 * What the pressed button adds to the document.
 *
 * Each one names the **coordinates it lands**, because that is the only thing
 * that differs between them and the previous set of labels got it wrong: "Solve
 * & Add" promised an action that had already happened inside the decode, and was
 * byte-identical to "Add as-is" beside it.
 *
 * - `add` — the *solved* FOLD, from a solve the solver called exact. It is plain
 *   **Add** because there is nothing left to do.
 * - `addImproved` — the candidate with the moves from a solve the solver
 *   **accepted but did not call exact** written in. Real, better coordinates
 *   that still fail the foldability check, so offering them as "Add" would
 *   promise the one thing they do not deliver. Built here rather than taken from
 *   `CpExactSolveResult.fold`, which is deliberately null for this ending.
 * - `reviewAndFix` — the candidate, plus the rectified image and a
 *   check-suppression region carrying the `ExactSolveInput`, so the pattern can
 *   be repaired and solved in the document.
 * - `addPartial` — the candidate with a timed-out solve's partial coordinates
 *   written in. Real coordinates from a real run that simply did not clear the
 *   acceptance gate before the clock did.
 * - `addAsIs` — the candidate, untouched. Only offered where the pattern is
 *   **genuinely unsolved**, never as a second name for a solve that succeeded.
 */
type ImportMode = 'add' | 'addImproved' | 'reviewAndFix' | 'addPartial' | 'addAsIs';

/**
 * What the recognize report says about the candidate's **graph**.
 *
 * Read from `topology_diagnostics.combinatorial`: findings that are properties
 * of the graph and survive moving the drawing around. `angle_dependent` is
 * deliberately ignored — on an unsolved candidate the Kawasaki residual is
 * around 4° at every interior vertex by construction, which is what the solve is
 * for, so it says nothing about whether the topology is right.
 */
interface CandidateTopology {
  /**
   * Distinct places a human would have to touch: interior vertices flagged by
   * odd degree, Maekawa parity or a boundary failure (counted once each), plus
   * degenerate edges and unmodelled crossings.
   *
   * `degree_two_vertices` is deliberately excluded — a degree-2 vertex is not an
   * error on its own, and the repair for one is to dissolve it, never to delete.
   *
   * There is **no threshold** on this number. An earlier draft refused repair
   * past eight sites as "not practical", which was wrong twice over: the
   * alternative to this feature is tracing the whole pattern by hand, so 13
   * sites is a large saving rather than a burden; and the fallback it pushed
   * people to — adding the candidate unsolved — hands them that same ~4° of
   * error at every vertex. The measurement agrees: hard-bucket repairs came out
   * 131/140 identical to ground truth, and what capped their recovery was the
   * solve budget, not the size of the repair.
   */
  repairSites: number;
  /**
   * There is nothing to solve and nothing to repair against: the analysis was
   * blocked by a malformed graph, or the report carried no `ExactSolveInput` at
   * all. Both leave exactly one honest option, which is to add it as-is.
   */
  blocked: boolean;
}

/**
 * How far the staged flow has got, once recognition has landed.
 *
 * The three-way split at the top is the point of this whole change. A candidate
 * whose topology is visibly broken never reaches `solving`, because solving it
 * would spend the entire budget — up to 25 s, and 123 of 140 hard solves spend
 * all of it — on geometry the user is about to change.
 */
type SolvePhase =
  /** Recognized, and the solve was deliberately not run. */
  | { kind: 'not_attempted' }
  | { kind: 'solving'; stage: CpExactSolveStage }
  /**
   * The user stopped the solve.
   *
   * Its own phase rather than a return to `not_attempted`, because the two are
   * different facts and the screen has to say which: `not_attempted` means the
   * topology was flagged and solving would have been wasted, which is a sentence
   * about the candidate. This one is a sentence about a choice, and it must not
   * report "0 places to repair" as the reason the solve did not run.
   */
  | { kind: 'cancelled' }
  /** The solver reached a verdict. `fold` is non-null only when it accepted. */
  | { kind: 'settled'; outcome: CpExactSolveOutcome; fold: Record<string, unknown> | null }
  /**
   * The solve could not run at all — a dead worker, not one of the solver's
   * endings. Separate from `settled` so a bridge failure is never reported as a
   * rejection the user could fix by editing.
   */
  | { kind: 'errored' };

const NOT_ATTEMPTED: SolvePhase = { kind: 'not_attempted' };
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];
const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const QUAD_HANDLES: QuadHandle[] = ['top_left', 'top_right', 'bottom_right', 'bottom_left'];
const DEFAULT_PREVIEW_OVERLAYS: PreviewOverlayState = {
  inferred: false,
  assignments: false,
};

export function CpDetectImportModal() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<SourceImage | null>(null);
  const [quad, setQuad] = useState<CpDetectQuad | null>(null);
  const [rectified, setRectified] = useState<CpDetectRectifiedImage | null>(null);
  const [recognition, setRecognition] = useState<CpDetectRecognizeResult | null>(null);
  const [phase, setPhase] = useState<SolvePhase>(NOT_ATTEMPTED);
  const [modelManifest, setModelManifest] = useState<CpDetectModelManifest | null>(null);
  const [busy, setBusy] = useState<BusyState>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<QuadHandle | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [previewOverlays, setPreviewOverlays] = useState<PreviewOverlayState>(DEFAULT_PREVIEW_OVERLAYS);
  const sourceImageRef = useRef<HTMLImageElement>(null);
  /**
   * Distinguishes one detection's solve from the next one's in the run registry.
   *
   * The registry refuses a second run for the same `targetId` rather than
   * queueing it invisibly. A constant id would therefore make a re-detect throw
   * if the previous solve were somehow still live, so each press gets its own.
   */
  const solveCountRef = useRef(0);
  /**
   * The run registry's key for the solve on screen, so Stop can name it.
   *
   * State rather than the ref above because the Stop affordance renders from it:
   * whether a run *can* be stopped is the registry's answer, and this is how the
   * modal asks for its own run rather than assuming there is exactly one.
   */
  const [solveTargetId, setSolveTargetId] = useState<string | null>(null);
  const solveRun = useCpExactSolveRun(solveTargetId);

  /**
   * Stop the running solve.
   *
   * Addressed by run id through the registry, which is also where `cancellable`
   * came from — so the button that renders and the run that is stopped cannot be
   * two different things.
   */
  const stopSolve = useCallback(() => {
    if (solveRun) requestCpExactSolveStop(solveRun.runId);
  }, [solveRun]);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('ori-studio:detect-cp-image', onOpen);
    return () => window.removeEventListener('ori-studio:detect-cp-image', onOpen);
  }, []);

  useEffect(() => {
    if (!open || modelManifest) return;
    let cancelled = false;
    setBusy((current) => current ?? 'loading_model');
    setError(null);
    getCpDetectClient()
      .then((client) => whileCpDetectClientAlive(client.verifyModelAssets()))
      .then((manifest) => {
        if (!cancelled) setModelManifest(manifest);
      })
      .catch((caught) => {
        if (!cancelled) setError(cpDetectError(caught).message);
      })
      .finally(() => {
        if (!cancelled) {
          setBusy((current) => (current === 'loading_model' ? null : current));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [modelManifest, open]);

  useEffect(() => {
    return () => {
      if (source?.url) URL.revokeObjectURL(source.url);
    };
  }, [source?.url]);

  /**
   * Forget the picked image and everything derived from it.
   *
   * Closing used to clear only `error` and `dropActive`, so reopening the modal
   * came back to the previous image, crop and detection — a second detection
   * looked like it had silently ignored the file picker. It also held the
   * source blob and a 1024x1024 rectified `ImageData` alive for the whole
   * session, for a dialog that is shut.
   *
   * `modelManifest` deliberately survives: it is the expensive asset
   * verification, and the effect above is keyed on its absence, so clearing it
   * would re-verify on every open.
   */
  const resetSession = useCallback(() => {
    setSource((previous) => {
      if (previous?.url) URL.revokeObjectURL(previous.url);
      return null;
    });
    setQuad(null);
    setRectified(null);
    setRecognition(null);
    setPhase(NOT_ATTEMPTED);
    setSolveTargetId(null);
    setError(null);
    setDragging(null);
    setDropActive(false);
    setPreviewOverlays(DEFAULT_PREVIEW_OVERLAYS);
  }, []);

  /**
   * Whether leaving is possible right now.
   *
   * Every busy state but one is a short call the dialog has no way to interrupt.
   * A solve is the exception — it is the long wait, up to the whole 25 s budget,
   * and now the one thing here that *can* be stopped — so closing during it
   * stops it instead of being refused. That gate was the reason a running
   * detection could not be abandoned at all.
   */
  const canClose = busy === null || (busy === 'solving' && solveRun?.cancellable === true);

  const close = useCallback(() => {
    if (!canClose) return;
    // Stopped before the state is cleared, so the solve's own rejection lands on
    // a session that is already gone rather than writing a phase into it.
    if (busy === 'solving') stopSolve();
    setOpen(false);
    resetSession();
  }, [busy, canClose, resetSession, stopSolve]);

  const loadImageFile = useCallback(async (file: OpenBinaryFileResult) => {
    const nextSource = await sourceImageFromFile(file, t);
    setSource((previous) => {
      if (previous?.url) URL.revokeObjectURL(previous.url);
      return nextSource;
    });
    setQuad(null);
    setRectified(null);
    setRecognition(null);
    setPhase(NOT_ATTEMPTED);
    setPreviewOverlays(DEFAULT_PREVIEW_OVERLAYS);

    const client = await getCpDetectClient();
    setBusy('rectifying');
    const auto = await whileCpDetectClientAlive(
      client.autoRectifyImage(nextSource.image, DETECT_IMAGE_SIZE)
    );
    setRectified(auto);
    setQuad(auto.report.detected_source_quad ?? auto.report.source_quad);
  }, [t]);

  const chooseImage = useCallback(async () => {
    setBusy('opening');
    setError(null);
    try {
      const file = await getFileService().openBinaryFile({
        title: t('dialogs:cpDetectImport.openImageTitle', 'Open Crease Pattern Image'),
        extensions: IMAGE_EXTENSIONS,
        mimeTypes: IMAGE_MIME_TYPES,
      });
      if (file) await loadImageFile(file);
    } catch (caught) {
      setError(cpDetectError(caught).message);
    } finally {
      setBusy(null);
    }
  }, [loadImageFile, t]);

  const chooseDroppedImage = useCallback(
    async (file: File) => {
      setBusy('opening');
      setError(null);
      try {
        if (!isSupportedImageFile(file)) {
          throw new Error(t('errors:cpDetectImport.unsupportedImage', 'Use a PNG, JPEG, or WebP image.'));
        }
        await loadImageFile(await openBinaryFileFromBrowserFile(file));
      } catch (caught) {
        setError(cpDetectError(caught).message);
      } finally {
        setBusy(null);
      }
    },
    [loadImageFile, t]
  );

  const rerunManualRectification = useCallback(async () => {
    if (!source || !quad) return;
    setBusy('rectifying');
    setError(null);
    setRecognition(null);
    setPhase(NOT_ATTEMPTED);
    setPreviewOverlays(DEFAULT_PREVIEW_OVERLAYS);
    try {
      const client = await getCpDetectClient();
      setRectified(
        await whileCpDetectClientAlive(
          client.manualRectifyImage(source.image, quad, DETECT_IMAGE_SIZE)
        )
      );
    } catch (caught) {
      setError(cpDetectError(caught).message);
    } finally {
      setBusy(null);
    }
  }, [quad, source]);

  /**
   * Run the exact solve on a recognized candidate, in the two stages it has.
   *
   * The shared implementation, not a second one: `runCpExactSolve` is the same
   * call the region chip's Solve makes, and it owns the parts that must not be
   * re-derived per surface — the stage split, the run registry, and the budget
   * rule. **The budget is the caller's obligation** and this is where it is met:
   * `solve_exact` builds its deadline from the `timeout_seconds` of the call it
   * is in, so two calls would otherwise be two independent deadlines and the
   * staged path would quietly get twice the fused path's cap. Handing over the
   * published `budget.total_seconds` is what keeps the total whole; a negative
   * total passes through unchanged, because it disables the timeout and `0`
   * means "time out immediately".
   */
  const solveRecognized = useCallback(
    async (recognized: CpDetectRecognizeResult) => {
      setBusy('solving');
      setPhase({ kind: 'solving', stage: 'geometry' });
      solveCountRef.current += 1;
      const targetId = `cp-detect-import:${solveCountRef.current}`;
      setSolveTargetId(targetId);
      try {
        const result = await runCpExactSolve(recognized.solveInput, {
          timeoutSeconds: recognized.solve.budget?.totalSeconds,
          run: { kind: 'detect-import', targetId },
          onStage: (stage) => setPhase({ kind: 'solving', stage }),
        });
        setPhase({ kind: 'settled', outcome: result.outcome, fold: result.fold });
        publishDetectionResult(source, recognized, foldJsonOf(result.fold) ?? recognized.foldJson);
      } catch (caught) {
        // Stop is not a failure, and must not leave an error line behind saying
        // it was. The candidate is exactly what it was before the solve started
        // — nothing here writes — so the screen goes back to offering it.
        if (isCpExactSolveCancelledError(caught)) {
          setPhase({ kind: 'cancelled' });
          publishDetectionResult(source, recognized, recognized.foldJson);
          return;
        }
        setError(cpDetectError(caught).message);
        setPhase({ kind: 'errored' });
        publishDetectionResult(source, recognized, recognized.foldJson);
      } finally {
        setBusy(null);
      }
    },
    [source]
  );

  /**
   * Detect: **recognize, then decide whether solving is worth it.**
   *
   * The two halves used to be one opaque wasm call that always solved, so a
   * candidate with a missing junction still paid the full solve budget before
   * the user saw anything at all. Recognition returns in inference time plus a
   * few hundred microseconds of graph analysis, and its combinatorial findings
   * are enough to answer the only question that matters here: is this graph
   * worth handing to the solver, or is it worth handing to the user?
   */
  const runDetection = useCallback(async () => {
    if (!rectified) return;
    setBusy('detecting');
    setError(null);
    setRecognition(null);
    setPhase(NOT_ATTEMPTED);
    // Image→CP funnel start. No image data or filename is ever sent.
    track('cp detect started');
    let recognized: CpDetectRecognizeResult;
    try {
      const client = await getCpDetectClient();
      // Raced against the worker's loss signal, because comlink's proxy settles
      // only when the worker answers: a wasm trap or an OOM mid-inference would
      // otherwise leave this dialog on "Running model" with nothing ever ending
      // it. The solve below has its own transport and its own version of this.
      recognized = await whileCpDetectClientAlive(
        client.recognizeRectifiedFold(rectified.image, {
          decoderBackend: DETECT_DECODER_BACKEND,
          junctionSource: 'dense-model',
        })
      );
      setRecognition(recognized);
      track('cp detect completed', { succeeded: true });
    } catch (caught) {
      setError(cpDetectError(caught).message);
      track('cp detect completed', { succeeded: false });
      setBusy(null);
      return;
    }
    const topology = candidateTopology(recognized);
    if (topology.blocked || topology.repairSites > 0) {
      publishDetectionResult(source, recognized, recognized.foldJson);
      setBusy(null);
      return;
    }
    await solveRecognized(recognized);
  }, [rectified, solveRecognized, source]);

  const topology = useMemo(
    () => (recognition ? candidateTopology(recognition) : null),
    [recognition]
  );

  /**
   * The timed-out solve's partial coordinates, as a FOLD ready to add.
   *
   * Computed rather than promised: the mapping needs `cp_detector
   * .vertex_original_ids`, so this returns null when the export carries none and
   * the button is then not offered at all. An offer that cannot be honoured is
   * worse than no offer.
   */
  const partialFoldJson = useMemo(
    () =>
      recognition && phase.kind === 'settled' && phase.outcome.kind === 'timeout'
        ? foldJsonWithMovedVertices(recognition.foldJson, phase.outcome.partialMovedVertices)
        : null,
    [phase, recognition]
  );

  /**
   * The improved-but-not-exact document, built here because the runner will not
   * hand one over.
   *
   * `CpExactSolveResult.fold` is deliberately null on an `ambiguous` acceptance:
   * that field is the *exactly* solved document, and returning improved geometry
   * through it is how improved geometry gets applied as the answer. The moves are
   * on the outcome, and offering them is the caller's design decision — which is
   * this, and it is the same construction the timeout partial uses, because the
   * two cases are the same shape: real coordinates from a real run that the
   * solver would not sign off as exact.
   */
  const improvedFoldJson = useMemo(
    () =>
      recognition && phase.kind === 'settled' && phase.outcome.kind === 'ambiguous'
        ? foldJsonWithMovedVertices(recognition.foldJson, phase.outcome.movedVertices)
        : null,
    [phase, recognition]
  );

  const importModes = useMemo(
    () => availableImportModes(topology, phase, partialFoldJson !== null, improvedFoldJson !== null),
    [improvedFoldJson, partialFoldJson, phase, topology]
  );
  const primaryMode = importModes.primary;

  /**
   * Add the detected pattern **beside** the user's work, never over it.
   *
   * This used to call `loadCreasePatternText`, which replaces the document — so
   * detecting a crease pattern discarded whatever was open. Everything now goes
   * through Import (Add): the kernel shifts the import clear of the existing
   * pattern and divides it against nothing, so the candidate's topology arrives
   * untouched and the user's own pattern is not edited at all.
   *
   * `reviewAndFix` additionally places the rectified source image and a
   * check-suppression region over the added paper — see
   * `implementation-plans/crease-topology-repair.md`.
   */
  const addDetection = useCallback(
    async (mode: ImportMode) => {
      if (!recognition || !source) return;
      const foldJson = importFoldJson(
        mode,
        recognition,
        phase,
        partialFoldJson,
        improvedFoldJson
      );
      if (!foldJson) return;
      setBusy('importing');
      setError(null);
      try {
        const label =
          mode === 'reviewAndFix'
            ? t('dialogs:cpDetectImport.repairLabel', 'Add detected crease pattern to repair')
            : t('dialogs:cpDetectImport.addLabel', 'Add detected crease pattern');
        // Re-encoded before anything is merged, so a canvas failure aborts with
        // the document still untouched rather than half a repair set up.
        const underlay =
          mode === 'reviewAndFix' && rectified
            ? {
                src: imageDataToDataUrl(rectified.image, t),
                width: rectified.image.width,
                height: rectified.image.height,
              }
            : null;
        // Detect is reachable with no crease pattern open at all (it is gated
        // only on "not busy"), and Import (Add) needs a document to add into.
        await useWorkspaceStore.getState().ensureEditCreasePattern();
        const beforeAnnotations = useWorkspaceStore.getState().oristudioCpAnnotations;
        const merged = await useWorkspaceStore.getState().importAddOristudioCpText({
          text: foldJson,
          format: 'fold',
          filename: detectedFoldFilename(source.name),
          label,
        });
        if (!merged) {
          throw new Error(
            useWorkspaceStore.getState().oristudioCpError ??
              t('errors:cpDetectImport.addFailed', 'The detected crease pattern could not be added.')
          );
        }
        const paper = lastOristudioCpImportAddPlacement()?.bounds ?? null;
        if (underlay && paper) {
          const store = useWorkspaceStore.getState();
          const annotations = repairAnnotations(
            paper,
            underlay,
            recognition.solveInput,
            t('dialogs:cpDetectImport.regionLabel', 'Detected crease pattern'),
            bottomAnnotationZ(beforeAnnotations)
          );
          for (const annotation of annotations) store.addAnnotation(annotation);
          // A second, overlay-only history entry, so one undo takes the image
          // and the region back off and a second undo takes the creases with
          // them. Recorded after the adds because the store already holds the
          // post-gesture layer by then.
          store.recordAnnotationHistory(beforeAnnotations, label);
          // The same event the rail tool fires, distinguished only by `source`:
          // a region drawn by hand and one set up by a detection import are the
          // same object doing two different jobs, and separating them is how we
          // tell whether anyone found the tool.
          track('cp suppression region created', { source: 'detect' });
        }
        useLayoutStore.getState().activateWorkspace('edit');
        // One check, where this used to run seven. Two of those (`Fix1`, `Fix2`)
        // *mutate*, and they now run over the **merged** document — they would
        // silently edit the user's own creases, which is precisely what adding
        // beside their work exists to stop. Of the five read-only ones only the
        // last had any visible effect, since each overwrites `lastCommandResult`.
        // The repair worklist itself is the always-on CAMV overlay, which the
        // merge already scheduled.
        await useWorkspaceStore
          .getState()
          .executeOristudioCpCommand('FlatFoldableCheck')
          .catch(() => false);
        // Last, so it wins over the check's own jump to its first issue: the
        // import lands clear of the existing pattern, so without this the user
        // sees the modal close and — as far as the viewport is concerned —
        // nothing else happen. Best effort; a camera is only registered while an
        // Edit canvas is mounted, and a canvas mounting fresh fits by itself.
        if (paper) cpCamera()?.frameModelBounds(paper);
        track('cp detect imported', {
          mode,
          outcome: importOutcome(topology, phase),
          repair_sites: repairSiteBucket(topology),
        });
        setOpen(false);
        // Same reset as `close`: a successful add ends the session, so the next
        // open starts at the file picker rather than on the pattern just added.
        resetSession();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setBusy(null);
      }
    },
    [
      improvedFoldJson,
      partialFoldJson,
      phase,
      recognition,
      rectified,
      resetSession,
      source,
      t,
      topology,
    ]
  );

  const onDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDropActive(false);
      if (busy !== null || !modelManifest) return;
      const file = event.dataTransfer.files?.[0];
      if (file) void chooseDroppedImage(file);
    },
    [busy, chooseDroppedImage, modelManifest]
  );

  const report = recognition?.detectorReport ?? null;
  const rectificationWarnings = rectified?.report.warnings ?? [];
  const detectorWarnings = report?.warnings ?? [];
  const compilerMetadata = useMemo(() => compilerReportMetadata(t, report), [report, t]);
  const compilerOverlay = useMemo(() => compilerPreviewOverlay(report), [report]);
  /**
   * What the preview draws: the solved pattern once there is one, and the
   * recognized candidate at every other moment — including *while the solve
   * runs*, which is the point. The user watches the creases that were found
   * rather than a spinner over an opaque call, and sees them settle when the
   * solve lands.
   */
  const foldPreview = useMemo(() => {
    if (!recognition) return null;
    const solved = phase.kind === 'settled' ? phase.fold : null;
    return solved ? foldPreviewOf(solved) : parseFoldPreview(recognition.foldJson);
  }, [phase, recognition]);
  const stage: ModalStage =
    busy === 'detecting' ? 'detecting' : recognition ? 'review' : source ? 'crop' : 'upload';
  const canChooseImage = modelManifest !== null && busy === null;
  // The solve has its own row, which names the stage rather than saying "busy".
  const status = busy && busy !== 'solving' ? busyLabel(t, busy) : null;
  const togglePreviewOverlay = useCallback((key: PreviewOverlayKey) => {
    setPreviewOverlays((previous) => ({ ...previous, [key]: !previous[key] }));
  }, []);

  if (!open) return null;

  return (
    <div
      className="cp-detect-modal"
      role="dialog"
      aria-modal="true"
      aria-label={t('dialogs:cpDetectImport.ariaLabel', 'Detect CP from image')}
    >
      <div className={`cp-detect-modal__surface cp-detect-modal__surface--${stage}`}>
        <header className="cp-detect-modal__header">
          <div>
            <h2>{t('dialogs:cpDetectImport.title', 'Detect CP from Image')}</h2>
            {source && <p>{source.name}</p>}
          </div>
          <IconButton title={t('common:close', 'Close')} size="sm" onClick={close} disabled={!canClose}>
            <X size={15} />
          </IconButton>
        </header>

        {stage === 'upload' && (
          <div
            className={`cp-detect-modal__dropzone${dropActive ? ' cp-detect-modal__dropzone--active' : ''}`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDropActive(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              event.preventDefault();
              setDropActive(false);
            }}
            onDrop={onDrop}
          >
            <Button size="md" variant="primary" onClick={chooseImage} disabled={!canChooseImage}>
              <ImagePlus size={16} />
              {t('dialogs:cpDetectImport.chooseImage', 'Choose Image')}
            </Button>
            <div className="cp-detect-modal__drop-hint">{t('dialogs:cpDetectImport.dropImageHere', 'Drop image here')}</div>
            {status && (
              <div className="cp-detect-modal__inline-status">
                <Loader2 size={14} className="cp-detect-modal__spinner" />
                {status}
              </div>
            )}
          </div>
        )}

        {stage === 'crop' && source && (
          <>
            <div className="cp-detect-modal__actions">
              <Button size="sm" onClick={chooseImage} disabled={busy !== null}>
                <ImagePlus size={14} />
                {t('dialogs:cpDetectImport.chooseImage', 'Choose Image')}
              </Button>
              <Button size="sm" onClick={rerunManualRectification} disabled={!quad || busy !== null}>
                <RefreshCw size={14} />
                {t('dialogs:cpDetectImport.updateCrop', 'Update Crop')}
              </Button>
              <Button size="sm" variant="primary" onClick={runDetection} disabled={!rectified || busy !== null}>
                <Play size={14} />
                {t('dialogs:cpDetectImport.detect', 'Detect')}
              </Button>
            </div>

            <StatusRows status={status} error={error} />

            <div className="cp-detect-modal__crop-grid">
              <section className="cp-detect-modal__pane">
                <h3>{t('dialogs:cpDetectImport.crop', 'Crop')}</h3>
                <SourceCropEditor
                  source={source}
                  quad={quad}
                  dragging={dragging}
                  sourceImageRef={sourceImageRef}
                  onDragHandle={setDragging}
                  onUpdateQuad={setQuad}
                />
              </section>

              <section className="cp-detect-modal__pane">
                <h3>{t('dialogs:cpDetectImport.rectified', 'Rectified')}</h3>
                {rectified ? <CanvasImage image={rectified.image} /> : <div className="cp-detect-modal__empty" />}
              </section>
            </div>
          </>
        )}

        {stage === 'detecting' && (
          <div className="cp-detect-modal__detecting">
            <Loader2 size={28} className="cp-detect-modal__spinner" />
            <div>{status ?? t('dialogs:cpDetectImport.runningModel', 'Running model')}</div>
            {rectified && <CanvasImage image={rectified.image} />}
          </div>
        )}

        {stage === 'review' && (
          <>
            <div className="cp-detect-modal__actions">
              <Button size="sm" onClick={chooseImage} disabled={busy !== null}>
                <ImagePlus size={14} />
                {t('dialogs:cpDetectImport.chooseImage', 'Choose Image')}
              </Button>
              <Button size="sm" onClick={rerunManualRectification} disabled={!source || !quad || busy !== null}>
                <RefreshCw size={14} />
                {t('dialogs:cpDetectImport.updateCrop', 'Update Crop')}
              </Button>
              <Button size="sm" onClick={runDetection} disabled={!rectified || busy !== null}>
                <Play size={14} />
                {t('dialogs:cpDetectImport.detect', 'Detect')}
              </Button>
              {/* No terminal button while the solve runs: there is no decision to
                  offer yet, and a button that adds an about-to-change pattern is
                  the same trap as a "Solve & Add" that does not solve. */}
              {primaryMode && (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => void addDetection(primaryMode)}
                  disabled={busy !== null}
                >
                  {primaryMode === 'reviewAndFix' ? <Wrench size={14} /> : <Upload size={14} />}
                  {importModeLabel(t, primaryMode)}
                </Button>
              )}
              {importModes.secondary.map((mode) => (
                <Button
                  key={mode}
                  size="sm"
                  onClick={() => void addDetection(mode)}
                  disabled={busy !== null}
                >
                  {importModeLabel(t, mode)}
                </Button>
              ))}
            </div>

            <div className="cp-detect-modal__verdict" data-outcome={verdictTone(topology, phase)}>
              {verdictMessage(t, {
                topology,
                phase,
                partialVertices: partialVertexCount(phase, partialFoldJson),
                // So the sentence never offers a button that is not on the row
                // above it: the improved result needs a solved FOLD, and a solve
                // that produced none has nothing to add.
                canAddImproved: importModes.secondary.includes('addImproved'),
              })}
              {/* The solver's two stages, named. They behave nothing alike —
                  geometry fails fast and is a fraction of the wall, refinement is
                  79-96% of it — so one spinner for both would be a lie about how
                  long is left. Inside the verdict rather than beside it, so the
                  surface's row template is unchanged. */}
              {phase.kind === 'solving' && (
                <div className="cp-detect-modal__solving" role="status">
                  <Loader2 size={14} className="cp-detect-modal__spinner" />
                  <span>{cpExactSolveStageLabel(t, phase.stage)}</span>
                  <span className="cp-detect-modal__solving-hint">
                    {cpExactSolveStageHint(t, phase.stage)}
                  </span>
                  {/* Rendered from the run's own `cancellable`, so a solve on a
                      transport nothing can reach shows the wait and no button
                      rather than a Stop that does nothing. */}
                  {solveRun?.cancellable && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={stopSolve}
                      disabled={solveRun.stopping}
                    >
                      <Square size={13} />
                      {solveRun.stopping
                        ? t('dialogs:cpDetectImport.stopping', 'Stopping…')
                        : t('dialogs:cpDetectImport.stopSolve', 'Stop')}
                    </Button>
                  )}
                </div>
              )}
            </div>

            <StatusRows status={status} error={error} />

            <div className="cp-detect-modal__review-grid">
              <section className="cp-detect-modal__pane">
                <h3>{t('dialogs:cpDetectImport.rectified', 'Rectified')}</h3>
                {rectified ? <CanvasImage image={rectified.image} /> : <div className="cp-detect-modal__empty" />}
              </section>

              <section className="cp-detect-modal__pane">
                <div className="cp-detect-modal__pane-heading">
                  <h3>{t('dialogs:cpDetectImport.detected', 'Detected')}</h3>
                  <CompilerPreviewControls
                    overlay={previewOverlays}
                    hasInferred={foldPreview?.edgeProvenance.some(edgeHasInferredProvenance) ?? false}
                    hasAssignments={compilerOverlay.assignmentEdgeIds.size > 0}
                    onToggle={togglePreviewOverlay}
                  />
                </div>
                {foldPreview ? (
                  <FoldPreview preview={foldPreview} overlay={previewOverlays} compilerOverlay={compilerOverlay} />
                ) : (
                  <div className="cp-detect-modal__empty" />
                )}
              </section>
            </div>
          </>
        )}

        {stage !== 'upload' &&
          (modelManifest || rectificationWarnings.length > 0 || detectorWarnings.length > 0 || report) && (
            <div className="cp-detect-modal__report">
              {modelManifest && <span>{modelManifest.id}</span>}
              {report && (
                <span>
                  {t('dialogs:cpDetectImport.report.counts', '{{vertices}} vertices, {{edges}} edges', {
                    vertices: report.vertex_count,
                    edges: report.edge_count,
                  })}
                </span>
              )}
              {report && (
                <span>{report.quality_report?.candidate_strategy ?? report.decoder_backend}</span>
              )}
              {compilerMetadata.map((item) => (
                <span key={item}>{item}</span>
              ))}
              {/* Why the solve did not land, in the solver's own vocabulary. A
                  timeout is told apart by `classifyCpExactSolve` reading the
                  `movement_report.timed_out` **boolean** — never by matching the
                  reason string, which embeds a formatted number. A malformed
                  input carries no `rejection_reasons` key at all and so has no
                  token to print here; the verdict above says what happened. */}
              {phase.kind === 'settled' && phase.outcome.kind === 'timeout' && (
                <span>{t('dialogs:cpDetectImport.report.solveTimedOut', 'solve timed out')}</span>
              )}
              {phase.kind === 'settled' &&
                phase.outcome.kind === 'rejected' &&
                phase.outcome.reasons[0] && <span>{phase.outcome.reasons[0]}</span>}
              {[...rectificationWarnings, ...detectorWarnings].map((warning, index) => (
                <span key={`${warning.code}-${index}`}>{warning.code}</span>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}

function StatusRows({ status, error }: { status: string | null; error: string | null }) {
  if (!status && !error) return null;
  return (
    <>
      {status && (
        <div className="cp-detect-modal__status">
          <Loader2 size={14} className="cp-detect-modal__spinner" />
          {status}
        </div>
      )}
      {error && <div className="cp-detect-modal__error">{error}</div>}
    </>
  );
}

function SourceCropEditor({
  source,
  quad,
  dragging,
  sourceImageRef,
  onDragHandle,
  onUpdateQuad,
}: {
  source: SourceImage;
  quad: CpDetectQuad | null;
  dragging: QuadHandle | null;
  sourceImageRef: RefObject<HTMLImageElement | null>;
  onDragHandle: (handle: QuadHandle | null) => void;
  onUpdateQuad: (quad: CpDetectQuad) => void;
}) {
  return (
    <div
      className="cp-detect-modal__image-wrap"
      style={{ aspectRatio: `${source.image.width} / ${source.image.height}` }}
      onPointerMove={(event) => {
        if (!dragging || !sourceImageRef.current || !quad) return;
        event.preventDefault();
        const point = pointFromPointer(event, sourceImageRef.current, source.image);
        onUpdateQuad({ ...quad, [dragging]: clampPoint(point, source.image) });
      }}
      onPointerUp={() => onDragHandle(null)}
      onPointerLeave={() => onDragHandle(null)}
    >
      <img ref={sourceImageRef} src={source.url} alt="" draggable={false} />
      {quad && (
        <svg className="cp-detect-modal__overlay" viewBox={`0 0 ${source.image.width} ${source.image.height}`}>
          <polygon points={quadPolygon(quad)} className="cp-detect-modal__quad" />
          {QUAD_HANDLES.map((handle) => (
            <circle
              key={handle}
              cx={quad[handle].x}
              cy={quad[handle].y}
              r={Math.max(source.image.width, source.image.height) * 0.012}
              className="cp-detect-modal__handle"
              onPointerDown={(event) => {
                event.preventDefault();
                (event.currentTarget as SVGCircleElement).setPointerCapture(event.pointerId);
                onDragHandle(handle);
              }}
            />
          ))}
        </svg>
      )}
    </div>
  );
}

function CanvasImage({ image }: { image: ImageData }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d')?.putImageData(image, 0, 0);
  }, [image]);

  return <canvas ref={ref} className="cp-detect-modal__canvas" />;
}

interface FoldPreviewData {
  vertices: [number, number][];
  edges: [number, number][];
  assignments: string[];
  edgeIds: number[];
  edgeSources: string[];
  edgeProvenance: string[][];
  assignmentConfidence: number[];
}

interface CompilerPreviewOverlay {
  assignmentEdgeIds: Set<number>;
}

function CompilerPreviewControls({
  overlay,
  hasInferred,
  hasAssignments,
  onToggle,
}: {
  overlay: PreviewOverlayState;
  hasInferred: boolean;
  hasAssignments: boolean;
  onToggle: (key: PreviewOverlayKey) => void;
}) {
  const { t } = useTranslation();
  if (!hasInferred && !hasAssignments) return null;
  return (
    <div
      className="cp-detect-modal__preview-controls"
      aria-label={t('dialogs:cpDetectImport.compilerReviewOverlays', 'Compiler review overlays')}
    >
      {hasInferred && (
        <Button
          size="sm"
          variant="ghost"
          isActive={overlay.inferred}
          aria-pressed={overlay.inferred}
          onClick={() => onToggle('inferred')}
        >
          {t('dialogs:cpDetectImport.inferred', 'Inferred')}
        </Button>
      )}
      {hasAssignments && (
        <Button
          size="sm"
          variant="ghost"
          isActive={overlay.assignments}
          aria-pressed={overlay.assignments}
          onClick={() => onToggle('assignments')}
        >
          {t('dialogs:cpDetectImport.mvChanges', 'M/V changes')}
        </Button>
      )}
    </div>
  );
}

function FoldPreview({
  preview,
  overlay,
  compilerOverlay,
}: {
  preview: FoldPreviewData;
  overlay: PreviewOverlayState;
  compilerOverlay: CompilerPreviewOverlay;
}) {
  return (
    <svg className="cp-detect-modal__fold" viewBox="0 0 1 1">
      {preview.edges.map(([a, b], index) => {
        const start = preview.vertices[a];
        const end = preview.vertices[b];
        if (!start || !end) return null;
        return (
          <line
            key={`${a}-${b}-${index}`}
            x1={start[0]}
            y1={start[1]}
            x2={end[0]}
            y2={end[1]}
            className={`cp-detect-modal__fold-line cp-detect-modal__fold-line--${assignmentClass(preview.assignments[index])}`}
          />
        );
      })}
      {overlay.inferred &&
        preview.edges.map(([a, b], index) => {
          if (!edgeIsInferred(preview, index)) return null;
          return provenanceLine(preview, a, b, index, 'inferred');
        })}
      {overlay.assignments &&
        preview.edges.map(([a, b], index) => {
          if (!compilerOverlay.assignmentEdgeIds.has(edgeIdAt(preview, index))) return null;
          return provenanceLine(preview, a, b, index, 'assignment');
        })}
    </svg>
  );
}

function provenanceLine(
  preview: FoldPreviewData,
  a: number,
  b: number,
  index: number,
  kind: 'inferred' | 'assignment'
) {
  const start = preview.vertices[a];
  const end = preview.vertices[b];
  if (!start || !end) return null;
  return (
    <line
      key={`${kind}-${a}-${b}-${index}`}
      x1={start[0]}
      y1={start[1]}
      x2={end[0]}
      y2={end[1]}
      className={`cp-detect-modal__fold-provenance cp-detect-modal__fold-provenance--${kind}`}
    />
  );
}

async function sourceImageFromFile(file: OpenBinaryFileResult, t: TFunction): Promise<SourceImage> {
  const bytes = new Uint8Array(file.bytes.length);
  bytes.set(file.bytes);
  const blob = new Blob([bytes.buffer], { type: file.mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error(t('errors:cpDetectImport.canvasUnavailable', 'Canvas 2D is unavailable'));
    context.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return {
      image: context.getImageData(0, 0, canvas.width, canvas.height),
      name: file.name,
      path: file.path,
      url,
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

async function openBinaryFileFromBrowserFile(file: File): Promise<OpenBinaryFileResult> {
  return {
    bytes: new Uint8Array(await file.arrayBuffer()),
    name: file.name,
    path: null,
    mimeType: file.type || 'application/octet-stream',
  };
}

function isSupportedImageFile(file: File): boolean {
  if (IMAGE_MIME_TYPES.includes(file.type)) return true;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.includes(extension);
}

function pointFromPointer(event: ReactPointerEvent, element: HTMLElement, image: ImageData): CpDetectPoint {
  const rect = element.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * image.width,
    y: ((event.clientY - rect.top) / rect.height) * image.height,
  };
}

function clampPoint(point: CpDetectPoint, image: ImageData): CpDetectPoint {
  return {
    x: Math.min(Math.max(point.x, 0), image.width - 1),
    y: Math.min(Math.max(point.y, 0), image.height - 1),
  };
}

function quadPolygon(quad: CpDetectQuad): string {
  return [quad.top_left, quad.top_right, quad.bottom_right, quad.bottom_left]
    .map((point) => `${point.x},${point.y}`)
    .join(' ');
}

/**
 * `'solving'` is excluded rather than given a case: the solve names the stage it
 * is in (`cpExactSolveStageLabel`), and a generic "Solving" beside that would
 * either duplicate it or contradict it. The exclusion is what makes the omission
 * a type error if this is ever called for that state.
 */
function busyLabel(t: TFunction, busy: Exclude<BusyState, null | 'solving'>): string {
  switch (busy) {
    case 'loading_model':
      return t('dialogs:cpDetectImport.busy.loadingModel', 'Checking detector model');
    case 'opening':
      return t('dialogs:cpDetectImport.busy.opening', 'Opening image');
    case 'rectifying':
      return t('dialogs:cpDetectImport.busy.rectifying', 'Rectifying crop');
    case 'detecting':
      return t('dialogs:cpDetectImport.busy.detecting', 'Running model');
    case 'importing':
      return t('dialogs:cpDetectImport.busy.importing', 'Importing crease pattern');
  }
}

function detectedFoldFilename(name: string): string {
  return `${name.replace(/\.[^.]+$/, '') || 'detected-cp'}.fold`;
}

/**
 * Announce the finished pattern on `window`, once per detection.
 *
 * Fired at the **terminal** state rather than the moment recognition lands, so
 * `foldJson` is what the user is being offered: the solved document where a
 * solve landed, and the candidate everywhere else. `scripts/cp-detect/
 * benchmark-browser-vs-oracle.mjs` drives this modal and reads exactly these two
 * fields off `detail.detection`, and it compares the fold against an oracle — so
 * publishing the pre-solve candidate the instant it exists would have quietly
 * made every browser-vs-oracle number a candidate-coordinate number.
 */
function publishDetectionResult(
  source: SourceImage | null,
  recognition: CpDetectRecognizeResult,
  foldJson: string
): void {
  window.dispatchEvent(
    new CustomEvent('ori-studio:cp-detect-result', {
      detail: {
        sourceName: source?.name ?? null,
        sourcePath: source?.path ?? null,
        detection: { ...recognition, foldJson },
      },
    })
  );
}

function parseFoldPreview(foldJson: string): FoldPreviewData | null {
  try {
    return foldPreviewOf(JSON.parse(foldJson));
  } catch {
    return null;
  }
}

/**
 * The preview's view of a FOLD document, from an already-parsed one.
 *
 * Split from {@link parseFoldPreview} because the solved document arrives from
 * the solver as an object, and re-serializing it only to parse it straight back
 * would be a round trip through a quarter of a megabyte of JSON for nothing.
 */
function foldPreviewOf(value: unknown): FoldPreviewData | null {
  const fold = value as {
    vertices_coords?: [number, number][];
    edges_vertices?: [number, number][];
    edges_assignment?: string[];
    cp_detector?: {
      edge_ids?: unknown[];
      edge_source?: unknown[];
      edge_provenance?: unknown[];
      assignment_confidence?: unknown[];
    };
  } | null;
  if (!fold || !Array.isArray(fold.vertices_coords) || !Array.isArray(fold.edges_vertices)) {
    return null;
  }
  return {
    vertices: fold.vertices_coords,
    edges: fold.edges_vertices,
    assignments: fold.edges_assignment ?? [],
    edgeIds: numericArray(fold.cp_detector?.edge_ids),
    edgeSources: stringArray(fold.cp_detector?.edge_source),
    edgeProvenance: stringMatrix(fold.cp_detector?.edge_provenance),
    assignmentConfidence: numericArray(fold.cp_detector?.assignment_confidence),
  };
}

function assignmentClass(assignment: string | undefined): string {
  if (assignment === 'M') return 'mountain';
  if (assignment === 'V') return 'valley';
  if (assignment === 'B') return 'border';
  return 'unknown';
}

function edgeIdAt(preview: FoldPreviewData, index: number): number {
  return preview.edgeIds[index] ?? index;
}

function edgeIsInferred(preview: FoldPreviewData, index: number): boolean {
  return preview.edgeSources[index] === 'inferred' || edgeHasInferredProvenance(preview.edgeProvenance[index] ?? []);
}

function edgeHasInferredProvenance(provenance: string[]): boolean {
  return provenance.some((value) => value.startsWith('inferred_by'));
}

function numericArray(value: unknown[] | undefined): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
}

function stringArray(value: unknown[] | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function stringMatrix(value: unknown[] | undefined): string[][] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stringArray(Array.isArray(item) ? item : undefined));
}

function compilerPreviewOverlay(report: CpDetectDecodeReport | null): CompilerPreviewOverlay {
  const assignmentEdgeIds = new Set<number>();
  const compilerReport = cpDetectCompilerReport(report);
  if (!compilerReport) return { assignmentEdgeIds };
  if (!compilerOutputWasEmitted(compilerReport)) return { assignmentEdgeIds };
  const decisions = (compilerReport as { assignments?: { decisions?: unknown[] } }).assignments?.decisions ?? [];
  for (const decision of decisions) {
    if (!decision || typeof decision !== 'object') continue;
    const record = decision as { edge_id?: unknown; provenance?: unknown };
    if (record.provenance === 'assignment_observed') continue;
    if (typeof record.edge_id === 'number' && Number.isInteger(record.edge_id)) {
      assignmentEdgeIds.add(record.edge_id);
    }
  }
  return { assignmentEdgeIds };
}

function compilerReportMetadata(t: TFunction, report: CpDetectDecodeReport | null): string[] {
  const compilerReport = cpDetectCompilerReport(report);
  if (!compilerReport) return [];
  const emitted = compilerOutputWasEmitted(compilerReport);
  const data = compilerReport as {
    output?: { selected?: string };
    topology?: { accepted_moves?: unknown[]; ambiguous?: boolean };
    assignments?: { decisions?: unknown[]; ambiguous?: boolean };
    final_verification?: { classifications?: string[] };
  };
  const items: string[] = [];
  if (!emitted && data.output?.selected === 'legacy_fallback') {
    items.push(t('dialogs:cpDetectImport.report.compilerFallback', 'compiler fallback'));
  }
  const moves = emitted ? data.topology?.accepted_moves?.length ?? 0 : 0;
  if (moves > 0) {
    items.push(
      moves === 1
        ? t('dialogs:cpDetectImport.report.topologyMove', '{{count}} topology move', { count: moves })
        : t('dialogs:cpDetectImport.report.topologyMoves', '{{count}} topology moves', { count: moves })
    );
  }
  const decisions = emitted ? data.assignments?.decisions?.filter((decision) => {
    return (
      decision &&
      typeof decision === 'object' &&
      (decision as { provenance?: unknown }).provenance !== 'assignment_observed'
    );
  }).length ?? 0 : 0;
  if (decisions > 0) {
    items.push(
      decisions === 1
        ? t('dialogs:cpDetectImport.report.assignmentChange', '{{count}} assignment change', { count: decisions })
        : t('dialogs:cpDetectImport.report.assignmentChanges', '{{count}} assignment changes', { count: decisions })
    );
  }
  if (data.topology?.ambiguous || data.assignments?.ambiguous) {
    items.push(t('dialogs:cpDetectImport.report.ambiguous', 'ambiguous'));
  }
  const classifications = data.final_verification?.classifications ?? [];
  if (classifications.length > 0 && !classifications.includes('clean')) {
    items.push(...classifications);
  }
  return items;
}

/**
 * The candidate's topology, from the recognize report's own analysis.
 *
 * `topology_diagnostics` is `oristudio_cp_compiler::analyze_candidate_topology`
 * run on the `ExactSolveInput` — the compiler's finding, not a second
 * implementation of it — and it is the whole reason recognition can decide
 * whether solving is worth it: it costs a few hundred microseconds where the
 * solve it replaces costs up to 25 seconds.
 *
 * A report carrying no diagnostics reads as `{repairSites: 0}` and so goes to
 * the solver. That is the honest default: no evidence of a broken graph is not
 * evidence of one, and refusing to solve on a missing field would turn a
 * serialization change into "this pattern needs repair".
 */
function candidateTopology(recognition: CpDetectRecognizeResult): CandidateTopology {
  const diagnostics = recognition.topologyDiagnostics;
  // No seam to hand the solver is the same dead end as an unreadable graph: the
  // region's Solve affordance keys on the attachment's presence, so without one
  // there is nothing to repair *against* either.
  if (recognition.solveInput === null || recognition.solveInput === undefined) {
    return { repairSites: 0, blocked: true };
  }
  if (!diagnostics) return { repairSites: 0, blocked: false };
  if (diagnostics.blockers.length > 0) return { repairSites: 0, blocked: true };

  const combinatorial = diagnostics.combinatorial;
  const flagged = new Set<number>([
    ...combinatorial.odd_degree_vertices,
    ...combinatorial.maekawa_failures,
    ...combinatorial.boundary_failures,
  ]);
  return {
    repairSites:
      flagged.size + combinatorial.degenerate_edges.length + combinatorial.unmodeled_crossings.length,
    blocked: false,
  };
}

/**
 * Which buttons the terminal state earns, and which is primary.
 *
 * The rule the old screen broke: **a button names what it does**. So `add` is
 * offered only where a solve this modal ran was accepted and produced a
 * document, `addAsIs` only where the pattern is genuinely unsolved, and
 * `reviewAndFix` wherever there is anything to repair — at **any** site count,
 * with no threshold. While the solve is running there is no decision to offer,
 * so there is no button at all.
 */
function availableImportModes(
  topology: CandidateTopology | null,
  phase: SolvePhase,
  hasPartial: boolean,
  hasImproved: boolean
): { primary: ImportMode | null; secondary: ImportMode[] } {
  if (!topology || phase.kind === 'solving') return { primary: null, secondary: [] };
  if (phase.kind === 'settled' && phase.outcome.kind === 'solved' && phase.fold) {
    return { primary: 'add', secondary: [] };
  }
  // Accepted, kept, and not exact. It may be added — the coordinates are real
  // and better — but it may not be the recommended one-word answer: it did not
  // reach foldable precision, and the usual cause is topology only the user can
  // fix. So repair leads and the improved result stays on offer beside it, under
  // a name that says what it is.
  if (phase.kind === 'settled' && phase.outcome.kind === 'ambiguous' && hasImproved) {
    return { primary: 'reviewAndFix', secondary: ['addImproved', 'addAsIs'] };
  }
  if (topology.blocked) return { primary: 'addAsIs', secondary: [] };
  // A stopped solve lands in the same place a failed one does, and for the same
  // reason: there is an unsolved candidate and two honest things to do with it.
  // `add` is not among them — no solve was accepted, so there is no solved FOLD.
  return {
    primary: 'reviewAndFix',
    secondary: hasPartial ? ['addPartial', 'addAsIs'] : ['addAsIs'],
  };
}

function importModeLabel(t: TFunction, mode: ImportMode): string {
  switch (mode) {
    case 'add':
      return t('dialogs:cpDetectImport.add', 'Add');
    case 'addImproved':
      return t('dialogs:cpDetectImport.addImproved', 'Add improved result');
    case 'reviewAndFix':
      return t('dialogs:cpDetectImport.reviewAndFix', 'Review & Fix');
    case 'addPartial':
      return t('dialogs:cpDetectImport.addPartial', 'Add partial result');
    case 'addAsIs':
      return t('dialogs:cpDetectImport.addAsIs', 'Add as-is');
  }
}

/** The FOLD a mode adds, or null when the state cannot produce one. */
function importFoldJson(
  mode: ImportMode,
  recognition: CpDetectRecognizeResult,
  phase: SolvePhase,
  partialFoldJson: string | null,
  improvedFoldJson: string | null
): string | null {
  switch (mode) {
    case 'add':
      return phase.kind === 'settled' ? foldJsonOf(phase.fold) : null;
    // Not `phase.fold`: the runner returns that only for an exact solve, on
    // purpose. This is the candidate with the accepted moves written in.
    case 'addImproved':
      return improvedFoldJson;
    case 'addPartial':
      return partialFoldJson;
    case 'reviewAndFix':
    case 'addAsIs':
      return recognition.foldJson;
  }
}

function foldJsonOf(fold: Record<string, unknown> | null): string | null {
  return fold ? JSON.stringify(fold) : null;
}

/**
 * The candidate FOLD with a run's coordinates written into it.
 *
 * One construction, two callers, because they are the same situation: geometry a
 * real run produced that the modal cannot get as a solved FOLD.
 *
 * - **A timeout** returns the coordinates it was *given* and reports the work it
 *   did in `attempted_moved_vertices` — a median of ~448 entries — so this is
 *   the only place that partial solution exists.
 * - **An ambiguous acceptance** is withheld by `runCpExactSolve` on purpose: its
 *   `fold` is the *exactly* solved document, and improved-but-not-foldable
 *   geometry returned through that field is how it gets applied as the answer.
 *
 * Either way the coordinates are real and what did not happen is a claim about
 * them, which is why the buttons that add these say "partial" and "improved".
 *
 * The mapping is exact rather than positional. `cp_detector.vertex_original_ids`
 * is written by the same exporter that renumbered the vertices
 * (`fold_export.rs`), and the ids in the movement report index
 * `ExactSolveInput.vertices` — the same space. Null when the export carries no
 * such list or the arrays disagree, so a shape change drops the offer instead of
 * scattering coordinates onto the wrong vertices.
 */
function foldJsonWithMovedVertices(
  foldJson: string,
  partial: readonly CpExactSolveMovedVertex[]
): string | null {
  if (partial.length === 0) return null;
  let fold: { vertices_coords?: unknown; cp_detector?: { vertex_original_ids?: unknown } } | null;
  try {
    fold = JSON.parse(foldJson) as typeof fold;
  } catch {
    return null;
  }
  const coords = fold?.vertices_coords;
  const originalIds = fold?.cp_detector?.vertex_original_ids;
  if (!Array.isArray(coords) || !Array.isArray(originalIds)) return null;
  if (coords.length !== originalIds.length) return null;

  const indexOfVertex = new Map<number, number>();
  originalIds.forEach((id, index) => {
    if (typeof id === 'number') indexOfVertex.set(id, index);
  });
  const moved = coords.map((point) => (Array.isArray(point) ? [...point] : point));
  let applied = 0;
  for (const vertex of partial) {
    const index = indexOfVertex.get(vertex.vertex_id);
    if (index === undefined) continue;
    moved[index] = [vertex.after.x, vertex.after.y];
    applied += 1;
  }
  if (applied === 0) return null;
  return JSON.stringify({ ...fold, vertices_coords: moved });
}

/** How many of the partial's vertices the offer actually carries, or null. */
function partialVertexCount(phase: SolvePhase, partialFoldJson: string | null): number | null {
  if (!partialFoldJson || phase.kind !== 'settled' || phase.outcome.kind !== 'timeout') return null;
  return phase.outcome.partialMovedVertices.length;
}

/** Tone for the verdict's left border. Presentation only. */
function verdictTone(topology: CandidateTopology | null, phase: SolvePhase): string {
  if (!topology) return 'unknown';
  if (phase.kind === 'solving') return 'solving';
  if (phase.kind === 'settled' && isCpExactSolveAccepted(phase.outcome)) {
    // The tone follows the *check*, not the acceptance: an ambiguous solve leaves
    // the preview looking solved while every angle marker survives, and a green
    // border over that is the screen agreeing with the wrong reading.
    return cpSolveMeetsFoldabilityCheck(cpSolveCompletion(phase.outcome))
      ? 'exact'
      : 'improved';
  }
  // A stop is not a failure and is not toned like one: the user asked for it,
  // and the candidate underneath is exactly as repairable as it was.
  if (phase.kind === 'cancelled') return 'repairable';
  if (phase.kind === 'settled' || phase.kind === 'errored') return 'failed';
  return topology.blocked ? 'blocked' : 'repairable';
}

/**
 * What the review screen says about the candidate, in one short paragraph.
 *
 * Every branch names what the user gets rather than what the compiler found, and
 * the site count is **information, not a verdict** — it says how much work you
 * are taking on and never withholds the option.
 *
 * The failure sentences are not written here. `cpExactSolveReasonLabel` is the
 * one table that turns the solver's nine `rejection_reasons` tokens plus its two
 * unspelt endings into sentences, and it is shared with the region chip on
 * purpose: two surfaces explaining the same refusal in two different ways is how
 * they drift.
 */
function verdictMessage(
  t: TFunction,
  {
    topology,
    phase,
    partialVertices,
    canAddImproved,
  }: {
    topology: CandidateTopology | null;
    phase: SolvePhase;
    partialVertices: number | null;
    canAddImproved: boolean;
  }
): string {
  if (!topology) return '';
  if (phase.kind === 'solving') {
    return t(
      'dialogs:cpDetectImport.verdict.solving',
      'Nothing is flagged in the topology, so the solve is running. Below is what was recognized — the creases move into place when it lands.'
    );
  }
  if (phase.kind === 'settled' && isCpExactSolveAccepted(phase.outcome)) {
    // The same four completion sentences the region chip uses, because they are
    // statements about one solve and two surfaces describing it differently is
    // how they drift apart. Only the closing clause is this modal's own — it
    // names buttons that exist here and nowhere else.
    const facts = cpSolveCompletionFacts(phase.outcome);
    const detail = cpSolveCompletionDetail(t, facts);
    // The closing clause names buttons, so it follows the *solver's* verdict —
    // the same thing `availableImportModes` branches on. Following the check
    // instead would send a user to a Review & Fix that is not on the screen.
    return `${detail} ${
      cpSolveIsExactVerdict(facts.completion)
        ? t(
            'dialogs:cpDetectImport.verdict.exact',
            'Adding it beside your work leaves the rest of the document untouched.'
          )
        : canAddImproved
          ? t(
              'dialogs:cpDetectImport.verdict.improved',
              'Review & Fix adds it with the source image behind it and keeps the solver data, so you can repair what is left and solve again — or add the improved result as it stands.'
            )
          : t(
              'dialogs:cpDetectImport.verdict.improvedNoFold',
              'Review & Fix adds it with the source image behind it and keeps the solver data, so you can repair what is left and solve again.'
            )
    }`;
  }
  if (phase.kind === 'cancelled') {
    return t(
      'dialogs:cpDetectImport.verdict.cancelled',
      'You stopped the solve, so nothing was changed — this is the pattern exactly as it was recognized. Review & Fix adds it with the source image behind it and keeps the solver data, so you can solve it again in the document.'
    );
  }
  if (phase.kind === 'settled' || phase.kind === 'errored') {
    const reason = phase.kind === 'settled' ? primaryCpExactSolveReason(phase.outcome) : null;
    return [
      reason ? cpExactSolveReasonLabel(t, reason) : null,
      partialVertices === null
        ? null
        : t('dialogs:cpDetectImport.verdict.timeoutPartial', {
            count: partialVertices,
            defaultValue_one:
              'It had moved 1 vertex into place before the clock ran out, and you can add that partial result instead of the raw candidate.',
            defaultValue_other:
              'It had moved {{count}} vertices into place before the clock ran out, and you can add that partial result instead of the raw candidate.',
          }),
      t(
        'dialogs:cpDetectImport.verdict.afterFailure',
        'Review & Fix adds the candidate with the source image behind it and keeps the solver data, so you can repair it and solve again.'
      ),
    ]
      .filter((part): part is string => part !== null)
      .join(' ');
  }
  if (topology.blocked) {
    return t(
      'dialogs:cpDetectImport.verdict.blocked',
      'The solver could not read this candidate graph, so there is nothing to repair by hand. You can still add it as-is.'
    );
  }
  return t('dialogs:cpDetectImport.verdict.repairable', {
    count: topology.repairSites,
    defaultValue_one:
      'Recognized, with 1 place to repair — so the solve was not run: it would have spent its whole budget on geometry you are about to change. Review & Fix adds the candidate with the source image behind it, so you can fix it and solve.',
    defaultValue_other:
      'Recognized, with {{count}} places to repair — so the solve was not run: it would have spent its whole budget on geometry you are about to change. Review & Fix adds the candidate with the source image behind it, so you can fix them and solve. Adding it as-is instead leaves every angle approximate.',
  });
}

/**
 * The two annotations "Review & Fix" places over the added candidate.
 *
 * `paper` is the added pattern's own paper square in document coordinates, which
 * `import_add` decided — so both annotations follow the import wherever it
 * landed, whether it was gapped beside the user's work or centred into a blank
 * canvas.
 *
 * Registration needs no user alignment. The rectified image and the candidate
 * come out of the same rectification, so the paper occupies image pixels
 * `[inset, size - inset]`; the image box is therefore the paper scaled by
 * `size / (size - 2·inset)` about the same centre, since the inset is symmetric.
 */
function repairAnnotations(
  paper: OristudioCpModelBox,
  imageSrc: { src: string; width: number; height: number },
  solveInput: unknown,
  label: string,
  bottomZ: number
): CanvasAnnotation[] {
  const center = { x: (paper.minX + paper.maxX) / 2, y: (paper.minY + paper.maxY) / 2 };
  const paperWidth = paper.maxX - paper.minX;
  const paperHeight = paper.maxY - paper.minY;
  const inset = 2 * DETECT_PAPER_INSET_PX;
  const scale = imageSrc.width > inset ? imageSrc.width / (imageSrc.width - inset) : 1;
  const margin = Math.max(paperWidth, paperHeight) * REGION_PAPER_MARGIN_RATIO;
  return [
    createCpImage({
      src: imageSrc.src,
      naturalWidth: imageSrc.width,
      naturalHeight: imageSrc.height,
      center,
      width: paperWidth * scale,
      height: paperHeight * scale,
      // Locked so it never takes a click meant for the creases over it, and at
      // half opacity so it reads as an underlay rather than as the drawing.
      opacity: 0.5,
      locked: true,
      z: bottomZ - 1,
    }),
    createCpSuppressionRegion({
      center,
      width: paperWidth + 2 * margin,
      height: paperHeight + 2 * margin,
      suppress: DEFAULT_SUPPRESSED_CHECK_CLASSES,
      label,
      // Verbatim and unread here: its presence is what gives the region a Solve
      // affordance, and only detection produces one.
      solveInput,
      z: bottomZ - 2,
    }),
  ];
}

/**
 * Re-encode the rectified frame as the data URL a `CpImage` carries.
 *
 * JPEG, following the image layer's own import policy: the rectified frame is
 * fully opaque (its padding is filled), and a 1024² PNG of a scanned crease
 * pattern is several times the size for nothing.
 */
function imageDataToDataUrl(image: ImageData, t: TFunction): string {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error(t('errors:cpDetectImport.canvasUnavailable', 'Canvas 2D is unavailable'));
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/jpeg', IMAGE_JPEG_QUALITY);
}

/**
 * Repair-site count as an analytics bucket. Never the raw number: a per-sample
 * count of anything measured off the user's own drawing is exactly what the
 * privacy contract forbids sending.
 */
function repairSiteBucket(topology: CandidateTopology | null): string {
  if (!topology) return 'unknown';
  if (topology.blocked) return 'blocked';
  const sites = topology.repairSites;
  if (sites === 0) return '0';
  if (sites <= 2) return '1-2';
  if (sites <= 4) return '3-4';
  if (sites <= 8) return '5-8';
  if (sites <= 16) return '9-16';
  return '17+';
}

/**
 * How the pattern being added came out, as a fixed token.
 *
 * The four solver endings pass through under their own names, so the funnel can
 * be read as intended-vs-landed: `recognized` is a candidate the modal chose not
 * to solve, and it is the number that says whether staging is earning its keep.
 */
function importOutcome(topology: CandidateTopology | null, phase: SolvePhase): string {
  if (!topology) return 'unknown';
  if (topology.blocked) return 'blocked';
  switch (phase.kind) {
    case 'not_attempted':
      return 'recognized';
    case 'solving':
      return 'solving';
    case 'cancelled':
      return 'cancelled';
    case 'errored':
      return 'error';
    case 'settled':
      return phase.outcome.kind;
  }
}

function compilerOutputWasEmitted(compilerReport: unknown): boolean {
  return (
    compilerReport !== null &&
    typeof compilerReport === 'object' &&
    (compilerReport as { output?: { selected?: unknown } }).output?.selected === 'compiled'
  );
}
