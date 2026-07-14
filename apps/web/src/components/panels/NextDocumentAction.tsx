import { Play, Sparkles } from 'lucide-react';
import { handleMenuAction } from '../../commands/menuActions';
import { getNextDocumentAction } from '../../lib/workspaceCapabilities';
import { useWorkspaceCapabilities } from '../../store/workspaceStore/useWorkspaceCapabilities';
import { Button } from '../ui/Button';

export function NextDocumentAction() {
  const capabilities = useWorkspaceCapabilities();
  const action = getNextDocumentAction(capabilities);
  if (!action) return null;

  const capability = capabilities[action];
  // Optimize/Build are TreeMaker/CP actions; hidden (masked) in a BP context.
  if (!capability.visible) return null;
  return (
    <Button
      size="sm"
      variant="primary"
      disabled={!capability.enabled}
      title={capability.reason}
      onClick={() => void handleMenuAction(action)}
    >
      {action === 'cp.build' ? <Play size={13} /> : <Sparkles size={13} />}
      {capability.label}
    </Button>
  );
}
