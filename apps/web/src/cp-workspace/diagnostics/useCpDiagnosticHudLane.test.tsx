import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  OristudioCpCommandResult,
  OristudioCpDiagnosticEntry,
} from '../../engine/oristudioCpTypes';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { CpDiagnosticHud } from './CpDiagnosticHud';
import { CP_HUD_LANE_GAP } from './hudPlacement';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no ResizeObserver, and the lane hook is the only thing here that
// wants one — every re-measure in this file is driven by the resize event below.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

let root: Root | null = null;
let viewport: HTMLDivElement | null = null;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  viewport?.remove();
  viewport = null;
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

function entry(id: string): OristudioCpDiagnosticEntry {
  return { id, kind: 'CheckCamv', severity: 'error', message: id, point: { x: 0, y: 0 } };
}

/** jsdom does no layout, so every box this rule reads has to be stated. */
function stubRect(element: Element, rect: { left: number; right: number; bottom: number }) {
  const width = rect.right - rect.left;
  element.getBoundingClientRect = () =>
    ({ ...rect, top: 0, x: rect.left, y: 0, width, height: rect.bottom }) as DOMRect;
}

/**
 * The HUD inside a viewport that also holds the tool hint's status readout —
 * the arrangement `CreasePatternPanel` renders, and the only one in which the
 * two can collide.
 */
function renderLane(widths: { viewport: number; readoutRight: number; readoutBottom: number }) {
  const initial = useWorkspaceStore.getInitialState();
  useWorkspaceStore.setState(
    {
      ...initial,
      oristudioCpCamvResult: {
        operation: 'CheckCamv',
        status: 'OracleTested',
        diagnostics: ['CheckCamv found 1 issue(s)'],
        diagnostic_entries: [entry('a')],
      } as OristudioCpCommandResult,
    },
    true
  );

  viewport = document.createElement('div');
  viewport.className = 'cp-panel__viewport';
  const readout = document.createElement('div');
  readout.className = 'viewport-status-readout';
  const mount = document.createElement('div');
  viewport.append(readout, mount);
  document.body.append(viewport);

  root = createRoot(mount);
  act(() => {
    root?.render(<CpDiagnosticHud />);
  });

  const hud = viewport.querySelector<HTMLElement>('.cp-diagnostic-hud');
  if (!hud) throw new Error('the HUD did not render');

  stubRect(viewport, { left: 0, right: widths.viewport, bottom: 700 });
  stubRect(readout, { left: 12, right: widths.readoutRight, bottom: widths.readoutBottom });
  // Collapsed badge at `right: --space-4`, the width the headline comes out at.
  stubRect(hud, { left: widths.viewport - 16 - 232, right: widths.viewport - 16, bottom: 52 });

  // The rects above were not there for the mount-time measure, so ask for another.
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
  return hud;
}

describe('the diagnostic HUD in the viewport top lane', () => {
  it('writes no top at desktop width', () => {
    // The stylesheet's `top: var(--space-4)` has to stay in charge wherever the
    // two clear each other, or this hook becomes a second place the inset lives.
    const hud = renderLane({ viewport: 1120, readoutRight: 402, readoutBottom: 36 });
    expect(hud.style.top).toBe('');
  });

  it('drops below the readout when a wrapped strip runs under it', () => {
    // 820pt portrait, the iPad case: the strip reaches the pane's right edge.
    const hud = renderLane({ viewport: 820, readoutRight: 808, readoutBottom: 52 });
    expect(hud.style.top).toBe(`${52 + CP_HUD_LANE_GAP}px`);
  });

  it('writes no top with no readout in the viewport', () => {
    const hud = renderLane({ viewport: 820, readoutRight: 808, readoutBottom: 52 });
    viewport?.querySelector('.viewport-status-readout')?.remove();
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(hud.style.top).toBe('');
  });
});
