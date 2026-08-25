import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUpdateStore } from '../store/updateStore';
import { announceUpdateCheck } from './updateFeedback';

const success = vi.fn();
const error = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => success(...args),
    error: (...args: unknown[]) => error(...args),
  },
}));

const t = ((_key: string, fallback: string, vars?: Record<string, unknown>) =>
  fallback.replace(/{{(\w+)}}/g, (_, name: string) =>
    String(vars?.[name] ?? '')
  )) as unknown as Parameters<typeof announceUpdateCheck>[1];

describe('announceUpdateCheck', () => {
  beforeEach(() => {
    success.mockClear();
    error.mockClear();
    useUpdateStore.setState({
      status: 'idle',
      version: null,
      skippedVersion: null,
      snoozed: false,
      downloadWasRequested: false,
    });
  });

  it('confirms an up-to-date app, which is the answer almost every press gets', () => {
    // Without this the button is dead on every press but the rare one.
    announceUpdateCheck('none', t);
    expect(success).toHaveBeenCalledWith('Ori Studio is up to date', expect.anything());
  });

  it('reports a failed check as an error', () => {
    announceUpdateCheck('failed', t);
    expect(error).toHaveBeenCalledWith("Couldn't check for updates", expect.anything());
  });

  it('says nothing when the check never ran', () => {
    // `skipped` means delivery is off or a download is in flight. Claiming the
    // app is up to date here would be a statement made from no evidence.
    announceUpdateCheck('skipped', t);
    expect(success).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('leaves an available update to the card rather than saying it twice', () => {
    useUpdateStore.setState({ status: 'available', version: '0.2.1' });
    announceUpdateCheck('available', t);
    expect(success).not.toHaveBeenCalled();
  });

  it('speaks up when the card is suppressed by a skip', () => {
    // The version was skipped, so no card appears — but the user just asked,
    // and silence would read as a dead button.
    useUpdateStore.setState({ status: 'available', version: '0.2.1', skippedVersion: '0.2.1' });
    announceUpdateCheck('available', t);
    expect(success).toHaveBeenCalledWith('Version 0.2.1 is available', expect.anything());
  });

  it('speaks up when the card is snoozed', () => {
    useUpdateStore.setState({ status: 'available', version: '0.2.1', snoozed: true });
    announceUpdateCheck('available', t);
    expect(success).toHaveBeenCalledWith('Version 0.2.1 is available', expect.anything());
  });
});
