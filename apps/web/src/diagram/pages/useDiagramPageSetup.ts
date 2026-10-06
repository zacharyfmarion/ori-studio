import { useCallback, useMemo } from 'react';
import { trackDiagramPageSetupChanged, type DiagramPageSetting } from '../../analytics';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  DEFAULT_DIAGRAM_STYLE,
  DEFAULT_PAGE_SETUP,
  defaultHanStyle,
  type DiagramHanStyle,
  type DiagramPageSetup,
  type DiagramStep,
  stepsOf,
} from '../document/diagramDocument';
import { pageCellMm, pathWidthMm, splitIntoPages } from './diagramPageLayout';
import type { DiagramStyleChoice } from './diagramStyleChoices';

const NO_STEPS: readonly DiagramStep[] = [];

/**
 * The Page pane's store bindings (AGENTS.md › Panel components): the page
 * setup, style and Han style, each change one undo step and one count of
 * which setting changed, and how many pages the steps make.
 *
 * The flow path's colour is not here: its row binds itself
 * (`usePathColorPick`), so that a pick's moves re-render the row alone.
 */
export function useDiagramPageSetup() {
  const page = useWorkspaceStore((state) => state.diagram?.page ?? DEFAULT_PAGE_SETUP);
  const title = useWorkspaceStore((state) => state.diagram?.title ?? '');
  const style = useWorkspaceStore((state) => state.diagram?.style ?? DEFAULT_DIAGRAM_STYLE);
  // A diagram not made yet takes the author's language's, as its first edit will.
  const hanStyle = useWorkspaceStore(
    (state) =>
      state.diagram?.hanStyle ?? defaultHanStyle(typeof document === 'undefined' ? null : document.documentElement.lang)
  );
  const readOnly = useWorkspaceStore((state) => state.diagramReadOnly);
  const steps = useWorkspaceStore((state) => (state.diagram ? stepsOf(state.diagram) : NO_STEPS));
  const perPage = page.columns * page.rows;
  const pageCount = useMemo(() => splitIntoPages(steps, perPage).length, [steps, perPage]);

  const setPage = useCallback((patch: Partial<DiagramPageSetup>, setting: DiagramPageSetting) => {
    if (useWorkspaceStore.getState().setDiagramPage(patch)) trackDiagramPageSetupChanged(setting);
  }, []);
  const setStyle = useCallback((choice: DiagramStyleChoice) => {
    if (useWorkspaceStore.getState().setDiagramStyle(choice.style)) {
      trackDiagramPageSetupChanged('style', choice.analytics);
    }
  }, []);
  const setHanStyle = useCallback((next: DiagramHanStyle) => {
    if (useWorkspaceStore.getState().setDiagramHanStyle(next)) trackDiagramPageSetupChanged('han_style');
  }, []);

  // The path's width as it prints: the one chosen, or the one the steps give it, to the mm.
  const pathWidth = useMemo(
    () => ({ mm: Math.round(pathWidthMm(page, pageCellMm(page, title))), chosen: page.pathWidthMm !== null }),
    [page, title]
  );
  const setPathWidth = useCallback((mm: number | null) => setPage({ pathWidthMm: mm }, 'path_width'), [setPage]);

  return {
    page,
    style,
    hanStyle,
    readOnly,
    stepCount: steps.length,
    perPage,
    pageCount,
    pathWidth,
    setPage,
    setStyle,
    setHanStyle,
    setPathWidth,
  };
}
