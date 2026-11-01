/**
 * Which style an export paints with: the Settings export slot, named by what it
 * holds ("Export style · Default · modified", "Export style · Default, from
 * display"), or any preset.
 *
 * The slot is named by the words Settings ▸ Paper's chip is
 * (`paperSlotChipLabel`), so the two cannot disagree about what "the export
 * style" is. The pick is for the export in hand and the next one of its kind;
 * the slot itself is only ever changed in Settings.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { paperStyleFieldLabel } from '../../i18n/enumLabels';
import { PAPER_STYLE_FIELDS, type PaperStyleOverrides } from '../../lib/paper/paperStyle';
import { PAPER_EXPORT_STYLE_SLOT, type PaperExportStyleChoice } from '../../lib/paperExportSettings';
import {
  paperPresetRowLabel,
  paperPresetRows,
  paperSlotChipLabel,
  paperSlotPreset,
  type PaperSlotPreset,
} from '../../lib/paperPresetRows';
import { useSettingsStore } from '../../store/settingsStore';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select';
import { SelectRow, type SelectRowOption } from '../ui/fieldRows';
import styles from './PaperStylePicker.module.css';

/**
 * What an object's own pins keep whichever style it is exported in, as a line
 * under the picker; null for an object that pins nothing.
 */
export function paperExportPinsHint(
  t: TFunction,
  language: string,
  pins: PaperStyleOverrides | null | undefined
): string | null {
  const fields = PAPER_STYLE_FIELDS.filter((field) => pins?.[field] !== undefined);
  if (fields.length === 0) return null;
  const list = new Intl.ListFormat(language, { type: 'conjunction' }).format(
    fields.map((field) => paperStyleFieldLabel(t, field))
  );
  return t('dialogs:paperExport.pinsHint', 'Keeps its own {{fields}}, whichever style is picked.', {
    fields: list,
  });
}

/** The export slot's entry: "Export style ·" and the slot's style as the Settings chip names it. */
export function exportStyleEntryLabel(
  t: TFunction,
  slot: PaperSlotPreset,
  { fromDisplay }: { fromDisplay: boolean }
): string {
  const style = paperSlotChipLabel(t, slot, { fromDisplay });
  return t('dialogs:paperExport.exportStyle', 'Export style · {{style}}', { style });
}

export function PaperStylePicker({
  value,
  onChange,
  hint = null,
  id,
}: {
  value: PaperExportStyleChoice;
  onChange: (value: PaperExportStyleChoice) => void;
  /** A line under the picker: what of the style the picture keeps of its own, or cannot take. */
  hint?: string | null;
  id?: string;
}) {
  const { t } = useTranslation();
  const choices = usePaperStyleChoices();
  const label = t('dialogs:paperExport.style', 'Style');
  return (
    <div className="export-modal__control-group">
      <div className={styles.row}>
        <span className="export-modal__label">{label}</span>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger
            id={id}
            aria-label={label}
            className={`export-modal__select ${styles.select}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {choices.map((choice) => (
              <SelectItem key={choice.id} value={choice.id}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {hint && <small className="export-modal__hint">{hint}</small>}
    </div>
  );
}

/**
 * The same choice as a row of an options pane (`SelectRow`): the folded-figure
 * sections of the Export crease pattern dialog and the Share modal, whose
 * rows are FieldRows as the Diagram export's and the sidebars' are.
 */
export function PaperStyleRow({
  value,
  onChange,
}: {
  value: PaperExportStyleChoice;
  onChange: (value: PaperExportStyleChoice) => void;
}) {
  const { t } = useTranslation();
  const choices = usePaperStyleChoices();
  return (
    <SelectRow label={t('dialogs:paperExport.style', 'Style')} value={value} options={choices} onChange={onChange} />
  );
}

/** The styles an export can pick, as the picker and the row offer them: the export slot first, then every preset. */
function usePaperStyleChoices(): SelectRowOption[] {
  const { t } = useTranslation();
  const paperStyle = useSettingsStore((state) => state.paperStyle);
  const rows = useMemo(() => paperPresetRows(paperStyle.presets), [paperStyle.presets]);
  const slot = useMemo(() => paperSlotPreset(paperStyle, 'export', rows), [paperStyle, rows]);
  return useMemo(
    () => [
      {
        id: PAPER_EXPORT_STYLE_SLOT,
        label: exportStyleEntryLabel(t, slot, { fromDisplay: paperStyle.export === null }),
      },
      ...rows.map((row) => ({ id: row.key, label: paperPresetRowLabel(t, row) })),
    ],
    [t, slot, paperStyle.export, rows]
  );
}
