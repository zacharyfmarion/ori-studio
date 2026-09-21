import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { FloatingToolbar } from '../../components/ui/FloatingToolbar';
import { resolveCpViewportCanvas } from '../cpViewportCanvas';
import { IconButton } from '../../components/ui/IconButton';
import { MenuIconButton } from '../../components/ui/MenuIconButton';
import { ContextMenuItems } from '../../components/ui/ContextMenu';
import type { ContextMenuItem } from '../../components/ui/contextMenuTypes';
import { useCanvasObjectAnchor } from '../canvasObjects/useCanvasObjectAnchor';
import { foldedFigureBox } from '../adapters/cpFoldedToScene';
import {
  buildFoldedFigureActions,
  type FoldedFigureActionDeps,
  type FoldedFigureCommand,
  type FoldedFigureNoteAction,
} from './foldedFigureActions';
import { foldedFigureActionIconNode } from './foldedFigureActionIcons';
import { choiceMenuItems, styleMenuItems } from './foldedFigureMenuItems';
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';

function CommandButton({ action }: { action: FoldedFigureCommand }) {
  return (
    <IconButton
      size="sm"
      variant="toolbar"
      title={action.label}
      disabled={action.disabled}
      onClick={action.run}
    >
      {foldedFigureActionIconNode(action.icon)}
    </IconButton>
  );
}

/**
 * A 3D verdict, as a chip.
 *
 * A button when the verdict offers something to do about it, a plain span
 * otherwise — rather than a disabled button, which would read as an action that
 * is temporarily unavailable rather than as a statement of fact.
 */
function NoticeChip({ action }: { action: FoldedFigureNoteAction }) {
  const { notice } = action;
  const content = (
    <>
      {foldedFigureActionIconNode(action.icon)}
      <span className="cp-folded-figure-toolbar__notice-label">{notice.label}</span>
    </>
  );
  if (!action.run) {
    return (
      <span className="cp-folded-figure-toolbar__notice" data-tone={notice.tone} title={notice.detail}>
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="cp-folded-figure-toolbar__notice"
      data-tone={notice.tone}
      title={`${notice.detail} — ${notice.action?.label ?? ''}`.trim()}
      onClick={action.run}
    >
      {content}
    </button>
  );
}

/**
 * An icon button that opens rows from the context-menu vocabulary.
 *
 * The rows are the same descriptors the right-click menu renders, through the
 * same renderer, so the Style menu here and the Style submenu there are one
 * definition — a colour row or a check row is written once.
 *
 * Non-modal, unlike the right-click menu. A modal menu blocks pointer events
 * everywhere outside it, so the press that dismisses it never reaches the
 * canvas — and a press on the canvas away from the figure is how the figure is
 * deselected. This menu floats over a selection; a press elsewhere should
 * dismiss it *and* do what it would have done, which is what the viewport
 * bar's own dropdown always did.
 */
function ToolbarMenu({
  label,
  icon,
  disabled,
  items,
}: {
  label: string;
  icon: ReactNode;
  disabled: boolean;
  items: ContextMenuItem[];
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <MenuIconButton label={label} icon={icon} disabled={disabled} />
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="context-menu"
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          loop
        >
          <ContextMenuItems items={items} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * Floating actions for the selected folded figure: flip, style, another
 * solution, refold (when stale), export, duplicate, and delete. Hovers above the
 * figure via {@link FloatingToolbar}, mirroring {@link CpImageInspector}.
 *
 * Items come from {@link buildFoldedFigureActions}, which the right-click menu
 * also renders — so the two surfaces present the same verbs in the same order.
 *
 * Anchored in **`'user'`** space, unlike the image and crease-selection
 * toolbars: a folded figure is placed in SVG user coordinates, the space its
 * render primitives land in, while annotations live in crease-pattern model
 * space (see `TransformableCanvasObject.space`). The two coincide only when no
 * native Oriedita camera is active, so passing `'model'` here would leave the
 * pill drifting off the figure rather than failing outright.
 */
export function CpFoldedFigureToolbar({
  figure,
  container,
  deps,
}: {
  figure: OristudioCpFoldedFigureEntry;
  /** Element the canvas is positioned against — see {@link useCanvasObjectAnchor}. */
  container: HTMLElement | null;
  deps: Omit<FoldedFigureActionDeps, 't'>;
}) {
  const { t } = useTranslation();
  const box = useMemo(() => foldedFigureBox(figure), [figure]);
  // Subscribed in this small component (not the panel) so the toolbar tracks the
  // camera live; see useCanvasObjectAnchor.
  const anchorRect = useCanvasObjectAnchor(box, 'user', container);
  const actions = useMemo(
    () => buildFoldedFigureActions(figure, { ...deps, t }),
    [figure, deps, t]
  );

  // A figure that draws nothing (still folding, errored, empty) has no box to
  // hang the toolbar off.
  if (!box) return null;

  return (
    <FloatingToolbar
      anchorRect={anchorRect}
      boundary={container}
      wheelTarget={resolveCpViewportCanvas}
      className="cp-folded-figure-toolbar"
      ariaLabel={t('panels:foldedFigureActions.label', 'Folded figure actions')}
    >
      {actions.map((action) => {
        switch (action.kind) {
          case 'separator':
            return <span key={action.id} className="floating-toolbar__separator" />;
          case 'choice':
            return (
              <ToolbarMenu
                key={action.id}
                label={action.label}
                icon={foldedFigureActionIconNode(action.icon)}
                disabled={action.disabled}
                items={choiceMenuItems(action)}
              />
            );
          case 'group':
            return (
              <ToolbarMenu
                key={action.id}
                label={action.label}
                icon={foldedFigureActionIconNode(action.icon)}
                disabled={action.disabled}
                items={styleMenuItems(action, { keepOpen: true })}
              />
            );
          case 'note':
            return <NoticeChip key={action.id} action={action} />;
          case 'command':
            return <CommandButton key={action.id} action={action} />;
        }
      })}
    </FloatingToolbar>
  );
}
