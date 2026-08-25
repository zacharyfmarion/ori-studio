import { describe, expect, it } from 'vitest';
import { updateCheckSummary } from './UpdatesSection';

/**
 * Stands in for `t`, returning the English default with `{{...}}` filled in.
 *
 * The assertions below are about *which* of the four states the row reports, so
 * a fake that echoes the default keeps them readable without pulling i18n in.
 */
const t = ((_key: string, fallback: string, vars?: Record<string, unknown>) =>
  fallback.replace(/{{(\w+)}}/g, (_, name: string) =>
    String(vars?.[name] ?? '')
  )) as unknown as Parameters<typeof updateCheckSummary>[0];

describe('updateCheckSummary', () => {
  it('says nothing has been checked before the first check', () => {
    expect(updateCheckSummary(t, { lastCheck: null, version: null })).toBe('Not checked yet');
  });

  it('reports a failed check instead of leaving the row unchanged', () => {
    // The reported bug. Pressing Check now against an unreachable server left
    // this reading "Not checked yet", so the press looked like a no-op.
    const summary = updateCheckSummary(t, {
      lastCheck: { at: Date.parse('2026-08-19T12:00:00Z'), ok: false },
      version: null,
    });
    expect(summary).toMatch(/Couldn't check for updates/);
    expect(summary).not.toBe('Not checked yet');
  });

  it('confirms an up-to-date app after a check that found nothing', () => {
    const summary = updateCheckSummary(t, {
      lastCheck: { at: Date.parse('2026-08-19T12:00:00Z'), ok: true },
      version: null,
    });
    expect(summary).toMatch(/Up to date/);
  });

  it('names the offered version when one is standing', () => {
    const summary = updateCheckSummary(t, {
      lastCheck: { at: Date.parse('2026-08-19T12:00:00Z'), ok: true },
      version: '0.2.1',
    });
    expect(summary).toBe('Version 0.2.1 is available');
  });

  it('reports the failure even when a stale version is still on offer', () => {
    // A staged update survives a failed check by design, so `version` is set.
    // The row must still answer the question the press asked.
    const summary = updateCheckSummary(t, {
      lastCheck: { at: Date.parse('2026-08-19T12:00:00Z'), ok: false },
      version: '0.2.1',
    });
    expect(summary).toMatch(/Couldn't check for updates/);
  });
});
