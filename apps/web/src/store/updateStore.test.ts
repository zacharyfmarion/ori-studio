import { beforeEach, describe, expect, it } from 'vitest';
import { shouldShowUpdateCard, useUpdateStore } from './updateStore';

const BASE = {
  status: 'ready' as const,
  version: '0.3.0',
  skippedVersion: null,
  snoozed: false,
  downloadWasRequested: false,
};

describe('shouldShowUpdateCard', () => {
  it('shows once an update is installable', () => {
    expect(shouldShowUpdateCard(BASE)).toBe(true);
  });

  it('stays hidden while an unrequested download runs', () => {
    // The contract: progress for something nobody asked for is a nag. An
    // automatic download must be invisible until it produces something the user
    // can act on.
    expect(shouldShowUpdateCard({ ...BASE, status: 'downloading' })).toBe(false);
    expect(
      shouldShowUpdateCard({ ...BASE, status: 'downloading', downloadWasRequested: true })
    ).toBe(true);
  });

  it('stays hidden while merely checking, and when nothing is offered', () => {
    expect(shouldShowUpdateCard({ ...BASE, status: 'checking' })).toBe(false);
    expect(shouldShowUpdateCard({ ...BASE, status: 'idle' })).toBe(false);
    expect(shouldShowUpdateCard({ ...BASE, version: null })).toBe(false);
  });

  it('respects a skip only for the version that was skipped', () => {
    expect(shouldShowUpdateCard({ ...BASE, skippedVersion: '0.3.0' })).toBe(false);
    expect(shouldShowUpdateCard({ ...BASE, skippedVersion: '0.2.0' })).toBe(true);
  });

  it('respects a session snooze', () => {
    expect(shouldShowUpdateCard({ ...BASE, snoozed: true })).toBe(false);
  });

  it('shows the download variant where in-place update is impossible', () => {
    // A .deb install: it cannot self-update, but the user should still learn a
    // release exists.
    expect(shouldShowUpdateCard({ ...BASE, status: 'unsupported' })).toBe(true);
  });

  it('never shows a failure the user did not ask for', () => {
    expect(shouldShowUpdateCard({ ...BASE, status: 'failed' })).toBe(false);
  });
});

describe('updateStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useUpdateStore.setState({
      status: 'idle',
      version: null,
      skippedVersion: null,
      highestSeenVersion: null,
      snoozed: false,
      readyAt: null,
      lastCheck: null,
      downloadProgress: null,
      downloadWasRequested: false,
    });
  });

  it('records the highest version ever offered', () => {
    useUpdateStore.getState().setAvailable('0.3.0', 'app', 1000);
    expect(useUpdateStore.getState().highestSeenVersion).toBe('0.3.0');
  });

  it('retires a skip when a newer version is offered', () => {
    useUpdateStore.getState().setAvailable('0.3.0', 'app', 1000);
    useUpdateStore.getState().skipCurrentVersion();
    expect(useUpdateStore.getState().skippedVersion).toBe('0.3.0');

    // Skipping one release must not become a standing opt-out.
    useUpdateStore.getState().setAvailable('0.4.0', 'app', 2000);
    expect(useUpdateStore.getState().skippedVersion).toBeNull();
  });

  it('keeps a staged update when a later check fails', () => {
    // Losing the network must not retract a "Relaunch to update" the user can
    // still act on — the payload is already on disk.
    useUpdateStore.getState().setAvailable('0.3.0', 'app', 1000);
    useUpdateStore.getState().setReady(2000);
    useUpdateStore.getState().setCheckFailed(3000);
    expect(useUpdateStore.getState().status).toBe('ready');
  });

  it('marks a check that fails while checking as failed', () => {
    useUpdateStore.getState().setChecking();
    useUpdateStore.getState().setCheckFailed(3000);
    expect(useUpdateStore.getState().status).toBe('failed');
  });

  it('records a check that failed, so it is not indistinguishable from never checking', () => {
    // The whole bug: the settings row read "Not checked yet" no matter how many
    // times someone pressed Check now against an unreachable server, and the
    // interval guard — which reads this same field — never backed off.
    useUpdateStore.getState().setChecking();
    useUpdateStore.getState().setCheckFailed(3000);
    expect(useUpdateStore.getState().lastCheck).toEqual({ at: 3000, ok: false });
  });

  it('records a failed check even when it leaves a staged update alone', () => {
    // `setCheckFailed` deliberately does not move `status` here. The attempt
    // still happened, and the timestamp is what the interval guard reads.
    useUpdateStore.getState().setAvailable('0.3.0', 'app', 1000);
    useUpdateStore.getState().setReady(2000);
    useUpdateStore.getState().setCheckFailed(3000);
    expect(useUpdateStore.getState().status).toBe('ready');
    expect(useUpdateStore.getState().lastCheck).toEqual({ at: 3000, ok: false });
  });

  it('records a successful check as ok', () => {
    useUpdateStore.getState().setNoUpdate(4000);
    expect(useUpdateStore.getState().lastCheck).toEqual({ at: 4000, ok: true });
  });
});
