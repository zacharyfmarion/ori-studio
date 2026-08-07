import { selectDesignMethod, selectOristudioBpDocument } from '../store/workspaceStore/designTabs';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { DockviewReact } from 'dockview';
import type { DockviewReadyEvent } from 'dockview';
import 'dockview/dist/styles/dockview.css';
import {
  Box,
  DraftingCompass,
  FilePlus,
  FolderOpen,
  PenTool,
  Save,
  ScanLine,
  Settings,
  Sparkles,
} from 'lucide-react';
import { MenuBar } from './MenuBar';
import { DesignAttributionFooter } from './DesignAttributionFooter';
import { DesignTabStrip } from './panels/DesignTabStrip';
import { FixedDockTab } from './panels/FixedDockTab';
import { ErrorBoundary } from './errors/ErrorBoundary';
import { FileDropOverlay } from './FileDropOverlay';
import { panelComponents } from './panels/PanelComponents';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { handleMenuAction } from '../commands/menuActions';
import { useFileDropTarget } from '../hooks/useFileDropTarget';
import type { DropTargetPolicy } from '../lib/fileDrop';
import { getRuntimeSurface } from '../platform/runtime';
import { applyDefaultLayout, clearPersistedLayout, useLayoutStore } from '../store/layoutStore';
import { useSettingsStore } from '../store/settingsStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useWorkspaceCapabilities } from '../store/workspaceStore/useWorkspaceCapabilities';
import { pathForWorkspace } from '../routing/landing';
import { parseWorkspacePath } from '../routing/paths';
import { WORKSPACE_DEFINITIONS, type WorkspaceId } from '../workspaces/workspaces';

const workspaceIcons: Record<WorkspaceId, typeof DraftingCompass> = {
  design: DraftingCompass,
  edit: PenTool,
  simulate: Box,
};

/**
 * Dropping a document anywhere on the workspace canvas opens it, and a crease
 * pattern additionally offers to merge into the Edit canvas. Mounted on the
 * shell rather than the Edit panel because "can I merge this?" is a question
 * about store state, not about which workspace happens to be visible.
 */
const WORKSPACE_DROP_POLICY: DropTargetPolicy = 'open-or-import';

/** Localized workspace-rail tooltip. Literal `t()` calls keep the keys extractable. */
function workspaceTooltip(t: TFunction, id: WorkspaceId): string {
  switch (id) {
    case 'design':
      return t('common:workspaceRail.design', 'Design workspace');
    case 'edit':
      return t('common:workspaceRail.edit', 'Edit workspace');
    case 'simulate':
      return t('common:workspaceRail.simulate', 'Simulate workspace');
  }
}

function WorkspaceRail() {
  const { t } = useTranslation();
  const activeWorkspace = useLayoutStore((state) => state.activeWorkspace);
  const navigate = useNavigate();

  return (
    <aside className="workspace-rail" aria-label={t('common:workspaceRail.label', 'Workspaces')}>
      <div className="workspace-rail__items">
        {WORKSPACE_DEFINITIONS.map((workspace) => {
          const Icon = workspaceIcons[workspace.id];
          return (
            <IconButton
              key={workspace.id}
              size="lg"
              variant="toolbar"
              className="workspace-rail__button"
              isActive={activeWorkspace === workspace.id}
              title={workspaceTooltip(t, workspace.id)}
              tooltipSide="right"
              aria-label={workspaceTooltip(t, workspace.id)}
              onClick={() => navigate(pathForWorkspace(workspace.id))}
            >
              <Icon size={19} />
            </IconButton>
          );
        })}
      </div>
    </aside>
  );
}

function Toolbar() {
  const { t } = useTranslation();
  const openSettings = useSettingsStore((state) => state.openSettings);
  const capabilities = useWorkspaceCapabilities();
  const isDesktop = getRuntimeSurface() === 'desktop';
  const optimizeScale = capabilities['optimize.scale'];
  const bpOptimizeLayout = capabilities['bp.optimize.layout'];
  const buildCp = capabilities['cp.build'];
  const activeContext = useWorkspaceStore((state) => state.activeEditingContext);
  const sendBpToEdit = useWorkspaceStore((state) => state.sendOristudioBpToEdit);
  const sendTreeToEdit = useWorkspaceStore((state) => state.sendTreeCreasePatternToEdit);
  const hasBpDocument = useWorkspaceStore((state) => selectOristudioBpDocument(state) !== null);
  const bpBusy = useWorkspaceStore((state) => state.oristudioBpBusy);
  // In a BP design the top action sends the design's crease pattern to the Edit
  // canvas (Import(Add) merge), in place of TreeMaker's Optimize/Build.
  const isBpContext = activeContext === 'bp-tree' || activeContext === 'bp-packing';

  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        {/* eslint-disable-next-line i18next/no-literal-string -- brand name, never translated */}
        {isDesktop ? <span className="toolbar__title">Ori Studio</span> : <MenuBar />}
      </div>
      <div className="toolbar__actions">
        <IconButton
          size="sm"
          title={t('common:toolbar.new', 'New')}
          tooltipSide="bottom"
          disabled={!capabilities['file.new'].enabled}
          onClick={() => void handleMenuAction('file.new')}
        >
          <FilePlus size={15} />
        </IconButton>
        <IconButton
          size="sm"
          title={t('common:toolbar.open', 'Open')}
          tooltipSide="bottom"
          disabled={!capabilities['file.open'].enabled}
          onClick={() => void handleMenuAction('file.open')}
        >
          <FolderOpen size={15} />
        </IconButton>
        <IconButton
          size="sm"
          title={t('common:toolbar.save', 'Save')}
          tooltipSide="bottom"
          disabled={!capabilities['file.save'].enabled}
          onClick={() => void handleMenuAction('file.save')}
        >
          <Save size={15} />
        </IconButton>
        <span className="toolbar__separator" />
        {optimizeScale.visible && (
          <Button
            size="sm"
            variant={buildCp.enabled ? 'secondary' : 'primary'}
            disabled={!optimizeScale.enabled}
            title={optimizeScale.reason}
            onClick={() => void handleMenuAction('optimize.scale')}
          >
            <Sparkles size={14} />
            {t('common:toolbar.optimizeScale', 'Optimize Scale')}
          </Button>
        )}
        {buildCp.visible && (
          <Button
            size="sm"
            variant={buildCp.enabled ? 'primary' : 'secondary'}
            disabled={!buildCp.enabled}
            title={
              buildCp.enabled
                ? t('common:toolbar.sendToEditTooltip', "Send this design's crease pattern to the Edit canvas")
                : buildCp.reason
            }
            onClick={() => void sendTreeToEdit()}
          >
            <ScanLine size={14} />
            {t('common:toolbar.sendToEdit', 'Send to Edit')}
          </Button>
        )}
        {bpOptimizeLayout.visible && (
          <Button
            size="sm"
            variant="primary"
            disabled={!bpOptimizeLayout.enabled}
            title={bpOptimizeLayout.reason}
            onClick={() => void handleMenuAction('bp.optimize.layout')}
          >
            <Sparkles size={14} />
            {t('common:toolbar.optimizeLayout', 'Optimize')}
          </Button>
        )}
        {isBpContext && (
          <Button
            size="sm"
            // Optimize is the authoring step and Send to Edit the hand-off, so
            // Send steps back to secondary while Optimize is offered.
            variant={bpOptimizeLayout.enabled ? 'secondary' : 'primary'}
            disabled={!hasBpDocument || bpBusy}
            title={t('common:toolbar.sendToEditTooltip', "Send this design's crease pattern to the Edit canvas")}
            onClick={() => void sendBpToEdit()}
          >
            <ScanLine size={14} />
            {t('common:toolbar.sendToEdit', 'Send to Edit')}
          </Button>
        )}
        {(optimizeScale.visible || buildCp.visible || isBpContext) && (
          <span className="toolbar__separator" />
        )}
        <IconButton size="sm" title={t('common:toolbar.settings', 'Settings')} tooltipSide="bottom" onClick={() => openSettings()}>
          <Settings size={15} />
        </IconButton>
      </div>
    </header>
  );
}

/**
 * The Design workspace's tab strip, spanning the full canvas above every dock
 * panel.
 *
 * It belongs here rather than inside `DesignPanel` because a design is not one
 * pane: the box-pleat layout is two design surfaces side by side, and a strip
 * living inside one of them would appear to govern only that one. The tabs own
 * the whole workspace, so they sit above the whole workspace.
 */
function DesignWorkspaceTabs() {
  const activeWorkspace = useLayoutStore((state) => state.activeWorkspace);
  if (activeWorkspace !== 'design') return null;
  return <DesignTabStrip />;
}

/**
 * The box-pleat design workspace's attribution bar, spanning the full width
 * below both of its panes (the BP tree editor and the BP packing editor — both
 * are Box Pleating Studio surfaces).
 *
 * Only the box-pleat variant gets a workspace-spanning bar. The TreeMaker
 * variant has inspector/diagnostics/conditions tool panes on the right, which
 * the attribution must not underline, so it renders a pane-level footer inside
 * the design canvas instead (see DesignPanel). Edit/Simulate credit their own
 * upstreams via the About dialog.
 */
function DesignWorkspaceFooter() {
  const activeWorkspace = useLayoutStore((state) => state.activeWorkspace);
  const designMethod = useWorkspaceStore(selectDesignMethod);

  if (activeWorkspace !== 'design') return null;
  if (designMethod !== 'box-pleat') return null;
  return <DesignAttributionFooter method="bp" />;
}

/**
 * The workspace chrome: toolbar, workspace rail, and the shared Dockview canvas.
 * Mounted for every workspace route (`/design`, `/edit`, `/simulate`) and their
 * sub-paths, so the Dockview instance persists across workspace switches. The
 * active workspace route renders into the `<Outlet />` (an invisible sync
 * element) and drives which layout Dockview shows via `activeWorkspace`.
 */
export function WorkspaceShell() {
  const setDockviewApi = useLayoutStore((state) => state.setDockviewApi);
  const loadLayout = useLayoutStore((state) => state.loadLayout);
  const saveLayout = useLayoutStore((state) => state.saveLayout);
  const { dropTargetProps, isDragActive } = useFileDropTarget({ policy: WORKSPACE_DROP_POLICY });

  // The workspace/variant the URL targets at mount, captured in a ref so onReady
  // (fired once by Dockview, possibly before the route effect runs) builds the
  // right layout instead of the stale store default. onReady fires at mount, so
  // the mount-time value is what it needs; later route changes rebuild via
  // WorkspaceRoute without a fresh onReady.
  const location = useLocation();
  const targetRef = useRef(
    parseWorkspacePath(location.pathname) ?? { workspace: 'design' as WorkspaceId }
  );

  // Drop the disposed Dockview API when the shell unmounts (e.g. navigating to
  // /welcome) so a later remount doesn't operate on a dead handle.
  useEffect(() => () => setDockviewApi(null), [setDockviewApi]);

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      const { api } = event;
      setDockviewApi(api);

      // Build for the workspace the URL asks for, not the store default, so the
      // layout is built once, correctly, with no second rebuild churning the
      // WebGL canvas.
      const { workspace } = targetRef.current;
      useLayoutStore.setState({ activeWorkspace: workspace });

      let loaded = false;
      const saved = loadLayout(workspace);
      if (saved) {
        try {
          api.fromJSON(saved);
          loaded = true;
        } catch (error) {
          console.warn('Failed to restore layout', error);
          clearPersistedLayout(workspace);
        }
      }

      if (!loaded) {
        applyDefaultLayout(api, workspace);
      }

      // The active panel drives the active editing context (menus, history,
      // shortcuts). Seed it and keep it in sync as the user focuses panels.
      const setActivePanelId = useWorkspaceStore.getState().setActivePanelId;
      setActivePanelId(api.activePanel?.id ?? null);
      api.onDidActivePanelChange((panel) => {
        setActivePanelId(panel?.id ?? null);
      });

      let timer: ReturnType<typeof setTimeout> | null = null;
      api.onDidLayoutChange(() => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => saveLayout(), 250);
      });
    },
    [loadLayout, saveLayout, setDockviewApi]
  );

  // The chrome and the canvas get separate boundaries: a capability selector
  // that throws in the toolbar must not take the user's document down with it,
  // and vice versa. Each dock panel inside Dockview has its own (see
  // `withPanelErrorBoundary`), so this one only catches Dockview itself.
  return (
    <div className="app-layout">
      <ErrorBoundary surface="shell:toolbar" variant="strip">
        <Toolbar />
      </ErrorBoundary>
      <div className="workspace-shell">
        <ErrorBoundary surface="shell:rail" variant="mini">
          <WorkspaceRail />
        </ErrorBoundary>
        <div className="workspace-shell__canvas file-drop-region" {...dropTargetProps}>
          <ErrorBoundary surface="shell:design-tabs" variant="strip">
            <DesignWorkspaceTabs />
          </ErrorBoundary>
          {/*
            The wrapper is load-bearing: it, not dockview's own element, is the
            canvas grid's item. DockviewReact renders an unnamed div around the
            element that takes its `className`, so placing the dock by that class
            targets one level too deep — see the note in App.css.
          */}
          <div className="workspace-shell__dock">
            <ErrorBoundary surface="shell:dockview" variant="pane">
              <DockviewReact
                components={panelComponents}
                defaultTabComponent={FixedDockTab}
                onReady={onReady}
                className="dockview-theme-treemaker workspace-shell__dockview"
                disableFloatingGroups
              />
            </ErrorBoundary>
          </div>
          <DesignWorkspaceFooter />
          <FileDropOverlay visible={isDragActive} policy={WORKSPACE_DROP_POLICY} />
        </div>
      </div>
      <Outlet />
    </div>
  );
}
