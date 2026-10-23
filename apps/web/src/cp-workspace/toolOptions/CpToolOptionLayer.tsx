/**
 * The tool option window on Edit's canvas: {@link ToolOptionLayer} projected
 * through Edit's live camera.
 *
 * Anchored the way {@link CpFoldAngleLayer} anchors its badges: the camera comes
 * from {@link cpOverlayViewStore}, which only this small component subscribes
 * to, so the window tracks a pan or zoom without re-rendering the (very large)
 * panel that mounts it.
 */
import { useCpOverlayView } from '../cpOverlayViewStore';
import type { CpToolOptionWindow } from './toolOptionWindow';
import { ToolOptionLayer } from './ToolOptionLayer';

export function CpToolOptionLayer({ option }: { option: CpToolOptionWindow | null }) {
  const view = useCpOverlayView();
  return <ToolOptionLayer option={option} view={view} />;
}
