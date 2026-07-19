import type { WorkflowTarget } from '../../lib/sampleProject';
import type { DesignLayoutVariant } from '../layoutStore';

/**
 * Derive the Design workspace layout variant from the design state. A pending
 * method choice shows the NUX chooser; otherwise the workflow target selects the
 * TreeMaker or box-pleat layout. Single source of truth for both the layout
 * store's variant lookup and the URL sync.
 */
export function deriveDesignVariant(input: {
  pendingDesignChoice: boolean;
  workflowTarget: WorkflowTarget;
}): DesignLayoutVariant {
  if (input.pendingDesignChoice) return 'nux';
  return input.workflowTarget === 'box-pleat' ? 'box-pleat' : 'treemaker';
}
