import { useCallback, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { SerializedEditorState } from 'lexical';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { Point } from '../../lib/geometry';
import type { CanvasObjectBoxUpdate } from '../CanvasObjectOverlay';
import { annotationAsTransformable } from '../canvasObjects/transformableObject';
import type { TransformableCanvasObject } from '../canvasObjects/transformableObject';
import type { CpOverlayView } from '../CreasePatternWebglCanvas';
import { createCpImage } from '../images/cpImage';
import { importImageFile, isSupportedImageFile } from '../images/cpImageImport';
import { cropImage, fitImageModelSize } from '../images/cpImagePlacement';
import { dragCarriesFiles } from '../../lib/fileDrop';
import { overlayCssPerModel, overlayCssToModel } from './annotationTransform';
import type { AnnotationResizeHandle } from './annotationTransform';
import {
  annotationAtModelPoint,
  isImageAnnotation,
  isTextAnnotation,
  topAnnotationZ,
} from './annotation';
import type { CanvasAnnotation, ImageAnnotation } from './annotation';
import {
  createTextAnnotation,
  textBoxFromDrag,
  DEFAULT_TEXT_BOX_WIDTH,
  DEFAULT_TEXT_FONT_SIZE,
} from './textAnnotation';


/** Reason inline text editing ended: a click outside, or the keyboard. */
export type TextEditExitReason = 'blur' | 'escape';

export interface UseCpAnnotationsOptions {
  /** Live model↔CSS transform, for placing dropped images and new text boxes. */
  overlayView: CpOverlayView | null;
  /** The element the canvas is laid out in, for drop-point conversion. */
  viewportRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Every annotation (reference image and text box) behaviour the CP viewport
 * offers: the transformable projection the canvas-object overlay consumes, the
 * undo-gesture protocol, image import and stacking, and the inline text-edit
 * lifecycle.
 *
 * It lives here rather than in the panel because all of it shares one
 * invariant — `preGestureAnnotationsRef` holds the pre-gesture snapshot, and
 * every mutation must be bracketed by begin/commit so a whole drag or edit
 * lands as a single undo entry. That invariant is only checkable if the code
 * that depends on it is in one place.
 */
export function useCpAnnotations({ overlayView, viewportRef }: UseCpAnnotationsOptions) {
  const { t } = useTranslation();
  const annotations = useWorkspaceStore((state) => state.oristudioCpAnnotations);
  const selectedAnnotationId = useWorkspaceStore(
    (state) => state.oristudioCpSelectedAnnotationId
  );
  const addAnnotation = useWorkspaceStore((state) => state.addAnnotation);
  const updateAnnotation = useWorkspaceStore((state) => state.updateAnnotation);
  const removeAnnotation = useWorkspaceStore((state) => state.removeAnnotation);
  const setSelectedAnnotation = useWorkspaceStore(
    (state) => state.setSelectedAnnotation
  );
  const syncAnnotationHeight = useWorkspaceStore((state) => state.syncAnnotationHeight);
  const recordAnnotationHistory = useWorkspaceStore(
    (state) => state.recordAnnotationHistory
  );

  /**
   * Annotation list captured at the start of a move/resize/rotate/crop/edit, so
   * the whole gesture records a single undo entry when it commits.
   */
  const preGestureAnnotationsRef = useRef<readonly CanvasAnnotation[] | null>(null);
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);

  const beginGesture = useCallback(() => {
    preGestureAnnotationsRef.current = useWorkspaceStore.getState().oristudioCpAnnotations;
  }, []);
  const commitGesture = useCallback(
    (label: string) => {
      const previous = preGestureAnnotationsRef.current;
      preGestureAnnotationsRef.current = null;
      if (previous) recordAnnotationHistory([...previous], label);
    },
    [recordAnnotationHistory]
  );

  const selectedAnnotation = useMemo(
    () => annotations.find((a) => a.id === selectedAnnotationId) ?? null,
    [annotations, selectedAnnotationId]
  );
  const selectedImage: ImageAnnotation | null =
    selectedAnnotation && isImageAnnotation(selectedAnnotation) ? selectedAnnotation : null;
  // Image annotations only — the WebGL renderer and the image overlay narrow to
  // this; text annotations render on their own DOM layer.
  const imageAnnotations = useMemo(
    () => annotations.filter(isImageAnnotation),
    [annotations]
  );
  const transformableObjects = useMemo<TransformableCanvasObject[]>(
    () => annotations.map(annotationAsTransformable),
    [annotations]
  );

  const annotationById = useCallback(
    (id: string) => useWorkspaceStore.getState().oristudioCpAnnotations.find((a) => a.id === id),
    []
  );
  const applyBoxUpdate = useCallback(
    (id: string, patch: CanvasObjectBoxUpdate) => updateAnnotation(id, patch),
    [updateAnnotation]
  );
  // Crop needs the image's source rect, which the overlay has no view of; it
  // hands back the dragged handle and pointer and we apply the image math here.
  const applyCrop = useCallback(
    (id: string, handle: AnnotationResizeHandle, pointer: { x: number; y: number }) => {
      const annotation = annotationById(id);
      if (!annotation || !isImageAnnotation(annotation)) return;
      const next = cropImage(annotation, handle, pointer);
      updateAnnotation(id, {
        center: next.center,
        width: next.width,
        height: next.height,
        crop: next.crop,
      });
    },
    [annotationById, updateAnnotation]
  );
  const canCrop = useCallback(
    (id: string) => {
      const annotation = annotationById(id);
      return !!annotation && isImageAnnotation(annotation);
    },
    [annotationById]
  );
  const gestureLabel = useCallback(
    (kind: 'move' | 'resize' | 'rotate' | 'crop') => {
      switch (kind) {
        case 'move':
          return t('panels:creasePattern.moveAnnotation', 'Move annotation');
        case 'rotate':
          return t('panels:creasePattern.rotateAnnotation', 'Rotate annotation');
        case 'crop':
          return t('panels:creasePattern.cropImage', 'Crop image');
        case 'resize':
          return t('panels:creasePattern.resizeAnnotation', 'Resize annotation');
      }
    },
    [t]
  );

  // Import an image file and add it as a reference image, placed at the given
  // client point (or the view center) and sized to ~half the view. Shared by the
  // drop handler and the Insert-image button.
  const addImageFromFile = useCallback(
    async (file: File, client: { x: number; y: number } | null) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      try {
        const source = await importImageFile(file);
        let center = { x: 0.5, y: 0.5 };
        let targetExtent = 1;
        if (overlayView && rect) {
          const cssPoint = client
            ? { x: client.x - rect.left, y: client.y - rect.top }
            : { x: rect.width / 2, y: rect.height / 2 };
          const model = overlayCssToModel(overlayView, cssPoint);
          if (model) center = model;
          const cssPerModel = overlayCssPerModel(overlayView);
          if (cssPerModel > 0) {
            targetExtent = (0.5 * Math.min(rect.width, rect.height)) / cssPerModel;
          }
        }
        const { width, height } = fitImageModelSize(
          source.naturalWidth,
          source.naturalHeight,
          targetExtent
        );
        const images = useWorkspaceStore.getState().oristudioCpAnnotations;
        const topZ = images.reduce((max, image) => Math.max(max, image.z), 0);
        addAnnotation(
          createCpImage({
            src: source.src,
            naturalWidth: source.naturalWidth,
            naturalHeight: source.naturalHeight,
            center,
            width,
            height,
            z: topZ + 1,
          })
        );
        recordAnnotationHistory([...images], t('panels:creasePattern.addImage', 'Add image'));
      } catch (error) {
        console.error('[cp-image] failed to import image', error);
      }
    },
    [addAnnotation, recordAnnotationHistory, overlayView, viewportRef, t]
  );

  const handleViewportDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    // Shares the file-drag test with the workspace drop target rather than
    // re-checking `types` for the exact string 'Files': that check fails
    // silently (no preventDefault → no drop event at all), so the two must not
    // disagree about what counts as a file drag.
    const transfer = event.dataTransfer;
    if (dragCarriesFiles({ types: Array.from(transfer.types), items: transfer.items })) {
      event.preventDefault();
      transfer.dropEffect = 'copy';
    }
  }, []);

  const handleViewportDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      const file = Array.from(event.dataTransfer.files).find(isSupportedImageFile);
      // Anything that is not an image bubbles up to the workspace drop target,
      // which opens or imports it.
      if (!file) return;
      event.preventDefault();
      // Consumed here, so it must not also reach the workspace target.
      event.stopPropagation();
      void addImageFromFile(file, { x: event.clientX, y: event.clientY });
    },
    [addImageFromFile]
  );

  // Image-layer edits driven by the inspector: each records one undo entry.
  const bringSelectedImageToFront = useCallback(() => {
    if (!selectedAnnotationId) return;
    const images = useWorkspaceStore.getState().oristudioCpAnnotations;
    const maxZ = images.reduce((max, image) => Math.max(max, image.z), 0);
    beginGesture();
    updateAnnotation(selectedAnnotationId, { z: maxZ + 1 });
    commitGesture(t('panels:creasePattern.bringImageToFront', 'Bring image to front'));
  }, [selectedAnnotationId, updateAnnotation, beginGesture, commitGesture, t]);

  const sendSelectedImageToBack = useCallback(() => {
    if (!selectedAnnotationId) return;
    const images = useWorkspaceStore.getState().oristudioCpAnnotations;
    const minZ = images.reduce((min, image) => Math.min(min, image.z), 0);
    beginGesture();
    updateAnnotation(selectedAnnotationId, { z: minZ - 1 });
    commitGesture(t('panels:creasePattern.sendImageToBack', 'Send image to back'));
  }, [selectedAnnotationId, updateAnnotation, beginGesture, commitGesture, t]);

  const deleteSelectedImage = useCallback(() => {
    if (!selectedAnnotationId) return;
    beginGesture();
    removeAnnotation(selectedAnnotationId);
    commitGesture(t('panels:creasePattern.deleteImage', 'Delete image'));
  }, [selectedAnnotationId, removeAnnotation, beginGesture, commitGesture, t]);

  // --- Inline text editing ---

  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  /** The box under edit and whether this edit created it, for the undo label. */
  const editStartRef = useRef<{ id: string; created: boolean } | null>(null);
  /**
   * A click outside an editor both commits it and, if the Text tool is active,
   * would land on the canvas as a "create a box here". Set on a blur exit so
   * that same click only deselects.
   */
  const suppressNextTextCreateRef = useRef(false);

  // Double-click a text box (via the annotation overlay), or a Text-tool click
  // on one → inline editing.
  const requestEditText = useCallback(
    (id: string) => {
      preGestureAnnotationsRef.current = useWorkspaceStore.getState().oristudioCpAnnotations;
      editStartRef.current = { id, created: false };
      setSelectedAnnotation(id);
      setEditingTextId(id);
    },
    [setSelectedAnnotation]
  );

  /**
   * A Text-tool click: edit or select whatever it lands on, or drop a new box on
   * empty canvas and start editing. Whether the Text tool is active is the
   * caller's gate — the canvas only routes clicks here in text mode.
   */
  const createTextAt = useCallback(
    (modelPoint: Point) => {
      if (!overlayView) return;
      const prev = useWorkspaceStore.getState().oristudioCpAnnotations;
      // A click over an existing annotation edits (text) or selects (image) it,
      // rather than stacking a new box on top.
      const hit = annotationAtModelPoint(prev, modelPoint);
      if (hit) {
        suppressNextTextCreateRef.current = false;
        if (isTextAnnotation(hit)) requestEditText(hit.id);
        else setSelectedAnnotation(hit.id);
        return;
      }
      // Empty canvas: if this click just committed an edit, it only deselects.
      if (suppressNextTextCreateRef.current) {
        suppressNextTextCreateRef.current = false;
        setSelectedAnnotation(null);
        return;
      }
      const cssPerModel = overlayCssPerModel(overlayView);
      const box = createTextAnnotation({
        center: { x: modelPoint.x, y: modelPoint.y },
        width: cssPerModel > 0 ? 220 / cssPerModel : DEFAULT_TEXT_BOX_WIDTH,
        fontSize: cssPerModel > 0 ? 16 / cssPerModel : DEFAULT_TEXT_FONT_SIZE,
        z: topAnnotationZ(prev) + 1,
      });
      preGestureAnnotationsRef.current = prev; // snapshot before add, for undo
      editStartRef.current = { id: box.id, created: true };
      addAnnotation(box);
      setEditingTextId(box.id);
    },
    [overlayView, addAnnotation, requestEditText, setSelectedAnnotation]
  );

  // Text tool: a press-drag creates a fixed-size box (the dragged height seeds a
  // minimum; content still grows it downward). Too small a drag falls back to the
  // click-created auto-sizing box.
  const createTextBoxFromDrag = useCallback(
    (start: Point, end: Point) => {
      if (!overlayView) return;
      const cssPerModel = overlayCssPerModel(overlayView);
      const minExtent = cssPerModel > 0 ? 12 / cssPerModel : DEFAULT_TEXT_FONT_SIZE;
      const box = textBoxFromDrag(start, end, minExtent);
      if (!box) {
        createTextAt(start);
        return;
      }
      const prev = useWorkspaceStore.getState().oristudioCpAnnotations;
      const annotation = createTextAnnotation({
        center: box.center,
        width: box.width,
        height: box.height,
        minHeight: box.height,
        fontSize: cssPerModel > 0 ? 16 / cssPerModel : DEFAULT_TEXT_FONT_SIZE,
        z: topAnnotationZ(prev) + 1,
      });
      preGestureAnnotationsRef.current = prev;
      editStartRef.current = { id: annotation.id, created: true };
      addAnnotation(annotation);
      setEditingTextId(annotation.id);
    },
    [overlayView, addAnnotation, createTextAt]
  );

  const changeTextContent = useCallback(
    (id: string, doc: SerializedEditorState, plainText: string) => {
      updateAnnotation(id, { doc, plainText });
    },
    [updateAnnotation]
  );

  // Leave inline editing. An empty box is discarded (parity with Oriedita's
  // blank-text GC); otherwise the whole edit records one undo entry.
  const exitEditText = useCallback(
    (reason: TextEditExitReason = 'blur') => {
      if (reason === 'blur') suppressNextTextCreateRef.current = true;
      const editing = editStartRef.current;
      setEditingTextId(null);
      editStartRef.current = null;
      if (!editing) {
        preGestureAnnotationsRef.current = null;
        return;
      }
      const annotation = useWorkspaceStore
        .getState()
        .oristudioCpAnnotations.find((a) => a.id === editing.id);
      const empty =
        !annotation || (annotation.kind === 'text' && annotation.plainText.trim() === '');
      if (empty) {
        removeAnnotation(editing.id);
        if (editing.created) preGestureAnnotationsRef.current = null;
        else commitGesture(t('panels:textAnnotation.deleteText', 'Delete text'));
        return;
      }
      commitGesture(
        editing.created
          ? t('panels:textAnnotation.addText', 'Add text')
          : t('panels:textAnnotation.editText', 'Edit text')
      );
    },
    [removeAnnotation, commitGesture, t]
  );

  // Delete from the text toolbar removes the box and leaves edit mode; the
  // pre-edit snapshot makes it undoable (unless the box was never real).
  const deleteEditingText = useCallback(() => {
    const editing = editStartRef.current;
    const id = editingTextId;
    setEditingTextId(null);
    editStartRef.current = null;
    if (!id) return;
    removeAnnotation(id);
    if (editing && !editing.created) {
      commitGesture(t('panels:textAnnotation.deleteText', 'Delete text'));
    } else {
      preGestureAnnotationsRef.current = null;
    }
  }, [editingTextId, removeAnnotation, commitGesture, t]);

  return {
    annotations,
    imageAnnotations,
    transformableObjects,
    selectedAnnotationId,
    selectedImage,
    setSelectedAnnotation,
    updateAnnotation,
    syncAnnotationHeight,
    beginGesture,
    commitGesture,
    gestureLabel,
    applyBoxUpdate,
    applyCrop,
    canCrop,
    imageFileInputRef,
    addImageFromFile,
    handleViewportDragOver,
    handleViewportDrop,
    bringSelectedImageToFront,
    sendSelectedImageToBack,
    deleteSelectedImage,
    editingTextId,
    requestEditText,
    createTextAt,
    createTextBoxFromDrag,
    changeTextContent,
    exitEditText,
    deleteEditingText,
  };
}
