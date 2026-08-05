import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { designKindsForChooser } from '../../designKinds';
import type { DesignKindDescriptor, DesignKindId } from '../../designKinds';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { DESIGN_BP_PATH, DESIGN_TREEMAKER_PATH } from '../../routing/paths';

/**
 * Design workspace NUX. When no design method has been chosen yet, the Design
 * pane presents the registered authoring methods side by side.
 *
 * The cards are built from the design-kind registry rather than hardcoded, so a
 * new kind appears here by registering a descriptor. Each kind supplies its own
 * copy, icon, ordering, and availability rule — see `designKinds/types.ts`.
 */
export function DesignMethodChooser() {
  const { t } = useTranslation();
  const engineReady = useWorkspaceStore((state) => state.engineReady);
  const status = useWorkspaceStore((state) => state.status);
  const chooseDesignMethod = useWorkspaceStore((state) => state.chooseDesignMethod);
  const navigate = useNavigate();

  const chooseMethod = (target: DesignKindId) => {
    void chooseDesignMethod(target);
    navigate(target === 'box-pleat' ? DESIGN_BP_PATH : DESIGN_TREEMAKER_PATH);
  };

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
          {designKindsForChooser().map((kind) => (
            <MethodCard
              key={kind.id}
              kind={kind}
              disabled={!kind.chooser.isAvailable({ engineReady, status })}
              onSelect={() => chooseMethod(kind.id)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

interface MethodCardProps {
  kind: DesignKindDescriptor;
  disabled: boolean;
  onSelect: () => void;
}

function MethodCard({ kind, disabled, onSelect }: MethodCardProps) {
  const { t } = useTranslation();
  const { title, description } = kind.chooser.copy(t);
  const icon: ReactNode = <kind.chooser.Icon size={22} />;
  return (
    <button
      type="button"
      className="design-method-card"
      data-method={kind.id}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="design-method-card__icon">{icon}</span>
      <span className="design-method-card__title">{title}</span>
      <span className="design-method-card__description">{description}</span>
    </button>
  );
}
