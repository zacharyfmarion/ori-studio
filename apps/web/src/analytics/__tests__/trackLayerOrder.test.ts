import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  constraintAddedFact,
  constraintBlockedFact,
  dialogClosedFact,
  dialogOpenedFact,
  needsAttentionFact,
  solutionsBucket,
} from '../../layer-order/model/layerOrderAnalytics';

/**
 * The Layer order dialog's five events (spec §10, plan "Analytics"): each
 * fact its model builds goes out under its own name, with its properties as
 * built — enums and buckets only, and the host's `surface` only when it says.
 * A host's saved constraints needing attention are counted the same way:
 * where, and how many, by the dialog's own ladder.
 */

const runtime = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock('../runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime')>();
  return { ...actual, track: runtime.track };
});

const { trackLayerConstraintsNeedAttention, trackLayerOrderFact } = await import('../trackLayerOrder');

beforeEach(() => {
  runtime.track.mockClear();
});

describe('trackLayerOrderFact', () => {
  it('sends the dialog opened, its solutions pending until the count arrives', () => {
    trackLayerOrderFact(dialogOpenedFact('edit_figure', 18, solutionsBucket(null, true)));
    expect(runtime.track).toHaveBeenCalledWith('layer order dialog opened', {
      surface: 'edit_figure',
      face_count_bucket: '<=20',
      solutions_bucket: 'pending',
    });
  });

  it('leaves the surface out when the host doesn’t say which it is', () => {
    trackLayerOrderFact(dialogOpenedFact(null, 850, solutionsBucket(null, false)));
    expect(runtime.track).toHaveBeenCalledWith('layer order dialog opened', {
      face_count_bucket: '<=1000',
      solutions_bucket: 'skipped',
    });
  });

  it('sends a constraint added, once per Add, with how many objects its sentence named (D21)', () => {
    trackLayerOrderFact(constraintAddedFact('in_front_of', 'menu', 'folded', 2));
    expect(runtime.track).toHaveBeenCalledWith('layer constraint added', {
      verb: 'in_front_of',
      subject_origin: 'menu',
      object_origin: 'folded',
      object_count_bucket: '<=2',
    });
  });

  it('sends a sentence blocked, bucketed', () => {
    trackLayerOrderFact(constraintBlockedFact(3, 7));
    expect(runtime.track).toHaveBeenCalledWith('layer constraint blocked', {
      constraint_count_bucket: '<=5',
      object_count_bucket: '>5',
    });
  });

  it('sends the dialog closed, with what was on screen and how long it stayed', () => {
    trackLayerOrderFact(dialogClosedFact('applied', 1, solutionsBucket({ n: 9, exact: true }, true), 12_000, null, true));
    expect(runtime.track).toHaveBeenCalledWith('layer order dialog closed', {
      outcome: 'applied',
      constraint_count_bucket: '<=1',
      solutions_bucket: '<=10',
      elapsed_ms_bucket: '<=15000',
      rotated: true,
    });
  });

  it('sends a close on a refused open with the refusal’s code, and a crash or an untouched Apply by outcome', () => {
    trackLayerOrderFact(dialogClosedFact('refused', 0, 'pending', 2_000, 'source_non_convex_face'));
    expect(runtime.track).toHaveBeenLastCalledWith('layer order dialog closed', {
      outcome: 'refused',
      refusal: 'source_non_convex_face',
      constraint_count_bucket: '<=0',
      solutions_bucket: 'pending',
      elapsed_ms_bucket: '<=5000',
      rotated: false,
    });
    trackLayerOrderFact(dialogClosedFact('crashed', 2, 'pending', 2_000, 'session_timed_out'));
    expect(runtime.track).toHaveBeenLastCalledWith('layer order dialog closed', expect.not.objectContaining({ refusal: expect.anything() }));
    trackLayerOrderFact(dialogClosedFact('unchanged', 0, '<=1', 9_000));
    expect(runtime.track).toHaveBeenLastCalledWith('layer order dialog closed', expect.objectContaining({ outcome: 'unchanged' }));
  });

  it('sends the hosts’ constraints needing attention as a fact too', () => {
    trackLayerOrderFact(needsAttentionFact('diagram_step', 2));
    expect(runtime.track).toHaveBeenCalledWith('layer constraints need attention', {
      surface: 'diagram_step',
      broken_count_bucket: '<=2',
    });
  });
});

describe('trackLayerConstraintsNeedAttention', () => {
  it('sends where and how many, bucketed, and nothing else', () => {
    trackLayerConstraintsNeedAttention(needsAttentionFact('diagram_step', 3).properties);
    expect(runtime.track).toHaveBeenCalledWith('layer constraints need attention', {
      surface: 'diagram_step',
      broken_count_bucket: '<=5',
    });
    trackLayerConstraintsNeedAttention(needsAttentionFact('diagram_step', 40).properties);
    expect(runtime.track).toHaveBeenLastCalledWith('layer constraints need attention', {
      surface: 'diagram_step',
      broken_count_bucket: '>10',
    });
  });
});
