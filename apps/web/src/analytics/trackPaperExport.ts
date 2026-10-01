import { ANALYTICS_EVENTS, bucketCount, PAPER_EXPORT_PAGE_COUNT_BUCKETS } from './events';
import type {
  PaperExportBackground,
  PaperExportFormat,
  PaperExportHiddenFaces,
  PaperExportMarkShown,
  PaperExportResolution,
  PaperExportScope,
  PaperExportStyleName,
  PaperExportSurface,
} from './events';
import { track } from './runtime';

/**
 * The export dialog opened on a paper surface's picture: the funnel's first
 * step. Its triggers are toolbar and context-menu verbs as well as shortcuts,
 * which the menu chokepoint does not all see.
 */
export function trackPaperExportOpened(surface: PaperExportSurface, scope: PaperExportScope): void {
  track(ANALYTICS_EVENTS.paperExportOpened, { surface, scope });
}

/** A saved paper export, as the dialog knows it: every field an enum, or a density bucketed into one. */
export interface PaperExportedEvent {
  surface: PaperExportSurface;
  format: PaperExportFormat;
  hiddenFaces: PaperExportHiddenFaces;
  style: PaperExportStyleName;
  background: PaperExportBackground;
  /** The PNG's density; read only for a PNG. */
  pngDpi: number;
  /** Whether anything was touched in the dialog before saving: does the dialog earn its step. */
  optionsChanged: boolean;
  scope: PaperExportScope;
  /** How many pages the ZIP holds; read only for every page. */
  pageCount: number;
  /**
   * Whether the page carried the step's letters and its line highlights; set
   * only for a surface that offers them (References), and sent only then.
   */
  letters?: PaperExportMarkShown;
  highlights?: PaperExportMarkShown;
}

const RESOLUTION_BY_DPI: Readonly<Record<number, PaperExportResolution>> = {
  96: '1x',
  192: '2x',
  288: '3x',
  384: '4x',
  300: '300',
  600: '600',
};

/** The density as the picker names it: one of its presets, or `custom`; `none` for an SVG. */
export function paperExportResolution(format: PaperExportFormat, pngDpi: number): PaperExportResolution {
  if (format === 'svg') return 'none';
  return RESOLUTION_BY_DPI[pngDpi] ?? 'custom';
}

/**
 * A paper export was written. The file service's `file exported` fires too;
 * this carries what that chokepoint cannot see — which surface drew it, and
 * with what — and never a colour, a size or a name.
 */
export function trackPaperExported(event: PaperExportedEvent): void {
  track(ANALYTICS_EVENTS.paperExported, {
    surface: event.surface,
    format: event.format,
    hidden_faces: event.hiddenFaces,
    style: event.style,
    background: event.background,
    resolution: paperExportResolution(event.format, event.pngDpi),
    options_changed: event.optionsChanged ? 'yes' : 'no',
    scope: event.scope,
    ...(event.scope === 'all'
      ? { page_count_bucket: bucketCount(event.pageCount, PAPER_EXPORT_PAGE_COUNT_BUCKETS) }
      : {}),
    ...(event.letters ? { letters: event.letters } : {}),
    ...(event.highlights ? { highlights: event.highlights } : {}),
  });
}
