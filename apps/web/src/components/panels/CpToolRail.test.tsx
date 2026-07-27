import { act } from 'react';
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

function renderRail(): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <TooltipProvider delayDuration={0}>
        <CpToolRail
          activeActionId={null}
          activeLineColor="Red1"
          editable
          onSelectAction={() => {}}
        />
      </TooltipProvider>
    );
  });
  return container;
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
