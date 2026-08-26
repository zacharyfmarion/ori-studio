import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, MoreHorizontal } from 'lucide-react';
import { MenuIconButton } from '../ui/MenuIconButton';
import {
  hasUnseenActiveMode,
  viewportToolbarSlots,
  type ViewportToolbarAction,
  type ViewportToolbarOverflowGroup,
} from './viewportToolbarLayout';

function OverflowItem({
  action,
  onOpenDialog,
}: {
  action: ViewportToolbarAction;
  /** Told before the select runs, so the close that follows keeps its hands off focus. */
  onOpenDialog: () => void;
}) {
  // The leading slot is the action's own icon, swapped for a tick while the mode
  // is on — the shape `ContextMenu` already uses for a checked item, so a row
  // here is the same width as a row anywhere else in the app.
  const leading = <span className="context-menu__icon">{action.checked ? <Check size={12} /> : action.icon}</span>;

  if (action.checked === undefined) {
    return (
      <DropdownMenu.Item
        className="context-menu__item"
        disabled={action.disabled}
        onSelect={() => {
          if (action.opensDialog) onOpenDialog();
          action.onSelect();
        }}
      >
        {leading}
        <span className="context-menu__label">{action.label}</span>
      </DropdownMenu.Item>
    );
  }

  return (
    <DropdownMenu.CheckboxItem
      className="context-menu__item"
      checked={action.checked}
      disabled={action.disabled}
      // A verb closes the menu; a mode does not. Radix closes on select unless
      // the event is canceled, and the modes here arrive in runs — the packing
      // pane collapses twelve layer toggles into this menu, and closing after
      // each one would cost twelve reopenings to set three of them.
      onSelect={(event) => {
        event.preventDefault();
        action.onSelect();
      }}
    >
      {leading}
      <span className="context-menu__label">{action.label}</span>
    </DropdownMenu.CheckboxItem>
  );
}

/**
 * The `⋯` end of the viewport toolbar on a touch device, and everything the bar
 * gave up to fit on one line.
 *
 * A **portalled** Radix menu, which is the point: the bar's own popovers are
 * `position: absolute` children of it opening upward out of its box, so the
 * obvious way to make a too-wide row fit — `overflow-x: auto` — would compute
 * `overflow-y` to `auto` as well and trap every one of them in a scroll box.
 * Nothing here introduces an overflow context, so all of them keep working
 * untouched; this menu escapes the bar entirely by rendering into `body`.
 *
 * `role="menu"` comes from Radix, which matters beyond a11y:
 * `isViewportInteractiveTarget` claims it, so space-to-pan does not fire while
 * the menu has focus.
 */
export function ViewportToolbarOverflowMenu({
  groups,
}: {
  groups: readonly ViewportToolbarOverflowGroup[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // Set by the one exit that must *not* hand the trigger back — see
  // `opensDialog`. A ref, not state: it is read inside `onCloseAutoFocus`, which
  // fires during the same close, and a re-render would be both pointless and
  // too late.
  const openedDialogRef = useRef(false);

  return (
    <DropdownMenu.Root
      open={open}
      onOpenChange={(next) => {
        // Cleared on every open, so a dialog-opening select cannot leave the
        // flag set and silently swallow the focus return of the *next* visit.
        if (next) openedDialogRef.current = false;
        setOpen(next);
      }}
    >
      <MenuIconButton
        label={t('tools:viewport.more', 'More view controls')}
        icon={<MoreHorizontal size={14} />}
        // Pressed while open, and while a mode it hides is switched on with
        // nothing else on screen to say so.
        isActive={open || hasUnseenActiveMode(groups)}
      />
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="context-menu viewport-toolbar__overflow-menu"
          // Upward, like every other menu on this bar — the bar sits on the
          // bottom edge of the canvas, so there is nowhere below to open into.
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={8}
          loop
          /*
            Swallow the contact that dismissed the menu, on touch.
            `DropdownMenu.Root` is modal, so Radix puts `pointer-events: none` on
            the body while the menu is open. The `pointerdown` therefore lands on
            `<html>`, the menu unmounts, and the *click* then hit-tests fresh
            against a toolbar whose pointer events are back — so the tap that
            dismissed the menu also presses whatever it landed on. Measured: a
            backdrop tap over Zoom In took the canvas from 68% to 92% on a tablet
            and 47% to 63% on a phone, and the same strip covers Fit, Fold and
            Insert image.
            This is the hazard the View drawer and the tool sheet each fixed by
            dismissing on `click` rather than `pointerdown`; a Radix layer cannot
            be moved that way, so the original event is neutered instead while
            Radix's own dismissal proceeds. Coarse-pointer only, because a mouse
            is already handled — the modal layer blocks its click — and because
            an outside click that both dismisses and acts is long-standing
            desktop behaviour that is not this change's to alter.
          */
          onPointerDownOutside={(event) => {
            if (event.detail.originalEvent.pointerType === 'mouse') return;
            event.detail.originalEvent.preventDefault();
            event.detail.originalEvent.stopPropagation();
          }}
          /*
            Radix hands focus back to the trigger as this unmounts, which is
            right for Escape and for a tap outside and wrong for the one item
            that opened a dialog: that restore lands *after* the dialog's own
            mount effect, so the dialog opens with focus on the toolbar button
            behind it — inaudible with `aria-modal` in force. Prevented only for
            that case, so every other exit keeps the behaviour it had.
          */
          onCloseAutoFocus={(event) => {
            if (openedDialogRef.current) event.preventDefault();
          }}
        >
          {viewportToolbarSlots(groups).map((slot) =>
            slot.kind === 'separator' ? (
              <DropdownMenu.Separator key={slot.id} className="context-menu__separator" />
            ) : (
              slot.group.items.map((action) => (
                <OverflowItem
                  key={action.id}
                  action={action}
                  onOpenDialog={() => {
                    openedDialogRef.current = true;
                  }}
                />
              ))
            )
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
