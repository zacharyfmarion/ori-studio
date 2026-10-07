import { useTranslation } from 'react-i18next';
import {
  ANNOTATE_TOOL_GROUPS,
  annotateToolBlocker,
  annotateToolShortcut,
  annotateGroupLabel,
  annotateToolHelp,
  annotateToolLabel,
  LINE_TYPE_SHORTCUTS,
  lineTypeLabel,
  type AnnotateTool,
} from '../../diagram/annotate/annotateTools';
import { DIAGRAM_LINE_TYPES, type DiagramLineType } from '../../diagram/annotate/lineTypes';
import { shortcutLabelForAction } from '../../keyboard/shortcuts';
import { useSettingsStore } from '../../store/settingsStore';
import { useShortcutResolution } from '../../store/shortcutStore';
import { SegmentedControl } from '../ui/SegmentedControl';
import { ToolRail, type ToolRailGroup } from '../ui/ToolRail';
import { DiagramAnnotateToolGlyph } from './DiagramAnnotateToolGlyph';
import { DiagramLineTypeMark } from './DiagramLineTypeMark';

/**
 * Annotate's tools down the left of the canvas (D8): the Edit rail's
 * `ToolRail`, in groups — Line Type first, the one control across the rail,
 * at the top as Edit's line types are (Zach, 2026-10-05); then Select and Edit
 * Path; Arrows; Lines; Marks; Text. Each names its key in its tooltip,
 * resolved against the reader's own layout. The line type is a preference,
 * kept as it was left: the Line tool and the Angle Bisector draw in it. On
 * an enlarged step the Enlarge tools are held, saying why (Revision 2).
 */
export function DiagramAnnotateRail({
  tool,
  readOnly,
  enlarged = false,
  onTool,
}: {
  tool: AnnotateTool;
  readOnly: boolean;
  /** The step is enlarged: an area is not drawn on it. */
  enlarged?: boolean;
  onTool: (tool: AnnotateTool) => void;
}) {
  const { t } = useTranslation();
  const resolution = useShortcutResolution();
  const lineType = useSettingsStore((state) => state.diagramAnnotateLineType);
  const setLineType = useSettingsStore((state) => state.setDiagramAnnotateLineType);
  const tools: ToolRailGroup[] = ANNOTATE_TOOL_GROUPS.map((group) => ({
    id: group.id,
    label: annotateGroupLabel(t, group.id),
    railLabel: annotateGroupLabel(t, group.id),
    content: {
      tools: group.tools.map((each) => {
        const label = annotateToolLabel(t, each);
        const shortcut = annotateToolShortcut(each);
        const key = shortcut === undefined ? undefined : shortcutLabelForAction(shortcut, resolution);
        const blocked = annotateToolBlocker(t, each, { enlarged });
        return {
          id: each ?? 'select',
          label,
          tooltip: `${key ? `${label} (${key})` : label} - ${blocked ?? annotateToolHelp(t, each)}`,
          glyph: <DiagramAnnotateToolGlyph tool={each} lineType={lineType} />,
          active: tool === each,
          available: !readOnly && blocked === null,
          onSelect: () => onTool(each),
        };
      }),
    },
  }));
  const typeLabel = t('panels:diagram.annotate.lineType', 'Line Type');
  const lineTypes: ToolRailGroup = {
    id: 'line-type',
    label: typeLabel,
    railLabel: typeLabel,
    content: {
      // One control with one answer, as Edit's line types are.
      control: (
        <SegmentedControl<DiagramLineType>
          size="lg"
          fill
          iconsOnly
          tooltipSide="right"
          aria-label={typeLabel}
          value={lineType}
          disabled={readOnly}
          options={DIAGRAM_LINE_TYPES.map((type) => {
            const label = lineTypeLabel(t, type);
            const key = shortcutLabelForAction(LINE_TYPE_SHORTCUTS[type], resolution);
            return {
              value: type,
              label,
              icon: <DiagramLineTypeMark type={type} />,
              tooltip: `${key ? `${label} (${key})` : label} - ${t('panels:diagram.annotate.lineTypeHelp', 'The line the Line tool and the Angle Bisector draw.')}`,
            };
          })}
          onChange={setLineType}
        />
      ),
    },
  };
  return (
    <ToolRail
      aria-label={t('panels:diagram.annotate.toolsLabel', 'Annotate tools')}
      idPrefix="diagram-annotate-group"
      groups={[lineTypes, ...tools]}
    />
  );
}
