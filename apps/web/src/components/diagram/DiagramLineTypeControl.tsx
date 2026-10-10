import { useTranslation } from 'react-i18next';
import { LINE_TYPE_SHORTCUTS, lineTypeLabel } from '../../diagram/annotate/annotateTools';
import { annotationInkColor } from '../../diagram/annotate/annotationPrimitives';
import { DIAGRAM_LINE_TYPES, type DiagramLineType } from '../../diagram/annotate/lineTypes';
import { DEFAULT_DIAGRAM_STYLE } from '../../diagram/document/diagramDocument';
import { shortcutLabelForAction } from '../../keyboard/shortcuts';
import { useSettingsStore } from '../../store/settingsStore';
import { useShortcutResolution } from '../../store/shortcutStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { FieldRow } from '../ui/fieldRows';
import { SegmentedControl } from '../ui/SegmentedControl';
import { DiagramColorSelect } from './DiagramColorSelect';
import { DiagramLineTypeMark } from './DiagramLineTypeMark';
import styles from './DiagramLineTypeControl.module.css';

/**
 * The left sidebar’s Line Type (15a): Valley, Mountain, Hidden and Solid, each a
 * short stroke in its own dash, and while Solid is the type, the colour the
 * next solid line is drawn in under it (17a). Both are preferences, kept as
 * they were left: the Line tool and the Angle Bisector draw in them.
 */
export function DiagramLineTypeControl({ label, disabled }: { label: string; disabled: boolean }) {
  const { t } = useTranslation();
  const resolution = useShortcutResolution();
  const lineType = useSettingsStore((state) => state.diagramAnnotateLineType);
  const setLineType = useSettingsStore((state) => state.setDiagramAnnotateLineType);
  const lineColor = useSettingsStore((state) => state.diagramAnnotateLineColor);
  const setLineColor = useSettingsStore((state) => state.setDiagramAnnotateLineColor);
  const style = useWorkspaceStore((state) => state.diagram?.style ?? DEFAULT_DIAGRAM_STYLE);
  const colorLabel = t('panels:diagram.annotate.lineColor', 'Line Color');
  return (
    <div className={styles.control}>
      <SegmentedControl<DiagramLineType>
        size="sm"
        fill
        iconsOnly
        tooltipSide="top"
        aria-label={label}
        value={lineType}
        disabled={disabled}
        options={DIAGRAM_LINE_TYPES.map((type) => {
          const name = lineTypeLabel(t, type);
          const key = shortcutLabelForAction(LINE_TYPE_SHORTCUTS[type], resolution);
          return {
            value: type,
            label: name,
            icon: <DiagramLineTypeMark type={type} />,
            tooltip: `${key ? `${name} (${key})` : name} - ${t('panels:diagram.annotate.lineTypeHelp', 'The line the Line tool and the Angle Bisector draw.')}`,
          };
        })}
        onChange={setLineType}
      />
      {lineType === 'solid' && (
        <FieldRow label={colorLabel} kind="select" disabled={disabled}>
          <DiagramColorSelect
            variant="row"
            label={colorLabel}
            value={lineColor}
            ink={annotationInkColor(style)}
            disabled={disabled}
            onChange={(color) => setLineColor(color)}
          />
        </FieldRow>
      )}
    </div>
  );
}
