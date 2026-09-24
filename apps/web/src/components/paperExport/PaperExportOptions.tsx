/**
 * The export dialog's options: format, style, size, page.
 *
 * Presentation over the dialog's draft (`usePaperExportDialog`): every control
 * patches the draft and nothing else, so the preview beside it is the whole of
 * what a change does. A row that would do nothing is not shown — Resolution for
 * an SVG, Keep hidden faces for a PNG or for a picture with nothing buried in it.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_PAPER_BACKGROUND,
  DEFAULT_PAPER_SHEET_MM,
  PAPER_PADDING_MM_RANGE,
  PAPER_SHEET_MM_RANGE,
  sheetMmOf,
} from '../../lib/paper/paperPage';
import { PAPER_PNG_DPI_RANGE } from '../../lib/paper/paperPng';
import type { PaperExportFormat, PaperExportSettings } from '../../lib/paperExportSettings';
import { ColorField } from '../ui/ColorField';
import { NumberField } from '../ui/NumberField';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select';
import { Toggle } from '../ui/Toggle';
import { PaperStylePicker } from './PaperStylePicker';

/** The densities the Resolution menu names; anything else is Custom. */
export const PAPER_EXPORT_DPI_PRESETS = [96, 192, 288, 384, 300, 600] as const;

const SCREEN_DPI = 96;

const CUSTOM = 'custom';

type SheetMode = 'as-shown' | 'custom';

export function PaperExportOptions({
  draft,
  patch,
  buriesFaces,
}: {
  draft: PaperExportSettings;
  patch: (next: Partial<PaperExportSettings>) => void;
  /** The picture can have buried faces; false hides Keep hidden faces. */
  buriesFaces: boolean;
}) {
  const { t } = useTranslation();
  const png = draft.format === 'png';
  const [customDpi, setCustomDpi] = useState(
    () => !(PAPER_EXPORT_DPI_PRESETS as readonly number[]).includes(draft.pngDpi)
  );
  const dpiValue = customDpi ? CUSTOM : String(draft.pngDpi);
  const sheetMode: SheetMode = draft.sheet === 'as-shown' ? 'as-shown' : 'custom';

  return (
    <>
      <section className="export-modal__section">
        <div className="export-modal__control-group">
          <span className="export-modal__label">{t('dialogs:paperExport.format', 'Format')}</span>
          <SegmentedControl<PaperExportFormat>
            aria-label={t('dialogs:paperExport.format', 'Format')}
            value={draft.format}
            onChange={(format) => patch({ format })}
            options={[
              { value: 'svg', label: 'SVG' },
              { value: 'png', label: 'PNG' },
            ]}
          />
        </div>
      </section>

      <section className="export-modal__section">
        <PaperStylePicker value={draft.style} onChange={(style) => patch({ style })} />
      </section>

      <section className="export-modal__section">
        <span className="export-modal__label">{t('dialogs:paperExport.size', 'Size')}</span>
        <div className="export-modal__control-group">
          <SegmentedControl<SheetMode>
            aria-label={t('dialogs:paperExport.sheet', 'Sheet')}
            value={sheetMode}
            onChange={(mode) =>
              patch({ sheet: mode === 'as-shown' ? 'as-shown' : { mm: sheetMmOf(draft.sheet) } })
            }
            options={[
              { value: 'as-shown', label: t('dialogs:paperExport.sheetAsShown', 'As shown') },
              { value: 'custom', label: t('dialogs:paperExport.sheetCustom', 'Custom') },
            ]}
          />
          {sheetMode === 'custom' && (
            <NumberField
              label={t('dialogs:settings.paper.exportPage.sheetMm', 'Sheet size')}
              value={draft.sheet === 'as-shown' ? DEFAULT_PAPER_SHEET_MM : draft.sheet.mm}
              min={PAPER_SHEET_MM_RANGE.min}
              max={PAPER_SHEET_MM_RANGE.max}
              step={PAPER_SHEET_MM_RANGE.step}
              suffix="mm"
              onCommit={(mm) => patch({ sheet: { mm } })}
            />
          )}
          <small className="export-modal__hint">
            {sheetMode === 'as-shown'
              ? t('dialogs:paperExport.sheetAsShownHint', 'The size it is on screen, at the current zoom.')
              : t(
                  'dialogs:paperExport.sheetCustomHint',
                  'The unfolded sheet spans this size, edge to edge. Lines keep their widths.'
                )}
          </small>
        </div>
        <div className="export-modal__field-row">
          <span className="export-modal__label">
            {t('dialogs:settings.paper.exportPage.padding', 'Margin')}
          </span>
          <NumberField
            label={t('dialogs:settings.paper.exportPage.padding', 'Margin')}
            value={draft.paddingMm}
            min={PAPER_PADDING_MM_RANGE.min}
            max={PAPER_PADDING_MM_RANGE.max}
            step={PAPER_PADDING_MM_RANGE.step}
            suffix="mm"
            onCommit={(paddingMm) => patch({ paddingMm })}
          />
        </div>
        {png && (
          <div className="export-modal__control-group">
            <span className="export-modal__label">
              {t('dialogs:paperExport.resolution', 'Resolution')}
            </span>
            <Select
              value={dpiValue}
              onValueChange={(next) => {
                if (next === CUSTOM) {
                  setCustomDpi(true);
                  return;
                }
                setCustomDpi(false);
                patch({ pngDpi: Number(next) });
              }}
            >
              <SelectTrigger
                aria-label={t('dialogs:paperExport.resolution', 'Resolution')}
                className="export-modal__select"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAPER_EXPORT_DPI_PRESETS.map((dpi) => (
                  <SelectItem key={dpi} value={String(dpi)}>
                    {dpi % SCREEN_DPI === 0
                      ? t('dialogs:paperExport.resolutionScale', '{{scale}}× · {{dpi}} dpi', {
                          scale: dpi / SCREEN_DPI,
                          dpi,
                        })
                      : t('dialogs:paperExport.resolutionDpi', '{{dpi}} dpi', { dpi })}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM}>
                  {t('dialogs:paperExport.resolutionCustom', 'Custom')}
                </SelectItem>
              </SelectContent>
            </Select>
            {customDpi && (
              <NumberField
                label={t('dialogs:paperExport.resolutionDpiField', 'Resolution in dpi')}
                value={draft.pngDpi}
                min={PAPER_PNG_DPI_RANGE.min}
                max={PAPER_PNG_DPI_RANGE.max}
                step={PAPER_PNG_DPI_RANGE.step}
                suffix="dpi"
                onCommit={(pngDpi) => patch({ pngDpi })}
              />
            )}
          </div>
        )}
      </section>

      <section className="export-modal__section">
        <span className="export-modal__label">{t('dialogs:paperExport.page', 'Page')}</span>
        <div className="export-modal__toggle-row">
          <div className="export-modal__toggle-copy">
            <span>
              {t('dialogs:settings.paper.exportPage.transparent', 'Transparent background')}
            </span>
          </div>
          <Toggle
            checked={draft.background === null}
            onChange={(transparent) =>
              patch({ background: transparent ? null : DEFAULT_PAPER_BACKGROUND })
            }
            aria-label={t('dialogs:settings.paper.exportPage.transparent', 'Transparent background')}
          />
        </div>
        {draft.background !== null && (
          <ColorField
            layout="inline"
            showValue
            label={t('dialogs:settings.paper.exportPage.background', 'Background')}
            value={draft.background}
            onChange={(background) => patch({ background })}
          />
        )}
        {!png && buriesFaces && (
          <div className="export-modal__toggle-row">
            <div className="export-modal__toggle-copy">
              <span>{t('dialogs:settings.paper.exportPage.keepHiddenFaces', 'Keep hidden faces')}</span>
              <small className="export-modal__hint">
                {t(
                  'dialogs:settings.paper.exportPage.keepHiddenFacesHint',
                  'Faces nothing shows stay in the file under what covers them, so deleting a face in a drawing editor reveals the one beneath.'
                )}
              </small>
            </div>
            <Toggle
              checked={draft.keepHiddenFaces}
              onChange={(keepHiddenFaces) => patch({ keepHiddenFaces })}
              aria-label={t('dialogs:settings.paper.exportPage.keepHiddenFaces', 'Keep hidden faces')}
            />
          </div>
        )}
      </section>
    </>
  );
}
