import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { trackDiagramPlacementsReflowed } from '../../analytics/trackDiagram';
import { useWorkspaceStore } from '../../store/workspaceStore';

// A pane can remount after a layout switch: a committed edit is announced only once.
let highestNonce = 0;
export function usePlacementReflowNotice(): void {
  const { t } = useTranslation();
  const settled = useWorkspaceStore((state) => state.diagramPlacesSettled);
  useEffect(() => {
    if (!settled || !settled.count || settled.nonce <= highestNonce) return;
    highestNonce = settled.nonce;
    trackDiagramPlacementsReflowed(settled.count);
    const loadId = useWorkspaceStore.getState().diagramLoadId;
    toast.message(
      t('toasts:diagram.placementsReflowed', 'Moved steps returned to automatic placement: {{count}}', {
        count: settled.count,
      }),
      {
        action: {
          label: t('common:actions.undo', 'Undo'),
          onClick: () => {
            const state = useWorkspaceStore.getState();
            if (state.diagramLoadId === loadId && state.diagramHistory.past.at(-1) === settled.entry)
              state.undoDiagram();
          },
        },
      },
    );
  }, [settled, t]);
}
