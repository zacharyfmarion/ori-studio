import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useLayoutStore } from '../../store/layoutStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { FoldGate } from '../fold/FoldGate';

/**
 * The Diagram's From Fold… browser (fold-workspace plan D17), mounted at the
 * App root while the Diagram is the workspace on screen and the store says it
 * is open. The browser is Fold's code (`DiagramFoldBrowser`): opening it is
 * what asks for that code, and the browser appears once it has come. If it
 * cannot come, the opening is closed and says why, so the next From Fold…
 * asks again.
 */
export function DiagramFoldModal() {
  const { t } = useTranslation();
  const state = useWorkspaceStore((store) => store.diagramFoldBrowser);
  const shown = useLayoutStore((store) => store.activeWorkspace === 'diagram');
  if (!state || !shown) return null;
  const failed = () => {
    useWorkspaceStore.getState().closeDiagramFoldBrowser();
    toast.error(t('panels:fold.load.failed', 'Fold did not load'));
  };
  return (
    <FoldGate key={state.opening} pending="none" onFailed={failed}>
      {({ DiagramFoldBrowser }) => <DiagramFoldBrowser state={state} />}
    </FoldGate>
  );
}
