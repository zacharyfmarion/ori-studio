import { useTranslation } from 'react-i18next';
import type { DiagramStyleChoice } from '../../diagram/pages/diagramStyleChoices';
import type { DiagramStyle } from '../../diagram/document/diagramDocument';
import { PaperStyleChoiceRow } from '../paper/PaperStyleChoiceRow';

/**
 * The diagram's paper style (D9): a built-in, the export style from Settings,
 * or a preset saved there — the last two copied into the diagram as they are
 * when chosen. The picker is a document's own paper style's
 * (`PaperStyleChoiceRow`), which Fold's Paper tab picks a sequence's with.
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
  return (
    <PaperStyleChoiceRow
      value={value}
      disabled={disabled}
      label={t('panels:diagram.pagePane.style', 'Style')}
      help={t(
        'panels:diagram.pagePane.styleHint',
        'Ink and pens change on every step at once. A 3D step takes a new light when it is refreshed.'
      )}
      keptLabel={t('panels:diagram.pagePane.keptStyle', 'This diagram’s own')}
      onChange={onChange}
    />
  );
}
