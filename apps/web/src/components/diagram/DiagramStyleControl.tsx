import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  chosenDiagramStyle,
  diagramStyleChoices,
  EXPORT_STYLE_CHOICE,
  type DiagramStyleChoice,
} from '../../diagram/pages/diagramStyleChoices';
import type { DiagramStyle } from '../../diagram/document/diagramDocument';
import { paperPresetLabel } from '../../i18n/enumLabels';
import { useSettingsStore } from '../../store/settingsStore';
import { SelectRow } from '../ui/fieldRows';

/** The entry for a style no choice holds now: the diagram's own, kept as it is. */
const KEPT = 'kept';

/**
 * The diagram's paper style (D9): a built-in, the export style from Settings,
 * or a preset saved there — the last two copied into the diagram as they are
 * when chosen. Its value is the diagram's own style, not a key into this
 * machine's settings, which is why it is not the export dialog's picker.
 */
export function DiagramStyleControl({
  value,
  disabled,
  onChange,
}: {
  value: DiagramStyle;
  disabled: boolean;
  onChange: (choice: DiagramStyleChoice) => void;
}) {
  const { t } = useTranslation();
  const paperStyle = useSettingsStore((state) => state.paperStyle);
  const choices = useMemo(() => diagramStyleChoices(paperStyle), [paperStyle]);
  const chosen = chosenDiagramStyle(value, choices);
  const label = (choice: DiagramStyleChoice) =>
    choice.builtIn
      ? paperPresetLabel(t, choice.builtIn)
      : choice.id === EXPORT_STYLE_CHOICE
        ? t('panels:diagram.pagePane.exportStyle', 'Export style from Settings')
        : (choice.presetName ?? '');
  const options = [
    ...choices.map((choice) => ({ id: choice.id, label: label(choice) })),
    ...(chosen ? [] : [{ id: KEPT, label: t('panels:diagram.pagePane.keptStyle', 'This diagram’s own') }]),
  ];
  return (
    <SelectRow
      label={t('panels:diagram.pagePane.style', 'Style')}
      value={chosen?.id ?? KEPT}
      options={options}
      disabled={disabled}
      title={t(
        'panels:diagram.pagePane.styleHint',
        'Ink and pens change on every step at once. A 3D step takes a new light when it is refreshed.'
      )}
      onChange={(id) => {
        const choice = choices.find((entry) => entry.id === id);
        if (choice) onChange(choice);
      }}
    />
  );
}
