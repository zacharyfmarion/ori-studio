import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Fold events' shapes as the owner reads them in PostHog: enums and
 * buckets only, each property name meaning one thing across the project.
 */

const runtime = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock('../runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime')>();
  return { ...actual, track: runtime.track };
});

const {
  trackFoldChoiceOffered,
  trackFoldMarkAdded,
  trackFoldOrderResolved,
  trackFoldOrdersSearched,
  trackFoldRefused,
  trackFoldRepeatRebuilt,
  trackFoldSheetChanged,
} = await import('../trackFold');
const { trackFoldCpImported } = await import('../trackFoldIo');

beforeEach(() => {
  runtime.track.mockClear();
});

it('names the choice offered as `choice_kind`, never the bare `kind` other events already use', () => {
  trackFoldChoiceOffered('placement', 12);
  expect(runtime.track).toHaveBeenCalledWith('fold choice offered', { choice_kind: 'placement', count_bucket: '>8' });
});

describe('trackFoldRefused', () => {
  it('sends a canvas tool’s refusal as its code alone', () => {
    trackFoldRefused('layer_order');
    expect(runtime.track).toHaveBeenCalledWith('fold refused', { code: 'layer_order' });
  });

  it('names a Repeat’s refusal by its op, since the steps it mirrors refuse in the tools’ codes', () => {
    trackFoldRefused('repeat_axis', 'repeat');
    expect(runtime.track).toHaveBeenCalledWith('fold refused', { code: 'repeat_axis', op_kind: 'repeat' });
  });
});

it('spells a cancelled order review as every other event does', () => {
  trackFoldOrderResolved('canceled', 'tool', 3);
  expect(runtime.track).toHaveBeenCalledWith('fold order resolved', { result: 'cancelled', source: 'tool', count_bucket: '<=3' });
});

it('says how a press of Find more orders ended and whether it found more, never which orders', () => {
  trackFoldOrdersSearched('exhausted', false, 1);
  expect(runtime.track).toHaveBeenLastCalledWith('fold orders searched', { result: 'exhausted', found: 'none', count_bucket: '<=2' });
  trackFoldOrdersSearched('stopped', true, 9);
  expect(runtime.track).toHaveBeenLastCalledWith('fold orders searched', { result: 'stopped', found: 'more', count_bucket: '>8' });
});

it('counts a Repeat updated in place apart from a step added, with nothing about it', () => {
  trackFoldRepeatRebuilt();
  expect(runtime.track).toHaveBeenCalledWith('fold repeat rebuilt');
});

it('counts a Divide line mark by how it divided, never the parts or the ratio', () => {
  trackFoldMarkAdded('ratio');
  expect(runtime.track).toHaveBeenCalledWith('fold mark added', { divide_mode: 'ratio' });
});

it('counts a sheet change by the setting and the sheet’s kind after it, never its size', () => {
  trackFoldSheetChanged('shape', { shape: 'polygon', startSide: 'back' });
  expect(runtime.track).toHaveBeenCalledWith('fold sheet changed', { setting: 'shape', sheet_shape: 'polygon', start_side: 'back' });
});

it('says whether an Import CP added a step or updated a Collapse in place', () => {
  trackFoldCpImported('sample');
  expect(runtime.track).toHaveBeenLastCalledWith('fold cp imported', { origin: 'sample', action: 'insert' });
  trackFoldCpImported('project_cp', 'update');
  expect(runtime.track).toHaveBeenLastCalledWith('fold cp imported', { origin: 'project_cp', action: 'update' });
});
