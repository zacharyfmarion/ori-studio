/**
 * DOM layer for the active tool's option window.
 *
 * A **transparent frame around the geometry being changed**, with its controls
 * on the top edge. The content is the drawing itself — the creases are already
 * stroked in the colour the chosen answer would give them and badged with their
 * angles, so a list beside them would say the same thing twice while covering
 * the canvas.
 *
 * Anchored the way {@link CpFoldAngleLayer} anchors its badges: projected
 * through the live camera from {@link cpOverlayViewStore}, so it tracks a pan or
 * zoom without re-rendering the (very large) panel. The frame scales with the
 * camera and the controls do not; see {@link toolOptionPlacement}.
 *
 * The header is **attached** to the frame's top edge and pinned to its right,
 * so the two read as one window rather than as a toolbar that happens to be
 * nearby — which matters on a pattern with several vertices, where the only
 * thing the controls say is *which* region they belong to.
 *
 * The layer and the frame are `pointer-events: none` — only the header takes
 * them — so drawing a crease inside the framed region still works.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { useCpOverlayView } from '../cpOverlayViewStore';
import { Button } from '../../components/ui/Button';
import type { CpToolOptionWindow } from './toolOptionWindow';
import { toolOptionFrame, toolOptionHeaderOffset, type Size } from './toolOptionPlacement';

export function CpToolOptionLayer({ option }: { option: CpToolOptionWindow | null }) {
  const { t } = useTranslation(['tools', 'common']);
  const view = useCpOverlayView();
  const [layerRef, setLayerRef] = useState<HTMLDivElement | null>(null);
  const chromeRef = useRef<HTMLDivElement | null>(null);
  const [chromeSize, setChromeSize] = useState<Size | null>(null);
  const [viewport, setViewport] = useState<Size | null>(null);

  // Measured rather than assumed: the translated strings and the optional note
  // both change the block, and guessing would put it through the frame's edge.
  // A layout effect, so the corrected position is in place before the browser
  // paints and the controls are never seen at the uncorrected one.
  const chromeKey = option ? `${option.note ?? ''}:${option.count}:${option.title}` : null;
  useLayoutEffect(() => {
    const element = chromeRef.current;
    if (!element) {
      setChromeSize(null);
      return;
    }
    const box = element.getBoundingClientRect();
    setChromeSize((current) =>
      current && current.width === box.width && current.height === box.height
        ? current
        : { width: box.width, height: box.height }
    );
  }, [chromeKey]);

  // The area the controls have to stay inside. Observed rather than read during
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

  const frame = toolOptionFrame(view, option.bounds);
  const headerTop =
    chromeSize && viewport ? toolOptionHeaderOffset(frame, chromeSize.height, viewport) : null;

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
        className="cp-tool-option"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: `${frame.width}px`,
          height: `${frame.height}px`,
          // Inline, alongside the layer's and the header's, because this is
          // behaviour rather than styling: a frame that swallowed clicks would
          // stop you drawing inside the very region it is drawing attention to.
          pointerEvents: 'none',
          transform: `translate(${frame.left}px, ${frame.top}px)`,
        }}
      >
        <div className="cp-tool-option__frame" aria-hidden />
        <div
          ref={chromeRef}
          className="cp-tool-option__header"
          style={{
            // `right: 0` in CSS pins it to the frame's right edge; this is the
            // only part that varies. `-height` sits it on top of the frame,
            // `0` just inside when there is no room above.
            top: `${headerTop ?? 0}px`,
            pointerEvents: 'auto',
            // Hidden for the single frame before the measurement lands, so it
            // is never seen at the unplaced offset.
            visibility: headerTop == null ? 'hidden' : 'visible',
          }}
          role="group"
          aria-label={option.title}
        >
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
        {option.note ? <p className="cp-tool-option__note">{option.note}</p> : null}
      </div>
    </div>
  );
}
