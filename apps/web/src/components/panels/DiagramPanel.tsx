import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { DiagramAsset, DiagramStep } from '../../diagram/document/diagramDocument';
import { pickStepPictures } from '../../diagram/upload/addStepPictures';
import { useStepPictureDrop } from '../../diagram/upload/useStepPictureDrop';
import { useAddDiagramStep } from '../../diagram/useDiagramActions';
import { useDiagramShortcuts } from '../../diagram/useDiagramShortcuts';
import { useDiagramStepMenu } from '../../diagram/useDiagramStepMenu';
import { useLayoutStore } from '../../store/layoutStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { DiagramEmptyState } from '../diagram/DiagramEmptyState';
import { DiagramHeader } from '../diagram/DiagramHeader';
import { DiagramStepsGrid } from '../diagram/DiagramStepsGrid';
import { ContextMenu } from '../ui/ContextMenu';
import { Notice } from '../ui/Notice';
import styles from './DiagramPanel.module.css';

const NO_STEPS: readonly DiagramStep[] = [];
const NO_ASSETS: Readonly<Record<string, DiagramAsset>> = {};

// Straight from the click, so the browser opens its picker (a user gesture).
const uploadPictures = () => void pickStepPictures();
const uploadPictureFor = (stepId: string) => void pickStepPictures({ replaceStepId: stepId });

/**
 * The Diagram workspace: the steps of a folding sequence in order, each a
 * picture and an instruction, on their way to printed pages.
 *
 * A composition site (AGENTS.md › Panel components): the header, the grid and
 * the empty state are children, the verbs live in `diagram/actions/`, and the
 * store bindings in `diagram/useDiagramActions.ts`, the keys in
 * `useDiagramShortcuts`, the card menu in `useDiagramStepMenu` and dropped
 * pictures in `useStepPictureDrop`. No keyboard handling here.
 * The selected step's controls are the Step pane beside this one
 * (`DiagramStepPanel`), which reads the store on its own.
 *
 * Nothing here creates a diagram: the first edit does (`commit` in the slice),
 * so opening the workspace on a project without one leaves it without one.
 */
export function DiagramPanel() {
  const { t } = useTranslation();
  const setViewDrawerSlot = useLayoutStore((state) => state.setViewDrawerSlot);
  const title = useWorkspaceStore((state) => state.diagram?.title ?? '');
  const steps = useWorkspaceStore((state) => state.diagram?.steps ?? NO_STEPS);
  const assets = useWorkspaceStore((state) => state.diagram?.assets ?? NO_ASSETS);
  const readOnly = useWorkspaceStore((state) => state.diagramReadOnly);
  const selectedStepId = useWorkspaceStore((state) => state.diagramSelectedStepId);
  const selectStep = useWorkspaceStore((state) => state.selectDiagramStep);
  const setTitle = useWorkspaceStore((state) => state.setDiagramTitle);
  const addStep = useAddDiagramStep();
  const rootRef = useRef<HTMLElement | null>(null);
  const menu = useDiagramStepMenu(rootRef);
  const keys = useDiagramShortcuts({ openStepMenu: menu.openStepMenu });
  const drop = useStepPictureDrop();

  return (
    <section
      ref={rootRef}
      className="panel-shell"
      aria-label={t('panels:diagram.label', 'Diagram')}
      onPointerDownCapture={keys.onPointerDownCapture}
    >
      <DiagramHeader
        title={title}
        stepCount={steps.length}
        readOnly={readOnly}
        onRename={setTitle}
        onAddStep={addStep}
        onUpload={uploadPictures}
        drawerSlot={setViewDrawerSlot}
      />
      {readOnly && (
        <div className={styles.notice}>
          <Notice>
            {t(
              'panels:diagram.readOnlyNotice',
              'This diagram was made with a newer Ori Studio, so it opens read-only here. Saving keeps it exactly as it came.'
            )}
          </Notice>
        </div>
      )}
      <div
        className="panel-body"
        onContextMenu={steps.length > 0 ? menu.onContextMenu : undefined}
        onDragOver={drop.onDragOver}
        onDragLeave={drop.onDragLeave}
        onDrop={drop.onDrop}
      >
        {steps.length === 0 ? (
          <DiagramEmptyState
            readOnly={readOnly}
            dropTarget={drop.dropTarget !== null}
            onAddStep={addStep}
            onUpload={uploadPictures}
          />
        ) : (
          <DiagramStepsGrid
            steps={steps}
            assets={assets}
            selectedStepId={selectedStepId}
            dropTarget={drop.dropTarget}
            readOnly={readOnly}
            onSelect={selectStep}
            onUpload={uploadPictureFor}
          />
        )}
      </div>
      <ContextMenu
        open={menu.controller.open}
        x={menu.controller.x}
        y={menu.controller.y}
        items={menu.controller.items}
        onOpenChange={menu.controller.onOpenChange}
        onCloseAutoFocus={menu.controller.onCloseAutoFocus}
      />
    </section>
  );
}
