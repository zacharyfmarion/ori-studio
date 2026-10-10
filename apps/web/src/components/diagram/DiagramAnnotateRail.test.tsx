import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../ui/Tooltip';
import type { XRayStanding } from '../../diagram/annotate/annotateTools';
import { DiagramAnnotateRail } from './DiagramAnnotateRail';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DiagramAnnotateRail', () => {
  it('contains only tools in their groups', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root!.render(
        <TooltipProvider>
          <DiagramAnnotateRail tool={null} readOnly={false} onTool={() => undefined} />
        </TooltipProvider>
      )
    );
    const groups = [...container.querySelectorAll('[id^="diagram-annotate-group-"]')].map((group) =>
      group.id.replace('diagram-annotate-group-', '')
    );
    // Shapes after Marks (Revision 3, R3-25 A).
    expect(groups).toEqual(['select', 'arrows', 'lines', 'marks', 'shapes', 'text']);
    const shapes = [...container.querySelectorAll('#diagram-annotate-group-shapes button[aria-label]')].map((button) =>
      button.getAttribute('aria-label')
    );
    expect(shapes).toEqual(['Oval', 'Rectangle']);
    // The two equality marks side by side, Equal Divisions on D (Revision 2, ED8).
    const marks = [...container.querySelectorAll('#diagram-annotate-group-marks button[aria-label]')].map((button) =>
      button.getAttribute('aria-label')
    );
    // The star after the circle, the eye after equal divisions, X-Ray after Enlarge in Frame (Revision 3, R3-25 A).
    expect(marks).toEqual([
      'Circle',
      'Star',
      'Right Angle',
      'Equal Angles',
      'Equal Divisions',
      'Eye',
      'Close-Up',
      'Enlarge',
      'Enlarge in Frame',
      'X-Ray',
    ]);
  });

  it('holds the Enlarge tools on an enlarged step, and only them (Revision 2)', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const onTool = vi.fn();
    act(() =>
      root!.render(
        <TooltipProvider>
          <DiagramAnnotateRail tool={null} readOnly={false} enlarged onTool={onTool} />
        </TooltipProvider>
      )
    );
    const held = [...container.querySelectorAll('[aria-disabled="true"][aria-label]')].map((button) =>
      button.getAttribute('aria-label')
    );
    expect(held).toEqual(['Enlarge', 'Enlarge in Frame']);
    act(() => (container!.querySelector('[aria-label="Enlarge"]') as HTMLButtonElement).click());
    expect(onTool).not.toHaveBeenCalled();
  });

  it('holds the X-Ray tool on a picture with no layers, or one that needs a Refresh, saying why, and only it (Revision 3, R3-18a A)', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const onTool = vi.fn();
    const render = (xray: XRayStanding) =>
      act(() =>
        root!.render(
          <TooltipProvider>
            <DiagramAnnotateRail tool={null} readOnly={false} xray={xray} onTool={onTool} />
          </TooltipProvider>
        )
      );
    const held = () =>
      [...container!.querySelectorAll('[aria-disabled="true"][aria-label]')].map((button) => button.getAttribute('aria-label'));
    render({ kind: 'none' });
    expect(held()).toEqual(['X-Ray']);
    act(() => (container!.querySelector('[aria-label="X-Ray"]') as HTMLButtonElement).click());
    expect(onTool).not.toHaveBeenCalled();
    render({ kind: 'refresh', number: 15 });
    expect(held()).toEqual(['X-Ray']);
    // A flat fold with its faces, or one whose faces are fetched as an x-ray is laid: the tool is free.
    render({ kind: 'fetch' });
    expect(held()).toEqual([]);
    render({ kind: 'ready' });
    expect(held()).toEqual([]);
  });

  it.each(['label', 'star', 'line', 'circle'] as const)('has no creation options with %s in hand', (tool) => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root!.render(<TooltipProvider><DiagramAnnotateRail tool={tool} readOnly={false} onTool={() => undefined} /></TooltipProvider>));
    expect(container.querySelector('[role="combobox"], [role="switch"], fieldset')).toBeNull();
    expect(container.querySelector('[aria-label="Line Type"], [aria-label="Star Fill"], [aria-label="Text Style"], [aria-label="Draw circle"]')).toBeNull();
  });
});
