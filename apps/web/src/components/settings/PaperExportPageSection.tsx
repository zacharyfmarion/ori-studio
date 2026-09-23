/**
 * The export page: what is behind the artwork, whether buried faces are kept,
 * how big the sheet is and how dense a PNG is. The Simulate pane's Export group
 * binds the first three of these to the same store.
 *
 * Last on the tab, and outside the slot's own fields: a page is not part of a
 * style — the same picture goes out on any page — so it stays live while the
 * export *style* is following display.
 */
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_PAPER_BACKGROUND,
  sheetMmOf,
  usePaperExportPage,
} from '../../hooks/usePaperExportPage';
import { PAPER_PADDING_MM_RANGE, PAPER_SHEET_MM_RANGE } from '../../lib/paper/paperPage';
import { PAPER_PNG_DPI_RANGE } from '../../lib/paper/paperPng';
import { ColorField } from '../ui/ColorField';
import { NumberField } from '../ui/NumberField';
import { PaperSection } from './PaperSection';
import { SettingsToggleRow } from './SettingsToggleRow';

export function PaperExportPageSection() {
  const { t } = useTranslation();
  const exportPage = usePaperExportPage();
  const { page } = exportPage;
  return (
    <PaperSection
      title={t('dialogs:settings.paper.exportPage.title', 'Export page')}
      testId="settings-paper-export"
    >
      <div className="settings-paper__card">
        <SettingsToggleRow
          label={t('dialogs:settings.paper.exportPage.transparent', 'Transparent background')}
          description={t(
            'dialogs:settings.paper.exportPage.transparentHint',
            'Off, the page is filled with a color behind the paper.'
          )}
          checked={page.background === null}
          onChange={(transparent) =>
            exportPage.setBackground(transparent ? null : DEFAULT_PAPER_BACKGROUND)
          }
        />
        {page.background !== null && (
          <div className="settings-paper-swatches">
            <ColorField
              layout="inline"
              label={t('dialogs:settings.paper.exportPage.background', 'Background')}
              value={page.background}
              onChange={exportPage.setBackground}
            />
          </div>
        )}
        <SettingsToggleRow
          label={t('dialogs:settings.paper.exportPage.keepHiddenFaces', 'Keep hidden faces')}
          description={t(
            'dialogs:settings.paper.exportPage.keepHiddenFacesHint',
            'Faces nothing shows stay in the file under what covers them, so deleting a face in a drawing editor reveals the one beneath.'
          )}
          checked={page.keepHiddenFaces}
          onChange={exportPage.setKeepHiddenFaces}
        />
        <SettingsToggleRow
          label={t('dialogs:settings.paper.exportPage.sheetAsShown', 'Sheet size as shown')}
          description={t(
            'dialogs:settings.paper.exportPage.sheetAsShownHint',
            'The paper is the size it is on screen. Off, the unfolded sheet spans a size in mm; lines keep their widths.'
          )}
          checked={page.sheet === 'as-shown'}
          onChange={exportPage.setSheetAsShown}
        />
        {page.sheet !== 'as-shown' && (
          <FieldRow
            label={t('dialogs:settings.paper.exportPage.sheetMm', 'Sheet size')}
            description={t(
              'dialogs:settings.paper.exportPage.sheetMmHint',
              'The unfolded sheet, edge to edge.'
            )}
          >
            {(id, label) => (
              <NumberField
                id={id}
                label={label}
                value={sheetMmOf(page.sheet)}
                min={PAPER_SHEET_MM_RANGE.min}
                max={PAPER_SHEET_MM_RANGE.max}
                step={PAPER_SHEET_MM_RANGE.step}
                suffix="mm"
                onCommit={exportPage.setSheetMm}
              />
            )}
          </FieldRow>
        )}
        <FieldRow
          label={t('dialogs:settings.paper.exportPage.padding', 'Margin')}
          description={t(
            'dialogs:settings.paper.exportPage.paddingHint',
            'Around the artwork, on every side.'
          )}
        >
          {(id, label) => (
            <NumberField
              id={id}
              label={label}
              value={page.paddingMm}
              min={PAPER_PADDING_MM_RANGE.min}
              max={PAPER_PADDING_MM_RANGE.max}
              step={PAPER_PADDING_MM_RANGE.step}
              suffix="mm"
              onCommit={exportPage.setPaddingMm}
            />
          )}
        </FieldRow>
        <FieldRow
          label={t('dialogs:settings.paper.exportPage.pngDpi', 'PNG density')}
          description={t(
            'dialogs:settings.paper.exportPage.pngDpiHint',
            'Dots per inch of the page; 96 is the screen.'
          )}
        >
          {(id, label) => (
            <NumberField
              id={id}
              label={label}
              value={page.pngDpi}
              min={PAPER_PNG_DPI_RANGE.min}
              max={PAPER_PNG_DPI_RANGE.max}
              step={PAPER_PNG_DPI_RANGE.step}
              suffix="dpi"
              onCommit={exportPage.setPngDpi}
            />
          )}
        </FieldRow>
      </div>
    </PaperSection>
  );
}

/** The modal's field row — copy left, control right — for a number that needs a line of explanation. */
function FieldRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: (id: string, label: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="settings-toggle-row settings-toggle-row--field">
      <span className="settings-toggle-row__copy">
        <label className="settings-toggle-row__label" htmlFor={id}>
          {label}
        </label>
        <span className="settings-toggle-row__desc">{description}</span>
      </span>
      <span className="settings-toggle-row__field">{children(id, label)}</span>
    </div>
  );
}
