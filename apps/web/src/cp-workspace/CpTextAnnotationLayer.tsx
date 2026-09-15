import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { SerializedEditorState } from 'lexical';
import type { CpOverlayView } from './CreasePatternWebglCanvas';
import { useCpOverlayView } from './cpOverlayViewStore';
import { useWheelPassthrough } from '../hooks/useWheelPassthrough';
import { resolveCpViewportCanvas } from './cpViewportCanvas';
import { overlayCssPerModel, overlayModelToCss } from './annotations/annotationTransform';
import { isTextAnnotation, type CanvasAnnotation } from './annotations/annotation';
import type { TextAnnotation } from './annotations/textAnnotation';
import { CpTextView } from './CpTextView';
import { CpTextEditor } from './CpTextEditor';

/**
 * DOM layer that renders text-annotation boxes over the WebGL canvas. Text is
 * low-count and CSS-styled, so it rides a DOM layer rather than the GPU (no
 * glyph atlas). Each box is positioned/rotated/scaled to match its model-space
 * transform under the camera; box width drives reflow.
 *
 * A box that isn't being edited renders read-only ({@link CpTextView}) with
 * pointer-events disabled, so the sibling annotation overlay owns selection and
 * drag. The single box under edit (`editingTextId`) mounts the live Lexical
 * editor + text toolbar and captures pointer/keyboard input.
 */

/** Screen-space rotation (radians) of the box's local +x axis under the camera. */
function screenAngle(view: CpOverlayView, center: { x: number; y: number }, rotation: number): number {
  const origin = overlayModelToCss(view, center);
  const tip = overlayModelToCss(view, {
    x: center.x + Math.cos(rotation),
    y: center.y + Math.sin(rotation),
  });
  return Math.atan2(tip.y - origin.y, tip.x - origin.x);
}

export function CpTextAnnotationLayer({
  annotations,
  editingTextId,
  toolbarContainer,
  onChangeText,
  onExitEdit,
  onDelete,
  onSyncHeight,
}: {
  annotations: readonly CanvasAnnotation[];
  editingTextId: string | null;
  /** Element the canvas is positioned against, for toolbar anchoring. */
  toolbarContainer: HTMLElement | null;
  onChangeText: (id: string, doc: SerializedEditorState, plainText: string) => void;
  onExitEdit: (reason: 'blur' | 'escape') => void;
  onDelete: () => void;
  onSyncHeight: (id: string, height: number) => void;
}) {
  // Subscribe to the live camera directly so this small layer re-renders crisply
  // every frame (real font size, no scaling blur) without re-rendering the panel.
  const view = useCpOverlayView();
  const textAnnotations = annotations.filter(isTextAnnotation);
  if (!view) return null;
  const pxPerModel = overlayCssPerModel(view);

  return (
    <div
      className="cp-text-layer"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'visible',
        // Above the WebGL canvas (5) and grid (6); the annotation overlay (8)
        // and its handles sit just above this. Without a z-index the DOM text
        // paints behind the opaque canvas and is invisible.
        zIndex: 7,
      }}
      aria-hidden={editingTextId ? undefined : true}
    >
      {textAnnotations.map((text) => {
        if (text.hidden) return null;
        const editing = text.id === editingTextId;
        const center = overlayModelToCss(view, text.center);
        const angle = screenAngle(view, text.center, text.rotation);
        const style: CSSProperties = {
          position: 'absolute',
          left: center.x,
          top: center.y,
          width: text.width * pxPerModel,
          // The floor a creation drag or a resize handle set; content grows the
          // box downward past it but never shrinks it below (the top stays fixed).
          minHeight: text.minHeight > 0 ? text.minHeight * pxPerModel : undefined,
          transform: `translate(-50%, -50%) rotate(${angle}rad)`,
          transformOrigin: 'center center',
          fontSize: `${text.fontSize * pxPerModel}px`,
          opacity: text.opacity,
          pointerEvents: editing ? 'auto' : 'none',
        };
        return (
          <TextBox
            key={text.id}
            text={text}
            editing={editing}
            style={style}
            pxPerModel={pxPerModel}
            toolbarContainer={toolbarContainer}
            onChangeText={onChangeText}
            onExitEdit={onExitEdit}
            onDelete={onDelete}
            onSyncHeight={onSyncHeight}
          />
        );
      })}
    </div>
  );
}

function TextBox({
  text,
  editing,
  style,
  pxPerModel,
  toolbarContainer,
  onChangeText,
  onExitEdit,
  onDelete,
  onSyncHeight,
}: {
  text: TextAnnotation;
  editing: boolean;
  style: CSSProperties;
  pxPerModel: number;
  /** Element the canvas is positioned against, for toolbar anchoring. */
  toolbarContainer: HTMLElement | null;
  onChangeText: (id: string, doc: SerializedEditorState, plainText: string) => void;
  onExitEdit: (reason: 'blur' | 'escape') => void;
  onDelete: () => void;
  onSyncHeight: (id: string, height: number) => void;
}) {
  // State rather than a ref: the wheel listener below has to re-attach when this
  // element arrives, which a ref would not tell anyone about.
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  // The scale and current model height change every camera frame; read them from
  // a ref so the ResizeObserver below is created once per box (on doc change),
  // not torn down and rebuilt every frame during a zoom.
  const measureRef = useRef({ pxPerModel, height: text.height });
  useLayoutEffect(() => {
    measureRef.current = { pxPerModel, height: text.height };
  });

  // A box under edit takes pointer events so the editor can be typed into, which
  // also makes it swallow the wheel — and a pinch the browser reports as
  // ctrl+wheel then zooms the whole page. Hand it to the canvas the box is
  // floating over, as the toolbars and the selection overlay already do. Nothing
  // is lost: the box grows with its content and never scrolls, so there is no
  // inner scroll for the wheel to have meant.
  useWheelPassthrough(box, resolveCpViewportCanvas);

  // Keep the model height tracking the rendered box so the selection frame
  // matches the ink.
  const syncHeight = useCallback(() => {
    if (!box) return;
    const { pxPerModel: px, height } = measureRef.current;
    if (px <= 0) return;
    const modelHeight = box.offsetHeight / px;
    if (Math.abs(modelHeight - height) * px > 0.5) {
      onSyncHeight(text.id, modelHeight);
    }
  }, [box, text.id, onSyncHeight]);
  // The two can diverge from either side. Typing and reflow move the DOM box,
  // which the observer sees. A handle drag moves the *model* height — and when
  // it asks for less than the content needs, the DOM box stays put at the
  // content height and the observer never fires, so that side needs its own
  // trigger or the frame is left shorter than the text.
  useLayoutEffect(() => {
    if (!text.autoHeight || !box) return;
    syncHeight();
    const observer = new ResizeObserver(syncHeight);
    observer.observe(box);
    return () => observer.disconnect();
  }, [box, text.autoHeight, syncHeight, text.doc]);
  useLayoutEffect(() => {
    if (text.autoHeight) syncHeight();
  }, [text.autoHeight, text.height, text.minHeight, syncHeight]);

  return (
    <div
      ref={setBox}
      className={`cp-text-box${editing ? ' cp-text-box--editing' : ''}`}
      style={style}
    >
      {editing ? (
        <CpTextEditor
          id={text.id}
          doc={text.doc}
          box={text}
          container={toolbarContainer}
          onChange={(doc, plainText) => onChangeText(text.id, doc, plainText)}
          onExit={onExitEdit}
          onDelete={onDelete}
        />
      ) : (
        <CpTextView state={text.doc} />
      )}
    </div>
  );
}
