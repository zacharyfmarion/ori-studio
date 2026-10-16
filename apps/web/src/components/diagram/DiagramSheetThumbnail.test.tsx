import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { DiagramSheetThumbnail } from './DiagramSheetThumbnail';
import { useThemeStore } from '../../store/themeStore';
import type { SheetThumbnail } from '../../cp-workspace/sheets/sheetThumbnail';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it('rasterizes ordered crease inks, rejects non-finite coordinates and redraws when the theme changes', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const strokes: number[] = [];
  const context = {
    save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn(), setTransform: vi.fn(),
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), lineWidth: 0,
    stroke: () => strokes.push(context.lineWidth),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: (entries: unknown[]) => void) {}
    observe() { this.callback([{ contentRect: { width: 100, height: 100 } }]); }
    disconnect = disconnect;
  });
  const thumbnail: SheetThumbnail = {
    viewBox: '0 0 100 100',
    strokes: [
      { role: 'mountain', x1: 0, y1: 0, x2: 100, y2: 100 },
      { role: 'valley', x1: 0, y1: 100, x2: 100, y2: 0 },
      { role: 'edge', x1: 50, y1: 0, x2: 50, y2: 100 },
      { role: 'edge', x1: NaN, y1: 0, x2: 100, y2: 0 },
    ],
  };
  const theme = useThemeStore.getState().currentTheme;
  try {
    act(() => root.render(<DiagramSheetThumbnail thumbnail={thumbnail} />));
    expect(strokes).toEqual([1.1, 1.1, 1.6]);
    expect(context.moveTo.mock.calls).toEqual([[0, 0], [0, 100], [50, 0]]);
    expect(context.lineTo.mock.calls).toEqual([[100, 100], [100, 0], [50, 100]]);
    expect(host.querySelector('canvas')?.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('svg')).toBeNull();
    act(() => useThemeStore.setState({ currentTheme: { ...theme } }));
    expect(strokes).toHaveLength(6);
    expect(disconnect).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount()); host.remove();
    useThemeStore.setState({ currentTheme: theme });
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});
