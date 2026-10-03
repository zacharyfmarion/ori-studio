import { useTranslation } from 'react-i18next';
import {
  ANNOTATE_TOOL_GROUPS,
  ANNOTATE_TOOL_SHORTCUTS,
  annotateGroupLabel,
  annotateToolHelp,
  annotateToolLabel,
  type AnnotateTool,
} from '../../diagram/annotate/annotateTools';
import { shortcutLabelForAction } from '../../keyboard/shortcuts';
import { useShortcutResolution } from '../../store/shortcutStore';
import { ToolRail, type ToolRailGroup } from '../ui/ToolRail';
import { DiagramAnnotateToolGlyph } from './DiagramAnnotateToolGlyph';

/**
 * Annotate's tools down the left of the canvas (D8): the Edit rail's
 * `ToolRail`, in four groups — Select; Arrows; Lines; Text. Each names its key
 * in its tooltip, resolved against the reader's own layout.
 */
export function DiagramAnnotateRail({
  tool,
  readOnly,
  onTool,
}: {
  tool: AnnotateTool;
  readOnly: boolean;
  onTool: (tool: AnnotateTool) => void;
}) {
  const { t } = useTranslation();
  const resolution = useShortcutResolution();
  const groups: ToolRailGroup[] = ANNOTATE_TOOL_GROUPS.map((group) => ({
    id: group.id,
    label: annotateGroupLabel(t, group.id),
    railLabel: annotateGroupLabel(t, group.id),
    content: {
      tools: group.tools.map((kind) => {
        const label = annotateToolLabel(t, kind);
        const key = kind === null ? undefined : shortcutLabelForAction(ANNOTATE_TOOL_SHORTCUTS[kind], resolution);
        return {
          id: kind ?? 'select',
          label,
          tooltip: `${key ? `${label} (${key})` : label} - ${annotateToolHelp(t, kind)}`,
          glyph: <DiagramAnnotateToolGlyph tool={kind} />,
          active: tool === kind,
          available: !readOnly,
          onSelect: () => onTool(kind),
        };
      }),
    },
  }));
  return (
    <ToolRail
      aria-label={t('panels:diagram.annotate.toolsLabel', 'Annotate tools')}
      idPrefix="diagram-annotate-group"
      groups={groups}
    />
  );
}
