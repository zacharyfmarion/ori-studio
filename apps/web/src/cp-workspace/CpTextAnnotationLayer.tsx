import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import type { SerializedEditorState } from 'lexical';
import type { CpOverlayView } from './CreasePatternWebglCanvas';
import { overlayCssPerModel, overlayModelToCss } from './images/cpImagePlacement';
import { isTextAnnotation, type CanvasAnnotation } from './annotations/annotation';
import type { TextAnnotation } from './annotations/textAnnotation';
import { CpTextView } from './CpTextView';
import { CpTextEditor } from './CpTextEditor';
import type { FloatingAnchorRect } from '../components/ui/FloatingToolbar';

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
  view,
  editingTextId,
  toolbarAnchor,
  onChangeText,
  onExitEdit,
  onDelete,
  onSyncHeight,
}: {
  annotations: readonly CanvasAnnotation[];
  view: CpOverlayView;
  editingTextId: string | null;
  toolbarAnchor: FloatingAnchorRect | null;
  onChangeText: (id: string, doc: SerializedEditorState, plainText: string) => void;
  onExitEdit: (reason: 'blur' | 'escape') => void;
  onDelete: () => void;
  onSyncHeight: (id: string, height: number) => void;
}) {
  const pxPerModel = overlayCssPerModel(view);
  const textAnnotations = annotations.filter(isTextAnnotation);

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
          // A drag-created box seeds a minimum height; content grows it downward
          // past that but never shrinks below (the top stays fixed).
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
            toolbarAnchor={toolbarAnchor}
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
  toolbarAnchor,
  onChangeText,
  onExitEdit,
  onDelete,
  onSyncHeight,
}: {
  text: TextAnnotation;
  editing: boolean;
  style: CSSProperties;
  pxPerModel: number;
  toolbarAnchor: FloatingAnchorRect | null;
  onChangeText: (id: string, doc: SerializedEditorState, plainText: string) => void;
  onExitEdit: (reason: 'blur' | 'escape') => void;
  onDelete: () => void;
  onSyncHeight: (id: string, height: number) => void;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Keep the model height tracking the content so the selection box matches.
  useLayoutEffect(() => {
    if (!text.autoHeight || pxPerModel <= 0) return;
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      const modelHeight = el.offsetHeight / pxPerModel;
      if (Math.abs(modelHeight - text.height) * pxPerModel > 0.5) {
        onSyncHeight(text.id, modelHeight);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text.id, text.autoHeight, text.height, pxPerModel, onSyncHeight, text.doc]);

  return (
    <div
      ref={boxRef}
      className={`cp-text-box${editing ? ' cp-text-box--editing' : ''}`}
      style={style}
    >
      {editing ? (
        <CpTextEditor
          doc={text.doc}
          anchorRect={toolbarAnchor}
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
