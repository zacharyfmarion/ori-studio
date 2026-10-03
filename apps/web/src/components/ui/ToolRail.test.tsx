import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { TooltipProvider } from './Tooltip';
import { ToolRail, type ToolRailGroup, type ToolRailTool } from './ToolRail';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  localStorage.clear();
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
