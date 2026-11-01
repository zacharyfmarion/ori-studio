import { ANALYTICS_EVENTS } from './events';
import type { CreasePatternFoldedFigure } from './events';
import { track } from './runtime';

/**
 * A crease pattern saved as an image: its format, the style of the folded
 * figure drawn beside it, or `none`, and whose layer order that figure is in
 * — the kernel's own (`default`, also sent without a figure) or one chosen in
 * the Layer order dialog. Enums only — never the pattern, its title, a colour
 * or the order.
 */
export function trackCreasePatternExported(event: {
  format: 'svg' | 'png';
  foldedFigure: CreasePatternFoldedFigure;
  layerOrder?: 'default' | 'chosen';
}): void {
  track(ANALYTICS_EVENTS.creasePatternExported, {
    format: event.format,
    folded_figure: event.foldedFigure,
    folded_figure_layer_order: event.layerOrder ?? 'default',
  });
}
