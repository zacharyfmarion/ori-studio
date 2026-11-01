import { useCallback, type ReactNode, type Ref } from 'react';
import { cpCreaseStrokeWidthPx } from '../../cp-workspace/cpSizingScales';
import { useEventCallback } from '../../hooks/useEventCallback';
import { PaperPane } from '../../cp-workspace/surface/PaperPane';
import type { CpSurfaceControls, CpSurfaceFrameScales } from '../../cp-workspace/surface/useCpSurface';
import type { WheelGesturePreference } from '../../lib/wheelGesture';
import type { LayerFace } from '../../layer-order/engine/faceIndex';
import { sameLayerPaneHit, type LayerPaneHit, type LayerPanesEvents } from '../../layer-order/panes/layerPaneInput';
import type { LayerPaneChannels } from '../../layer-order/panes/useLayerOrderPanes';
import { useLayerPanePointer } from '../../layer-order/panes/useLayerPanePointer';
import { LayerOrderPaneMarks } from './LayerOrderPaneMarks';
import styles from './LayerOrderPane.module.css';

export interface LayerOrderPaneProps {
  ref?: Ref<CpSurfaceControls>;
  readonly channels: LayerPaneChannels;
  /** The pane's region name ("Crease pattern"). */
  readonly label: string;
  /** The canvas's accessible name: what it shows and what a press on it does. */
  readonly canvasLabel: string;
  readonly events: LayerPanesEvents;
  /** The camera refits when this changes: a new opening. */
  readonly framingKey: string;
  readonly wheelGesture: WheelGesturePreference;
  readonly snapRadius: number;
  readonly themeKey: string;
  readonly onZoomPercentChange: (percent: number) => void;
  /** A double tap: Fit, both panes. */
  readonly onFit: () => void;
  /** What floats over the pane: its zoom bar, wide; nothing on a phone. */
  readonly children?: ReactNode;
}

/** A crease is as wide as Edit draws it at this zoom; the folded paper's pens are its own (pt). */
function strokeWidthPx(channels: LayerPaneChannels) {
  return (frame: CpSurfaceFrameScales) =>
    channels.creases ? cpCreaseStrokeWidthPx(channels.creases.lineWidth, frame) : frame.ratio * frame.widthBoost;
}

/**
 * One of the Layer order dialog's panes (`implementation-plans/layer-order-dialog.md`,
 * row U8): a `PaperPane` handed its channels (`useLayerPatternPane`,
 * `useLayerFoldedPane`), its marks drawn over it through its camera
 * (`LayerOrderPaneMarks`), and its pointer turned into the panes' events
 * (`useLayerPanePointer`). Whatever floats over it is its parent's to give.
 */
export function LayerOrderPane({
  ref,
  channels,
  label,
  canvasLabel,
  events,
  framingKey,
  wheelGesture,
  snapRadius,
  themeKey,
  onZoomPercentChange,
  onFit,
  children,
}: LayerOrderPaneProps) {
  const pointer = useLayerPanePointer(channels.id, events, onFit);
  const { pickable, id } = channels;
  const isTarget = useCallback((hit: LayerPaneHit) => pickable.has(hit.face), [pickable]);
  const told = useEventCallback((faces: readonly LayerFace[]) => events.onUnlettered?.(id, faces));
  return (
    <section className={styles.pane} aria-label={label} data-layer-order-pane={channels.id} {...pointer.capture}>
      <PaperPane<LayerPaneHit>
        ref={ref}
        scene={channels.scene}
        look={channels.look}
        modelToSvg={channels.modelToSvg}
        creases={channels.creases?.creases ?? null}
        underFills={channels.underFills}
        fills={channels.fills}
        overlay={channels.overlay}
        strokeWidthPx={strokeWidthPx(channels)}
        stacks={channels.stacks}
        hitTest={channels.hitTest}
        sameHit={sameLayerPaneHit}
        isTarget={isTarget}
        onPick={pointer.onPick}
        onHover={pointer.onHover}
        contentBounds={channels.contentBounds}
        framingKey={framingKey}
        keepInViewKey={channels.keepInViewKey}
        keepInViewBounds={channels.keepInViewBounds}
        wheelGesture={wheelGesture}
        snapRadius={snapRadius}
        themeKey={themeKey}
        onZoomPercentChange={onZoomPercentChange}
        layers={(view) => <LayerOrderPaneMarks pane={channels} view={view} onUnlettered={told} />}
        ariaLabel={canvasLabel}
        testId={`layer-order-${channels.id}-canvas`}
        errorSurface={`layer-order:${channels.id}-webgl`}
      />
      {children}
    </section>
  );
}
