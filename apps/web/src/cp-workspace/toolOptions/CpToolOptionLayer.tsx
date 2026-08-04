/**
 * DOM layer for the active tool's option window.
 *
 * Anchored the way {@link CpFoldAngleLayer} anchors its badges — the model-space
 * point projected through the live camera from {@link cpOverlayViewStore}, so it
 * tracks a pan or zoom without re-rendering the (very large) panel. Unlike the
 * inline simulation windows it does **not** scale with the camera; see
 * {@link toolOptionPlacement}.
 *
 * The layer is `pointer-events: none` and only the window itself takes them, so
 * a drag across the canvas behind it still draws.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { useCpOverlayView } from '../cpOverlayViewStore';
import { overlayModelToCss } from '../annotations/annotationTransform';
import { Button } from '../../components/ui/Button';
import type { CpToolOptionWindow } from './toolOptionWindow';
import { toolOptionPlacement, type Size } from './toolOptionPlacement';

export function CpToolOptionLayer({ option }: { option: CpToolOptionWindow | null }) {
  const { t } = useTranslation(['tools', 'common']);
  const view = useCpOverlayView();
  const [layerRef, setLayerRef] = useState<HTMLDivElement | null>(null);
  const windowRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [viewport, setViewport] = useState<Size | null>(null);

  // Measured rather than assumed: the row count and the translated strings both
  // change the box, and guessing would put the flip rule on the wrong side.
  // A layout effect, so the corrected position is in place before the browser
  // paints and the window is never seen at the uncorrected one.
  const rowKey = option ? `${option.rows.length}:${option.note ?? ''}:${option.count}` : null;
  useLayoutEffect(() => {
    const element = windowRef.current;
    if (!element) {
      setSize(null);
      return;
    }
    const box = element.getBoundingClientRect();
    setSize((current) =>
      current && current.width === box.width && current.height === box.height
        ? current
        : { width: box.width, height: box.height }
    );
  }, [rowKey]);

  // The area the window has to stay inside. Observed rather than read during
  // render — a pane resize changes it without changing anything React knows
  // about, so nothing else would trigger the re-place.
  useEffect(() => {
    if (!layerRef) return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentRect;
      setViewport((current) =>
        current && current.width === box.width && current.height === box.height
          ? current
          : { width: box.width, height: box.height }
      );
    });
    observer.observe(layerRef);
    return () => observer.disconnect();
  }, [layerRef]);

  if (!option || !view) return null;

  const anchor = overlayModelToCss(view, option.anchor);
  const at = size && viewport ? toolOptionPlacement(anchor, size, viewport) : null;

  return (
    <div
      ref={setLayerRef}
      className="cp-tool-option-layer"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'visible',
        // Above the fold-angle badges and the measure layer, below the
        // annotation overlay's direct-manipulation handles.
        zIndex: 8,
      }}
    >
      <div
        ref={windowRef}
        className="cp-tool-option"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          pointerEvents: 'auto',
          // Hidden for the single frame before the measurement lands, so it is
          // never seen at the unplaced origin.
          visibility: at ? 'visible' : 'hidden',
          transform: `translate(${at?.left ?? 0}px, ${at?.top ?? 0}px)`,
        }}
        role="group"
        aria-label={option.title}
      >
        <div className="cp-tool-option__header">
          {option.count > 1 ? (
            <div className="cp-tool-option__stepper">
              <Button
                size="sm"
                variant="ghost"
                aria-label={t('tools:cpToolOption.previous', 'Previous option')}
                onClick={() => option.onStep(-1)}
              >
                <ChevronLeft size={14} aria-hidden />
              </Button>
              <span className="cp-tool-option__count">
                {t('tools:cpToolOption.count', '{{index}} of {{total}}', {
                  index: option.index + 1,
                  total: option.count,
                })}
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t('tools:cpToolOption.next', 'Next option')}
                onClick={() => option.onStep(1)}
              >
                <ChevronRight size={14} aria-hidden />
              </Button>
            </div>
          ) : (
            <span className="cp-tool-option__title">{option.title}</span>
          )}
          <div className="cp-tool-option__actions">
            <Button size="sm" variant="primary" onClick={option.onApply}>
              {t('tools:cpToolOption.apply', 'Apply')}
            </Button>
            <Button size="sm" variant="ghost" onClick={option.onCancel}>
              {t('common:cancel', 'Cancel')}
            </Button>
          </div>
        </div>
        <ul className="cp-tool-option__rows">
          {option.rows.map((row) => (
            <li
              key={row.id}
              className="cp-tool-option__row"
              data-changed={row.changed === false ? 'false' : 'true'}
            >
              {row.color ? (
                <span
                  className="cp-tool-option__swatch"
                  style={{ background: row.color }}
                  aria-hidden
                />
              ) : (
                <span className="cp-tool-option__swatch" aria-hidden />
              )}
              <span className="cp-tool-option__label">{row.label}</span>
              {row.before ? (
                <span className="cp-tool-option__before">{row.before}</span>
              ) : null}
              <span className="cp-tool-option__after">{row.after}</span>
            </li>
          ))}
        </ul>
        {option.note ? <p className="cp-tool-option__note">{option.note}</p> : null}
      </div>
    </div>
  );
}
