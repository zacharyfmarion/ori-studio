import { useTranslation } from 'react-i18next';
import {
  ANNOTATE_TOOL_GROUPS,
  annotateToolBlocker,
  annotateToolShortcut,
  annotateGroupLabel,
  annotateToolHelp,
  annotateToolLabel,
  type AnnotateTool,
  type XRayStanding,
} from '../../diagram/annotate/annotateTools';
import { shortcutLabelForAction } from '../../keyboard/shortcuts';
import { useSettingsStore } from '../../store/settingsStore';
import { useShortcutResolution } from '../../store/shortcutStore';
import { ToolRail, type ToolRailGroup } from '../ui/ToolRail';
import { DiagramLineTypeControl } from './DiagramLineTypeControl';
import { DiagramAnnotateToolGlyph } from './DiagramAnnotateToolGlyph';

/** Tools and the shared line type, as in Edit. Creation parameters live in the hint; mark properties in Layers. */
export function DiagramAnnotateRail({
  tool,
  readOnly,
  enlarged = false,
  xray,
  onTool,
}: {
  tool: AnnotateTool;
  readOnly: boolean;
  /** The step is enlarged: an area is not drawn on it. */
  enlarged?: boolean;
  /** Whether the step's picture can be x-rayed (Revision 3); unsaid, it can. */
  xray?: XRayStanding;
  onTool: (tool: AnnotateTool) => void;
}) {
  const { t } = useTranslation();
  const resolution = useShortcutResolution();
  const lineType = useSettingsStore((state) => state.diagramAnnotateLineType);
  const circleMode = useSettingsStore((state) => state.diagramAnnotateCircleMode);
  const starFill = useSettingsStore((state) => state.diagramAnnotateStarFill);
  const tools: ToolRailGroup[] = ANNOTATE_TOOL_GROUPS.map((group) => ({
    id: group.id,
    label: annotateGroupLabel(t, group.id),
    railLabel: annotateGroupLabel(t, group.id),
    content: {
      tools: group.tools.map((each) => {
        const label = annotateToolLabel(t, each);
        const shortcut = annotateToolShortcut(each);
        const key = shortcut === undefined ? undefined : shortcutLabelForAction(shortcut, resolution);
        const blocked = annotateToolBlocker(t, each, { enlarged, xray });
        return {
          id: each ?? 'select',
          label,
          tooltip: `${key ? `${label} (${key})` : label} - ${blocked ?? annotateToolHelp(t, each, circleMode)}`,
          glyph: <DiagramAnnotateToolGlyph tool={each} lineType={lineType} starFill={starFill} />,
          active: tool === each,
          available: !readOnly && blocked === null,
          onSelect: () => onTool(each),
        };
      }),
    },
  }));
  const lineLabel = t('panels:diagram.annotate.lineType', 'Line Type');
  tools.splice(tools.findIndex((group) => group.id === 'lines') + 1, 0, {
    id: 'line-type', label: lineLabel, railLabel: lineLabel,
    content: { control: <DiagramLineTypeControl label={lineLabel} disabled={readOnly} /> },
  });
  return (
    <ToolRail
      aria-label={t('panels:diagram.annotate.toolsLabel', 'Annotate tools')}
      idPrefix="diagram-annotate-group"
      groups={tools}
    />
  );
}
