import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '../../store/settingsStore';
import { TooltipProvider } from '../ui/Tooltip';
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
});

describe('DiagramAnnotateRail', () => {
  it('heads the rail with the line type, as Edit heads its own, then the tools in their groups', () => {
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
    expect(groups).toEqual(['line-type', 'select', 'arrows', 'lines', 'marks', 'text']);
    // The two equality marks side by side, Equal Divisions on D (Revision 2, ED8).
    const marks = [...container.querySelectorAll('#diagram-annotate-group-marks button[aria-label]')].map((button) =>
      button.getAttribute('aria-label')
    );
    expect(marks).toEqual([
      'Circle',
      'Right Angle',
      'Equal Angles',
      'Equal Divisions',
      'Close-Up',
      'Enlarge',
      'Enlarge in Frame',
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

  it('offers Solid among the line types, and while it is the type, the colour the next solid line is drawn in (17a)', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    // What Radix's select asks of the DOM, which jsdom does not have.
    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.releasePointerCapture ??= () => undefined;
    Element.prototype.scrollIntoView ??= () => undefined;
    useSettingsStore.setState({ diagramAnnotateLineType: 'valley', diagramAnnotateLineColor: null });
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
    const types = [...container.querySelectorAll('[role="group"][aria-label="Line Type"] button')].map((button) =>
      button.getAttribute('aria-label')
    );
    expect(types).toEqual(['Valley', 'Mountain', 'Hidden', 'Solid']);
    const color = () => container!.querySelector<HTMLButtonElement>('button[aria-label="Line Color"]');
    expect(color()).toBeNull();
    act(() => container!.querySelector<HTMLButtonElement>('[role="group"][aria-label="Line Type"] button[aria-label="Solid"]')!.click());
    expect(useSettingsStore.getState().diagramAnnotateLineType).toBe('solid');
    expect(color()!.textContent).toBe('Ink');
    act(() => color()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    const reference = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((each) => each.textContent === 'Reference')!;
    act(() => reference.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(useSettingsStore.getState().diagramAnnotateLineColor).toBe('#c91d87');
    expect(color()!.textContent).toBe('Reference');
  });
});
