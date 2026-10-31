import { useTranslation } from 'react-i18next';
import type { SpreadPresentation } from '../../layer-spread/presentation';
import { SelectRow } from '../ui/fieldRows';
export function SpreadPresentationRow({
  value,
  onChange,
  disabled = false,
}: {
  value: SpreadPresentation['kind'];
  onChange: (kind: SpreadPresentation['kind']) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <SelectRow
      label={t('panels:diagram.spread.presentation', 'Presentation')}
      value={value}
      disabled={disabled}
      onChange={(kind) => onChange(kind as SpreadPresentation['kind'])}
      options={[
        { id: 'diagram', label: t('panels:diagram.spread.diagram', 'Diagram') },
        { id: 'perspective', label: t('panels:diagram.spread.perspective', 'Perspective 3D') },
      ]}
    />
  );
}
