import { ANALYTICS_EVENTS } from './events';
import type {
  PaperExportBackground,
  PaperExportFormat,
  PaperExportHiddenFaces,
  PaperExportResolution,
  PaperExportSheet,
  PaperExportStyleName,
  PaperExportSurface,
} from './events';
import { track } from './runtime';

/**
 * The export dialog opened on a paper surface's picture: the funnel's first
 * step. Its triggers are toolbar and context-menu verbs as well as shortcuts,
 * which the menu chokepoint does not all see.
 */
export function trackPaperExportOpened(surface: PaperExportSurface): void {
  track(ANALYTICS_EVENTS.paperExportOpened, { surface });
}

/** A saved paper export, as the dialog knows it: every field an enum, or a density bucketed into one. */
export interface PaperExportedEvent {
  surface: PaperExportSurface;
  format: PaperExportFormat;
  hiddenFaces: PaperExportHiddenFaces;
  style: PaperExportStyleName;
  sheet: PaperExportSheet;
  background: PaperExportBackground;
  /** The PNG's density; read only for a PNG. */
  pngDpi: number;
  /** Whether anything was touched in the dialog before saving: does the dialog earn its step. */
  optionsChanged: boolean;
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
    sheet: event.sheet,
    background: event.background,
    resolution: paperExportResolution(event.format, event.pngDpi),
    options_changed: event.optionsChanged ? 'yes' : 'no',
  });
}
