import { ANALYTICS_EVENTS } from './events';
import type { CreasePatternFoldedFigure } from './events';
import { track } from './runtime';

/**
 * A crease pattern saved as an image: its format, and the style of the folded
 * figure drawn beside it, or `none`. Enums only — never the pattern, its
 * title or a colour.
 */
export function trackCreasePatternExported(event: {
  format: 'svg' | 'png';
  foldedFigure: CreasePatternFoldedFigure;
}): void {
  track(ANALYTICS_EVENTS.creasePatternExported, {
    format: event.format,
    folded_figure: event.foldedFigure,
  });
}
