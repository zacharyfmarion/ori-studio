import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react';

/**
 * The colour input whose picker is open in this menu, if one is.
 *
 * One fact, kept once per menu rather than per row, because what hangs off it
 * is menu-wide: the shield over the page, the watch for the picker closing on
 * its own, and every row declining to take focus on hover — see
 * {@link hoverFocusProps}. `release` lets a row stand down only its own
 * picker, so a row unmounting cannot clear a sibling's.
 */
interface MenuPicker {
  openInput: HTMLInputElement | null;
  setOpenInput: (input: HTMLInputElement) => void;
  release: (input: HTMLInputElement) => void;
}

const MenuPickerContext = createContext<MenuPicker | null>(null);

/**
 * Absorb the press that closes an open colour picker.
 *
 * The engine closes its picker on any press outside it, and that press then
 * lands on the page — where it would dismiss the menu and, on the canvas,
 * deselect the figure the menu belongs to. The picker is the topmost thing on
 * screen, so a press outside it should close the picker and nothing else. A
 * plain DOM node, deliberately outside React: nothing about it may reach the
 * menu's handlers, and stopping the event at the node itself is what keeps
 * Radix's document-level outside-press listener from seeing it. Its own
 * default action still runs, which moves focus off the input — the blur that
 * commits the drag.
 *
 * Below the menu (the rows stay usable, the picker's own window is not in the
 * DOM at all) and above everything else. Removed on that press, on the input
 * blurring, on the engine reporting the picker closed, and with the menu.
 */
function mountPickerShield(onPress: () => void): () => void {
  const shield = document.createElement('div');
  shield.className = 'context-menu__picker-shield';
  shield.setAttribute('aria-hidden', 'true');
  const swallow = (event: Event) => event.stopPropagation();
  shield.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    onPress();
  });
  for (const type of ['pointerup', 'pointermove', 'mousedown', 'mouseup', 'click', 'wheel']) {
    shield.addEventListener(type, swallow);
  }
  shield.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  document.body.appendChild(shield);
  return () => shield.remove();
}

/** How often to ask the engine whether the picker is still up, in ms. */
const PICKER_POLL_MS = 100;

/**
 * Whether the engine says `input`'s picker is showing, or `null` where it
 * cannot say — `:open` is what reports it, and an engine without the
 * pseudo-class rejects the selector outright.
 */
function pickerShowing(input: HTMLInputElement): boolean | null {
  try {
    return input.matches(':open');
  } catch {
    return null;
  }
}

/**
 * Call `onClosed` once the engine reports the picker gone.
 *
 * A picker can close without the page hearing a thing: a pick in WebKit's
 * popover closes the popover, and Chromium's panel has its own close button.
 * Neither blurs the input or fires an event for it, and a shield left up past
 * that swallows the user's next press for nothing. Asked, though, the engine
 * answers — `:open` on the input follows the picker — so this asks until the
 * answer turns from yes to no. Polled rather than observed because nothing
 * observable changes: no attribute, no event, only a pseudo-class.
 *
 * Only a yes-then-no counts. A picker that never reported open — an engine
 * without `:open`, or one whose picker does not set it — leaves the shield to
 * come down on a press or a blur, as it always has.
 */
function watchPickerClosed(input: HTMLInputElement, onClosed: () => void): () => void {
  if (pickerShowing(input) === null) return () => {};
  let reportedOpen = false;
  const timer = window.setInterval(() => {
    const showing = pickerShowing(input);
    if (showing) {
      reportedOpen = true;
    } else if (reportedOpen) {
      window.clearInterval(timer);
      onClosed();
    }
  }, PICKER_POLL_MS);
  return () => window.clearInterval(timer);
}

/**
 * Wraps one menu's rows — the top-level content's, which a submenu's share
 * through the portal — so a colour row can say its picker is open and every
 * row can ask.
 */
export function MenuPickerProvider({ children }: { children: ReactNode }) {
  const [openInput, setOpenInput] = useState<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!openInput) return undefined;
    const close = () => setOpenInput(null);
    const removeShield = mountPickerShield(close);
    const stopWatching = watchPickerClosed(openInput, close);
    return () => {
      removeShield();
      stopWatching();
    };
  }, [openInput]);
  // Stable, as a row's unmount cleanup depends on it.
  const release = useCallback(
    (input: HTMLInputElement) => setOpenInput((current) => (current === input ? null : current)),
    []
  );
  const value = useMemo<MenuPicker>(
    () => ({ openInput, setOpenInput, release }),
    [openInput, release]
  );
  return <MenuPickerContext.Provider value={value}>{children}</MenuPickerContext.Provider>;
}

export function useMenuPicker(): MenuPicker {
  const picker = useContext(MenuPickerContext);
  if (!picker) {
    throw new Error('Context-menu rows must be rendered through ContextMenuItems');
  }
  return picker;
}

function declineHover(event: PointerEvent) {
  event.preventDefault();
}

/**
 * Props for a row that must not take focus while a colour picker is open.
 *
 * Radix moves focus to whichever row the mouse is over — every `pointermove`
 * on a row focuses it, and leaving one focuses the menu — which is what makes
 * a menu feel native. It also blurs whatever held focus, and while a colour
 * picker is open that is its input: WebKit closes the picker the moment the
 * input blurs (`ColorInputType::elementDidBlur`), so in Safari the picker went
 * away on the first mouse movement. Chromium's picker survives a blur, which
 * is why it only ever looked like a Safari bug.
 *
 * Radix skips its own handler when the event arrives default-prevented — the
 * same signal it uses internally to hold focus while the pointer crosses to a
 * submenu — so that is how a row declines. On every row, not only the one
 * whose picker is up: a picker stays until it is dismissed, not until the
 * mouse drifts over a neighbour. A press on a row still focuses it as a
 * press does, which blurs the input and closes the picker, as it should.
 */
export function hoverFocusProps(picker: MenuPicker): {
  onPointerMove?: (event: PointerEvent) => void;
  onPointerLeave?: (event: PointerEvent) => void;
} {
  return picker.openInput ? { onPointerMove: declineHover, onPointerLeave: declineHover } : {};
}
