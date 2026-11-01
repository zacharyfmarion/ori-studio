import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SpreadPresentation } from '../../layer-spread/presentation';
import { SelectRow } from '../ui/fieldRows';
export function SpreadPresentationRow({
  value,
  onChange,
  disabled = false,
}: {
  value: SpreadPresentation['kind'];
  onChange: (kind: SpreadPresentation['kind']) => Promise<void>;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<SpreadPresentation['kind'] | null>(null);
  const revision = useRef(0);
  return (
    <SelectRow
      label={t('panels:diagram.spread.presentation', 'Presentation')}
      value={pending ?? value}
      disabled={disabled}
      onChange={(next) => {
        const kind = next as SpreadPresentation['kind'];
        const token = ++revision.current;
        setPending(kind);
        void onChange(kind).finally(() => {
          if (revision.current === token) setPending(null);
        });
      }}
      options={[
        { id: 'diagram', label: t('panels:diagram.spread.diagram', 'Diagram') },
        { id: 'perspective', label: t('panels:diagram.spread.perspective', 'Perspective 3D') },
      ]}
    />
  );
}
