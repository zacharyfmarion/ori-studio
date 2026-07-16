import { memo, useMemo, type CSSProperties, type MouseEvent } from 'react';
import { textCoordinate } from '../lib/creasePatternViewport';
import type { OristudioCpTextElement } from '../engine/oristudioCpTypes';
import type { CpOverlayView } from './CreasePatternWebglCanvas';

/**
 * DOM overlay for crease-pattern text annotations on the WebGL surface. Text is
 * low-count and CSS-styled, so it rides a DOM layer over the canvas rather than the
 * GPU (no glyph atlas needed). Each label projects its model position through the
 * camera's reported {@link CpOverlayView} and scales its font with zoom (the SVG's
 * 12px is in user space; `zoomPercent` is the user→CSS scale, so 100% ⇒ 12 CSS px).
 *
 * The container is click-through; individual labels are clickable only when the
 * current tool allows entity selection, so clicks fall through to draw tools.
 */
const BASE_FONT_PX = 12;

export const CpTextOverlay = memo(function CpTextOverlay({
  texts,
  selectedTextIds,
  view,
  zoomPercent,
  selectable,
  onToggleText,
}: {
  texts: readonly OristudioCpTextElement[];
  selectedTextIds: readonly number[];
  view: CpOverlayView;
  zoomPercent: number;
  selectable: boolean;
  onToggleText: (id: number, additive?: boolean) => void;
}) {
  const selectedSet = useMemo(() => new Set(selectedTextIds), [selectedTextIds]);
  const fontPx = Math.max(1, BASE_FONT_PX * (zoomPercent / 100));

  return (
    <div className="cp-text-overlay" aria-hidden="true">
      {texts.map((text, index) => {
        const id = index + 1;
        const mx = textCoordinate(text.x);
        const my = textCoordinate(text.y);
        const left = view.origin[0] + mx * view.ex[0] + my * view.ey[0];
        const top = view.origin[1] + mx * view.ex[1] + my * view.ey[1];
        const style: CSSProperties = {
          left,
          top,
          fontSize: fontPx,
          pointerEvents: selectable ? 'auto' : 'none',
        };
        const handleClick = (event: MouseEvent<HTMLSpanElement>) => {
          event.stopPropagation();
          onToggleText(id, event.shiftKey || event.metaKey || event.ctrlKey);
        };
        return (
          <span
            key={id}
            className={['cp-text-label', selectedSet.has(id) ? 'cp-text-label--selected' : '']
              .join(' ')
              .trim()}
            style={style}
            onClick={handleClick}
          >
            {text.text}
          </span>
        );
      })}
    </div>
  );
});
