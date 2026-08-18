import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UpdateChip } from './UpdateChip';
import { useUpdateStore } from '../store/updateStore';

/**
 * The chip, at the entry point.
 *
 * `shouldShowUpdateChip` is unit-tested beside the store; what this covers is
 * that the component actually asks it, and that the *words* match the state —
 * because the design's whole claim is that the label is never a lie. A chip
 * saying "Relaunch to update" on a `.deb` install, or during a download, would
 * pass every store test and still be wrong.
 */

let root: Root | null = null;
let container: HTMLDivElement | null = null;

type UpdateState = ReturnType<typeof useUpdateStore.getState>;

function seed(overrides: Partial<UpdateState>): void {
  act(() => {
    useUpdateStore.setState({
      status: 'idle',
      version: null,
      installKind: null,
      downloadProgress: null,
      downloadWasRequested: false,
      readyAt: null,
      lastCheckedAt: null,
      skippedVersion: null,
      snoozed: false,
      ...overrides,
    });
  });
}

function mount(): void {
  act(() => {
    root?.render(<UpdateChip />);
  });
}

function text(): string {
  return container?.textContent ?? '';
}

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  seed({});
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('UpdateChip', () => {
  it('renders nothing when no update is offered', () => {
    mount();
    expect(container?.querySelector('.update-chip')).toBeNull();
  });

  it('offers to relaunch once the update is installable', () => {
    seed({ status: 'ready', version: '0.3.0', installKind: 'app', readyAt: 1 });
    mount();
    expect(text()).toContain('Relaunch to update');
    expect(text()).toContain('v0.3.0');
  });

  it('renders nothing during a download nobody asked for', () => {
    // Progress for something the user did not request is a nag.
    seed({ status: 'downloading', version: '0.3.0', downloadWasRequested: false });
    mount();
    expect(container?.querySelector('.update-chip')).toBeNull();
  });

  it('shows progress for a download the user started', () => {
    seed({ status: 'downloading', version: '0.3.0', downloadWasRequested: true });
    mount();
    expect(text()).toContain('Downloading update');
  });

  it('says "download", not "relaunch", where in-place update is impossible', () => {
    // A .deb install. "Relaunch to update" would be a lie here — the update
    // cannot be applied in place at all.
    seed({ status: 'unsupported', version: '0.3.0', installKind: 'other' });
    mount();
    expect(text()).toContain('Download update');
    expect(text()).not.toContain('Relaunch to update');
  });

  it('does not offer to skip an update that cannot be acted on', () => {
    seed({ status: 'unsupported', version: '0.3.0' });
    mount();
    expect(text()).not.toContain('Skip');
  });

  it('offers skip and later for an actionable update', () => {
    seed({ status: 'ready', version: '0.3.0', readyAt: 1 });
    mount();
    expect(text()).toContain('Skip 0.3.0');
    expect(text()).toContain('Later');
  });

  it('hides itself once the version is skipped', () => {
    seed({ status: 'ready', version: '0.3.0', skippedVersion: '0.3.0', readyAt: 1 });
    mount();
    expect(container?.querySelector('.update-chip')).toBeNull();
  });

  it('disables the button while installing so it cannot be double-fired', () => {
    seed({ status: 'installing', version: '0.3.0', readyAt: 1 });
    mount();
    const button = container?.querySelector<HTMLButtonElement>('.update-chip__action');
    expect(button?.disabled).toBe(true);
  });
});
