import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DraftingCompass, Grid3x3 } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { WorkflowTarget } from '../../lib/sampleProject';

/**
 * Design workspace NUX. When no design method has been chosen yet, the Design
 * pane presents the two authoring methods side by side:
 *
 * - Circle-packed → the TreeMaker tree editor (circle/river packing).
 * - Box-pleated   → the Box Pleating Studio tree + packing workflow.
 */
export function DesignMethodChooser() {
  const { t } = useTranslation();
  const engineReady = useWorkspaceStore((state) => state.engineReady);
  const chooseDesignMethod = useWorkspaceStore((state) => state.chooseDesignMethod);

  return (
    <section className="panel-shell design-panel design-method-chooser">
      <div className="design-method-chooser__body">
        <div className="design-method-chooser__intro">
          <h2 className="design-method-chooser__title">
            {t('panels:design.methodChooser.title', 'Start a new design')}
          </h2>
          <p className="design-method-chooser__subtitle">
            {t('panels:design.methodChooser.subtitle', 'Choose how you want to author this model.')}
          </p>
        </div>
        <div
          className="design-method-chooser__options"
          role="group"
          aria-label={t('panels:design.methodChooser.groupLabel', 'Design method')}
        >
          <MethodCard
            method="treemaker"
            title={t('panels:design.methodChooser.circlePacked.title', 'Circle-packed')}
            description={t(
              'panels:design.methodChooser.circlePacked.description',
              'Sketch a tree and let circle/river packing optimize the base, TreeMaker-style.'
            )}
            icon={<DraftingCompass size={22} />}
            disabled={!engineReady}
            onSelect={() => void chooseDesignMethod('treemaker')}
          />
          <MethodCard
            method="box-pleat"
            title={t('panels:design.methodChooser.boxPleated.title', 'Box-pleated')}
            description={t(
              'panels:design.methodChooser.boxPleated.description',
              'Author a tree, then pack flaps and rivers on a grid with Box Pleating Studio.'
            )}
            icon={<Grid3x3 size={22} />}
            disabled={!engineReady}
            onSelect={() => void chooseDesignMethod('box-pleat')}
          />
        </div>
      </div>
    </section>
  );
}

interface MethodCardProps {
  method: WorkflowTarget;
  title: string;
  description: string;
  icon: ReactNode;
  disabled: boolean;
  onSelect: () => void;
}

function MethodCard({ method, title, description, icon, disabled, onSelect }: MethodCardProps) {
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
