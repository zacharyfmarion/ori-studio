import { useTranslation } from 'react-i18next';
import type { AnnotateTool } from '../../diagram/annotate/annotateTools';
import { annotateToolParameters, type AnnotateToolParameter } from '../../diagram/annotate/annotateToolParameters';
import type { CircleDrawingMode } from '../../diagram/annotate/circleDrawing';
import { useSettingsStore } from '../../store/settingsStore';
import { SegmentedControl } from '../ui/SegmentedControl';
import { DiagramStarFillControl } from './DiagramStarFillControl';
import { DiagramTextStyleControl } from './DiagramTextStyleControl';
import styles from './DiagramAnnotateToolParameters.module.css';

/** Each parameter owns its bindings; the window just composes these beside instructions. */
export function DiagramAnnotateToolParameters({ tool }: { tool: AnnotateTool }) {
  return annotateToolParameters(tool).map((parameter) => <Parameter key={parameter} parameter={parameter} />);
}

function Parameter({ parameter }: { parameter: AnnotateToolParameter }) {
  const { t } = useTranslation();
  const labels = {
    'text-style': t('panels:diagram.annotate.textStyle', 'Text Style'),
    'star-fill': t('panels:diagram.annotate.starFill', 'Star Fill'),
    'circle-mode': t('panels:diagram.annotate.circleMode', 'Draw circle'),
  };
  const label = labels[parameter];
  const controls = {
    'text-style': <DiagramTextStyleControl disabled={false} />,
    'star-fill': <DiagramStarFillControl label={label} disabled={false} />,
    'circle-mode': <CircleModeControl label={label} />,
  };
  return (
    <fieldset className={styles.parameter} aria-label={label}>
      <legend className={styles.heading}>{label}</legend>
      {controls[parameter]}
    </fieldset>
  );
}

function CircleModeControl({ label }: { label: string }) {
  const { t } = useTranslation();
  const mode = useSettingsStore((state) => state.diagramAnnotateCircleMode);
  const setMode = useSettingsStore((state) => state.setDiagramAnnotateCircleMode);
  return (
    <SegmentedControl<CircleDrawingMode>
      size="sm"
      fill
      aria-label={label}
      value={mode}
      options={[
        { value: 'bounds', label: t('panels:diagram.annotate.circleBounds', 'Bounds') },
        { value: 'center', label: t('panels:diagram.annotate.circleCenter', 'Center') },
      ]}
      onChange={setMode}
    />
  );
}
