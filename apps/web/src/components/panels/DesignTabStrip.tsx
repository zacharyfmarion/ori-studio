import * as Tabs from '@radix-ui/react-tabs';
import { Copy, Pencil, Plus, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { designKind } from '../../designKinds';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DesignTab } from '../../store/workspaceStore/designTabs';
import { ContextMenu } from '../ui/ContextMenu';
import type { ContextMenuItem } from '../ui/contextMenuTypes';
import { IconButton } from '../ui/IconButton';

/**
 * The Design workspace's tab strip.
 *
 * Radix `Tabs` supplies the parts that are tedious to get right by hand —
 * `tablist`/`tab` roles, `aria-selected`, roving tabindex, arrow-key navigation.
 * Everything Radix does not cover is composed on top: close buttons, inline
 * rename, drag-reorder, and a context menu.
 *
 * The design surface itself is rendered by `DesignPanel`, **not** by
 * `Tabs.Content`. Radix unmounts inactive content, and under lazy hydrate only
 * the active design holds a live engine handle anyway — so there is exactly one
 * surface, keyed by the active tab, rather than N mounted surfaces competing for
 * the same canvas.
 */
export function DesignTabStrip() {
  const { t } = useTranslation();
  const designTabs = useWorkspaceStore((state) => state.designTabs);
  const activeDesignId = useWorkspaceStore((state) => state.activeDesignId);
  const activateDesignTab = useWorkspaceStore((state) => state.activateDesignTab);
  const addDesignTab = useWorkspaceStore((state) => state.addDesignTab);
  // The confirming close, not the primitive: every user-facing close has to
  // prompt on a design that has been worked on, whichever control raised it.
  const requestCloseDesignTab = useWorkspaceStore((state) => state.requestCloseDesignTab);
  const renameDesignTab = useWorkspaceStore((state) => state.renameDesignTab);
  const reorderDesignTab = useWorkspaceStore((state) => state.reorderDesignTab);
  const duplicateDesignTab = useWorkspaceStore((state) => state.duplicateDesignTab);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menuTarget, setMenuTarget] = useState<{ id: string; x: number; y: number } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  /**
   * A rename asked for from the context menu, held until the menu lets go of
   * focus. Starting it inside `onSelect` does not work: the menu's focus trap is
   * still armed, so it pulls focus straight back out of the field — which blurs
   * it, which commits and ends the rename before a key is pressed.
   */
  const pendingRenameRef = useRef<string | null>(null);

  const closeLabel = t('panels:designTabs.close', 'Close design');
  const addLabel = t('panels:designTabs.add', 'New design');
  const moveLeftLabel = t('panels:designTabs.moveLeft', 'Move left');
  const moveRightLabel = t('panels:designTabs.moveRight', 'Move right');

  /**
   * The context menu is also the keyboard route to reordering. Drag alone is not
   * reachable without a pointer, so "Move left / Move right" is not a
   * convenience — it is the accessible equivalent of the drag.
   */
  const menuItems = useCallback(
    (tabId: string): ContextMenuItem[] => {
      const index = designTabs.findIndex((tab) => tab.id === tabId);
      const tab = designTabs[index];
      if (!tab) return [];
      return [
        {
          kind: 'action',
          id: 'rename',
          label: t('panels:designTabs.rename', 'Rename'),
          icon: <Pencil size={14} />,
          onSelect: () => {
            pendingRenameRef.current = tabId;
          },
        },
        {
          kind: 'action',
          id: 'duplicate',
          label: t('panels:designTabs.duplicate', 'Duplicate'),
          icon: <Copy size={14} />,
          // A chooser tab has nothing to copy through the codec.
          disabled: tab.kind === null,
          onSelect: () => void duplicateDesignTab(tabId),
        },
        { kind: 'separator' },
        {
          kind: 'action',
          id: 'move-left',
          label: moveLeftLabel,
          disabled: index <= 0,
          onSelect: () => reorderDesignTab(tabId, index - 1),
        },
        {
          kind: 'action',
          id: 'move-right',
          label: moveRightLabel,
          disabled: index >= designTabs.length - 1,
          onSelect: () => reorderDesignTab(tabId, index + 1),
        },
        { kind: 'separator' },
        {
          kind: 'action',
          id: 'close',
          label: closeLabel,
          icon: <X size={14} />,
          danger: true,
          onSelect: () => void requestCloseDesignTab(tabId),
        },
      ];
    },
    [
      closeLabel,
      requestCloseDesignTab,
      designTabs,
      duplicateDesignTab,
      moveLeftLabel,
      moveRightLabel,
      reorderDesignTab,
      t,
    ],
  );

  return (
    <div className="design-tab-strip" data-testid="design-tab-strip">
      <Tabs.Root
        className="design-tab-strip__root"
        value={activeDesignId}
        onValueChange={activateDesignTab}
        // Manual: activating a tab parks the outgoing design's engine handle and
        // may hydrate the incoming one. That is far too much work to fire while
        // someone arrows past a tab on the way to another.
        activationMode="manual"
        orientation="horizontal"
      >
        <Tabs.List
          className="design-tab-strip__list"
          aria-label={t('panels:designTabs.label', 'Open designs')}
        >
          {designTabs.map((tab) => (
            <DesignTabItem
              key={tab.id}
              tab={tab}
              closeLabel={closeLabel}
              // Closing the only tab is allowed — it re-provisions a fresh
              // chooser tab. But when that only tab *is* an untouched chooser,
              // closing it would swap one empty tab for an identical one, so the
              // control is hidden rather than made into a no-op.
              closable={designTabs.length > 1 || tab.kind !== null}
              renaming={renamingId === tab.id}
              dragging={draggingId === tab.id}
              onRenameStart={() => setRenamingId(tab.id)}
              onRenameEnd={(title) => {
                if (title !== null) renameDesignTab(tab.id, title);
                setRenamingId(null);
              }}
              onClose={() => void requestCloseDesignTab(tab.id)}
              onContextMenu={(x, y) => setMenuTarget({ id: tab.id, x, y })}
              onDragStart={() => setDraggingId(tab.id)}
              onDragEnd={() => setDraggingId(null)}
              onDropAt={(toIndex) => reorderDesignTab(tab.id, toIndex)}
            />
          ))}
        </Tabs.List>
      </Tabs.Root>
      <IconButton
        size="sm"
        className="design-tab-strip__add"
        title={addLabel}
        aria-label={addLabel}
        onClick={addDesignTab}
      >
        <Plus size={14} />
      </IconButton>
      {menuTarget ? (
        <ContextMenu
          open
          x={menuTarget.x}
          y={menuTarget.y}
          items={menuItems(menuTarget.id)}
          onOpenChange={(open) => {
            if (!open) setMenuTarget(null);
          }}
          onCloseAutoFocus={(event) => {
            const pending = pendingRenameRef.current;
            if (pending === null) return;
            pendingRenameRef.current = null;
            // The rename field takes focus instead of the menu handing it back.
            event.preventDefault();
            setRenamingId(pending);
          }}
        />
      ) : null}
    </div>
  );
}

interface DesignTabItemProps {
  tab: DesignTab;
  closeLabel: string;
  closable: boolean;
  renaming: boolean;
  dragging: boolean;
  onRenameStart: () => void;
  onRenameEnd: (title: string | null) => void;
  onClose: () => void;
  onContextMenu: (x: number, y: number) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropAt: (toIndex: number) => void;
}

function DesignTabItem({
  tab,
  closeLabel,
  closable,
  renaming,
  dragging,
  onRenameStart,
  onRenameEnd,
  onClose,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDropAt,
}: DesignTabItemProps) {
  const Icon = tab.kind === null ? null : (designKind(tab.kind)?.chooser.Icon ?? null);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || renaming) return;
    const strip = event.currentTarget.parentElement;
    if (!strip) return;
    const startX = event.clientX;
    let moved = false;

    const onMove = (move: PointerEvent) => {
      if (!moved) {
        if (Math.abs(move.clientX - startX) < DRAG_THRESHOLD_PX) return;
        moved = true;
        onDragStart();
      }
      // Hit-test the row rather than track drop zones: the strip is a single
      // line of tabs, so whichever tab is under the cursor is the destination.
      //
      // Both indices come from the live DOM. The drag reorders as it goes, so
      // this tab's own position changes mid-gesture — comparing against the
      // index it had at pointerdown would make every later move look like one.
      const row = [...strip.querySelectorAll('[data-design-tab]')];
      const from = row.findIndex((element) => element.getAttribute('data-design-tab') === tab.id);
      const over = row.findIndex((element) => {
        const box = element.getBoundingClientRect();
        return move.clientX >= box.left && move.clientX <= box.right;
      });
      if (over !== -1 && over !== from) onDropAt(over);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (moved) onDragEnd();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <div
      className={`design-tab${dragging ? ' design-tab--dragging' : ''}`}
      data-design-tab={tab.id}
      data-design-kind={tab.kind ?? 'none'}
      onPointerDown={handlePointerDown}
      // On the whole tab, not just the trigger: the label is short and the tab
      // is not, so double-clicking the empty space beside it has to work too.
      onDoubleClick={renaming ? undefined : onRenameStart}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu(event.clientX, event.clientY);
      }}
    >
      {renaming ? (
        // The input *replaces* the trigger rather than nesting inside it. A
        // focusable control inside `role="tab"` is invalid, and a disabled
        // trigger would swallow the input's pointer events entirely.
        <DesignTabNameInput title={tab.title} onDone={onRenameEnd} />
      ) : (
        <Tabs.Trigger value={tab.id} className="design-tab__trigger">
          {Icon ? <Icon size={13} /> : null}
          <span className="design-tab__title">{tab.title}</span>
        </Tabs.Trigger>
      )}
      {closable && !renaming ? (
        // A sibling of the trigger, never a child — see above.
        <button
          type="button"
          className="design-tab__close"
          aria-label={`${closeLabel}: ${tab.title}`}
          title={closeLabel}
          onClick={onClose}
          // Keeps the close out of the tab's drag and rename gestures.
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <X size={12} />
        </button>
      ) : null}
    </div>
  );
}

/** How far the pointer travels before a click becomes a reorder drag. */
const DRAG_THRESHOLD_PX = 4;

/**
 * The inline rename field.
 *
 * While it is mounted it owns its keystrokes. It does not need a bespoke guard
 * for that: `isShortcutEditingTarget` in the shortcut dispatcher already treats
 * a focused `<input>` as owning its keys, so the workspace shortcut runtime
 * stays out of the way on its own.
 */
function DesignTabNameInput({
  title,
  onDone,
}: {
  title: string;
  onDone: (title: string | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(title);
  // Commit-on-blur plus commit-on-Enter would otherwise fire twice, and Escape
  // would be undone by the blur that follows it.
  const settled = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (next: string | null) => {
    if (settled.current) return;
    settled.current = true;
    onDone(next);
  };

  return (
    <input
      ref={ref}
      className="design-tab__name-input"
      aria-label={title}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(value)}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(value);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          finish(null);
        }
      }}
    />
  );
}
