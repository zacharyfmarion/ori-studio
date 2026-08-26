import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlipHorizontal2,
  Hand,
  Layers,
  Maximize2,
  RotateCcwSquare,
  RotateCwSquare,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { IconButton } from '../ui/IconButton';
import { primaryModifierLabel } from '../../lib/platform';
import { useIsCoarsePointerSurface } from '../../platform/pointerSurface';
import { useIsPhoneLayout } from '../../platform/phoneLayout';
import { ViewportToolbarOverflowMenu } from './ViewportToolbarOverflowMenu';
import {
  planViewportToolbar,
  viewportToolbarSlots,
  type ViewportToolbarEntry,
  type ViewportToolbarGroupSpec,
  type ViewportToolbarItem,
} from './viewportToolbarLayout';

export type { ViewportToolbarEntry, ViewportToolbarGroupSpec } from './viewportToolbarLayout';

const ZOOM_PRESETS = [25, 50, 100, 200, 400];

/**
 * Close an open popover when the press lands outside its anchor.
 *
 * `pointerdown` and not `mousedown`, which is what the bar's three popovers used
 * and what made them undismissable on an iPad. The compatibility mouse events a
 * touch produces are suppressed entirely when `pointerdown` is canceled, and the
 * crease-pattern canvas cancels it on essentially every press (see
 * `CreasePatternWebglCanvas`'s `onPointerDown`) — so tapping the paper to put a
 * menu away fired no `mousedown`, and the menu stayed up over the canvas.
 *
 * Dismissing this early cannot mis-route the rest of the tap the way the View
 * drawer's did: these popovers cover only their own box, so whatever the press
 * landed on was already its target.
 */
function useToolbarPopover() {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (anchorRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return { open, setOpen, anchorRef };
}

/** `Label (Chord)` when the action has a chord bound, plain label otherwise. */
function withShortcut(label: string, shortcut: string | undefined): string {
  return shortcut ? `${label} (${shortcut})` : label;
}

/**
 * View rotation in degrees, trimmed of trailing zeros so the 11.25 degree step
 * reads exactly (11.25, 22.5, 33.75, 45) rather than rounding to nothing.
 */
function formatRotationValue(radians: number): string {
  const degrees = (radians * 180) / Math.PI;
  return `${Number.parseFloat(degrees.toFixed(2))}`;
}

/** The same value with its degree sign, for the idle field. */
function formatRotation(radians: number): string {
  return `${formatRotationValue(radians)}°`;
}

export function isViewportInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  // A focused rich-text editor (contenteditable) owns its keystrokes — space,
  // arrows, delete — so the canvas must not treat them as shortcuts (e.g.
  // space-to-pan swallowing the space bar mid-edit).
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return Boolean(
    target.closest('button, input, textarea, select, [role="menu"], [contenteditable="true"]')
  );
}

/** The zoom percentage, and the preset list behind it. */
function ZoomReadout({
  zoomPercent,
  setZoomLevel,
}: {
  zoomPercent: number;
  setZoomLevel: (scale: number) => void;
}) {
  const { open, setOpen, anchorRef } = useToolbarPopover();

  return (
    <div className="viewport-toolbar__menu-anchor" ref={anchorRef}>
      <button
        type="button"
        className="viewport-toolbar__zoom-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        {zoomPercent}%
      </button>
      {open && (
        <div className="viewport-toolbar__dropdown" role="menu">
          {ZOOM_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className="viewport-toolbar__dropdown-item"
              onClick={() => {
                setZoomLevel(preset / 100);
                setOpen(false);
              }}
            >
              {preset}%
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The editable view-rotation readout.
 *
 * Fine pointers only. On touch the field is 52px wide with a mandatory 16px font
 * (below that, Safari zooms the page on focus and `body { overflow: hidden }`
 * leaves no gesture to get back), so `-168.75°` already runs out of its box —
 * and a text field cannot live in the overflow menu, whose rows are
 * `role="menuitem"` with typeahead. The rotate buttons and a reset go there
 * instead.
 */
function RotationField({
  viewRotation,
  setViewRotation,
}: {
  viewRotation: number;
  setViewRotation: (degrees: number) => void;
}) {
  const { t } = useTranslation();
  // Null while the field is idle, so it tracks the camera; a string while the
  // user is editing, so their partial input is not overwritten mid-frame.
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const degrees = Number.parseFloat(draft);
    setDraft(null);
    if (Number.isFinite(degrees)) setViewRotation(degrees);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      className="viewport-toolbar__rotation-input"
      aria-label={t('tools:viewport.rotation', 'View rotation in degrees')}
      title={t('tools:viewport.rotation', 'View rotation in degrees')}
      value={draft ?? formatRotation(viewRotation)}
      onFocus={(event) => {
        // Drop the degree sign while editing so the field holds a plain
        // number, and select it so typing replaces the angle outright.
        setDraft(formatRotationValue(viewRotation));
        event.currentTarget.select();
      }}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          setDraft(null);
          event.currentTarget.blur();
        }
        // Digits typed here cannot reach the canvas shortcuts:
        // `isShortcutEditingTarget` bails on any input at the
        // capture-phase listener, before dispatch.
      }}
      onBlur={commit}
    />
  );
}

function InlineItem({ item }: { item: ViewportToolbarItem }) {
  if (item.kind === 'node') return <>{item.node}</>;
  return (
    <IconButton
      size="sm"
      variant="toolbar"
      title={item.title ?? item.label}
      aria-label={item.label}
      isActive={item.checked}
      disabled={item.disabled}
      onClick={item.onSelect}
    >
      {item.icon}
    </IconButton>
  );
}

interface ViewportToolbarProps {
  ariaLabel: string;
  zoomPercent: number;
  zoomIn: () => void;
  zoomOut: () => void;
  fitToView: () => void;
  setZoomLevel: (scale: number) => void;
  /**
   * Hand-tool state. Both are supplied together, or neither — a surface that
   * has no pan mode simply omits them and the button is not rendered.
   */
  panToolActive?: boolean;
  togglePanTool?: () => void;
  /** Resolved chord for the pan toggle, shown in its tooltip. */
  panShortcutLabel?: string;
  /**
   * View-rotation controls. Supplied together or not at all; a surface with no
   * rotatable camera omits them and the buttons are not rendered.
   */
  viewRotation?: number;
  /** Rotate by one step: -1 anticlockwise, +1 clockwise. */
  rotateView?: (direction: 1 | -1) => void;
  /** Set an absolute view rotation, in degrees, from the readout field. */
  setViewRotation?: (degrees: number) => void;
  /**
   * Back to square. Offered on touch in place of the readout field, where it is
   * the only way to undo a rotation in one step — `viewport.resetRotation` ships
   * with no default chord, so on a device with no keyboard it was unreachable.
   */
  resetViewRotation?: () => void;
  rotateCcwShortcutLabel?: string;
  rotateCwShortcutLabel?: string;
  /**
   * Everything the surface adds after the shared view controls, as runs that
   * belong together. A run is never split by a line break, and the hairline
   * between two runs is drawn by the bar rather than by the caller.
   */
  groups?: readonly ViewportToolbarGroupSpec[];
  /**
   * What the shared view controls do on the **phone** layout.
   *
   * `'inline'`, the default, is today's behaviour everywhere. `'collapsed'`
   * hands the bar over to {@link groups}: the zoom buttons and their readout go
   * entirely, and Fit, pan and the rotation controls fall into the overflow
   * menu despite being pinned.
   *
   * Opt-in per call site rather than a blanket phone rule, because the trade is
   * only worth it where the caller has something better to put there. A phone
   * has no tool rail, so its bar is the only strip a surface owns — but that is
   * an argument for spending it, not for emptying it, and a surface with no
   * groups of its own would just end up with a bar holding one button.
   *
   * What it costs is real: pinch scales about the finger centroid, so it pans
   * while it zooms, and the buttons were the only way to change scale without
   * moving the view. Fit, one tap away in the menu, is the recovery.
   */
  phoneViewControls?: 'inline' | 'collapsed';
}

/**
 * The floating pill of view controls over a canvas.
 *
 * Four surfaces render it — the crease-pattern editor, the circle-packing design
 * canvas, the box-pleating packing pane, and the two tree editors — with control
 * sets that overlap only in zoom and fit. So what belongs inline and what can
 * collapse is declared per call site, in `groups`, rather than decided here.
 *
 * On a coarse pointer every control is 44px and the row no longer fits any iPad
 * in portrait (the crease-pattern bar wants 615px against a 470px pane on an
 * iPad mini). Collapsing the verbs a touch gesture already covers — pan is a
 * two-finger drag on the canvas — gets it onto one line; anything still too wide
 * wraps between groups, never inside one.
 */
export function ViewportToolbar({
  ariaLabel,
  zoomPercent,
  zoomIn,
  zoomOut,
  fitToView,
  setZoomLevel,
  panToolActive,
  togglePanTool,
  panShortcutLabel,
  viewRotation = 0,
  rotateView,
  setViewRotation,
  resetViewRotation,
  rotateCcwShortcutLabel,
  rotateCwShortcutLabel,
  groups = [],
  phoneViewControls = 'inline',
}: ViewportToolbarProps) {
  const { t } = useTranslation();
  const coarse = useIsCoarsePointerSurface();
  // `useIsPhoneLayout`, not `useIsPhoneSurface`: this is a question about the
  // viewport, and the latter is false on both Tauri shells — a native iPhone
  // build would take the tablet arrangement through it.
  const phoneLayout = useIsPhoneLayout();
  const handOverBar = phoneLayout && phoneViewControls === 'collapsed';

  const rotateCcwLabel = t('tools:viewport.rotateCcw', 'Rotate view left');
  const rotateCwLabel = t('tools:viewport.rotateCw', 'Rotate view right');

  // Two answers, applied to every shared control below: zoom leaves outright
  // because a pinch replaces it, and everything else keeps a home in the menu
  // because nothing replaces it. Named here rather than repeated so the split
  // is one decision instead of six.
  const zoomOnPhone = handOverBar ? ('omit' as const) : undefined;
  const viewOnPhone = handOverBar ? ('collapse' as const) : undefined;

  const plan = planViewportToolbar(
    [
      {
        id: 'zoom',
        items: [
          {
            kind: 'action',
            id: 'zoom-out',
            label: t('tools:viewport.zoomOut', 'Zoom Out'),
            icon: <ZoomOut size={14} />,
            onSelect: zoomOut,
            // Pinch scales about the finger centroid, so it moves the view as
            // well; these are the only way to change scale without panning, and
            // a stylus is excluded from pinching outright.
            pinned: true,
            // Dropped rather than collapsed where a caller has handed the bar
            // over. A two-finger pinch is on every phone and covers this well
            // enough that two menu rows for it would crowd out the verbs that
            // have no gesture at all.
            onPhone: zoomOnPhone,
          },
          {
            kind: 'node',
            id: 'zoom-readout',
            node: <ZoomReadout zoomPercent={zoomPercent} setZoomLevel={setZoomLevel} />,
            // Goes with the buttons it reads for. A percentage alone, with
            // nothing beside it to change, is a diagnostic rather than a
            // control.
            onPhone: zoomOnPhone,
          },
          {
            kind: 'action',
            id: 'zoom-in',
            label: t('tools:viewport.zoomIn', 'Zoom In'),
            icon: <ZoomIn size={14} />,
            onSelect: zoomIn,
            pinned: true,
            onPhone: zoomOnPhone,
          },
        ],
      },
      {
        id: 'view',
        items: [
          {
            kind: 'action',
            id: 'fit',
            label: t('tools:viewport.fit', 'Fit'),
            icon: <Maximize2 size={14} />,
            onSelect: fitToView,
            // No gesture frames the paper, and it is what a hand reaches for
            // straight after a pinch.
            pinned: true,
            // The one control the phone handover keeps rather than drops: with
            // the zoom buttons gone this is the only way back from a pinch that
            // has wandered, so it collapses into the menu instead of leaving.
            onPhone: viewOnPhone,
          },
          togglePanTool && {
            kind: 'action',
            id: 'pan',
            label: t('tools:viewport.pan', 'Pan'),
            title: panShortcutLabel
              ? t('tools:viewport.panWithShortcut', 'Pan ({{shortcut}}) — or hold {{modifier}} and drag', {
                  shortcut: panShortcutLabel,
                  modifier: primaryModifierLabel(),
                })
              : t('tools:viewport.panWithModifier', 'Pan — or hold {{modifier}} and drag', {
                  modifier: primaryModifierLabel(),
                }),
            icon: <Hand size={14} />,
            checked: panToolActive ?? false,
            // Left-drag panning instead of drawing is not visible until you
            // drag, so the trigger says so while the button is behind it.
            unseenWhenCollapsed: true,
            onSelect: togglePanTool,
          },
          rotateView && {
            kind: 'action',
            id: 'rotate-ccw',
            label: rotateCcwLabel,
            title: withShortcut(rotateCcwLabel, rotateCcwShortcutLabel),
            icon: <RotateCcwSquare size={14} />,
            onSelect: () => rotateView(-1),
          },
          rotateView &&
            setViewRotation && {
              kind: 'node',
              id: 'rotation',
              only: 'fine',
              node: <RotationField viewRotation={viewRotation} setViewRotation={setViewRotation} />,
            },
          rotateView && {
            kind: 'action',
            id: 'rotate-cw',
            label: rotateCwLabel,
            title: withShortcut(rotateCwLabel, rotateCwShortcutLabel),
            icon: <RotateCwSquare size={14} />,
            onSelect: () => rotateView(1),
          },
          resetViewRotation && {
            kind: 'action',
            id: 'rotate-reset',
            only: 'coarse',
            label: t('tools:viewport.resetRotation', 'Reset view rotation'),
            icon: <Undo2 size={14} />,
            // Disabled at square, which is also how the menu says whether the
            // view is rotated at all now that the readout field is gone.
            disabled: viewRotation === 0,
            onSelect: resetViewRotation,
          },
        ],
      },
      ...groups,
    ],
    coarse,
    phoneLayout
  );

  const inlineGroups =
    plan.overflow.length > 0
      ? [
          ...plan.inline,
          {
            id: 'overflow',
            items: [
              {
                kind: 'node' as const,
                id: 'overflow',
                node: <ViewportToolbarOverflowMenu groups={plan.overflow} />,
              },
            ],
          },
        ]
      : plan.inline;

  return (
    <div className="viewport-toolbar" aria-label={ariaLabel}>
      {viewportToolbarSlots(inlineGroups).map((slot) =>
        slot.kind === 'separator' ? (
          <span key={slot.id} className="viewport-toolbar__separator" />
        ) : (
          <div key={slot.id} className="viewport-toolbar__group">
            {slot.group.items.map((item) => (
              <Fragment key={item.id}>
                <InlineItem item={item} />
              </Fragment>
            ))}
          </div>
        )
      )}
    </div>
  );
}

/**
 * Mirror draw, on a tree canvas.
 *
 * Named rather than abbreviated: symmetry is a mode the drawing is *in*, and
 * worth reading at a glance next to the icon-only view controls. Here rather
 * than in any one pane because there are three tree canvases — box-pleat's,
 * ExplOri's and circle-packing's — and they had drifted into two components and
 * two labels ("Mirror draw" and "Sym").
 *
 * The box-pleating *editor*'s own mirror button is deliberately not this: it is
 * the second appearance of the control, in a denser toolbar, and stays an icon.
 */
export function ViewportSymmetryToggle({
  enabled,
  label,
  title,
  onToggle,
}: {
  enabled: boolean;
  label: string;
  /** Tooltip and accessible name; says which way the toggle would go. */
  title: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="viewport-toolbar__symmetry-button"
      data-active={enabled || undefined}
      aria-pressed={enabled}
      // No `aria-label`: it would override the visible "Symmetry" text, so the
      // accessible name would not contain the label a person can see — a
      // Label-in-Name failure, and voice control ("click Symmetry") would hit
      // nothing. `title` remains, as the tooltip it always was, and
      // `aria-pressed` already conveys which way the toggle is set.
      title={title}
      onClick={onToggle}
    >
      <FlipHorizontal2 size={14} />
      <span>{label}</span>
    </button>
  );
}

/**
 * The mirror toggle as toolbar items: the named button on a pointer device, a
 * checkable menu row on touch.
 *
 * Declared as two mutually exclusive items rather than one that renders two
 * ways, because they are genuinely different controls — the button carries its
 * label as text, which is what makes it 92px wide and what makes it worth
 * collapsing on a pane that has 323px to spend.
 */
export function viewportSymmetryItems({
  enabled,
  label,
  title,
  onToggle,
}: {
  enabled: boolean;
  label: string;
  title: string;
  onToggle: () => void;
}): ViewportToolbarEntry[] {
  return [
    {
      kind: 'node',
      id: 'symmetry',
      only: 'fine',
      node: (
        <ViewportSymmetryToggle enabled={enabled} label={label} title={title} onToggle={onToggle} />
      ),
    },
    {
      kind: 'action',
      id: 'symmetry',
      only: 'coarse',
      label,
      title,
      icon: <FlipHorizontal2 size={14} />,
      checked: enabled,
      onSelect: onToggle,
    },
  ];
}

export interface ViewportLayerOption<Key extends string> {
  key: Key;
  icon: ReactNode;
  label: string;
}

/**
 * The layer popover as toolbar items: the popover on a pointer device, one
 * checkable menu row per layer on touch.
 *
 * The popover survives the move intact because it is already a data-driven
 * option list; what it gains is a 44px row per layer in place of a 24px native
 * checkbox, and the trigger's 46px back for the row.
 */
export function viewportLayerItems<Key extends string>({
  title,
  options,
  visible,
  onChange,
}: {
  title: string;
  options: readonly ViewportLayerOption<Key>[];
  visible: Record<Key, boolean>;
  onChange: (key: Key, next: boolean) => void;
}): ViewportToolbarEntry[] {
  return [
    {
      kind: 'node',
      id: 'layers',
      only: 'fine',
      node: (
        <ViewportLayerMenu title={title} options={options} visible={visible} onChange={onChange} />
      ),
    },
    ...options.map(
      (option): ViewportToolbarEntry => ({
        kind: 'action',
        id: `layer-${option.key}`,
        only: 'coarse',
        label: option.label,
        icon: option.icon,
        checked: visible[option.key],
        onSelect: () => onChange(option.key, !visible[option.key]),
      })
    ),
  ];
}

/**
 * The toolbar's layer-visibility popover: a toggle button and a checkbox list
 * that closes on an outside click.
 *
 * Both BP panes carried their own copy of this, including the outside-click
 * effect. Only the option table and its labels differ, so those are the props;
 * everything else lives here once.
 */
export function ViewportLayerMenu<Key extends string>({
  title,
  options,
  visible,
  onChange,
}: {
  title: string;
  options: readonly ViewportLayerOption<Key>[];
  visible: Record<Key, boolean>;
  onChange: (key: Key, next: boolean) => void;
}) {
  const { open, setOpen, anchorRef } = useToolbarPopover();

  return (
    <div className="viewport-toolbar__menu-anchor" ref={anchorRef}>
      <IconButton
        size="sm"
        variant="toolbar"
        title={title}
        isActive={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <Layers size={14} />
      </IconButton>
      {open && (
        <div className="design-layer-menu" role="menu">
          {options.map((option) => (
            <label key={option.key} className="design-layer-option">
              <input
                type="checkbox"
                checked={visible[option.key]}
                onChange={(event) => onChange(option.key, event.target.checked)}
              />
              <span className="design-layer-option__icon">{option.icon}</span>
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export interface ViewportChoiceOption<Value extends string | number> {
  value: Value;
  label: string;
}

/**
 * Single-select sibling of {@link ViewportLayerMenu}, for a toolbar control with
 * a handful of mutually exclusive choices.
 */
export function ViewportChoiceMenu<Value extends string | number>({
  title,
  icon,
  options,
  value,
  onChange,
}: {
  title: string;
  icon: ReactNode;
  options: readonly ViewportChoiceOption<Value>[];
  value: Value;
  onChange: (value: Value) => void;
}) {
  const { open, setOpen, anchorRef } = useToolbarPopover();

  return (
    <div className="viewport-toolbar__menu-anchor" ref={anchorRef}>
      <IconButton
        size="sm"
        variant="toolbar"
        title={title}
        isActive={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        {icon}
      </IconButton>
      {open && (
        <div className="design-layer-menu" role="menu">
          {options.map((option) => (
            <label key={String(option.value)} className="design-layer-option">
              <input
                type="radio"
                checked={option.value === value}
                onChange={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
