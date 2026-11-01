import { ANALYTICS_EVENTS } from './events';
import type {
  CreasePatternFoldedFigure,
  CreasePatternFoldedFigureSpread,
  CreasePatternSpreadRender,
} from './events';
import { track } from './runtime';

/** How a written figure's layers were spread: its kind and how it was written, or null for no spread. */
export interface CreasePatternSpreadDrawn {
  kind: Exclude<CreasePatternFoldedFigureSpread, 'none'>;
  render: CreasePatternSpreadRender;
}

/**
 * The spread properties of `crease pattern exported` and `crease pattern
 * shared`: `folded_figure_spread`, and `spread_render` beside it only for a
 * spread. Enums only — never an amount, a reveal or a direction.
 */
export function creasePatternSpreadProperties(spread: CreasePatternSpreadDrawn | null): Record<string, string> {
  return spread ? { folded_figure_spread: spread.kind, spread_render: spread.render } : { folded_figure_spread: 'none' };
}

/**
 * A crease pattern saved as an image: its format, the style of the folded
 * figure drawn beside it, or `none`, whose layer order that figure is in
 * — the kernel's own (`default`, also sent without a figure) or one chosen in
 * the Layer order dialog — and how its layers were spread in the file, and
 * written. Enums only — never the pattern, its title, a colour, the order or
 * the spread's values.
 */
export function trackCreasePatternExported(event: {
  format: 'svg' | 'png';
  foldedFigure: CreasePatternFoldedFigure;
  layerOrder?: 'default' | 'chosen';
  spread?: CreasePatternSpreadDrawn | null;
}): void {
  track(ANALYTICS_EVENTS.creasePatternExported, {
    format: event.format,
    folded_figure: event.foldedFigure,
    folded_figure_layer_order: event.layerOrder ?? 'default',
    ...creasePatternSpreadProperties(event.spread ?? null),
  });
}
