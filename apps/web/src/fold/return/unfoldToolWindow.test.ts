import { describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { FOLD_PENDING_NODE, type FoldSessionNode } from '../session/foldSessionState';
import type { FoldPathEntry } from '../sequence/foldSequencePath';
import { foldToolWindow, type FoldPreview, type FoldToolHost, type FoldToolWindowVerbs, type FoldToolWindowView } from '../tools/foldToolWindow';
import { unfoldOp, unfoldTargetOf, unfoldTargets } from './unfoldTool';
import type { FoldUnfoldWindowView } from './unfoldToolWindow';

const t = i18n.t.bind(i18n);
const HOST: FoldToolHost = { coarse: false, alt: 'Option' };

function entry(id: string | null, number: number | null, landed = true): FoldPathEntry {
  const session: FoldSessionNode = landed
    ? { ...FOLD_PENDING_NODE, status: 'ok', state: { generation: 1, id: number ?? 9 }, fingerprint: `fs1:${id}`, path: `fh1:${id}` }
    : FOLD_PENDING_NODE;
  return { id, key: id ?? 'sheet', node: null, kind: id === null ? 'sheet' : number === null ? 'turn' : 'fold', number, status: session.status, session, branches: null };
}

describe('the steps Unfold to step returns to', () => {
  const path = [entry(null, 0), entry('s1', 1), entry('t', null), entry('s2', 2, false), entry('s3', 3)];

  it('are the earlier landed entries of the path, latest first, the flat sheet among them', () => {
    expect(unfoldTargets(path, 4).map((each) => each.key)).toEqual(['t', 's1', 'sheet']);
    expect(unfoldTargets(path, 0)).toEqual([]);
  });

  it('take the one chosen while it is offered, else the step before the one on screen, else the nearest landed', () => {
    const targets = unfoldTargets(path, 4);
    expect(unfoldTargetOf(targets, { id: null }, path[3])?.key).toBe('sheet');
    expect(unfoldTargetOf(targets, { id: 's3' }, path[2])?.key).toBe('t');
    // The step before has not landed: the nearest that has.
    expect(unfoldTargetOf(targets, null, path[3])?.key).toBe('t');
    expect(unfoldTargetOf([], null, undefined)).toBeNull();
  });

  it('make the stored op from the step on screen and the target, once both are known', () => {
    expect(unfoldOp(path[4]!.session, path[1]!)).toEqual({
      kind: 'unfold-to',
      target: 's1',
      source: { path: 'fh1:s3', state: 'fs1:s3', targetState: 'fs1:s1' },
    });
    expect(unfoldOp(path[4]!.session, entry('s2', 2, false))).toBeNull();
  });
});

describe("Unfold to step's window", () => {
  const path = [entry(null, 0), entry('s1', 1), entry('s2', 2)];
  const targets = unfoldTargets(path, 2);

  function windowOf(unfold: Partial<FoldUnfoldWindowView>, preview: Partial<FoldPreview> | null = { landing: false }, calls = verbs()) {
    const view: FoldToolWindowView = {
      tool: 'unfold-to',
      lineMode: 'axiom-2',
      readOnly: null,
      picks: 0,
      preview: preview ? { section: null, interval: null, seed: 'all', added: [], refused: null, landing: false, ...preview } : null,
      unfold: { entries: path, targets, target: targets[0]!, noop: false, failure: null, rebuilding: false, busy: false, ...unfold },
    };
    const model = foldToolWindow(t, view, calls, HOST);
    if (!model) throw new Error('no window');
    return model;
  }
  function verbs() {
    return {
      selectTool: vi.fn(),
      selectLineMode: vi.fn(),
      swapSide: vi.fn(),
      toggleFlap: vi.fn(),
      cancel: vi.fn(),
      commit: vi.fn(),
      unfold: { setTarget: vi.fn() },
    } as unknown as FoldToolWindowVerbs & { unfold: { setTarget: ReturnType<typeof vi.fn> } };
  }

  it('offers only the steps it can return to, the one before the step on screen to start with, and commits', () => {
    const calls = verbs();
    const model = windowOf({}, { landing: false }, calls);
    expect(model).toMatchObject({ title: 'Unfold to step', phase: 'preview', lineMode: null, refusal: null });
    expect(model.steps).toMatchObject({
      label: 'Return to',
      value: 's1',
      // The flat sheet under an id of its own: a select's value is never empty.
      options: [
        { id: 's1', label: 'Step 1' },
        { id: '__sheet__', label: 'Starting sheet' },
      ],
    });
    expect(model.steps?.options.every((option) => option.id !== '')).toBe(true);
    expect(model.footer?.commit).toMatchObject({ label: 'Unfold to step', disabled: false });
    expect(model.instructions.notes[0]).toBe('The canvas shows the paper back in that pose. Every crease is kept.');
    model.steps?.set('__sheet__');
    expect(calls.unfold.setTarget).toHaveBeenCalledWith(null);
  });

  it('waits while the preview lands, adds nothing for the pose on screen, and says why it cannot unfold', () => {
    expect(windowOf({}, { landing: true }).footer?.commit.disabled).toBe(true);
    const noop = windowOf({ noop: true });
    expect(noop.footer?.commit.disabled).toBe(true);
    expect(noop.instructions.notes[0]).toBe('The paper is already in this pose with these creases.');
    const changed = windowOf({ failure: 'return_source_changed' });
    expect(changed.refusal).toMatchObject({
      code: 'return_source_changed',
      title: 'Cannot unfold',
      text: 'Earlier folds changed. Rebuild this unfold to review the new result.',
    });
    expect(changed.footer?.commit.disabled).toBe(true);
  });

  it('rebuilds a saved unfold in place under its own name', () => {
    expect(windowOf({ rebuilding: true }).footer?.commit.label).toBe('Rebuild unfold');
  });

  it('has nothing to return to at the flat sheet', () => {
    const model = windowOf({ targets: [], target: null }, null);
    expect(model.steps).toBeNull();
    expect(model.instructions.notes[0]).toBe('Fold a step first.');
    expect(model.footer?.commit.disabled).toBe(true);
  });
});
