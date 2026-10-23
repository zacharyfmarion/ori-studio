import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { paperPresetLabel } from '../../i18n/enumLabels';
import {
  chosenDocumentPaperStyle,
  documentPaperStyleChoices,
  EXPORT_STYLE_CHOICE,
  type DocumentPaperStyle,
  type DocumentPaperStyleChoice,
} from '../../lib/paper/documentPaperStyle';
import { useSettingsStore } from '../../store/settingsStore';
import { SelectRow } from '../ui/fieldRows';

/** The entry for a style no choice holds now: the document's own, kept as it is. */
const KEPT = 'kept';

/**
 * A document's paper style, picked as the Diagram's Page pane and Fold's Paper
 * tab pick theirs: a built-in, the export style from Settings, or a preset
 * saved there — the last two copied into the document as they are when
 * chosen (`lib/paper/documentPaperStyle`). Its value is the document's own
 * style, not a key into this machine's settings, which is why it is not the
 * export dialog's picker. A style none of the choices holds now (a preset
 * since edited, or one saved elsewhere) shows as `keptLabel`.
 */
export function PaperStyleChoiceRow({
  value,
  disabled,
  label,
  help,
  keptLabel,
  onChange,
}: {
  value: DocumentPaperStyle;
  disabled: boolean;
  label: string;
  help?: string;
  /** What a style none of the choices holds is called: the document's own. */
  keptLabel: string;
  onChange: (choice: DocumentPaperStyleChoice) => void;
}) {
  const { t } = useTranslation();
  const paperStyle = useSettingsStore((state) => state.paperStyle);
  const choices = useMemo(() => documentPaperStyleChoices(paperStyle), [paperStyle]);
  const chosen = chosenDocumentPaperStyle(value, choices);
  const name = (choice: DocumentPaperStyleChoice) =>
    choice.builtIn
      ? paperPresetLabel(t, choice.builtIn)
      : choice.id === EXPORT_STYLE_CHOICE
        ? t('panels:diagram.pagePane.exportStyle', 'Export style from Settings')
        : (choice.presetName ?? '');
  const options = [
    ...choices.map((choice) => ({ id: choice.id, label: name(choice) })),
    ...(chosen ? [] : [{ id: KEPT, label: keptLabel }]),
  ];
  return (
    <SelectRow
      label={label}
      value={chosen?.id ?? KEPT}
      options={options}
      disabled={disabled}
      help={help}
      onChange={(id) => {
        const choice = choices.find((entry) => entry.id === id);
        if (choice) onChange(choice);
      }}
    />
  );
}
