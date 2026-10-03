import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsTab } from '../../store/settingsStore';
import type { PostHogClientLike } from '../bootstrap';
import type { SettingsSectionName } from '../events';
import { AnalyticsRuntimeProvider } from '../runtime';
import { useSettingsSectionViewedEvent } from '../useSettingsSectionViewedEvent';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeFakeClient() {
  return {
    init: vi.fn(),
    register: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
    identify: vi.fn(),
    capture: vi.fn(),
    reset: vi.fn(),
  } satisfies PostHogClientLike;
}

function viewedEvents(client: ReturnType<typeof makeFakeClient>) {
  return client.capture.mock.calls
    .filter((call) => call[0] === 'settings section viewed')
    .map((call) => call[1]);
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function Probe({ section }: { section: SettingsSectionName }) {
  useSettingsSectionViewedEvent(section);
  return null;
}

function render(client: PostHogClientLike, node: ReactNode) {
  act(() => {
    root.render(createElement(AnalyticsRuntimeProvider, { client, children: node }));
  });
}

describe('useSettingsSectionViewedEvent', () => {
  it('names every section the dialog has, and nothing else', () => {
    // Each type assignable to the other, so tsc fails first on a one-sided edit.
    const nameOf = (tab: SettingsTab): SettingsSectionName => tab;
    const tabOf = (name: SettingsSectionName): SettingsTab => name;
    expect(tabOf(nameOf('paper'))).toBe('paper');
  });

  it('fires with the section the dialog opens on', () => {
    const client = makeFakeClient();
    render(client, createElement(Probe, { section: 'general' }));
    expect(viewedEvents(client)).toEqual([{ section: 'general' }]);
  });

  it('fires again for each section picked, not on an unrelated re-render', () => {
    const client = makeFakeClient();
    render(client, createElement(Probe, { section: 'general' }));
    render(client, createElement(Probe, { section: 'general' }));
    render(client, createElement(Probe, { section: 'paper' }));
    expect(viewedEvents(client)).toEqual([{ section: 'general' }, { section: 'paper' }]);
  });
});
