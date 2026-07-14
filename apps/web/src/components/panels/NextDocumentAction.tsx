import { Play, ScanLine, Sparkles } from 'lucide-react';
import { handleMenuAction } from '../../commands/menuActions';
import { getNextDocumentAction } from '../../lib/workspaceCapabilities';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useWorkspaceCapabilities } from '../../store/workspaceStore/useWorkspaceCapabilities';
import { Button } from '../ui/Button';

export function NextDocumentAction() {
  const capabilities = useWorkspaceCapabilities();
  const context = useWorkspaceStore((state) => state.activeEditingContext);
  const sendBpToEdit = useWorkspaceStore((state) => state.sendOristudioBpToEdit);
  const hasBpDocument = useWorkspaceStore((state) => state.oristudioBpDocument !== null);
  const bpBusy = useWorkspaceStore((state) => state.oristudioBpBusy);

  // In a BP design the top action sends the design's crease pattern to the Edit
  // canvas (Import(Add) merge) rather than TreeMaker's Optimize/Build.
  if (context === 'bp-tree' || context === 'bp-packing') {
    return (
      <Button
        size="sm"
        variant="primary"
        disabled={!hasBpDocument || bpBusy}
        title="Send this design's crease pattern to the Edit canvas"
        onClick={() => void sendBpToEdit()}
      >
        <ScanLine size={13} />
        Send to Edit
      </Button>
    );
  }

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
