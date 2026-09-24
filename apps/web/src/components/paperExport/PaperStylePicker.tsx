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
  id,
}: {
  value: PaperExportStyleChoice;
  onChange: (value: PaperExportStyleChoice) => void;
  id?: string;
}) {
  const { t } = useTranslation();
  const paperStyle = useSettingsStore((state) => state.paperStyle);
  const rows = useMemo(() => paperPresetRows(paperStyle.presets), [paperStyle.presets]);
  const slot = useMemo(() => paperSlotPreset(paperStyle, 'export', rows), [paperStyle, rows]);
  const label = t('dialogs:paperExport.style', 'Style');
  return (
    <div className="export-modal__control-group">
      <span className="export-modal__label">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} aria-label={label} className="export-modal__select">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={PAPER_EXPORT_STYLE_SLOT}>
            {exportStyleEntryLabel(t, slot, { fromDisplay: paperStyle.export === null })}
          </SelectItem>
          {rows.map((row) => (
            <SelectItem key={row.key} value={row.key}>
              {paperPresetRowLabel(t, row)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
