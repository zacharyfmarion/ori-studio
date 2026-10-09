import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '../../store/settingsStore';
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
    // Shapes after Marks (Revision 3, R3-25 A).
    expect(groups).toEqual(['line-type', 'select', 'arrows', 'lines', 'marks', 'shapes', 'text']);
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

  it('shows the Star Fill under Marks while the Star tool is in hand, keeps it for the next star, and draws the tool as the star it lays (Revision 3, R3-4 C)', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    useSettingsStore.setState({ diagramAnnotateStarFill: 'black' });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const render = (tool: 'star' | 'circle' | null) =>
      act(() =>
        root!.render(
          <TooltipProvider>
            <DiagramAnnotateRail tool={tool} readOnly={false} onTool={() => undefined} />
          </TooltipProvider>
        )
      );
    const group = () => container!.querySelector('section[aria-label="Star Fill"]');
    const toolFill = () => container!.querySelector('#diagram-annotate-group-marks button[aria-label="Star"] [data-glyph-fill]')!.getAttribute('data-glyph-fill');
    render(null);
    expect(group()).toBeNull();
    expect(toolFill()).toBe('black');
    render('circle');
    expect(group()).toBeNull();
    render('star');
    // Right under the Marks group.
    const sections = [...container.querySelectorAll('section')].map((each) => each.getAttribute('aria-label'));
    expect(sections.slice(sections.indexOf('Marks'), sections.indexOf('Marks') + 2)).toEqual(['Marks', 'Star Fill']);
    const options = () => [...group()!.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Star Fill"] button')];
    // Filled, then Outline, each a small star; Filled until one is chosen.
    expect(options().map((each) => each.getAttribute('aria-label'))).toEqual(['Filled', 'Outline']);
    expect(options().map((each) => each.querySelector('[data-glyph-fill]')!.getAttribute('data-glyph-fill'))).toEqual(['black', 'white']);
    expect(options().map((each) => each.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    act(() => options()[1]!.click());
    expect(useSettingsStore.getState().diagramAnnotateStarFill).toBe('white');
    expect(toolFill()).toBe('white');
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

  it('shows the Text Style under Text while the Label tool is in hand, and keeps what it sets for the next label (17b)', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.releasePointerCapture ??= () => undefined;
    Element.prototype.scrollIntoView ??= () => undefined;
    useSettingsStore.setState({ diagramAnnotateTextStyle: { color: null, bold: false, halo: false, sizePt: null } });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const render = (tool: 'label' | null) =>
      act(() =>
        root!.render(
          <TooltipProvider>
            <DiagramAnnotateRail tool={tool} readOnly={false} onTool={() => undefined} />
          </TooltipProvider>
        )
      );
    const group = () => container!.querySelector('section[aria-label="Text Style"]');
    render(null);
    expect(group()).toBeNull();
    render('label');
    // Right under the Text group.
    const sections = [...container.querySelectorAll('section')].map((each) => each.getAttribute('aria-label'));
    expect(sections.slice(-2)).toEqual(['Text', 'Text Style']);
    const color = () => group()!.querySelector<HTMLButtonElement>('button[aria-label="Text Color"]')!;
    const size = () => group()!.querySelector<HTMLButtonElement>('button[aria-label="Size"]')!;
    const bold = () => group()!.querySelector<HTMLButtonElement>('button[aria-label="Bold"]')!;
    const halo = () => group()!.querySelector<HTMLButtonElement>('button[aria-label="Halo"]')!;
    // Today's look until one is chosen.
    expect([color().textContent, size().textContent]).toEqual(['Ink', 'With the picture']);
    expect([bold().getAttribute('aria-pressed'), halo().getAttribute('aria-pressed')]).toEqual(['false', 'false']);
    const choose = (select: HTMLButtonElement, name: string) => {
      act(() => select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
      const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((each) => each.textContent === name)!;
      act(() => option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    };
    choose(color(), 'Reference');
    act(() => bold().click());
    act(() => halo().click());
    choose(size(), '9 pt');
    expect(useSettingsStore.getState().diagramAnnotateTextStyle).toEqual({ color: '#c91d87', bold: true, halo: true, sizePt: 9 });
    expect([bold().getAttribute('aria-pressed'), halo().getAttribute('aria-pressed')]).toEqual(['true', 'true']);
    expect(size().textContent).toBe('9 pt');
    // Size says what it sets by its glyph, as the colour select says its colour by its swatch.
    expect(size().querySelector('[data-glyph="text-size"]')).not.toBeNull();
  });

  it('brings the Text Style into the rail’s view when the Label tool is taken, on a screen too short to show it (17b)', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    // An iPad on its side: the rail's column ends at 700 px; the group comes in at 680–868.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 180, x: 0, y: top, width: 180, height: bottom - top }) as DOMRect;
      if (this.dataset.railPart === 'groups') return rect(0, 700);
      if (this.getAttribute('aria-label') === 'Text Style') return rect(680, 868);
      return rect(0, 0);
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const render = (tool: 'label' | null) =>
      act(() =>
        root!.render(
          <TooltipProvider>
            <DiagramAnnotateRail tool={tool} readOnly={false} onTool={() => undefined} />
          </TooltipProvider>
        )
      );
    render(null);
    const column = container.querySelector<HTMLDivElement>('[data-rail-part="groups"]')!;
    Object.defineProperty(column, 'clientHeight', { configurable: true, value: 700 });
    let scrolled = 0;
    Object.defineProperty(column, 'scrollTop', { configurable: true, get: () => scrolled, set: (value: number) => (scrolled = value) });
    render('label');
    expect(scrolled).toBe(168);
  });
});
