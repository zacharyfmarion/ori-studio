import { useCallback, useEffect, useMemo, useRef, type DragEvent as ReactDragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { SerializedEditorState } from 'lexical';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { Point } from '../../lib/geometry';
import type { CanvasObjectBoxUpdate } from '../CanvasObjectOverlay';
import { annotationAsTransformable } from '../canvasObjects/transformableObject';
import type { TransformableCanvasObject } from '../canvasObjects/transformableObject';
import type { CpOverlayView } from '../CreasePatternWebglCanvas';
import { createCpImage } from '../images/cpImage';
import type { BoxCorners } from '../tools/viewAlignedBox';
import { importImageFile } from '../images/cpImageImport';
import { cropImage, fitImageModelSize } from '../images/cpImagePlacement';
import { classifyDroppedFile, dragCarriesFiles } from '../../lib/fileDrop';
import {
  overlayCssPerModel,
  overlayCssToModel,
  uprightRotationForView,
} from './annotationTransform';
import type { AnnotationResizeHandle } from './annotationTransform';
import {
  annotationAtModelPoint,
  isImageAnnotation,
  isSuppressionRegionAnnotation,
  isTextAnnotation,
  topAnnotationZ,
} from './annotation';
import type { ImageAnnotation } from './annotation';
import type { CanvasLayerBinding } from '../canvasObjects/canvasLayerBindings';
import { cpAnnotationMenuItems } from '../contextMenu/cpContextMenuItems';
import { cpRegionMenuItems } from '../regions/regionMenuItems';
import { useCpRegionActions } from '../regions/useCpRegions';
import { annotationGesture } from './annotationGesture';
import {
  bringAnnotationToFront as bringAnnotationToFrontVerb,
  deleteAnnotation as deleteAnnotationVerb,
  sendAnnotationToBack as sendAnnotationToBackVerb,
} from './annotationVerbs';
import type { GestureToken } from '../canvasObjects/gestureBracket';
import {
  beginTextEditSession,
  endTextEditSession,
  takeSuppressNextTextCreate,
  textEditSession,
  useTextEditSession,
  type TextEditExitReason,
} from './textEditSession';
import {
  createTextAnnotation,
  textBoxFromDragCorners,
  textBoxResizeUpdate,
  DEFAULT_TEXT_BOX_WIDTH,
  DEFAULT_TEXT_FONT_SIZE,
} from './textAnnotation';


// The session's exit reasons are the session module's; re-exported for the
// callers that name the type through this hook.
export type { TextEditExitReason } from './textEditSession';

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
 * invariant — every mutation is bracketed by begin/commit on the layer's
 * bracket (`annotationGesture`) so a whole drag or edit lands as a single undo
 * entry. The bracket is module-level, so the Properties pane in another dock
 * panel edits through the same one and cannot clobber a drag's baseline.
 */
/**
 * Where a picked or dropped image should land, in **client** coordinates.
 *
 * `anchor` is what separates the gestures. A drop and the Insert menu put the
 * image under the cursor / in the middle of the view — those mean "here-ish".
 * The canvas context menu means "start it here", so it asks for `'top-left'`
 * and the box's corner lands on the point, matching a placed paste.
 */
export interface CpImagePlacement {
  x: number;
  y: number;
  /** Defaults to `'center'`, which is every pre-existing caller's behaviour. */
  anchor?: 'center' | 'top-left';
}

export function useCpAnnotations({ overlayView, viewportRef }: UseCpAnnotationsOptions) {
  const { t } = useTranslation();
  const annotations = useWorkspaceStore((state) => state.oristudioCpAnnotations);
  const selectedAnnotationId = useWorkspaceStore(
    (state) => state.oristudioCpSelectedAnnotationId
  );
  const addAnnotation = useWorkspaceStore((state) => state.addAnnotation);
  const updateAnnotation = useWorkspaceStore((state) => state.updateAnnotation);
  const setSelectedAnnotation = useWorkspaceStore(
    (state) => state.setSelectedAnnotation
  );
  const syncAnnotationHeight = useWorkspaceStore((state) => state.syncAnnotationHeight);
  const recordAnnotationHistory = useWorkspaceStore(
    (state) => state.recordAnnotationHistory
  );

  /**
   * The bracket token for the canvas gesture in flight (a drag on the overlay,
   * a floating-toolbar slider), so the whole gesture records a single undo
   * entry when it commits. The snapshot itself lives in `annotationGesture`.
   */
  const gestureTokenRef = useRef<GestureToken | null>(null);
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);
  /**
   * Where the next picked image should land, in client coordinates.
   *
   * A parked value rather than an argument, because the picker breaks the call
   * in half: the caller that knows the point (a right-click on blank paper)
   * only opens a file dialog, and the file arrives later on the input's
   * `change`. Nothing in between carries a point.
   *
   * `null` means "wherever the picker defaults to", which is the viewport
   * centre — the Insert menu's own behaviour, unchanged.
   */
  const pendingImagePointRef = useRef<CpImagePlacement | null>(null);

  /**
   * Open the canvas gesture. False when another owner holds the layer — an
   * open text session, a Properties-pane slider mid-drag — in which case the
   * caller must not start its drag: writes it made would land un-undoable.
   */
  const beginGesture = useCallback(() => {
    const token = annotationGesture.begin('canvas');
    gestureTokenRef.current = token;
    return token !== null;
  }, []);
  const commitGesture = useCallback((label: string) => {
    const token = gestureTokenRef.current;
    gestureTokenRef.current = null;
    if (token) void annotationGesture.commit(token, label);
  }, []);
  /** A drag that was cancelled: drop the snapshot without recording. */
  const cancelGesture = useCallback(() => {
    const token = gestureTokenRef.current;
    gestureTokenRef.current = null;
    if (token) annotationGesture.abort(token);
  }, []);

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
  // A text box's dragged height is its floor (`textBoxResizeUpdate`); every
  // other kind takes the box as reported.
  const applyBoxUpdate = useCallback(
    (id: string, patch: CanvasObjectBoxUpdate) => {
      const annotation = annotationById(id);
      updateAnnotation(
        id,
        annotation && isTextAnnotation(annotation) ? textBoxResizeUpdate(patch) : patch
      );
    },
    [annotationById, updateAnnotation]
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
  // drop handler, the Insert-image button, and the canvas context menu.
  const addImageFromFile = useCallback(
    async (file: File, placement: CpImagePlacement | null) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      try {
        const source = await importImageFile(file);
        let center = { x: 0.5, y: 0.5 };
        let targetExtent = 1;
        if (overlayView && rect) {
          const cssPoint = placement
            ? { x: placement.x - rect.left, y: placement.y - rect.top }
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
        const rotation = uprightRotationForView(overlayView);
        // A drop and the Insert menu put the image *under the cursor* / in the
        // middle of the view, which is what those gestures mean. The context
        // menu means "start it here", so its corner goes on the point instead —
        // the same rule as a placed paste.
        //
        // Rotated through the box's own angle rather than offset in model axes:
        // the image is squared to the screen, so under a turned view its visual
        // top-left is not its model-space minimum corner.
        if (placement?.anchor === 'top-left') {
          const radians = (rotation * Math.PI) / 180;
          const cos = Math.cos(radians);
          const sin = Math.sin(radians);
          const halfX = width / 2;
          const halfY = height / 2;
          center = {
            x: center.x + halfX * cos - halfY * sin,
            y: center.y + halfX * sin + halfY * cos,
          };
        }
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
            // Square to the screen it was dropped on. Centre and extent above
            // already go through the overlay view, so they need no adjustment.
            rotation,
            z: topZ + 1,
          })
        );
        recordAnnotationHistory([...images], t('panels:creasePattern.addImage', 'Add image'));
      } catch (error) {
        console.error('[cp-image] failed to import image', error);
        // A decode failure used to stop at the console, so picking a file the
        // browser cannot read looked like the button doing nothing at all.
        useWorkspaceStore.setState({
          error: {
            code: 'invalid_operation',
            message: t(
              'errors:creasePattern.imageNotDecodable',
              'Ori Studio could not read {{name}} as an image. Try a PNG, JPEG, or WebP.',
              { name: file.name }
            ),
          },
          projectMessage: null,
        });
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
      // Shares the classifier with the workspace drop target rather than testing
      // the MIME type here. The two must agree on what an image is: when they did
      // not, a `.ori` (which macOS labels Olympus raw) was claimed here as an
      // image and stopped from bubbling, so it reached neither handler's file
      // path and only surfaced as a decode error in the console.
      const file = Array.from(event.dataTransfer.files).find(
        (candidate) => classifyDroppedFile(candidate).kind === 'image'
      );
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

  /**
   * Park a placement for the image the user is about to pick.
   *
   * Set immediately before whatever opens the picker — the caller does not have
   * to be the thing that opens it, which is what lets the context menu keep
   * dispatching `insert.image` through `handleMenuAction` (and so through the
   * analytics chokepoint) instead of reaching for the file input itself.
   */
  const setPendingImagePoint = useCallback((placement: CpImagePlacement | null) => {
    pendingImagePointRef.current = placement;
  }, []);

  /**
   * Take the parked placement, clearing it.
   *
   * Cleared on read so a placement can never outlive the pick it was set for: a
   * cancelled dialog would otherwise leave the point armed and drop the *next*
   * image, inserted from the menu bar, at a spot the user last right-clicked
   * minutes ago.
   */
  const consumePendingImagePoint = useCallback(() => {
    const point = pendingImagePointRef.current;
    pendingImagePointRef.current = null;
    return point;
  }, []);

  // Annotation-layer edits, each recording one undo entry.
  //
  // Addressed **by id**, with the selected-* forms below expressed in terms of
  // them. A caller that acts on a thing it has just selected — the context menu
  // does exactly this, selecting what the right-click landed on and then
  // building rows for it — cannot use the selected-* forms: they close over
  // `selectedAnnotationId`, which is React state and still holds the *previous*
  // selection for the rest of the tick. Taking the id is what makes "act on what
  // was clicked" expressible at all.
  // The verbs themselves live in `annotationVerbs.ts`, over the same bracket,
  // so the context menu and the Properties pane call the very same functions.
  const bringAnnotationToFront = useCallback(
    (id: string) => bringAnnotationToFrontVerb(id, t),
    [t]
  );

  const sendAnnotationToBack = useCallback((id: string) => sendAnnotationToBackVerb(id, t), [t]);

  const deleteAnnotationById = useCallback((id: string) => deleteAnnotationVerb(id, t), [t]);

  const bringSelectedImageToFront = useCallback(() => {
    if (selectedAnnotationId) bringAnnotationToFront(selectedAnnotationId);
  }, [selectedAnnotationId, bringAnnotationToFront]);

  const sendSelectedImageToBack = useCallback(() => {
    if (selectedAnnotationId) sendAnnotationToBack(selectedAnnotationId);
  }, [selectedAnnotationId, sendAnnotationToBack]);

  const deleteSelectedImage = useCallback(() => {
    if (selectedAnnotationId) deleteAnnotationById(selectedAnnotationId);
  }, [selectedAnnotationId, deleteAnnotationById]);

  // --- Inline text editing ---

  // The session lives at module level (`textEditSession.ts`) so the Properties
  // pane, a separate dock panel, can tell whether the box it shows is being
  // edited; this hook is its canvas-side driver.
  const editingTextId = useTextEditSession()?.id ?? null;

  // Double-click a text box (via the annotation overlay), or a Text-tool click
  // on one → inline editing.
  const requestEditText = useCallback(
    (id: string) => {
      setSelectedAnnotation(id);
      beginTextEditSession(id, false);
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
        takeSuppressNextTextCreate();
        if (isTextAnnotation(hit)) requestEditText(hit.id);
        else setSelectedAnnotation(hit.id);
        return;
      }
      // Empty canvas: if this click just committed an edit, it only deselects.
      if (takeSuppressNextTextCreate()) {
        setSelectedAnnotation(null);
        return;
      }
      const cssPerModel = overlayCssPerModel(overlayView);
      const box = createTextAnnotation({
        center: { x: modelPoint.x, y: modelPoint.y },
        width: cssPerModel > 0 ? 220 / cssPerModel : DEFAULT_TEXT_BOX_WIDTH,
        // Square to the screen the user clicked on, not to the paper.
        rotation: uprightRotationForView(overlayView),
        fontSize: cssPerModel > 0 ? 16 / cssPerModel : DEFAULT_TEXT_FONT_SIZE,
        z: topAnnotationZ(prev) + 1,
      });
      // Snapshot before the add, so undoing the session removes the box.
      beginTextEditSession(box.id, true);
      addAnnotation(box);
    },
    [overlayView, addAnnotation, requestEditText, setSelectedAnnotation]
  );

  // Text tool: a press-drag creates a fixed-size box (the dragged height seeds a
  // minimum; content still grows it downward). Too small a drag falls back to the
  // click-created auto-sizing box.
  const createTextBoxFromDrag = useCallback(
    (corners: BoxCorners) => {
      if (!overlayView) return;
      const cssPerModel = overlayCssPerModel(overlayView);
      const minExtent = cssPerModel > 0 ? 12 / cssPerModel : DEFAULT_TEXT_FONT_SIZE;
      const box = textBoxFromDragCorners(corners, minExtent, uprightRotationForView(overlayView));
      if (!box) {
        createTextAt(corners[0]);
        return;
      }
      const prev = useWorkspaceStore.getState().oristudioCpAnnotations;
      const annotation = createTextAnnotation({
        center: box.center,
        width: box.width,
        height: box.height,
        minHeight: box.height,
        rotation: box.rotation,
        fontSize: cssPerModel > 0 ? 16 / cssPerModel : DEFAULT_TEXT_FONT_SIZE,
        z: topAnnotationZ(prev) + 1,
      });
      beginTextEditSession(annotation.id, true);
      addAnnotation(annotation);
    },
    [overlayView, addAnnotation, createTextAt]
  );

  const changeTextContent = useCallback(
    (id: string, doc: SerializedEditorState, plainText: string) => {
      updateAnnotation(id, { doc, plainText });
    },
    [updateAnnotation]
  );

  // Leave inline editing — the session module owns the empty-box GC, the
  // labels and the create-suppression arm.
  const exitEditText = useCallback(
    (reason: TextEditExitReason = 'blur') => endTextEditSession(reason),
    []
  );

  // A session outlives no box: the selection leaving it (a click elsewhere the
  // editor's blur did not see, a menu verb) or the box vanishing (delete,
  // undo, document replace) ends it as a blur. An undo about to run and a
  // document replacement reach the session through the chokepoint, which the
  // session module registers for itself.
  useEffect(() => {
    if (!editingTextId) return;
    const gone = !annotations.some((annotation) => annotation.id === editingTextId);
    if (gone || selectedAnnotationId !== editingTextId) endTextEditSession('blur');
  }, [editingTextId, annotations, selectedAnnotationId]);
  // The bracket is module-level and would otherwise outlive the surface that
  // opened it, refusing every later annotation gesture.
  useEffect(
    () => () => {
      const token = gestureTokenRef.current;
      gestureTokenRef.current = null;
      if (token) annotationGesture.abort(token);
      if (textEditSession()) endTextEditSession('document-replaced');
    },
    []
  );

  // Delete from the text toolbar removes the box and leaves edit mode; the
  // pre-edit snapshot makes it undoable (unless the box was never real).
  const deleteEditingText = useCallback(() => endTextEditSession('delete'), []);

  // A region's delete and check toggles are the region verbs' — a delete also
  // removes the owned reference image and clears the pins inside it, which the
  // bare annotation verb refuses to do by halves.
  const regionActions = useCpRegionActions();

  /**
   * The annotation layer as one {@link CanvasLayerBinding}: three kinds, one
   * list, one bracket. Everything here is a delegate to a binding above, so the
   * panel dispatches by id without naming a kind — see `canvasLayerBindings.ts`.
   */
  const binding = useMemo<CanvasLayerBinding>(
    () => ({
      kinds: ['image', 'text', 'suppressionRegion'],
      transformables: transformableObjects,
      // Text boxes and regions carry `hidden`; images are framed through the
      // canvas's own `images` prop, which draws them.
      overlayBoxes: annotations.filter((annotation) => !isImageAnnotation(annotation)),
      // A region's body is unconditionally inert: what is under it is the crease
      // pattern, and the region is a wash drawn behind it. It stays movable
      // through its chip and resizable through the selection handles.
      inertBodyIds: new Set(
        annotations.filter(isSuppressionRegionAnnotation).map((region) => region.id)
      ),
      select: (id) => setSelectedAnnotation(id),
      release: () => setSelectedAnnotation(null),
      applyBoxUpdate,
      beginGesture: () => beginGesture(),
      commitGesture: (_id, kind) => commitGesture(gestureLabel(kind)),
      cancelGesture: () => cancelGesture(),
      remove: (id) => {
        const annotation = annotationById(id);
        if (!annotation) return;
        if (isSuppressionRegionAnnotation(annotation)) regionActions.removeRegion(id);
        else deleteAnnotationById(id);
      },
      contextMenu: (id, deps) => {
        const annotation = annotationById(id);
        if (!annotation) return null;
        // Selecting first is what makes the floating surface and the menu agree
        // about which annotation is being acted on. The rows are bound by id,
        // so they do not depend on this having landed.
        setSelectedAnnotation(id);
        if (isSuppressionRegionAnnotation(annotation)) {
          return {
            targetKind: 'region',
            build: () =>
              cpRegionMenuItems(annotation, {
                t: deps.t,
                toggleCheckClass: (cpCheckClass) =>
                  regionActions.toggleRegionCheckClass(id, cpCheckClass),
                remove: () => regionActions.removeRegion(id),
              }),
          };
        }
        const kind = isTextAnnotation(annotation) ? 'text' : 'image';
        return {
          targetKind: kind,
          build: () =>
            cpAnnotationMenuItems(kind, {
              ...deps,
              annotation: {
                bringToFront: () => bringAnnotationToFront(id),
                sendToBack: () => sendAnnotationToBack(id),
                remove: () => deleteAnnotationById(id),
                edit:
                  kind === 'text'
                    ? () => {
                        // An inline edit takes focus for itself; without this
                        // the menu's trap pulls it straight back out and the
                        // blur that follows ends the edit before a key is
                        // pressed.
                        deps.deferFocus();
                        requestEditText(id);
                      }
                    : undefined,
              },
            }),
        };
      },
      applyCrop,
      canCrop,
      requestEdit: requestEditText,
    }),
    [
      annotations,
      transformableObjects,
      setSelectedAnnotation,
      applyBoxUpdate,
      beginGesture,
      commitGesture,
      cancelGesture,
      gestureLabel,
      annotationById,
      regionActions,
      deleteAnnotationById,
      bringAnnotationToFront,
      sendAnnotationToBack,
      requestEditText,
      applyCrop,
      canCrop,
    ]
  );

  return {
    binding,
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
    cancelGesture,
    gestureLabel,
    applyBoxUpdate,
    applyCrop,
    canCrop,
    imageFileInputRef,
    addImageFromFile,
    setPendingImagePoint,
    consumePendingImagePoint,
    handleViewportDragOver,
    handleViewportDrop,
    bringSelectedImageToFront,
    sendSelectedImageToBack,
    deleteSelectedImage,
    bringAnnotationToFront,
    sendAnnotationToBack,
    deleteAnnotationById,
    editingTextId,
    requestEditText,
    createTextAt,
    createTextBoxFromDrag,
    changeTextContent,
    exitEditText,
    deleteEditingText,
  };
}
