import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { PatternThumbnail } from './PatternThumbnail';
import { useThemeStore } from '../../store/themeStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { applyFoldAngleOpacity } from '../../cp-workspace/foldAngle/foldAngleRamp';
import { FOLD_MAGNITUDE_UNITS_PER_DEGREE } from '../../lib/foldAngle';
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
    act(() => root.render(<PatternThumbnail thumbnail={thumbnail} />));
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

it('paints an aux line in the unassigned grey, or in Edit’s aux-line ink when asked (Fold’s precreases)', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const inks: string[] = [];
  const context = {
    save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn(), setTransform: vi.fn(),
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), lineWidth: 0, strokeStyle: '',
    stroke: () => inks.push(context.strokeStyle),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const tokens: Record<string, string> = { '--sheet-thumb-unassigned': 'grey', '--fold-flat': 'aux-ink' };
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    getPropertyValue: (name: string) => tokens[name] ?? '',
  } as unknown as CSSStyleDeclaration);
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: (entries: unknown[]) => void) {}
    observe() { this.callback([{ contentRect: { width: 100, height: 100 } }]); }
    disconnect() {}
  });
  const thumbnail: SheetThumbnail = { viewBox: '0 0 100 100', strokes: [{ role: 'aux', x1: 0, y1: 0, x2: 100, y2: 100 }] };
  try {
    act(() => root.render(<PatternThumbnail thumbnail={thumbnail} />));
    act(() => root.render(<PatternThumbnail thumbnail={thumbnail} auxInk="aux" />));
    expect(inks).toEqual(['grey', 'aux-ink']);
    expect(host.querySelector('canvas')?.getAttribute('data-aux-ink')).toBe('aux');
  } finally {
    act(() => root.unmount()); host.remove();
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});

it('shades a crease folded short of 180° as Edit’s canvas does, in the View panel’s style, in a path of its own', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const painted: { ink: string; alpha: number; lines: number }[] = [];
  let lines = 0;
  const context = {
    save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn(), setTransform: vi.fn(),
    beginPath: () => { lines = 0; }, moveTo: () => { lines += 1; }, lineTo: vi.fn(),
    lineWidth: 0, strokeStyle: '', globalAlpha: 1,
    stroke: () => painted.push({ ink: context.strokeStyle, alpha: context.globalAlpha, lines }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const tokens: Record<string, string> = {
    '--sheet-thumb-mountain': '#ff4d5d',
    '--sheet-thumb-valley': '#60a5fa',
    '--fold-angle-anchor': '#d946ef',
  };
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    getPropertyValue: (name: string) => tokens[name] ?? '',
  } as unknown as CSSStyleDeclaration);
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: (entries: unknown[]) => void) {}
    observe() { this.callback([{ contentRect: { width: 100, height: 100 } }]); }
    disconnect() {}
  });
  const thumbnail: SheetThumbnail = {
    viewBox: '0 0 100 100',
    strokes: [
      { role: 'valley', x1: 0, y1: 0, x2: 100, y2: 100 },
      { role: 'valley', x1: 0, y1: 100, x2: 100, y2: 0, foldDegrees: 90 },
      { role: 'valley', x1: 50, y1: 0, x2: 50, y2: 100, foldDegrees: 90 },
      { role: 'mountain', x1: 0, y1: 50, x2: 100, y2: 50 },
    ],
  };
  const viewport = useWorkspaceStore.getState().oristudioCpViewport;
  const ninety = 90 * FOLD_MAGNITUDE_UNITS_PER_DEGREE;
  try {
    act(() => root.render(<PatternThumbnail thumbnail={thumbnail} />));
    // The full valley as before; the two at 90° together, at Edit's alpha; then the mountain.
    expect(painted).toEqual([
      { ink: '#60a5fa', alpha: 1, lines: 1 },
      { ink: '#60a5fa', alpha: applyFoldAngleOpacity([0, 0, 0, 1], ninety)[3], lines: 2 },
      { ink: '#ff4d5d', alpha: 1, lines: 1 },
    ]);
    painted.length = 0;
    act(() => useWorkspaceStore.setState({ oristudioCpViewport: { ...viewport, foldAngleDisplay: 'color' } }));
    // The colour style moves the hue instead, at full opacity.
    expect(painted[1]?.alpha).toBe(1);
    expect(painted[1]?.ink).not.toBe('#60a5fa');
    expect(painted[0]).toEqual({ ink: '#60a5fa', alpha: 1, lines: 1 });
  } finally {
    act(() => root.unmount()); host.remove();
    useWorkspaceStore.setState({ oristudioCpViewport: viewport });
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});
