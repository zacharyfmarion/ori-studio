import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from './Tooltip';
import { revealScroll, ToolRail, ToolRailButtons, type ToolRailGroup, type ToolRailTool } from './ToolRail';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  localStorage.clear();
  vi.restoreAllMocks();
});

function tool(id: string, overrides: Partial<ToolRailTool> = {}): ToolRailTool {
  return {
    id,
    label: id,
    tooltip: `${id} - does ${id}`,
    glyph: <svg />,
    active: false,
    available: true,
    onSelect: () => {},
    ...overrides,
  };
}

function render(props: { groups: ToolRailGroup[]; header?: string; storageKey?: string }): HTMLDivElement {
  container?.remove();
  act(() => root?.unmount());
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <TooltipProvider delayDuration={0}>
        <ToolRail
          aria-label="Tools"
          idPrefix="test-rail"
          groups={props.groups}
          header={props.header}
          storageKey={props.storageKey}
        />
      </TooltipProvider>
    );
  });
  return container;
}

const button = (host: HTMLElement, name: string) =>
  host.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!;

describe('ToolRail', () => {
  it('selects an available tool, and refuses one that is not while staying focusable', () => {
    const picked: string[] = [];
    const host = render({
      groups: [
        {
          id: 'draw',
          label: 'Draw tools',
          railLabel: 'Draw',
          content: {
            tools: [
              tool('Line', { active: true, onSelect: () => picked.push('Line') }),
              tool('Arc', { available: false, onSelect: () => picked.push('Arc') }),
            ],
          },
        },
      ],
    });
    act(() => button(host, 'Line').click());
    act(() => button(host, 'Arc').click());
    expect(picked).toEqual(['Line']);
    expect(button(host, 'Line').hasAttribute('data-active')).toBe(true);
    expect(button(host, 'Arc').getAttribute('aria-disabled')).toBe('true');
    expect(button(host, 'Arc').hasAttribute('disabled')).toBe(false);
  });

  it('lays a control group out as one control, not grid cells', () => {
    const host = render({
      groups: [{ id: 'type', label: 'Type', railLabel: 'Type', content: { control: <div role="group" /> } }],
    });
    const list = host.querySelector('#test-rail-type')!;
    expect(list.hasAttribute('data-control')).toBe(true);
    expect(list.querySelector('[role="group"]')).not.toBeNull();
  });

  // The rail is a grid with one explicit row, so a header names both rows and
  // a rail without one gains no child at all.
  it('adds a header row only when it has one', () => {
    const groups: ToolRailGroup[] = [{ id: 'a', label: 'A', railLabel: 'A', content: { tools: [tool('One')] } }];
    const bare = render({ groups }).querySelector('aside')!;
    expect(bare.hasAttribute('data-header')).toBe(false);
    expect([...bare.children].map((node) => node.getAttribute('data-rail-part'))).toEqual(['groups']);

    const headed = render({ groups, header: 'Latch' }).querySelector('aside')!;
    expect(headed.hasAttribute('data-header')).toBe(true);
    expect([...headed.children].map((node) => node.getAttribute('data-rail-part'))).toEqual([
      'touch-header',
      'groups',
    ]);
  });

  it('keeps its open groups for as long as it lives without a storage key, and across mounts with one', () => {
    const groups: ToolRailGroup[] = [
      { id: 'a', label: 'A', railLabel: 'A', content: { tools: [tool('One')] } },
      { id: 'b', label: 'B', railLabel: 'B', collapsedByDefault: true, content: { tools: [tool('Two')] } },
    ];
    const toggle = (host: HTMLElement, id: string) =>
      host.querySelector<HTMLButtonElement>(`[aria-controls="test-rail-${id}"]`)!;

    let host = render({ groups });
    expect(toggle(host, 'b').getAttribute('aria-expanded')).toBe('false');
    act(() => toggle(host, 'b').click());
    expect(host.querySelector('#test-rail-b')).not.toBeNull();
    expect(localStorage.length).toBe(0);
    host = render({ groups });
    expect(toggle(host, 'b').getAttribute('aria-expanded')).toBe('false');

    host = render({ groups, storageKey: 'test-rail-groups' });
    act(() => toggle(host, 'a').click());
    expect(JSON.parse(localStorage.getItem('test-rail-groups')!)).toEqual({ a: false });
    host = render({ groups, storageKey: 'test-rail-groups' });
    expect(toggle(host, 'a').getAttribute('aria-expanded')).toBe('false');
  });
});

describe('ToolRail’s groups that come with a tool', () => {
  it('scrolls the least that shows a box whole, its top when it is taller than the column', () => {
    const view = { top: 100, bottom: 400 };
    expect(revealScroll({ top: 150, bottom: 300 }, view)).toBe(0);
    // Below the fold: up by what it hangs past the bottom.
    expect(revealScroll({ top: 366, bottom: 554 }, view)).toBe(154);
    // Above it: down to its top.
    expect(revealScroll({ top: 40, bottom: 120 }, view)).toBe(-60);
    // Taller than the column: its top, not its foot.
    expect(revealScroll({ top: 380, bottom: 800 }, view)).toBe(280);
  });

  it('brings a group that appears below the fold into the column’s view, and scrolls nothing else', () => {
    // The column shows 0–300 px of the screen; a group comes in at 266–454, under the fold (an iPad on its side).
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 180, x: 0, y: top, width: 180, height: bottom - top }) as DOMRect;
      if (this.dataset.railPart === 'groups') return rect(0, 300);
      if (this.getAttribute('aria-label') === 'Style') return rect(266, 454);
      return rect(0, 0);
    });
    const tools: ToolRailGroup = { id: 'text', label: 'Text', railLabel: 'Text', content: { tools: [tool('Label')] } };
    const style: ToolRailGroup = { id: 'style', label: 'Style', railLabel: 'Style', reveal: true, content: { control: <div /> } };
    const quiet: ToolRailGroup = { ...style, id: 'quiet', label: 'Quiet', reveal: false };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const show = (groups: ToolRailGroup[]) =>
      act(() =>
        root!.render(
          <TooltipProvider delayDuration={0}>
            <ToolRail aria-label="Tools" idPrefix="test-rail" groups={groups} />
          </TooltipProvider>
        )
      );
    show([tools]);
    const column = container.querySelector<HTMLDivElement>('[data-rail-part="groups"]')!;
    Object.defineProperty(column, 'clientHeight', { configurable: true, value: 300 });
    let scrolled = 0;
    Object.defineProperty(column, 'scrollTop', { configurable: true, get: () => scrolled, set: (value: number) => (scrolled = value) });
    // A group that does not ask to be revealed stays where it came in.
    show([tools, quiet]);
    expect(scrolled).toBe(0);
    show([tools, style]);
    expect(scrolled).toBe(154);
    // Shown already, it does not pull the column back to it on every render.
    scrolled = 0;
    show([tools, style]);
    expect(scrolled).toBe(0);
  });

  it('lays toggles in a control in the rail’s own buttons: pressed while on, their tooltip where it is asked for', () => {
    const toggled: string[] = [];
    const host = render({
      groups: [
        {
          id: 'style',
          label: 'Style',
          railLabel: 'Style',
          content: {
            control: (
              <ToolRailButtons
                tools={[
                  tool('Bold', { toggle: true, active: true, tooltipSide: 'top', onSelect: () => toggled.push('Bold') }),
                  tool('Halo', { toggle: true, active: false, available: false, onSelect: () => toggled.push('Halo') }),
                ]}
              />
            ),
          },
        },
        { id: 'draw', label: 'Draw', railLabel: 'Draw', content: { tools: [tool('Line', { active: true })] } },
      ],
    });
    expect(button(host, 'Bold').getAttribute('aria-pressed')).toBe('true');
    expect(button(host, 'Bold').hasAttribute('data-active')).toBe(true);
    expect(button(host, 'Halo').getAttribute('aria-pressed')).toBe('false');
    // A tool taken in hand is not a toggle: it says nothing of being pressed.
    expect(button(host, 'Line').hasAttribute('aria-pressed')).toBe(false);
    // The same buttons as a group's tools.
    expect(button(host, 'Bold').className).toBe(button(host, 'Line').className);
    act(() => button(host, 'Bold').click());
    act(() => button(host, 'Halo').click());
    expect(toggled).toEqual(['Bold']);
  });
});
