import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnnotateToolHint } from '../../diagram/annotate/useAnnotateToolHint';
import type { DiagramStep } from '../../diagram/document/diagramDocument';
import { STORAGE_KEYS } from '../../lib/storage';
import { ToolHintInstructions } from '../ui/tools/ToolHintInstructions';
import { ToolHintWindow } from '../ui/tools/ToolHintWindow';

/**
 * Annotate's tool window (decision 7): Edit's and the Simulator's window, over
 * the canvas's bottom right, saying what the tool in hand does — its name,
 * how to use it, and the keys held while using it.
 *
 * Mounted outside the canvas's view in the React tree. The window is portaled,
 * and portal events still bubble through React: inside the view, the view's
 * pointer handlers would hear the window's events as the canvas's own.
 *
 * Memoized: the canvas renders on every pointer move of a drag, and nothing
 * here changes then.
 */
export const DiagramAnnotateToolWindow = memo(function DiagramAnnotateToolWindow({
  container,
  step,
}: {
  /** The canvas's view, whose right edge is the seam with the Step pane. */
  container: HTMLElement | null;
  step: DiagramStep;
}) {
  const { t } = useTranslation();
  const hint = useAnnotateToolHint(step);
  const instructions = t('panels:diagram.annotate.instructions', 'Instructions');
  return (
    <ToolHintWindow
      container={container}
      collapseKey={STORAGE_KEYS.diagramToolHintCollapsed}
      title={hint.title}
      meta={instructions}
      ariaLabel={t('panels:diagram.annotate.toolWindowLabel', 'Annotate tool instructions')}
    >
      <ToolHintInstructions heading={instructions} intro={hint.instructions} items={hint.modifiers} />
    </ToolHintWindow>
  );
});
