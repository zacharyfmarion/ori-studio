/**
 * The export dialog's options: format, style, the diagram's marks, size, page.
 *
 * Presentation over the dialog's draft (`usePaperExportDialog`): every control
 * patches the draft and nothing else, so the preview beside it is the whole of
 * what a change does. A row that would do nothing is not shown — Resolution for
 * an SVG, Keep hidden faces for a PNG or for a picture with nothing buried in
 * it, the Diagram section for a picture with no marks to leave out.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_PAPER_BACKGROUND,
  PAPER_PADDING_MM_RANGE,
  PAPER_SHEET_MM_RANGE,
  type PaperSizeMeasure,
} from '../../lib/paper/paperPage';
import { PAPER_PNG_DPI_RANGE } from '../../lib/paper/paperPng';
import type {
  PaperExportFormat,
  PaperExportMark,
  PaperExportSettings,
} from '../../lib/paperExportSettings';
import type { PaperExportScope } from '../../paperExport/paperExportTarget';
import type { PaperExportDialogBinding } from '../../paperExport/usePaperExportDialog';
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

export function PaperExportOptions({
  draft,
  patch,
  buriesFaces,
  sizeMeasures,
  marks,
  scopes,
  fixed,
  styleHint,
}: {
  draft: PaperExportSettings;
  patch: (next: Partial<PaperExportSettings>) => void;
  /** The picture can have buried faces; false hides Keep hidden faces. */
  buriesFaces: boolean;
  /** What its size measures (`PaperExportTarget.sizeMeasures`): the sheet or the figure, which the hint says. */
  sizeMeasures: PaperSizeMeasure;
  /** The marks the picture can be exported without (`PaperExportTarget.marks`); none hides the Diagram section. */
  marks: readonly PaperExportMark[];
  /** The step on show or every step, for a target with several; null hides the choice. */
  scopes: PaperExportDialogBinding['scopes'];
  /** The picture cannot be restyled or re-paged: only the format is offered. */
  fixed: boolean;
  /** Under the style picker: what of the style the picture keeps of its own, or cannot take. */
  styleHint: string | null;
}) {
  const { t } = useTranslation();
  const png = draft.format === 'png';
  const [customDpi, setCustomDpi] = useState(
    () => !(PAPER_EXPORT_DPI_PRESETS as readonly number[]).includes(draft.pngDpi)
  );
  const dpiValue = customDpi ? CUSTOM : String(draft.pngDpi);
  const markRow = (mark: PaperExportMark, label: string, hint: string) =>
    marks.includes(mark) && (
      <div className="export-modal__toggle-row">
        <div className="export-modal__toggle-copy">
          <span>{label}</span>
          <small className="export-modal__hint">{hint}</small>
        </div>
        <Toggle
          checked={draft.marks[mark]}
          onChange={(shown) => patch({ marks: { ...draft.marks, [mark]: shown } })}
          aria-label={label}
        />
      </div>
    );

  const formatSection = (
    <section className="export-modal__section">
      <div className="export-modal__field-row">
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
  );

  if (fixed) {
    return (
      <>
        {formatSection}
        <section className="export-modal__section">
          <small className="export-modal__hint">
            {t(
              'dialogs:paperExport.fixedHint',
              'This figure is exported as it was saved: its style and page are the ones it was drawn with. Fold it again to export it in a style, at a size and on a page of your choosing.'
            )}
          </small>
        </section>
      </>
    );
  }

  return (
    <>
      {scopes && (
        <section className="export-modal__section">
          <div className="export-modal__field-row">
            <span className="export-modal__label">{t('dialogs:paperExport.scope', 'Steps')}</span>
            <SegmentedControl<PaperExportScope>
              aria-label={t('dialogs:paperExport.scope', 'Steps')}
              value={scopes.scope}
              onChange={scopes.setScope}
              options={[
                { value: 'this', label: t('dialogs:paperExport.scopeThis', 'This step') },
                { value: 'all', label: t('dialogs:paperExport.scopeAll', 'All steps') },
              ]}
            />
          </div>
        </section>
      )}
      {formatSection}

      <section className="export-modal__section">
        <PaperStylePicker
          value={draft.style}
          onChange={(style) => patch({ style })}
          hint={styleHint}
        />
      </section>

      {marks.length > 0 && (
        <section className="export-modal__section">
          <span className="export-modal__label">{t('dialogs:paperExport.marks', 'Marks')}</span>
          {markRow(
            'letters',
            t('dialogs:paperExport.letters', 'Letters'),
            t('dialogs:paperExport.lettersHint', 'The names of the points a step refers to.')
          )}
          {markRow(
            'highlights',
            t('dialogs:paperExport.highlights', 'Line highlights'),
            t('dialogs:paperExport.highlightsHint', 'The accent over the lines a step lines up.')
          )}
        </section>
      )}

      {/* Size, Margin and Resolution are rows of one kind — the label on the
          left, a control of one width on the right — so the controls line up
          under one another. */}
      <section className="export-modal__section">
        <div className="export-modal__control-group">
          <div className="export-modal__field-row">
            <span className="export-modal__label">{t('dialogs:paperExport.size', 'Size')}</span>
            <NumberField
              label={
                sizeMeasures === 'figure'
                  ? t('dialogs:paperExport.figureMm', 'Figure size')
                  : t('dialogs:paperExport.sheetMm', 'Sheet size')
              }
              value={draft.sheet.mm}
              min={PAPER_SHEET_MM_RANGE.min}
              max={PAPER_SHEET_MM_RANGE.max}
              step={PAPER_SHEET_MM_RANGE.step}
              suffix="mm"
              onCommit={(mm) => patch({ sheet: { mm } })}
            />
          </div>
          <small className="export-modal__hint">
            {sizeMeasures === 'figure'
              ? t(
                  'dialogs:paperExport.figureSizeHint',
                  'The figure spans this size across its longer side. Lines keep their widths.'
                )
              : t(
                  'dialogs:paperExport.sheetSizeHint',
                  'The unfolded sheet spans this size, edge to edge. Lines keep their widths.'
                )}
          </small>
        </div>
        <div className="export-modal__field-row">
          <span className="export-modal__label">
            {t('dialogs:paperExport.padding', 'Margin')}
          </span>
          <NumberField
            label={t('dialogs:paperExport.padding', 'Margin')}
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
            <div className="export-modal__field-row">
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
            </div>
            {/* The Resolution row's second line: the menu's own label names it. */}
            {customDpi && (
              <div className="export-modal__field-row">
                <NumberField
                  label={t('dialogs:paperExport.resolutionDpiField', 'Resolution in dpi')}
                  value={draft.pngDpi}
                  min={PAPER_PNG_DPI_RANGE.min}
                  max={PAPER_PNG_DPI_RANGE.max}
                  step={PAPER_PNG_DPI_RANGE.step}
                  suffix="dpi"
                  onCommit={(pngDpi) => patch({ pngDpi })}
                />
              </div>
            )}
          </div>
        )}
      </section>

      <section className="export-modal__section">
        <span className="export-modal__label">{t('dialogs:paperExport.page', 'Page')}</span>
        <div className="export-modal__toggle-row">
          <div className="export-modal__toggle-copy">
            <span>
              {t('dialogs:paperExport.transparent', 'Transparent background')}
            </span>
          </div>
          <Toggle
            checked={draft.background === null}
            onChange={(transparent) =>
              patch({ background: transparent ? null : DEFAULT_PAPER_BACKGROUND })
            }
            aria-label={t('dialogs:paperExport.transparent', 'Transparent background')}
          />
        </div>
        {draft.background !== null && (
          <ColorField
            layout="inline"
            showValue
            label={t('dialogs:paperExport.background', 'Background')}
            value={draft.background}
            onChange={(background) => patch({ background })}
          />
        )}
        {!png && buriesFaces && (
          <div className="export-modal__toggle-row">
            <div className="export-modal__toggle-copy">
              <span>{t('dialogs:paperExport.keepHiddenFaces', 'Keep hidden faces')}</span>
              <small className="export-modal__hint">
                {t(
                  'dialogs:paperExport.keepHiddenFacesHint',
                  'Faces nothing shows stay in the file under what covers them, so deleting a face in a drawing editor reveals the one beneath.'
                )}
              </small>
            </div>
            <Toggle
              checked={draft.keepHiddenFaces}
              onChange={(keepHiddenFaces) => patch({ keepHiddenFaces })}
              aria-label={t('dialogs:paperExport.keepHiddenFaces', 'Keep hidden faces')}
            />
          </div>
        )}
      </section>
    </>
  );
}
