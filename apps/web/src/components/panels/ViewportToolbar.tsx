import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlipHorizontal2,
  Hand,
  Layers,
  Maximize2,
  RotateCcwSquare,
  RotateCwSquare,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { IconButton } from '../ui/IconButton';
import { primaryModifierLabel } from '../../lib/platform';

const ZOOM_PRESETS = [25, 50, 100, 200, 400];

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
    target.closest('button, input, textarea, select, [role="menu"], [contenteditable="true"]'),
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
  rotateCcwShortcutLabel?: string;
  rotateCwShortcutLabel?: string;
  children?: ReactNode;
}

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
  rotateCcwShortcutLabel,
  rotateCwShortcutLabel,
  children,
}: ViewportToolbarProps) {
  const { t } = useTranslation();
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const zoomMenuRef = useRef<HTMLDivElement | null>(null);
  // Null while the field is idle, so it tracks the camera; a string while the
  // user is editing, so their partial input is not overwritten mid-frame.
  const [rotationDraft, setRotationDraft] = useState<string | null>(null);

  const commitRotationDraft = () => {
    if (rotationDraft === null) return;
    const degrees = Number.parseFloat(rotationDraft);
    setRotationDraft(null);
    if (Number.isFinite(degrees)) setViewRotation?.(degrees);
  };

  useEffect(() => {
    if (!zoomMenuOpen) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (zoomMenuRef.current?.contains(target)) return;
      setZoomMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [zoomMenuOpen]);

  return (
    <div className="viewport-toolbar" aria-label={ariaLabel}>
      <IconButton
        size="sm"
        variant="toolbar"
        title={t('tools:viewport.zoomOut', 'Zoom Out')}
        onClick={zoomOut}
      >
        <ZoomOut size={14} />
      </IconButton>
      <div className="viewport-toolbar__menu-anchor" ref={zoomMenuRef}>
        <button
          type="button"
          className="viewport-toolbar__zoom-button"
          aria-haspopup="menu"
          aria-expanded={zoomMenuOpen}
          onClick={() => setZoomMenuOpen((open) => !open)}
        >
          {zoomPercent}%
        </button>
        {zoomMenuOpen && (
          <div className="viewport-toolbar__dropdown" role="menu">
            {ZOOM_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className="viewport-toolbar__dropdown-item"
                onClick={() => {
                  setZoomLevel(preset / 100);
                  setZoomMenuOpen(false);
                }}
              >
                {preset}%
              </button>
            ))}
          </div>
        )}
      </div>
      <IconButton
        size="sm"
        variant="toolbar"
        title={t('tools:viewport.zoomIn', 'Zoom In')}
        onClick={zoomIn}
      >
        <ZoomIn size={14} />
      </IconButton>
      <ViewportToolbarSeparator />
      <IconButton
        size="sm"
        variant="toolbar"
        title={t('tools:viewport.fit', 'Fit')}
        onClick={fitToView}
      >
        <Maximize2 size={14} />
      </IconButton>
      {togglePanTool && (
        <IconButton
          size="sm"
          variant="toolbar"
          title={
            panShortcutLabel
              ? t(
                  'tools:viewport.panWithShortcut',
                  'Pan ({{shortcut}}) — or hold {{modifier}} and drag',
                  {
                    shortcut: panShortcutLabel,
                    modifier: primaryModifierLabel(),
                  },
                )
              : t('tools:viewport.panWithModifier', 'Pan — or hold {{modifier}} and drag', {
                  modifier: primaryModifierLabel(),
                })
          }
          aria-label={t('tools:viewport.pan', 'Pan')}
          isActive={panToolActive}
          onClick={togglePanTool}
        >
          <Hand size={14} />
        </IconButton>
      )}
      {rotateView && (
        <>
          <IconButton
            size="sm"
            variant="toolbar"
            title={withShortcut(
              t('tools:viewport.rotateCcw', 'Rotate view left'),
              rotateCcwShortcutLabel,
            )}
            aria-label={t('tools:viewport.rotateCcw', 'Rotate view left')}
            onClick={() => rotateView(-1)}
          >
            <RotateCcwSquare size={14} />
          </IconButton>
          {setViewRotation && (
            <input
              type="text"
              inputMode="decimal"
              className="viewport-toolbar__rotation-input"
              aria-label={t('tools:viewport.rotation', 'View rotation in degrees')}
              title={t('tools:viewport.rotation', 'View rotation in degrees')}
              value={rotationDraft ?? formatRotation(viewRotation)}
              onFocus={(event) => {
                // Drop the degree sign while editing so the field holds a plain
                // number, and select it so typing replaces the angle outright.
                setRotationDraft(formatRotationValue(viewRotation));
                event.currentTarget.select();
              }}
              onChange={(event) => setRotationDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  commitRotationDraft();
                  event.currentTarget.blur();
                } else if (event.key === 'Escape') {
                  setRotationDraft(null);
                  event.currentTarget.blur();
                }
                // Digits typed here cannot reach the canvas shortcuts:
                // `isShortcutEditingTarget` bails on any input at the
                // capture-phase listener, before dispatch.
              }}
              onBlur={commitRotationDraft}
            />
          )}
          <IconButton
            size="sm"
            variant="toolbar"
            title={withShortcut(
              t('tools:viewport.rotateCw', 'Rotate view right'),
              rotateCwShortcutLabel,
            )}
            aria-label={t('tools:viewport.rotateCw', 'Rotate view right')}
            onClick={() => rotateView(1)}
          >
            <RotateCwSquare size={14} />
          </IconButton>
        </>
      )}
      {children}
    </div>
  );
}

export function ViewportToolbarSeparator() {
  return <span className="viewport-toolbar__separator" />;
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

export interface ViewportLayerOption<Key extends string> {
  key: Key;
  icon: ReactNode;
  label: string;
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
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (anchorRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

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
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (anchorRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

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
