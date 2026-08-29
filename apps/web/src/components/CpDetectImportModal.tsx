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
import { ImagePlus, Loader2, Play, RefreshCw, Upload, Wrench, X } from 'lucide-react';
import { track } from '../analytics';
import type {
  CpDetectFoldResult,
  CpDetectModelManifest,
  CpDetectPoint,
  CpDetectQuad,
  CpDetectRectifiedImage,
} from '../engine/cpDetectTypes';
import { getFileService, type OpenBinaryFileResult } from '../platform/fileService';
import { getCpDetectClient, cpDetectError } from '../store/workspaceStore/cpDetectRuntime';
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

type BusyState = 'loading_model' | 'opening' | 'rectifying' | 'detecting' | 'importing' | null;
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

/** What "Add" does with the detected pattern. */
type ImportMode = 'solveAndAdd' | 'reviewAndFix' | 'addAsIs';

/**
 * How the detected candidate came out, which is what the primary button offers.
 *
 * - `exact` — the pipeline's own `solve_exact` was accepted, so the FOLD it
 *   produced is already at solved coordinates. Nothing to repair.
 * - `repairable` — the solve was not accepted. Repair is offered **whatever the
 *   site count is**. An earlier draft refused past a threshold on the grounds
 *   that a large repair "is not practical", which was wrong twice over: the
 *   alternative to this feature is tracing the whole pattern by hand, so 13
 *   sites is a large saving rather than a burden; and the fallback it pushed
 *   people to — adding the candidate unsolved — hands them ~4° of Kawasaki
 *   error at every vertex, i.e. exactly the defect the feature exists to
 *   remove. The measurement agrees: hard-bucket repairs came out 131/140
 *   identical to ground truth, and what capped their recovery was the 25 s
 *   solve budget, not the size of the repair.
 * - `blocked` — the solver could not analyse the graph at all, so there is no
 *   candidate to attach and nothing to repair against. The only honest option.
 */
type CandidateOutcome = 'exact' | 'repairable' | 'blocked';

interface CandidateTopology {
  outcome: CandidateOutcome;
  /**
   * Distinct places a human would have to touch: interior vertices flagged by
   * odd degree, Maekawa parity or a boundary failure (counted once each), plus
   * degenerate edges and unmodelled crossings.
   *
   * `degree_two_vertices` is deliberately excluded — a degree-2 vertex is not an
   * error on its own, and the repair for one is to dissolve it, never to delete.
   */
  repairSites: number;
  /** The solver refused to analyse the graph at all (malformed input). */
  blocked: boolean;
  /** `rejection_reasons` verbatim; empty when the solve was accepted. */
  rejectionReasons: string[];
  /** From `movement_report.timed_out` — never by parsing a reason string. */
  timedOut: boolean;
  /** The pre-solve `ExactSolveInput`, carried to the region verbatim. */
  solveInput: unknown;
}
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
  const [detection, setDetection] = useState<CpDetectFoldResult | null>(null);
  const [modelManifest, setModelManifest] = useState<CpDetectModelManifest | null>(null);
  const [busy, setBusy] = useState<BusyState>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<QuadHandle | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [previewOverlays, setPreviewOverlays] = useState<PreviewOverlayState>(DEFAULT_PREVIEW_OVERLAYS);
  const sourceImageRef = useRef<HTMLImageElement>(null);

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
      .then((client) => client.verifyModelAssets())
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
    setDetection(null);
    setError(null);
    setDragging(null);
    setDropActive(false);
    setPreviewOverlays(DEFAULT_PREVIEW_OVERLAYS);
  }, []);

  const close = useCallback(() => {
    if (busy) return;
    setOpen(false);
    resetSession();
  }, [busy, resetSession]);

  const loadImageFile = useCallback(async (file: OpenBinaryFileResult) => {
    const nextSource = await sourceImageFromFile(file, t);
    setSource((previous) => {
      if (previous?.url) URL.revokeObjectURL(previous.url);
      return nextSource;
    });
    setQuad(null);
    setRectified(null);
    setDetection(null);
    setPreviewOverlays(DEFAULT_PREVIEW_OVERLAYS);

    const client = await getCpDetectClient();
    setBusy('rectifying');
    const auto = await client.autoRectifyImage(nextSource.image, DETECT_IMAGE_SIZE);
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
    setDetection(null);
    setPreviewOverlays(DEFAULT_PREVIEW_OVERLAYS);
    try {
      const client = await getCpDetectClient();
      setRectified(await client.manualRectifyImage(source.image, quad, DETECT_IMAGE_SIZE));
    } catch (caught) {
      setError(cpDetectError(caught).message);
    } finally {
      setBusy(null);
    }
  }, [quad, source]);

  const runDetection = useCallback(async () => {
    if (!rectified) return;
    setBusy('detecting');
    setError(null);
    // Image→CP funnel start. No image data or filename is ever sent.
    track('cp detect started');
    try {
      const client = await getCpDetectClient();
      const nextDetection = await client.detectRectifiedFold(rectified.image, {
        decoderBackend: DETECT_DECODER_BACKEND,
        junctionSource: 'dense-model',
      });
      setDetection(nextDetection);
      publishDetectionResult(source, nextDetection);
      track('cp detect completed', { succeeded: true });
    } catch (caught) {
      setError(cpDetectError(caught).message);
      track('cp detect completed', { succeeded: false });
    } finally {
      setBusy(null);
    }
  }, [rectified, source]);

  const topology = useMemo(() => candidateTopology(detection), [detection]);

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
      if (!detection || !source) return;
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
          text: detection.foldJson,
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
            topology?.solveInput ?? null,
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
          outcome: topology?.outcome ?? 'unknown',
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
    [detection, rectified, resetSession, source, t, topology]
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

  const rectificationWarnings = rectified?.report.warnings ?? [];
  const detectorWarnings = detection?.detectorReport.warnings ?? [];
  const compilerMetadata = useMemo(() => compilerReportMetadata(t, detection), [detection, t]);
  const compilerOverlay = useMemo(() => compilerPreviewOverlay(detection), [detection]);
  const primaryMode = primaryImportMode(topology);
  const foldPreview = useMemo(
    () => (detection ? parseFoldPreview(detection.foldJson) : null),
    [detection]
  );
  const stage: ModalStage =
    busy === 'detecting' ? 'detecting' : detection ? 'review' : source ? 'crop' : 'upload';
  const canChooseImage = modelManifest !== null && busy === null;
  const status = busy ? busyLabel(t, busy) : null;
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
          <IconButton title={t('common:close', 'Close')} size="sm" onClick={close} disabled={busy !== null}>
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
              <Button
                size="sm"
                variant="primary"
                onClick={() => void addDetection(primaryMode)}
                disabled={!detection || busy !== null}
              >
                {primaryMode === 'reviewAndFix' ? <Wrench size={14} /> : <Upload size={14} />}
                {importModeLabel(t, primaryMode)}
              </Button>
              {/* Always available, whatever the topology check says. */}
              {primaryMode !== 'addAsIs' && (
                <Button
                  size="sm"
                  onClick={() => void addDetection('addAsIs')}
                  disabled={!detection || busy !== null}
                >
                  {importModeLabel(t, 'addAsIs')}
                </Button>
              )}
            </div>

            <div className="cp-detect-modal__verdict" data-outcome={topology?.outcome ?? 'unknown'}>
              {verdictMessage(t, topology)}
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
          (modelManifest || rectificationWarnings.length > 0 || detectorWarnings.length > 0 || detection) && (
            <div className="cp-detect-modal__report">
              {modelManifest && <span>{modelManifest.id}</span>}
              {detection && (
                <span>
                  {t('dialogs:cpDetectImport.report.counts', '{{vertices}} vertices, {{edges}} edges', {
                    vertices: detection.detectorReport.vertex_count,
                    edges: detection.detectorReport.edge_count,
                  })}
                </span>
              )}
              {detection && (
                <span>
                  {detection.detectorReport.quality_report?.candidate_strategy ??
                    detection.detectorReport.decoder_backend}
                </span>
              )}
              {compilerMetadata.map((item) => (
                <span key={item}>{item}</span>
              ))}
              {/* Why the pipeline's own solve did not land. A timeout is told
                  apart on `movement_report.timed_out`, never by matching the
                  reason string — that one embeds a formatted number. The
                  rejection token itself is shown verbatim, like the
                  classifications beside it. */}
              {topology?.timedOut && (
                <span>{t('dialogs:cpDetectImport.report.solveTimedOut', 'solve timed out')}</span>
              )}
              {topology && !topology.timedOut && topology.rejectionReasons[0] && (
                <span>{topology.rejectionReasons[0]}</span>
              )}
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

function busyLabel(t: TFunction, busy: Exclude<BusyState, null>): string {
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

function publishDetectionResult(source: SourceImage | null, detection: CpDetectFoldResult): void {
  window.dispatchEvent(
    new CustomEvent('ori-studio:cp-detect-result', {
      detail: {
        sourceName: source?.name ?? null,
        sourcePath: source?.path ?? null,
        detection,
      },
    })
  );
}

function parseFoldPreview(foldJson: string): FoldPreviewData | null {
  try {
    const fold = JSON.parse(foldJson) as {
      vertices_coords?: [number, number][];
      edges_vertices?: [number, number][];
      edges_assignment?: string[];
      cp_detector?: {
        edge_ids?: unknown[];
        edge_source?: unknown[];
        edge_provenance?: unknown[];
        assignment_confidence?: unknown[];
      };
    };
    if (!Array.isArray(fold.vertices_coords) || !Array.isArray(fold.edges_vertices)) return null;
    return {
      vertices: fold.vertices_coords,
      edges: fold.edges_vertices,
      assignments: fold.edges_assignment ?? [],
      edgeIds: numericArray(fold.cp_detector?.edge_ids),
      edgeSources: stringArray(fold.cp_detector?.edge_source),
      edgeProvenance: stringMatrix(fold.cp_detector?.edge_provenance),
      assignmentConfidence: numericArray(fold.cp_detector?.assignment_confidence),
    };
  } catch {
    return null;
  }
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

function compilerPreviewOverlay(detection: CpDetectFoldResult | null): CompilerPreviewOverlay {
  const assignmentEdgeIds = new Set<number>();
  const report = detection?.detectorReport.quality_report;
  if (!report || typeof report !== 'object') return { assignmentEdgeIds };
  const compilerReport = (report as { compiler_report?: unknown }).compiler_report;
  if (!compilerReport || typeof compilerReport !== 'object') return { assignmentEdgeIds };
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

function compilerReportMetadata(t: TFunction, detection: CpDetectFoldResult | null): string[] {
  const report = detection?.detectorReport.quality_report;
  if (!report || typeof report !== 'object') return [];
  const compilerReport = (report as { compiler_report?: unknown }).compiler_report;
  if (!compilerReport || typeof compilerReport !== 'object') return [];
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
 * The candidate's pre-solve topology, read out of the decode report.
 *
 * The source is `compiler_report.exact_solve.theorem_residual_report.before`,
 * which is `analyze_graph` run on the **candidate** coordinates — the same pass
 * `oristudio_cp_compiler::analyze_candidate_topology` wraps, so this is the
 * compiler's own finding rather than a second implementation of it. It is
 * already in every decode report, which is why no new wasm export is needed to
 * decide what the primary button offers.
 *
 * Null when the report is not the exact-solve backend's (an older or fallback
 * decode), in which case the modal offers "Add as-is" only.
 */
function candidateTopology(detection: CpDetectFoldResult | null): CandidateTopology | null {
  const compilerReport = detectionCompilerReport(detection);
  if (!compilerReport) return null;
  const exactSolve = asRecord(compilerReport.exact_solve);
  if (!exactSolve) return null;
  const theorem = asRecord(exactSolve.theorem_residual_report);
  const movement = asRecord(exactSolve.movement_report);
  const solveInput = compilerReport.exact_solve_input ?? null;
  const rejectionReasons = stringArray(asArray(theorem?.rejection_reasons));
  const timedOut = movement?.timed_out === true;
  const before = asRecord(theorem?.before);

  // A malformed input returns `{status, blockers}` with no `before` and no
  // `rejection_reasons` at all, so an empty reason list is not evidence of
  // success — `accepted` is.
  if (!before) {
    return {
      outcome: 'blocked',
      repairSites: 0,
      blocked: true,
      rejectionReasons,
      timedOut,
      solveInput,
    };
  }

  if (theorem?.accepted === true) {
    return {
      outcome: 'exact',
      repairSites: 0,
      blocked: false,
      rejectionReasons: [],
      timedOut: false,
      solveInput,
    };
  }

  const flagged = new Set<number>([
    ...numericArray(asArray(before.odd_degree_vertices)),
    ...numericArray(asArray(before.maekawa_failures)),
    ...numericArray(asArray(before.boundary_failures)),
  ]);
  const repairSites =
    flagged.size +
    (asArray(before.degenerate_edges)?.length ?? 0) +
    (asArray(before.unmodeled_crossings)?.length ?? 0);

  return {
    // No threshold: any number of sites is repairable. See `CandidateOutcome`.
    outcome: 'repairable',
    repairSites,
    blocked: false,
    rejectionReasons,
    timedOut,
    solveInput,
  };
}

/** The mode the primary button runs. `null` topology means "Add as-is" only. */
function primaryImportMode(topology: CandidateTopology | null): ImportMode {
  if (!topology) return 'addAsIs';
  switch (topology.outcome) {
    case 'exact':
      return 'solveAndAdd';
    case 'repairable':
      return 'reviewAndFix';
    case 'blocked':
      return 'addAsIs';
  }
}

function importModeLabel(t: TFunction, mode: ImportMode): string {
  switch (mode) {
    case 'solveAndAdd':
      return t('dialogs:cpDetectImport.solveAndAdd', 'Solve & Add');
    case 'reviewAndFix':
      return t('dialogs:cpDetectImport.reviewAndFix', 'Review & Fix');
    case 'addAsIs':
      return t('dialogs:cpDetectImport.addAsIs', 'Add as-is');
  }
}

/**
 * What the result screen says about the candidate, in one sentence.
 *
 * Every branch names what the user gets rather than what the compiler found.
 * The site count is **information, not a verdict**: it tells you how much work
 * you are taking on, and never withholds the option.
 */
function verdictMessage(t: TFunction, topology: CandidateTopology | null): string {
  if (!topology) {
    return t(
      'dialogs:cpDetectImport.verdict.unknown',
      'This detector run reports no topology check, so the pattern can only be added as-is.'
    );
  }
  if (topology.outcome === 'exact') {
    return t(
      'dialogs:cpDetectImport.verdict.exact',
      'Exactly solved. Adding it beside your work leaves the rest of the document untouched.'
    );
  }
  if (topology.blocked) {
    return t(
      'dialogs:cpDetectImport.verdict.blocked',
      'The solver could not read this candidate graph, so there is nothing to repair by hand. You can still add it as-is.'
    );
  }
  if (topology.repairSites === 0) {
    // Combinatorially clean and still rejected: the graph is a valid crease
    // pattern that is not *this* crease pattern. There is no marker worklist to
    // work, so the source image behind the creases is the only tool — which is
    // exactly what Review & Fix puts there.
    return t(
      'dialogs:cpDetectImport.verdict.unflagged',
      'Not solved, but nothing is flagged for repair — the solver rejected it for another reason. Review & Fix adds the candidate with the source image behind it so you can compare.'
    );
  }
  return t('dialogs:cpDetectImport.verdict.repairable', {
    count: topology.repairSites,
    defaultValue_one:
      'Not solved — 1 place to repair. Review & Fix adds the candidate with the source image behind it, so you can fix it and solve.',
    defaultValue_other:
      'Not solved — {{count}} places to repair. Review & Fix adds the candidate with the source image behind it, so you can fix them and solve. Adding it as-is instead leaves every angle approximate.',
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

function detectionCompilerReport(
  detection: CpDetectFoldResult | null
): Record<string, unknown> | null {
  const report = detection?.detectorReport.quality_report;
  if (!report || typeof report !== 'object') return null;
  return asRecord((report as { compiler_report?: unknown }).compiler_report);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function compilerOutputWasEmitted(compilerReport: unknown): boolean {
  return (
    compilerReport !== null &&
    typeof compilerReport === 'object' &&
    (compilerReport as { output?: { selected?: unknown } }).output?.selected === 'compiled'
  );
}
