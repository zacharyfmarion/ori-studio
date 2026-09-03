import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Crop, ImagePlus, Loader2, Play, Square, Upload, Wrench, X } from 'lucide-react';
import { CpDetectCropEditor } from './CpDetectCropEditor';
import { sourceSizeForRectification } from './cpDetectCropLoupe';
import { track } from '../analytics';
import type { CpDetectFailureReason, CpDetectImageSource } from '../analytics/events';
import { proxy } from 'comlink';
import { CpDetectModelLine } from './CpDetectModelLine';
import { detectRuntimeProperties, loadDetectorModel, type DetectorModelState } from './cpDetectModelState';
import { defaultCpDetectModelStore, formatModelSize, type CpDetectModelDownloadProgress } from '../lib/cpDetectModels';
import { identityOf } from '../lib/objectIdentity';
import {
  cpDetectCompilerReport,
  type CpDetectDecodeReport,
  type CpDetectQuad,
  type CpDetectRecognizeResult,
  type CpDetectRectifiedImage,
} from '../engine/cpDetectTypes';
import { CP_EXACT_SOLVE_NO_DEADLINE, runCpExactSolve } from '../engine/cpExactSolve';
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
type ModalStage = 'upload' | 'crop' | 'detecting' | 'review';

/**
 * The funnel's reason for a detection that did not complete: the model store's
 * own code when the download half failed, `worker_lost` when the runtime died
 * under the inference, and `inference` for everything else the model run
 * raised. Never the message, which can name the registry URL.
 */
function detectFailureReason(code: string): CpDetectFailureReason {
  switch (code) {
    case 'registry_unavailable':
    case 'registry_invalid':
    case 'download_failed':
    case 'integrity':
      return code;
    case 'cp_detect_client_lost':
      return 'worker_lost';
    default:
      return 'inference';
  }
}

/** Where the dialog stands, from the three facts that decide it. */
function modalStage(busy: string | null, recognition: unknown, source: unknown): ModalStage {
  return busy === 'detecting' ? 'detecting' : recognition ? 'review' : source ? 'crop' : 'upload';
}
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
 * reserves (`candidate_generation/junction_carrier_v1.rs:23`), so a unit
 * coordinate `u` decodes from pixel `inset + u·(image_size - 2·inset)`.
 *
 * **This constant is the registration, and nothing else is.** It is tempting to
 * read the rectifier's own `report.target_quad` instead — it says where the
 * paper really landed, and the three rectification paths used to disagree about
 * it, two of them (`resize_full_frame`, `resize_without_panel`) not insetting at
 * all. But
 * `unit_from_px` and `px_from_unit` never consult it: they always divide by
 * `image_size - 64`. So the candidate's unit square is at pixels
 * `[32, size - 32]` **whatever the rectifier did**, and an underlay placed from
 * `target_quad` lines its border up with the paper while every crease inside it
 * sits 1024/960 ≈ 6.7% off. That was tried, in a999608e, and reverted: the
 * symptom is "the borders line up but the lines don't".
 *
 * Rectification agrees with it now — `paper_target_span` (`rectify.rs`) puts the
 * paper at `[32, image_size - 32]` on all three paths, where it used to inset
 * only when it had warped a detected panel. So the underlay, the decode and the
 * model's training renders are finally one convention rather than three, and
 * this constant is the name of it.
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
 * The modes that add what a solve produced. Those get the extra-vertex sweep
 * over the added creases: detection split every crease at every junction it
 * found, the solve keeps the pieces, and an accepted solve is where they are
 * put back together. The other two add the raw detection, whose collinear
 * pieces are only nearly collinear and are the user's to repair.
 */
const SOLVER_OUTPUT_MODES: ReadonlySet<ImportMode> = new Set(['add', 'addImproved', 'addPartial']);

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
  const [model, setModel] = useState<DetectorModelState | null>(null);
  const [modelProgress, setModelProgress] = useState<CpDetectModelDownloadProgress | null>(null);
  const [modelUpdating, setModelUpdating] = useState(false);
  const [busy, setBusy] = useState<BusyState>(null);
  const [error, setError] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [previewOverlays, setPreviewOverlays] = useState<PreviewOverlayState>(DEFAULT_PREVIEW_OVERLAYS);
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

  // What the registry points at, what is installed, whether an update is on
  // offer — read on open, before any image, so the dialog can say what a
  // Detect will download. Nothing is fetched but the registry and a manifest.
  useEffect(() => {
    if (!open || model) return;
    let cancelled = false;
    setBusy((current) => current ?? 'loading_model');
    setError(null);
    getCpDetectClient()
      .then((client) => whileCpDetectClientAlive(loadDetectorModel(client)))
      .then((state) => {
        if (!cancelled) setModel(state);
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
  }, [model, open]);

  /**
   * Take the offered update: install the newer version through the worker (so
   * its session is warm), switch to it, and only then drop the old bytes — an
   * interrupted update leaves the previous detector in place, never nothing.
   */
  const updateModel = useCallback(async () => {
    if (!model?.update || modelUpdating) return;
    const next = model.update;
    const previous = model.active;
    setModelUpdating(true);
    setError(null);
    try {
      const client = await getCpDetectClient();
      const manifest = await whileCpDetectClientAlive(
        client.loadModel(
          { model: next, manifestUrl: next.manifest_url },
          proxy((progress: CpDetectModelDownloadProgress) => setModelProgress(progress))
        )
      );
      setModel({ ...model, active: next, manifest, installed: true, update: null });
      if (previous.id !== next.id) await defaultCpDetectModelStore().remove(previous.id);
      track('cp detect model downloaded', { source: 'update' });
    } catch (caught) {
      const failure = cpDetectError(caught);
      setError(failure.message);
      track('cp detect model download failed', { source: 'update', code: failure.code });
    } finally {
      setModelUpdating(false);
      setModelProgress(null);
    }
  }, [model, modelUpdating]);

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
   * `model` deliberately survives: it is the registry read, and the effect
   * above is keyed on its absence, so clearing it would re-read on every open.
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
    // The funnel's exit, with where it happened. Only a close that abandons the
    // session reaches here; a successful add closes through `addToDocument`.
    track('cp detect dismissed', { stage: modalStage(busy, recognition, source) });
    setOpen(false);
    resetSession();
  }, [busy, canClose, recognition, resetSession, source, stopSolve]);

  const loadImageFile = useCallback(async (file: OpenBinaryFileResult, from: CpDetectImageSource) => {
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
    // Funnel step two, with the auto-crop's own success as a property: whether
    // it found the paper. No image data, size or filename.
    track('cp detect image loaded', {
      source: from,
      paper_found: auto.report.detected_source_quad != null,
    });
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
      if (file) await loadImageFile(file, 'picker');
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
        await loadImageFile(await openBinaryFileFromBrowserFile(file), 'drop');
      } catch (caught) {
        setError(cpDetectError(caught).message);
      } finally {
        setBusy(null);
      }
    },
    [loadImageFile, t]
  );

  /**
   * Distinguishes one crop's rectification from the next one's: a corner
   * dragged twice in quick succession sends two requests, and the first one
   * finishing last must not overwrite the crop the user actually left.
   */
  /**
   * What the crop editor is shown of the source: its size and its URL, never
   * its pixels. An ImageData's pixel array is an own property, and React's
   * development build diffs the props of every component it re-renders for its
   * performance track, so a prop that reaches one is walked byte by byte on the
   * main thread. The seconds-long freeze after a crop drag was exactly that.
   */
  const cropSource = useMemo(
    () =>
      source && {
        image: { width: source.image.width, height: source.image.height },
        url: source.url,
      },
    [source]
  );

  const rectifyRequestRef = useRef(0);

  /**
   * Re-rectify from the crop — the one handed in when a drag just ended, since
   * the state may be a render behind the pointer, or the current one.
   */
  const rerunManualRectification = useCallback(
    async (nextQuad?: CpDetectQuad) => {
      const target = nextQuad ?? quad;
      if (!source || !target) return;
      rectifyRequestRef.current += 1;
      const request = rectifyRequestRef.current;
      setBusy('rectifying');
      setError(null);
      setRecognition(null);
      setPhase(NOT_ATTEMPTED);
      setPreviewOverlays(DEFAULT_PREVIEW_OVERLAYS);
      try {
        const client = await getCpDetectClient();
        const result = await whileCpDetectClientAlive(
          client.manualRectifyImage(source.image, target, DETECT_IMAGE_SIZE)
        );
        if (request === rectifyRequestRef.current) setRectified(result);
      } catch (caught) {
        if (request === rectifyRequestRef.current) setError(cpDetectError(caught).message);
      } finally {
        if (request === rectifyRequestRef.current) setBusy(null);
      }
    },
    [quad, source]
  );

  /**
   * Solve the recognized candidate, with no deadline.
   *
   * The recognize path publishes `solve.budget.total_seconds` — the 25 s the
   * native decode was measured against — and this used to hand it over. It no
   * longer does: a solve that is still converging at 25 s was being cut off and
   * offered as a partial, and a complex pattern that gets there in forty
   * seconds is worth forty seconds. The dialog's own Stop, and the solving
   * toast's Cancel, are how a solve that would not get there ends.
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
          timeoutSeconds: CP_EXACT_SOLVE_NO_DEADLINE,
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
    if (!rectified || !model) return;
    setBusy('detecting');
    setError(null);
    setRecognition(null);
    setPhase(NOT_ATTEMPTED);
    setModelProgress(null);
    // Image→CP funnel start. No image data or filename is ever sent.
    track('cp detect started');
    let recognized: CpDetectRecognizeResult;
    try {
      const client = await getCpDetectClient();
      // Raced against the worker's loss signal, because comlink's proxy settles
      // only when the worker answers: a wasm trap or an OOM mid-inference would
      // otherwise leave this dialog on "Running model" with nothing ever ending
      // it. The solve below has its own transport and its own version of this.
      //
      // The first run on a device is also the download: the worker installs
      // the model the registry named, reporting progress here, before its
      // session exists.
      recognized = await whileCpDetectClientAlive(
        client.recognizeRectifiedFold(
          rectified.image,
          {
            decoderBackend: DETECT_DECODER_BACKEND,
            junctionSource: 'dense-model',
            model: model.active,
            manifestUrl: model.active.manifest_url,
          },
          proxy((progress: CpDetectModelDownloadProgress) => setModelProgress(progress))
        )
      );
      setRecognition(recognized);
      if (recognized.runtime?.model_source === 'downloaded') {
        setModel((current) => (current ? { ...current, installed: true } : current));
        track('cp detect model downloaded', { source: 'first-run' });
      }
      track('cp detect completed', { succeeded: true, ...detectRuntimeProperties(recognized.runtime) });
    } catch (caught) {
      const failure = cpDetectError(caught);
      setError(failure.message);
      track('cp detect completed', { succeeded: false, reason: detectFailureReason(failure.code) });
      setBusy(null);
      return;
    } finally {
      setModelProgress(null);
    }
    const topology = candidateTopology(recognized);
    if (topology.blocked || topology.repairSites > 0) {
      publishDetectionResult(source, recognized, recognized.foldJson);
      setBusy(null);
      return;
    }
    await solveRecognized(recognized);
  }, [model, rectified, solveRecognized, source]);

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
          mergeExtraVertices: SOLVER_OUTPUT_MODES.has(mode),
          // A crease the model could not call mountain or valley arrives
          // unassigned; in the pattern it is a guide for the user to decide on,
          // not a crease for the checks to count, so it lands as auxiliary.
          unassignedAsAuxiliary: true,
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
        // No check is run here. This used to run seven, then one —
        // `FlatFoldableCheck`, which is a drag-path tool: it traces the loop the
        // user drags and tests the paper inside it, and called with no path it
        // can only report "Boundary loop is not closed", which is what every
        // import ended with. The repair worklist is the always-on CAMV overlay,
        // which the merge already scheduled.
        // The import lands clear of the existing pattern, so without this the
        // user sees the modal close and — as far as the viewport is concerned —
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
      if (busy !== null || !model) return;
      const file = event.dataTransfer.files?.[0];
      if (file) void chooseDroppedImage(file);
    },
    [busy, chooseDroppedImage, model]
  );

  const report = recognition?.detectorReport ?? null;
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
  const stage = modalStage(busy, recognition, source);
  const canChooseImage = model !== null && busy === null && !modelUpdating;
  // The solve has its own row, which names the stage rather than saying "busy".
  const downloading =
    busy === 'detecting' && modelProgress !== null && modelProgress.total > 0 && modelProgress.loaded < modelProgress.total;
  const status = downloading
    ? t('dialogs:cpDetectImport.busy.downloadingModel', 'Downloading the detector — {{loaded}} of {{total}}', {
        loaded: formatModelSize(modelProgress.loaded),
        total: formatModelSize(modelProgress.total),
      })
    : busy && busy !== 'solving'
      ? busyLabel(t, busy)
      : null;
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
            <CpDetectModelLine model={model} progress={modelProgress} updating={modelUpdating} onUpdate={() => void updateModel()} />
            {status && (
              <div className="cp-detect-modal__inline-status">
                <Loader2 size={14} className="cp-detect-modal__spinner" />
                {status}
              </div>
            )}
          </div>
        )}

        {stage === 'crop' && cropSource && (
          <>
            <div className="cp-detect-modal__actions">
              <Button size="sm" onClick={chooseImage} disabled={busy !== null}>
                <ImagePlus size={14} />
                {t('dialogs:cpDetectImport.chooseImage', 'Choose Image')}
              </Button>
              <Button size="sm" variant="primary" onClick={runDetection} disabled={!rectified || busy !== null}>
                <Play size={14} />
                {t('dialogs:cpDetectImport.detect', 'Detect')}
              </Button>
            </div>

            <CpDetectModelLine model={model} progress={modelProgress} updating={modelUpdating} onUpdate={() => void updateModel()} />

            {/* No "Rectifying crop" row here: it is over in a blink and a row
                that appears above the grid shoves the crop and the result down
                and back up again, which reads as something going wrong. The
                dropzone still says it for the first, slower load. */}
            <StatusRows status={busy === 'rectifying' ? null : status} error={error} />

            <div className="cp-detect-modal__crop-grid">
              <section className="cp-detect-modal__pane">
                <h3>{t('dialogs:cpDetectImport.crop', 'Crop')}</h3>
                {/* The crop re-rectifies itself when a corner is let go; the
                    only button here is the one that does the next thing. */}
                <CpDetectCropEditor
                  source={cropSource}
                  quad={quad}
                  onQuadChange={setQuad}
                  onDragEnd={(next) => void rerunManualRectification(next)}
                />
              </section>

              <section className="cp-detect-modal__pane">
                <h3>{t('dialogs:cpDetectImport.rectified', 'Rectified')}</h3>
                {rectified ? <CanvasImage key={identityOf(rectified.image)} image={rectified.image} /> : <div className="cp-detect-modal__empty" />}
              </section>
            </div>
          </>
        )}

        {stage === 'detecting' && (
          <div className="cp-detect-modal__detecting">
            <Loader2 size={28} className="cp-detect-modal__spinner" />
            <div>{status ?? t('dialogs:cpDetectImport.runningModel', 'Running model')}</div>
            {rectified && <CanvasImage key={identityOf(rectified.image)} image={rectified.image} />}
          </div>
        )}

        {stage === 'review' && (
          <>
            <div className="cp-detect-modal__actions">
              <Button size="sm" onClick={chooseImage} disabled={busy !== null}>
                <ImagePlus size={14} />
                {t('dialogs:cpDetectImport.chooseImage', 'Choose Image')}
              </Button>
              {/* Back to the crop step: re-rectifying clears the recognition,
                  and the crop editor is what the modal shows without one. */}
              <Button
                size="sm"
                onClick={() => void rerunManualRectification()}
                disabled={!source || !quad || busy !== null}
              >
                <Crop size={14} />
                {t('dialogs:cpDetectImport.editCrop', 'Edit Crop')}
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
                {rectified ? <CanvasImage key={identityOf(rectified.image)} image={rectified.image} /> : <div className="cp-detect-modal__empty" />}
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

/**
 * One canvas per image — key it by the image. Updating a mounted one with a
 * different image hands React's development build two pixel arrays to diff.
 */
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
    // The rectifier's copy, no larger than it can use; the object URL above
    // keeps the full resolution for the picture on screen and the loupe. See
    // `sourceSizeForRectification`.
    const { width, height } = sourceSizeForRectification(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error(t('errors:cpDetectImport.canvasUnavailable', 'Canvas 2D is unavailable'));
    context.drawImage(bitmap, 0, 0, width, height);
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
  const image = createCpImage({
    src: imageSrc.src,
    naturalWidth: imageSrc.width,
    naturalHeight: imageSrc.height,
    center,
    width: paperWidth * scale,
    height: paperHeight * scale,
    // Locked so it never takes a click meant for the creases over it, and at
    // half opacity so it reads as an underlay rather than as the drawing.
    //
    // Locked is absolute — no body, no handles, no context menu, and
    // `annotationAtModelPoint` skips it — so the region below has to carry the
    // controls for it, which is what `imageId` is for. Accepting the solve
    // unlocks it; deleting the region deletes it.
    opacity: 0.5,
    locked: true,
    z: bottomZ - 1,
  });
  return [
    image,
    createCpSuppressionRegion({
      center,
      width: paperWidth + 2 * margin,
      height: paperHeight + 2 * margin,
      suppress: DEFAULT_SUPPRESSED_CHECK_CLASSES,
      label,
      // Verbatim and unread here: its presence is what gives the region a Solve
      // affordance, and only detection produces one.
      solveInput,
      imageId: image.id,
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
