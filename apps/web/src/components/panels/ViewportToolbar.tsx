import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Hand, Layers, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { IconButton } from '../ui/IconButton';

const ZOOM_PRESETS = [25, 50, 100, 200, 400];

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
  children,
}: ViewportToolbarProps) {
  const { t } = useTranslation();
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const zoomMenuRef = useRef<HTMLDivElement | null>(null);

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
      <IconButton size="sm" variant="toolbar" title={t('tools:viewport.zoomOut', 'Zoom Out')} onClick={zoomOut}>
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
      <IconButton size="sm" variant="toolbar" title={t('tools:viewport.zoomIn', 'Zoom In')} onClick={zoomIn}>
        <ZoomIn size={14} />
      </IconButton>
      <ViewportToolbarSeparator />
      <IconButton size="sm" variant="toolbar" title={t('tools:viewport.fit', 'Fit')} onClick={fitToView}>
        <Maximize2 size={14} />
      </IconButton>
      {togglePanTool && (
        <IconButton
          size="sm"
          variant="toolbar"
          title={t('tools:viewport.pan', 'Pan')}
          isActive={panToolActive}
          onClick={togglePanTool}
        >
          <Hand size={14} />
        </IconButton>
      )}
      {children}
    </div>
  );
}

export function ViewportToolbarSeparator() {
  return <span className="viewport-toolbar__separator" />;
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
