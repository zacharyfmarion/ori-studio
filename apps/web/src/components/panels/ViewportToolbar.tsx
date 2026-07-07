import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { IconButton } from '../ui/IconButton';

const ZOOM_PRESETS = [25, 50, 100, 200, 400];

export function isViewportInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('button, input, textarea, select, [role="menu"]'));
}

interface ViewportToolbarProps {
  ariaLabel: string;
  zoomPercent: number;
  zoomIn: () => void;
  zoomOut: () => void;
  fitToView: () => void;
  setZoomLevel: (scale: number) => void;
  children?: ReactNode;
}

export function ViewportToolbar({
  ariaLabel,
  zoomPercent,
  zoomIn,
  zoomOut,
  fitToView,
  setZoomLevel,
  children,
}: ViewportToolbarProps) {
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
      <IconButton size="sm" variant="toolbar" title="Zoom Out" onClick={zoomOut}>
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
      <IconButton size="sm" variant="toolbar" title="Zoom In" onClick={zoomIn}>
        <ZoomIn size={14} />
      </IconButton>
      <ViewportToolbarSeparator />
      <IconButton size="sm" variant="toolbar" title="Fit" onClick={fitToView}>
        <Maximize2 size={14} />
      </IconButton>
      {children}
    </div>
  );
}

export function ViewportToolbarSeparator() {
  return <span className="viewport-toolbar__separator" />;
}
