/**
 * A pen's dash, picked by name from a menu that draws every option.
 *
 * A dash is run lengths in multiples of the pen's width, and typing `8 2 1 2`
 * is not how anyone recognises a dash-dot line — so the menu draws each named
 * dash and keeps the numbers for the one row that needs them. The custom field
 * is inside the menu, where the named dashes are, rather than beside the
 * trigger: it is the same question answered the long way.
 *
 * Its own menu rather than one of the three the app already has, each of which
 * this would have to fight: `ContextMenu` anchors to a cursor position and
 * renders descriptor lists, with no room for a field; `Select` is a value
 * picker whose options cannot hold one either; and Radix's menu — what both are
 * built on — treats every character typed inside it as type-ahead, which is
 * exactly the keystrokes this field is for. What Radix would have given us is
 * written out here instead: `aria-haspopup` / `aria-expanded`, arrow-key focus
 * across the options *and* the field, Escape back to the trigger, click
 * outside to dismiss, and the flip upward when the menu would open past the
 * bottom of the scrolling panel.
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { dashPresetLabel } from '../../i18n/enumLabels';
import { isShortcutEditingTarget } from '../../keyboard/shortcutDispatcher';
import {
  DASH_PRESETS,
  dashPresetOf,
  dashPresetRuns,
} from '../../lib/paper/paperDashPresets';
import { formatDashText, parseDashText } from '../../lib/paper/paperDashText';
import type { Pen } from '../../lib/paper/paperStyle';
import styles from './PaperDashMenu.module.css';

/**
 * The preview line's width, and so the unit its multiples resolve against: a
 * preview is a picture of the *pattern*, not of the pen, and drawing it at the
 * pen's own weight would make a hairline's dashes vanish next to a thick one's.
 */
const PREVIEW_STROKE = 1.6;
const TRIGGER_PREVIEW_WIDTH = 56;
const OPTION_PREVIEW_WIDTH = 64;

/** How tall the menu is taken to be when choosing which way to open it. */
export const DASH_MENU_HEIGHT = 240;

/**
 * Whether the menu should open upward: it would otherwise reach past `limit`,
 * the bottom of whatever is scrolling it, and a menu clipped by its own panel
 * cannot be scrolled into view — opening it is what moved the trigger.
 */
export function dashMenuFlipsUp(triggerBottom: number, limit: number): boolean {
  return triggerBottom + DASH_MENU_HEIGHT > limit;
}

/** A dash as the preview draws it: its multiples at the preview's own width. */
export function previewDashArray(dash: number[] | null): string | undefined {
  if (!dash || dash.length === 0) return undefined;
  return dash.map((run) => Math.round(run * PREVIEW_STROKE * 100) / 100).join(' ');
}

/** The bottom of the scrolling box `element` sits in, or the viewport's. */
function scrollBoxBottom(element: HTMLElement): number {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return node.getBoundingClientRect().bottom;
    }
  }
  return window.innerHeight;
}

/** The options and the custom field, in the order the arrow keys walk them. */
function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return Array.from(menu?.querySelectorAll<HTMLElement>('[data-dash-item]') ?? []);
}

function DashPreview({ dash, width }: { dash: number[] | null; width: number }) {
  return (
    <svg
      className={styles.preview}
      width={width}
      height={12}
      aria-hidden="true"
      focusable="false"
    >
      <line
        x1="1"
        y1="6"
        x2={width - 1}
        y2="6"
        stroke="currentColor"
        strokeWidth={PREVIEW_STROKE}
        strokeDasharray={previewDashArray(dash)}
      />
    </svg>
  );
}

export function PaperDashMenu({
  label,
  pen,
  disabled,
  onCommit,
}: {
  /** The trigger's accessible name — the pen's own, since the menu is that pen's dash. */
  label: string;
  pen: Pen;
  disabled: boolean;
  onCommit: (dash: number[] | null) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [flipUp, setFlipUp] = useState(false);
  const [draft, setDraft] = useState(() => formatDashText(pen.dash));
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const customId = useId();
  const choice = dashPresetOf(pen);

  useEffect(() => {
    setDraft(formatDashText(pen.dash));
  }, [pen.dash]);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const openMenu = useCallback(() => {
    const trigger = triggerRef.current;
    setFlipUp(
      trigger
        ? dashMenuFlipsUp(trigger.getBoundingClientRect().bottom, scrollBoxBottom(trigger))
        : false
    );
    setOpen(true);
  }, []);

  // A press anywhere else is an answer too: the dash stays as it was. Capture,
  // so a control underneath still receives the press that dismissed the menu.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  // Opening takes focus to the dash that is current, so a keyboard lands on
  // the answer it is most likely to keep and can walk from there.
  useEffect(() => {
    if (!open) return;
    const items = menuItems(menuRef.current);
    (items.find((item) => item.dataset.current === 'true') ?? items[0])?.focus();
  }, [open]);

  const commitDraft = () => {
    const parsed = parseDashText(draft);
    // A half-typed `8 2 1` is a different dash and an `8 x` is none: put the
    // field back rather than write either.
    if (parsed === undefined) {
      setDraft(formatDashText(pen.dash));
      return;
    }
    setDraft(formatDashText(parsed));
    if (formatDashText(parsed) !== formatDashText(pen.dash)) onCommit(parsed);
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === 'Tab') {
      close(false);
      return;
    }
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0 && event.key !== 'Home' && event.key !== 'End') return;
    // Home and End are the caret's, not the roving focus's, when the press came
    // from the custom field: they are the two keys a text field most needs, and
    // taking them would move focus out mid-edit and commit the half-typed run.
    // Up and down still walk, because one line has nowhere else to go.
    if (step === 0 && isShortcutEditingTarget(event.target)) return;
    const items = menuItems(menuRef.current);
    if (items.length === 0) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (at + step + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div className={styles.root}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        data-open={open || undefined}
        disabled={disabled}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            openMenu();
          }
        }}
      >
        <DashPreview dash={pen.dash} width={TRIGGER_PREVIEW_WIDTH} />
        <span className={styles.label}>
          {choice === 'custom'
            ? t('dialogs:settings.paper.dash.customNamed', 'Custom · {{runs}}', {
                runs: formatDashText(pen.dash),
              })
            : dashPresetLabel(t, choice)}
        </span>
        <ChevronDown size={12} aria-hidden="true" className={styles.chevron} />
      </button>
      {open && (
        <div
          ref={menuRef}
          className={styles.menu}
          data-placement={flipUp ? 'top' : 'bottom'}
          onKeyDown={onMenuKeyDown}
        >
          {/*
            The menu is the named dashes alone. `role="menu"` may own menu
            items and nothing else, so the custom field is a sibling of the
            menu rather than a child of it — a textbox inside one is skipped by
            a screen reader that switches to menu navigation there, which is
            the one control this field exists to be.
          */}
          <div role="menu" aria-label={label} className={styles.options}>
            {DASH_PRESETS.map((preset) => {
              const current = choice === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={current}
                  className={styles.option}
                  data-dash-item=""
                  data-current={current || undefined}
                  tabIndex={-1}
                  onClick={() => {
                    onCommit(dashPresetRuns(preset.id));
                    close(true);
                  }}
                >
                  <DashPreview dash={preset.dash} width={OPTION_PREVIEW_WIDTH} />
                  <span>{dashPresetLabel(t, preset.id)}</span>
                </button>
              );
            })}
          </div>
          <div className={styles.custom} role="group" aria-labelledby={customId}>
            <span className={styles.customName} id={customId}>
              {t('dialogs:settings.paper.dash.custom', 'Custom')}
            </span>
            <input
              className={styles.customField}
              type="text"
              aria-label={t('dialogs:settings.paper.dash.customField', 'Custom dash')}
              placeholder="8 2 1 2"
              value={draft}
              data-dash-item=""
              tabIndex={-1}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onBlur={commitDraft}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitDraft();
                }
              }}
            />
            <span className={styles.customUnit}>
              {t('dialogs:settings.paper.dash.customUnit', '× width')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
