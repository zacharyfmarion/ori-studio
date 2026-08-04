import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { storageKey, STORAGE_KEYS } from '../../lib/storage';
import { TooltipProvider } from '../ui/Tooltip';
import { CpToolRail } from './CpToolRail';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAIL_GROUPS_KEY = storageKey(STORAGE_KEYS.cpToolRailGroups);

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
  localStorage.clear();
});

function renderRail(active: Partial<CpToolRailActive> = {}): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <TooltipProvider delayDuration={0}>
        <CpToolRail
          activeActionId={active.activeActionId ?? null}
          activeOperationId={active.activeOperationId ?? null}
          activeLineColor="Red1"
          editable
          onSelectAction={() => {}}
        />
      </TooltipProvider>
    );
  });
  return container;
}

type CpToolRailActive = Pick<
  ComponentProps<typeof CpToolRail>,
  'activeActionId' | 'activeOperationId'
>;

function buttonFor(host: HTMLDivElement, label: string): HTMLElement {
  const button = host.querySelector(`[aria-label="${label}"]`);
  if (!(button instanceof HTMLElement)) throw new Error(`Missing rail button ${label}`);
  return button;
}

function groupToggle(host: HTMLDivElement, groupId: string): HTMLElement {
  const toggle = host.querySelector(`[aria-controls="cp-tool-rail-group-${groupId}"]`);
  if (!(toggle instanceof HTMLElement)) throw new Error(`no rail toggle for group ${groupId}`);
  return toggle;
}

function isExpanded(host: HTMLDivElement, groupId: string): boolean {
  return groupToggle(host, groupId).getAttribute('aria-expanded') === 'true';
}

function hasButtons(host: HTMLDivElement, groupId: string): boolean {
  return host.querySelector(`#cp-tool-rail-group-${groupId}`) !== null;
}

function remount(): HTMLDivElement {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  return renderRail();
}

describe('CpToolRail collapsible groups', () => {
  it('opens every group by default except the ones marked collapsed', () => {
    const host = renderRail();

    expect(isExpanded(host, 'select-edit')).toBe(true);
    expect(hasButtons(host, 'select-edit')).toBe(true);
    expect(isExpanded(host, 'advanced')).toBe(false);
    expect(hasButtons(host, 'advanced')).toBe(false);
  });

  it('persists each group independently and restores it on the next render', () => {
    const host = renderRail();

    act(() => {
      groupToggle(host, 'advanced').click();
      groupToggle(host, 'select-edit').click();
    });

    expect(hasButtons(host, 'advanced')).toBe(true);
    expect(hasButtons(host, 'select-edit')).toBe(false);
    expect(JSON.parse(localStorage.getItem(RAIL_GROUPS_KEY) ?? '{}')).toEqual({
      advanced: true,
      'select-edit': false,
    });

    const remounted = remount();
    expect(isExpanded(remounted, 'advanced')).toBe(true);
    expect(isExpanded(remounted, 'select-edit')).toBe(false);
  });
});

// Extend Line and Divided Line are one button each over two kernel operations.
// The button draws the variant its mode currently resolves to, so which mode is
// armed is readable from the rail without opening the context panel.
describe('CpToolRail merged tools', () => {
  it('shows one button per merged pair, not one per operation', () => {
    const host = renderRail();

    expect(host.querySelector('[aria-label="Extend Line"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Divided Line"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Lengthen by Same Color"]')).toBeNull();
    expect(host.querySelector('[aria-label="Divided Line (ratio)"]')).toBeNull();
  });

  it('draws the resolved variant glyph while the tool is active', () => {
    const asCount = renderRail({
      activeActionId: 'cp.action.line-segment-division',
      activeOperationId: 'LineSegmentDivision',
    });
    expect(buttonFor(asCount, 'Divided Line').textContent).toBe('\uE011');

    act(() => {
      root?.unmount();
    });
    container?.remove();

    const asRatio = renderRail({
      activeActionId: 'cp.action.line-segment-division',
      activeOperationId: 'LineSegmentRatioSet',
    });
    expect(buttonFor(asRatio, 'Divided Line').textContent).toBe('\uE044');
  });

  it('falls back to its own glyph when another tool is active', () => {
    const host = renderRail({
      activeActionId: 'cp.action.draw-crease',
      activeOperationId: 'DrawCreaseFree',
    });
    expect(buttonFor(host, 'Divided Line').textContent).toBe('\uE011');
  });
});
