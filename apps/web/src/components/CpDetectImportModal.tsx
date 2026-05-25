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
import { ImagePlus, Loader2, Play, RefreshCw, Upload, X } from 'lucide-react';
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
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import './CpDetectImportModal.css';

type BusyState = 'loading_model' | 'opening' | 'rectifying' | 'detecting' | 'importing' | null;
type QuadHandle = keyof CpDetectQuad;
type ModalStage = 'upload' | 'crop' | 'detecting' | 'review';

interface SourceImage {
  image: ImageData;
  name: string;
  path: string | null;
  url: string;
}

const DETECT_IMAGE_SIZE = 1024;
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];
const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const QUAD_HANDLES: QuadHandle[] = ['top_left', 'top_right', 'bottom_right', 'bottom_left'];

export function CpDetectImportModal() {
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

  const close = useCallback(() => {
    if (busy) return;
    setOpen(false);
    setError(null);
    setDropActive(false);
  }, [busy]);

  const loadImageFile = useCallback(async (file: OpenBinaryFileResult) => {
    const nextSource = await sourceImageFromFile(file);
    setSource((previous) => {
      if (previous?.url) URL.revokeObjectURL(previous.url);
      return nextSource;
    });
    setQuad(null);
    setRectified(null);
    setDetection(null);

    const client = await getCpDetectClient();
    setBusy('rectifying');
    const auto = await client.autoRectifyImage(nextSource.image, DETECT_IMAGE_SIZE);
    setRectified(auto);
    setQuad(auto.report.detected_source_quad ?? auto.report.source_quad);
  }, []);

  const chooseImage = useCallback(async () => {
    setBusy('opening');
    setError(null);
    try {
      const file = await getFileService().openBinaryFile({
        title: 'Open Crease Pattern Image',
        extensions: IMAGE_EXTENSIONS,
        mimeTypes: IMAGE_MIME_TYPES,
      });
      if (file) await loadImageFile(file);
    } catch (caught) {
      setError(cpDetectError(caught).message);
    } finally {
      setBusy(null);
    }
  }, [loadImageFile]);

  const chooseDroppedImage = useCallback(
    async (file: File) => {
      setBusy('opening');
      setError(null);
      try {
        if (!isSupportedImageFile(file)) {
          throw new Error('Use a PNG, JPEG, or WebP image.');
        }
        await loadImageFile(await openBinaryFileFromBrowserFile(file));
      } catch (caught) {
        setError(cpDetectError(caught).message);
      } finally {
        setBusy(null);
      }
    },
    [loadImageFile]
  );

  const rerunManualRectification = useCallback(async () => {
    if (!source || !quad) return;
    setBusy('rectifying');
    setError(null);
    setDetection(null);
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
    try {
      const client = await getCpDetectClient();
      const nextDetection = await client.detectRectifiedFold(rectified.image);
      setDetection(nextDetection);
      publishDetectionResult(source, nextDetection);
    } catch (caught) {
      setError(cpDetectError(caught).message);
    } finally {
      setBusy(null);
    }
  }, [rectified, source]);

  const importDetection = useCallback(async () => {
    if (!detection || !source) return;
    setBusy('importing');
    setError(null);
    try {
      const filename = detectedFoldFilename(source.name);
      const workspace = useWorkspaceStore.getState();
      await workspace.loadCreasePatternText(detection.foldJson, { filename, path: null });
      for (const operation of [
        'Fix1',
        'Fix2',
        'Check1',
        'Check2',
        'Check3',
        'Check4',
        'FlatFoldableCheck',
      ] as const) {
        await useWorkspaceStore.getState().executeOristudioCpCommand(operation).catch(() => false);
      }
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }, [detection, source]);

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
  const foldPreview = useMemo(
    () => (detection ? parseFoldPreview(detection.foldJson) : null),
    [detection]
  );
  const stage: ModalStage =
    busy === 'detecting' ? 'detecting' : detection ? 'review' : source ? 'crop' : 'upload';
  const canChooseImage = modelManifest !== null && busy === null;
  const status = busy ? busyLabel(busy) : null;

  if (!open) return null;

  return (
    <div className="cp-detect-modal" role="dialog" aria-modal="true" aria-label="Detect CP from image">
      <div className={`cp-detect-modal__surface cp-detect-modal__surface--${stage}`}>
        <header className="cp-detect-modal__header">
          <div>
            <h2>Detect CP from Image</h2>
            {source && <p>{source.name}</p>}
          </div>
          <IconButton title="Close" size="sm" onClick={close} disabled={busy !== null}>
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
              Choose Image
            </Button>
            <div className="cp-detect-modal__drop-hint">Drop image here</div>
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
                Choose Image
              </Button>
              <Button size="sm" onClick={rerunManualRectification} disabled={!quad || busy !== null}>
                <RefreshCw size={14} />
                Update Crop
              </Button>
              <Button size="sm" variant="primary" onClick={runDetection} disabled={!rectified || busy !== null}>
                <Play size={14} />
                Detect
              </Button>
            </div>

            <StatusRows status={status} error={error} />

            <div className="cp-detect-modal__crop-grid">
              <section className="cp-detect-modal__pane">
                <h3>Crop</h3>
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
                <h3>Rectified</h3>
                {rectified ? <CanvasImage image={rectified.image} /> : <div className="cp-detect-modal__empty" />}
              </section>
            </div>
          </>
        )}

        {stage === 'detecting' && (
          <div className="cp-detect-modal__detecting">
            <Loader2 size={28} className="cp-detect-modal__spinner" />
            <div>{status ?? 'Running model'}</div>
            {rectified && <CanvasImage image={rectified.image} />}
          </div>
        )}

        {stage === 'review' && (
          <>
            <div className="cp-detect-modal__actions">
              <Button size="sm" onClick={chooseImage} disabled={busy !== null}>
                <ImagePlus size={14} />
                Choose Image
              </Button>
              <Button size="sm" onClick={rerunManualRectification} disabled={!source || !quad || busy !== null}>
                <RefreshCw size={14} />
                Update Crop
              </Button>
              <Button size="sm" variant="primary" onClick={runDetection} disabled={!rectified || busy !== null}>
                <Play size={14} />
                Detect
              </Button>
              <Button size="sm" variant="primary" onClick={importDetection} disabled={!detection || busy !== null}>
                <Upload size={14} />
                Import
              </Button>
            </div>

            <StatusRows status={status} error={error} />

            <div className="cp-detect-modal__review-grid">
              <section className="cp-detect-modal__pane">
                <h3>Rectified</h3>
                {rectified ? <CanvasImage image={rectified.image} /> : <div className="cp-detect-modal__empty" />}
              </section>

              <section className="cp-detect-modal__pane">
                <h3>Detected</h3>
                {foldPreview ? <FoldPreview preview={foldPreview} /> : <div className="cp-detect-modal__empty" />}
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
                  {detection.detectorReport.vertex_count} vertices, {detection.detectorReport.edge_count} edges
                </span>
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
}

function FoldPreview({ preview }: { preview: FoldPreviewData }) {
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
    </svg>
  );
}

async function sourceImageFromFile(file: OpenBinaryFileResult): Promise<SourceImage> {
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
    if (!context) throw new Error('Canvas 2D is unavailable');
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

function busyLabel(busy: Exclude<BusyState, null>): string {
  return {
    loading_model: 'Checking detector model',
    opening: 'Opening image',
    rectifying: 'Rectifying crop',
    detecting: 'Running model',
    importing: 'Importing crease pattern',
  }[busy];
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
    };
    if (!Array.isArray(fold.vertices_coords) || !Array.isArray(fold.edges_vertices)) return null;
    return {
      vertices: fold.vertices_coords,
      edges: fold.edges_vertices,
      assignments: fold.edges_assignment ?? [],
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
