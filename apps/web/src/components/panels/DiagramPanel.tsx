import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { trackDiagramViewSwitched } from '../../analytics';
import { handleMenuAction } from '../../commands/menuActions';
import {
  DEFAULT_DIAGRAM_STYLE,
  DEFAULT_PAGE_SETUP,
  type DiagramAsset,
  type DiagramStep,
} from '../../diagram/document/diagramDocument';
import { splitIntoPages } from '../../diagram/pages/diagramPageLayout';
import type { PreparedDiagramPages } from '../../diagram/pages/diagramPages';
import { useDiagramPages } from '../../diagram/pages/useDiagramPages';
import { DIAGRAM_PAGE_PANE_ID, revealDiagramPane, useDiagramPaneReveal } from '../../diagram/useDiagramPaneReveal';
import { refreshAllDiagramSteps, stopRefreshAll } from '../../diagram/capture/captureQueue';
import { openDiagramPatternPicker } from '../../diagram/capture/stepCaptureActions';
import { useDiagramCardLinks } from '../../diagram/capture/useCardLinks';
import { useDiagramLinkedPose } from '../../diagram/capture/useDiagramLinkedPose';
import { pickStepPictures } from '../../diagram/upload/addStepPictures';
import { useStepPictureDrop } from '../../diagram/upload/useStepPictureDrop';
import {
  addDiagramStep,
  openDiagramStep,
  useAddDiagramStep,
  useDiagramPoseActions,
} from '../../diagram/useDiagramActions';
import { useDiagramShortcuts } from '../../diagram/useDiagramShortcuts';
import { useDiagramStepMenu } from '../../diagram/useDiagramStepMenu';
import { useLayoutStore } from '../../store/layoutStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DiagramViewMode } from '../../store/workspaceStore/types';
import { DiagramEmptyState } from '../diagram/DiagramEmptyState';
import { DiagramHeader } from '../diagram/DiagramHeader';
import { DiagramPagesView } from '../diagram/DiagramPagesView';
import { DiagramStepDetail } from '../diagram/DiagramStepDetail';
import { DiagramStepsGrid } from '../diagram/DiagramStepsGrid';
import { ContextMenu } from '../ui/ContextMenu';
import { Notice } from '../ui/Notice';
import styles from './DiagramPanel.module.css';

const NO_STEPS: readonly DiagramStep[] = [];
const NONE_CUT: ReadonlySet<string> = new Set();

/** The steps whose instruction the pages cut with "…". */
function cutStepIds(pages: PreparedDiagramPages | null): ReadonlySet<string> {
  if (!pages) return NONE_CUT;
  const cut = new Set<string>();
  for (const page of pages.layout.pages) for (const cell of page.cells) if (cell.textOverflow) cut.add(cell.stepId);
  return cut.size > 0 ? cut : NONE_CUT;
}
const NO_ASSETS: Readonly<Record<string, DiagramAsset>> = {};

const openOnDoubleClick = (stepId: string) => void openDiagramStep(stepId, 'double_click');

// Straight from the click, so the browser opens its picker (a user gesture).
const uploadPictures = () => void pickStepPictures();
const uploadPictureFor = (stepId: string) => void pickStepPictures({ replaceStepId: stepId });
/** Link pattern… from the header or the empty diagram: a new step, and its pattern picker. */
const refreshAll = () => void refreshAllDiagramSteps();
const linkNewStep = () => {
  const stepId = addDiagramStep();
  if (stepId) openDiagramPatternPicker(stepId);
};

/** References, whose Send to diagram adds its cards after the selected step. */
const stepsFromReferences = () => useWorkspaceStore.getState().openReferencesWorkspace();

const switchView = (view: DiagramViewMode) => {
  const store = useWorkspaceStore.getState();
  if (store.diagramView === view) return;
  store.setDiagramView(view);
  trackDiagramViewSwitched(view);
};

/** A press on a page outside its steps: a question about the page. */
const revealPagePane = () => revealDiagramPane(DIAGRAM_PAGE_PANE_ID);

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
  const style = useWorkspaceStore((state) => state.diagram?.style ?? DEFAULT_DIAGRAM_STYLE);
  const readOnly = useWorkspaceStore((state) => state.diagramReadOnly);
  const selectedStepId = useWorkspaceStore((state) => state.diagramSelectedStepId);
  const selectStep = useWorkspaceStore((state) => state.selectDiagramStep);
  const detail = useWorkspaceStore((state) => state.diagramDetail);
  const closeStep = useWorkspaceStore((state) => state.closeDiagramStep);
  const poseActions = useDiagramPoseActions(detail !== null ? selectedStepId : null);
  const setTitle = useWorkspaceStore((state) => state.setDiagramTitle);
  const addStep = useAddDiagramStep();
  const rootRef = useRef<HTMLElement | null>(null);
  const menu = useDiagramStepMenu(rootRef);
  const keys = useDiagramShortcuts({ openStepMenu: menu.openStepMenu });
  const { dropTarget, ...dropHandlers } = useStepPictureDrop();
  const links = useDiagramCardLinks(steps, style);
  const patternOpen = useWorkspaceStore((state) => state.oristudioCpDocument !== null);
  const refreshing = useWorkspaceStore((state) => state.diagramRefreshAll);
  const diagram = useWorkspaceStore((state) => state.diagram);
  const view = useWorkspaceStore((state) => state.diagramView);
  useDiagramPaneReveal();
  // Laid out in either view: the pages are the Pages view, and the cards say
  // whose text the pages cut.
  const pages = useDiagramPages(steps.length > 0 ? diagram : null);
  const page = diagram?.page ?? DEFAULT_PAGE_SETUP;
  const pageCount = useMemo(
    () => splitIntoPages(steps, page.columns * page.rows).length,
    [steps, page.columns, page.rows]
  );
  const textCut = useMemo(() => cutStepIds(pages.pages), [pages.pages]);

  const detailIndex =
    detail !== null && selectedStepId !== null
      ? steps.findIndex((step) => step.id === selectedStepId)
      : -1;
  // Held for as long as the detail is open on a linked step: its fold, between verbs.
  const linkedPose = useDiagramLinkedPose(detailIndex >= 0 ? steps[detailIndex] : null);
  if (detailIndex >= 0) {
    const step = steps[detailIndex];
    return (
      <section
        ref={rootRef}
        className="panel-shell"
        aria-label={t('panels:diagram.label', 'Diagram')}
        onPointerDownCapture={keys.onPointerDownCapture}
        {...dropHandlers}
      >
        <DiagramStepDetail
          // A new detail per step: it takes focus as it opens, and keeps none of the last.
          key={step.id}
          step={step}
          assets={assets}
          style={style}
          number={detailIndex + 1}
          count={steps.length}
          readOnly={readOnly}
          poseActions={poseActions}
          linkedPose={linkedPose}
          onBack={closeStep}
          onStep={(direction) => {
            const next = steps[detailIndex + direction];
            if (next) selectStep(next.id);
          }}
          onUpload={() => uploadPictureFor(step.id)}
          dropping={dropTarget !== null}
          drawerSlot={setViewDrawerSlot}
        />
      </section>
    );
  }

  return (
    <section
      ref={rootRef}
      className="panel-shell"
      aria-label={t('panels:diagram.label', 'Diagram')}
      onPointerDownCapture={keys.onPointerDownCapture}
      {...dropHandlers}
    >
      <DiagramHeader
        title={title}
        stepCount={steps.length}
        pageCount={pageCount}
        view={view}
        onViewChange={switchView}
        readOnly={readOnly}
        onRename={setTitle}
        onAddStep={addStep}
        onUpload={uploadPictures}
        patternOpen={patternOpen}
        onLink={linkNewStep}
        onFromReferences={stepsFromReferences}
        staleCount={links.refreshable}
        refreshing={refreshing}
        onRefreshAll={refreshAll}
        onStopRefreshing={stopRefreshAll}
        onExport={() => void handleMenuAction('file.exportDiagram')}
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
      <div className="panel-body" onContextMenu={steps.length > 0 ? menu.onContextMenu : undefined}>
        {steps.length > 0 && view === 'pages' ? (
          <DiagramPagesView
            pages={pages.pages}
            failed={pages.failed}
            steps={steps}
            selectedStepId={selectedStepId}
            fitKey={`${diagram?.id ?? ''}:${page.size}:${page.orientation}`}
            onSelect={selectStep}
            onOpen={openOnDoubleClick}
            onPageClick={revealPagePane}
          />
        ) : steps.length === 0 ? (
          <DiagramEmptyState
            readOnly={readOnly}
            dropTarget={dropTarget !== null}
            onAddStep={addStep}
            onUpload={uploadPictures}
            patternOpen={patternOpen}
            onLink={linkNewStep}
            onFromReferences={stepsFromReferences}
          />
        ) : (
          <DiagramStepsGrid
            steps={steps}
            assets={assets}
            style={style}
            selectedStepId={selectedStepId}
            dropTarget={dropTarget}
            readOnly={readOnly}
            onSelect={selectStep}
            onOpen={openOnDoubleClick}
            onUpload={uploadPictureFor}
            links={links}
            textCut={textCut}
            patternOpen={patternOpen}
            onLink={openDiagramPatternPicker}
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
