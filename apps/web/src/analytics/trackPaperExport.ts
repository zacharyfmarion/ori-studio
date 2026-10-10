import { ANALYTICS_EVENTS, bucketCount, PAPER_EXPORT_PAGE_COUNT_BUCKETS } from './events';
import type {
  PaperExportBackground,
  PaperExportFormat,
  PaperImageExportFormat,
  PaperExportHiddenFaces,
  PaperExportLastSave,
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

/**
 * The reader closed the dialog without a file: the funnel's other ending, with
 * how the last press of Export went, so a change of mind is told apart from
 * something in the way.
 */
export function trackPaperExportDismissed(event: {
  surface: PaperExportSurface;
  scope: PaperExportScope;
  lastSave: PaperExportLastSave;
}): void {
  track(ANALYTICS_EVENTS.paperExportDismissed, {
    surface: event.surface,
    scope: event.scope,
    last_save: event.lastSave,
  });
}

/** A save from the dialog threw: which surface, file kind and scope — never the message. */
export function trackPaperExportFailed(event: {
  surface: PaperExportSurface;
  format: PaperExportFormat;
  scope: PaperExportScope;
}): void {
  track(ANALYTICS_EVENTS.paperExportFailed, {
    surface: event.surface,
    format: event.format,
    scope: event.scope,
  });
}

/** A saved paper export, as the dialog knows it: every field an enum, or a density bucketed into one. */
interface PaperExportedBase {
  surface: PaperExportSurface;
  /** Whether anything was touched in the dialog before saving. */
  optionsChanged: boolean;
  scope: PaperExportScope;
}

export type PaperExportedEvent = PaperImageExportedEvent | (PaperExportedBase & { format: 'obj' });

interface PaperImageExportedEvent extends PaperExportedBase {
  format: PaperImageExportFormat;
  hiddenFaces: PaperExportHiddenFaces;
  style: PaperExportStyleName;
  background: PaperExportBackground;
  /** The PNG's density; read only for a PNG. */
  pngDpi: number;
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

/** The density as the picker names it: one of its presets, or `custom`; `none` for non-raster formats. */
export function paperExportResolution(format: PaperExportFormat, pngDpi: number): PaperExportResolution {
  if (format !== 'png') return 'none';
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
    options_changed: event.optionsChanged ? 'yes' : 'no',
    scope: event.scope,
    ...(event.format === 'obj' ? {} : {
      hidden_faces: event.hiddenFaces,
      style: event.style,
      background: event.background,
      resolution: paperExportResolution(event.format, event.pngDpi),
      ...(event.scope === 'all'
        ? { page_count_bucket: bucketCount(event.pageCount, PAPER_EXPORT_PAGE_COUNT_BUCKETS) }
        : {}),
      ...(event.letters ? { letters: event.letters } : {}),
      ...(event.highlights ? { highlights: event.highlights } : {}),
    }),
  });
}
