import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import { FloatingToolbar } from '../../components/ui/FloatingToolbar';
import { resolveCpViewportCanvas } from '../cpViewportCanvas';
import { IconButton } from '../../components/ui/IconButton';
import { MenuIconButton } from '../../components/ui/MenuIconButton';
import { useCanvasObjectAnchor } from '../canvasObjects/useCanvasObjectAnchor';
import { foldedFigureBox } from '../adapters/cpFoldedToScene';
import {
  buildFoldedFigureActions,
  type FoldedFigureActionDeps,
  type FoldedFigureChoice,
  type FoldedFigureCommand,
  type FoldedFigureNoteAction,
} from './foldedFigureActions';
import { foldedFigureActionIconNode } from './foldedFigureActionIcons';
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

function ChoiceMenu({ action }: { action: FoldedFigureChoice }) {
  return (
    <DropdownMenu.Root>
      <MenuIconButton
        label={action.label}
        icon={foldedFigureActionIconNode(action.icon)}
        disabled={action.disabled}
      />
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="context-menu"
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          loop
        >
          {action.options.map((option) => (
            <DropdownMenu.Item
              key={option.id}
              className="context-menu__item"
              onSelect={option.run}
            >
              {/* The check column is reserved for an exclusive set only, so its
                  labels stay put as the check moves. A list of one-shot actions
                  has nothing to check, and an always-empty column just reads as
                  a stray indent. */}
              {action.exclusive && (
                <span className="context-menu__icon">{option.checked && <Check size={12} />}</span>
              )}
              <span className="context-menu__label">{option.label}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * Floating actions for the selected folded figure: flip, display style, another
 * solution, refold (when stale), duplicate, and delete. Hovers above the figure
 * via {@link FloatingToolbar}, mirroring {@link CpImageInspector}.
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
            return <ChoiceMenu key={action.id} action={action} />;
          case 'note':
            return <NoticeChip key={action.id} action={action} />;
          case 'command':
            return <CommandButton key={action.id} action={action} />;
        }
      })}
    </FloatingToolbar>
  );
}
