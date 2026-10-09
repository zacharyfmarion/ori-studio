import { useTranslation } from 'react-i18next';
import {
  ANNOTATE_TOOL_GROUPS,
  annotateToolBlocker,
  annotateToolShortcut,
  annotateGroupLabel,
  annotateToolHelp,
  annotateToolLabel,
  type AnnotateTool,
} from '../../diagram/annotate/annotateTools';
import { shortcutLabelForAction } from '../../keyboard/shortcuts';
import { useSettingsStore } from '../../store/settingsStore';
import { useShortcutResolution } from '../../store/shortcutStore';
import { ToolRail, type ToolRailGroup } from '../ui/ToolRail';
import { DiagramAnnotateToolGlyph } from './DiagramAnnotateToolGlyph';
import { DiagramLineTypeControl } from './DiagramLineTypeControl';
import { DiagramStarFillControl } from './DiagramStarFillControl';
import { DiagramTextStyleControl } from './DiagramTextStyleControl';

/**
 * Annotate's tools down the left of the canvas (D8): the Edit rail's
 * `ToolRail`, in groups — Line Type first, the one control across the rail,
 * at the top as Edit's line types are (Zach, 2026-10-05), with a solid line's
 * colour under it while Solid is the type (17a); then Select and Edit
 * Path; Arrows; Lines; Marks; Text — and under Text, while the Label tool is
 * in hand, its Text Style (17b), one control across the rail as Line Type
 * is; under Marks, while the Star tool is, its Star Fill (Revision 3, R3-4
 * C). Each names its key in its tooltip,
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
        const blocked = annotateToolBlocker(t, each, { enlarged });
        return {
          id: each ?? 'select',
          label,
          tooltip: `${key ? `${label} (${key})` : label} - ${blocked ?? annotateToolHelp(t, each)}`,
          glyph: <DiagramAnnotateToolGlyph tool={each} lineType={lineType} starFill={starFill} />,
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
    // One control with one answer, as Edit's line types are, and a solid line's colour under it (17a).
    content: { control: <DiagramLineTypeControl label={typeLabel} disabled={readOnly} /> },
  };
  const styleLabel = t('panels:diagram.annotate.textStyle', 'Text Style');
  // The next label's colour, Bold, Halo and Size (17b): under the Text group while the Label tool is in hand.
  const textStyle: ToolRailGroup | null =
    tool === 'label'
      ? {
          id: 'text-style',
          label: styleLabel,
          railLabel: styleLabel,
          // Taking the tool brings it in under Text, at the foot of the rail: in view, or a short screen shows nothing new.
          reveal: true,
          content: { control: <DiagramTextStyleControl disabled={readOnly} /> },
        }
      : null;
  const fillLabel = t('panels:diagram.annotate.starFill', 'Star Fill');
  // The next star's fill (Revision 3): under the Marks group while the Star tool is in hand, as Text Style is under Text.
  const starFillGroup: ToolRailGroup | null =
    tool === 'star'
      ? {
          id: 'star-fill',
          label: fillLabel,
          railLabel: fillLabel,
          reveal: true,
          content: { control: <DiagramStarFillControl label={fillLabel} disabled={readOnly} /> },
        }
      : null;
  const groups = tools.flatMap((group) => {
    if (group.id === 'text' && textStyle) return [group, textStyle];
    if (group.id === 'marks' && starFillGroup) return [group, starFillGroup];
    return [group];
  });
  return (
    <ToolRail
      aria-label={t('panels:diagram.annotate.toolsLabel', 'Annotate tools')}
      idPrefix="diagram-annotate-group"
      groups={[lineTypes, ...groups]}
    />
  );
}
