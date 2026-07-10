import { BoxSelect } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';

/**
 * BP Editor pane — the Box Pleating packing/manual-layout surface that sits
 * beside the BP tree editor in the Design workspace.
 *
 * Phase 1 registers the pane and its empty state; the packing editor content
 * is wired up in Phase 4 once the BP store slice exists.
 */
export function BpEditorPanel() {
  const workflowTarget = useWorkspaceStore((state) => state.workflowTarget);

  return (
    <section className="panel-shell bp-editor-panel">
      <div className="panel-body document-mode-empty">
        <div className="document-mode-empty__icon" aria-hidden="true">
          <BoxSelect size={24} />
        </div>
        <span className="document-mode-empty__message">
          {workflowTarget === 'box-pleat'
            ? 'Run Optimize Layout or materialize a packing to edit flaps and rivers here.'
            : 'The BP Editor is available in Box Pleating designs.'}
        </span>
      </div>
    </section>
  );
}
