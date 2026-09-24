/**
 * The page the export will write, and what it is: its size in mm, in px for a
 * PNG, its weight for an SVG.
 *
 * The image is the painted SVG itself, at fit, in a box of the page's own
 * aspect. A transparent page shows a checkerboard in that box only — behind the
 * image, through its transparent pixels — so the margin reads as part of the
 * page and the pane around it does not.
 */
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { PT_PER_MM } from '../../lib/paper/paperSvg';
import type { PaperExportFormat } from '../../lib/paperExportSettings';
import type {
  PaperExportPreviewImage,
  PaperExportStatus,
} from '../../paperExport/usePaperExportDialog';

/** A length in mm as the caption prints it: whole mm from 100, tenths below. */
export function formatPageMm(pt: number): string {
  const mm = pt / PT_PER_MM;
  return mm >= 100 ? String(Math.round(mm)) : String(Math.round(mm * 10) / 10);
}

/** An SVG's weight: KB below a megabyte, MB with one decimal above. */
export function formatFileSize(t: TFunction, bytes: number): string {
  if (bytes < 1024 * 1024) {
    return t('dialogs:paperExport.sizeKb', '{{size}} KB', { size: Math.max(1, Math.round(bytes / 1024)) });
  }
  return t('dialogs:paperExport.sizeMb', '{{size}} MB', {
    size: Math.round((bytes / (1024 * 1024)) * 10) / 10,
  });
}

export function PaperExportPreview({
  status,
  error,
  image,
  transparent,
  format,
  pngSize,
  pngTooLarge,
  hiddenFacesDropped,
}: {
  status: PaperExportStatus;
  error: string | null;
  /** The page on screen, which the caption describes. */
  image: PaperExportPreviewImage | null;
  transparent: boolean;
  format: PaperExportFormat;
  pngSize: { width: number; height: number } | null;
  pngTooLarge: boolean;
  hiddenFacesDropped: number;
}) {
  const { t, i18n } = useTranslation();
  const number = (value: number) => value.toLocaleString(i18n.language);
  const parts: string[] = [];
  const page = image?.page ?? null;
  if (page) {
    parts.push(
      t('dialogs:paperExport.pageMm', '{{width}} × {{height}} mm', {
        width: formatPageMm(page.widthPt),
        height: formatPageMm(page.heightPt),
      })
    );
    if (format === 'png' && pngSize) {
      parts.push(
        t('dialogs:paperExport.pagePx', '{{width}} × {{height}} px', {
          width: number(pngSize.width),
          height: number(pngSize.height),
        })
      );
    }
    if (format === 'svg') parts.push(formatFileSize(t, new Blob([page.svg]).size));
    if (hiddenFacesDropped > 0) {
      parts.push(
        t('dialogs:paperExport.hiddenFacesDropped', '{{count}} hidden faces left out', {
          count: hiddenFacesDropped,
          defaultValue_one: '{{count}} hidden face left out',
        })
      );
    }
  }

  return (
    <div className="paper-export__preview-column">
      <div
        className="export-modal__preview paper-export__preview"
        aria-label={t('dialogs:export.preview', 'Export preview')}
        aria-busy={status === 'building'}
      >
        {image && (
          <div
            className={`paper-export__sheet${transparent ? ' paper-export__sheet--transparent' : ''}${status === 'building' ? ' paper-export__sheet--stale' : ''}`}
            style={
              { '--page-aspect': String(image.page.widthPt / image.page.heightPt) } as CSSProperties
            }
          >
            <img src={image.url} alt="" />
          </div>
        )}
        {status === 'building' && (
          <span className="paper-export__state">
            {t('dialogs:paperExport.preparing', 'Preparing preview…')}
          </span>
        )}
        {status === 'empty' && (
          <span className="paper-export__state">
            {t('dialogs:paperExport.empty', 'Nothing to export: the view shows no paper.')}
          </span>
        )}
        {status === 'error' && (
          <span className="paper-export__state paper-export__state--error">
            {t('dialogs:paperExport.previewFailed', 'Couldn’t draw the preview: {{message}}', {
              message: error ?? '',
            })}
          </span>
        )}
      </div>
      <p
        className={`paper-export__caption${pngTooLarge ? ' paper-export__caption--error' : ''}`}
        aria-live="polite"
      >
        {pngTooLarge && pngSize
          ? t(
              'dialogs:paperExport.pngTooLarge',
              'Too large to export as PNG: {{width}} × {{height}} px. Lower the resolution or the sheet size.',
              { width: number(pngSize.width), height: number(pngSize.height) }
            )
          : parts.join(' · ')}
      </p>
    </div>
  );
}
