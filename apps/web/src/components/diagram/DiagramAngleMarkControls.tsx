import { useTranslation } from 'react-i18next';
import { ANGLE_RADIUS_MM, angleRadiusMm, angleRadiusWithin } from '../../diagram/annotate/angleMarkStyle';
import type { KnownDiagramAnnotation } from '../../diagram/document/diagramDocument';
import { NumberRow, ToggleRow } from '../ui/fieldRows';

/** The bisector's equal-angle indicator; hiding it keeps it editable in Layers. */
export function DiagramAngleMarkControls({
  annotation,
  editable,
  onVisible,
  onRadius,
}: {
  annotation: KnownDiagramAnnotation;
  editable: boolean;
  onVisible: (visible: boolean) => void;
  onRadius: (radius: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <ToggleRow
        label={t('panels:diagram.annotations.showEqualAngles', 'Show equal angles')}
        checked={!annotation.hidden}
        disabled={!editable}
        onChange={onVisible}
      />
      <NumberRow
        label={t('panels:diagram.annotations.angleRadius', 'Indicator radius')}
        value={angleRadiusMm(annotation)}
        min={ANGLE_RADIUS_MM.min}
        max={ANGLE_RADIUS_MM.max}
        step={ANGLE_RADIUS_MM.step}
        suffix="mm"
        disabled={!editable || annotation.hidden}
        normalize={angleRadiusWithin}
        onCommit={onRadius}
      />
    </>
  );
}
