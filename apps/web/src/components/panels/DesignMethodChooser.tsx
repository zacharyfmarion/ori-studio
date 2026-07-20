import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { DraftingCompass, Grid3x3 } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { DESIGN_BP_PATH, DESIGN_TREEMAKER_PATH } from '../../routing/paths';
import type { WorkflowTarget } from '../../lib/sampleProject';

/**
 * Design workspace NUX. When no design method has been chosen yet, the Design
 * pane presents the two authoring methods side by side:
 *
 * - Circle-packed → the TreeMaker tree editor (circle/river packing).
 * - Box-pleated   → the Box Pleating Studio tree + packing workflow.
 */
export function DesignMethodChooser() {
  const engineReady = useWorkspaceStore((state) => state.engineReady);
  const status = useWorkspaceStore((state) => state.status);
  const chooseDesignMethod = useWorkspaceStore((state) => state.chooseDesignMethod);
  const navigate = useNavigate();

  const chooseMethod = (target: WorkflowTarget) => {
    void chooseDesignMethod(target);
    navigate(target === 'box-pleat' ? DESIGN_BP_PATH : DESIGN_TREEMAKER_PATH);
  };

  return (
    <section className="panel-shell design-panel design-method-chooser">
      <div className="design-method-chooser__body">
        <div className="design-method-chooser__intro">
          <h2 className="design-method-chooser__title">Start a new design</h2>
          <p className="design-method-chooser__subtitle">
            Choose how you want to author this model.
          </p>
        </div>
        <div className="design-method-chooser__options" role="group" aria-label="Design method">
          <MethodCard
            title="Circle-packed"
            description="Sketch a tree and let circle/river packing optimize the base, TreeMaker-style."
            icon={<DraftingCompass size={22} />}
            // Circle-packing runs on the treemaker engine — wait for it to load.
            disabled={!engineReady}
            onSelect={() => chooseMethod('treemaker')}
          />
          <MethodCard
            title="Box-pleated"
            description="Author a tree, then pack flaps and rivers on a grid with Box Pleating Studio."
            icon={<Grid3x3 size={22} />}
            // Box-pleating runs on the independent BP worker, not the treemaker
            // engine, so it needn't wait for `engineReady`.
            disabled={status === 'error'}
            onSelect={() => chooseMethod('box-pleat')}
          />
        </div>
      </div>
    </section>
  );
}

interface MethodCardProps {
  title: string;
  description: string;
  icon: ReactNode;
  disabled: boolean;
  onSelect: () => void;
}

function MethodCard({ title, description, icon, disabled, onSelect }: MethodCardProps) {
  const method: WorkflowTarget = title === 'Box-pleated' ? 'box-pleat' : 'treemaker';
  return (
    <button
      type="button"
      className="design-method-card"
      data-method={method}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="design-method-card__icon">{icon}</span>
      <span className="design-method-card__title">{title}</span>
      <span className="design-method-card__description">{description}</span>
    </button>
  );
}
