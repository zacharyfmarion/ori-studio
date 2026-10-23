import { describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n';
import type { TurnRotation } from '../../../lib/steps/turn';
import { foldToolWindow, type FoldPreview, type FoldToolWindowVerbs, type FoldToolWindowView } from '../foldToolWindow';

const t = i18n.t.bind(i18n);

function verbs() {
  return {
    selectTool: vi.fn(),
    selectLineMode: vi.fn(),
    includeFlaps: vi.fn(),
    foldOtherWay: vi.fn(),
    pickFlap: vi.fn(),
    useLine: vi.fn(),
    swapSide: vi.fn(),
    toggleFlap: vi.fn(),
    cancel: vi.fn(),
    commit: vi.fn(),
    setRotation: vi.fn(),
  } satisfies FoldToolWindowVerbs;
}

/** What the canvas hands a rotation's window: no section, nothing moving, the turn landing or landed. */
const preview = (extra: Partial<FoldPreview> = {}): FoldPreview => ({
  section: null,
  interval: null,
  seed: 'all',
  added: [],
  refused: null,
  landing: false,
  ...extra,
});

const view = (rotation: TurnRotation, extra: Partial<FoldToolWindowView> = {}): FoldToolWindowView => ({
  tool: 'rotate',
  lineMode: 'axiom-2',
  readOnly: null,
  picks: 0,
  preview: preview(),
  rotate: { rotation },
  ...extra,
});

const HOST = { coarse: false, alt: 'Option' };

describe('the Rotate tool’s window', () => {
  it('previews from the start: how far, the exact angle, which way, and Cancel and Rotate', () => {
    const bound = verbs();
    const model = foldToolWindow(t, view({ amount: 'quarter', direction: 'cw' }), bound, HOST)!;
    expect(model).toMatchObject({ phase: 'preview', title: 'Rotate', lineMode: null, kind: null, movingSide: null, layers: null });
    const rotate = model.rotate!;
    expect(rotate.amount.value).toBe('quarter');
    expect(rotate.amount.options.map((option) => [option.value, option.label, option.tooltip])).toEqual([
      ['eighth', '1/8', '1/8 turn, 45°'],
      ['quarter', '1/4', '1/4 turn, 90°'],
      ['half', '1/2', '1/2 turn, 180°'],
    ]);
    expect(rotate.degrees).toMatchObject({ label: 'Exact angle', value: 90, suffix: '°', step: 15 });
    expect(rotate.direction.value).toBe('cw');
    expect(rotate.direction.options.map((option) => option.label)).toEqual(['Clockwise', 'Counterclockwise']);
    expect(model.instructions.items).toEqual([
      // The controls under it say how: a part of a turn, or an exact angle.
      'Choose how far to turn the model.',
      'Choose which way it turns.',
      'Press Enter to add the turn.',
    ]);
    expect(model.instructions.notes).toContain('Esc puts Rotate down without adding the turn.');
    expect(model.footer?.commit).toMatchObject({ label: 'Rotate', shortcut: 'fold.commit', disabled: false });
    expect(model.footer?.cancel.shortcut).toBe('viewport.cancel');
  });

  it('sets a preset, a direction and an exact angle, each keeping the rest', () => {
    const bound = verbs();
    const rotate = foldToolWindow(t, view({ amount: 'quarter', direction: 'ccw' }), bound, HOST)!.rotate!;
    rotate.amount.set('eighth');
    expect(bound.setRotation).toHaveBeenLastCalledWith({ amount: 'eighth', direction: 'ccw' });
    rotate.direction.set('cw');
    expect(bound.setRotation).toHaveBeenLastCalledWith({ amount: 'quarter', direction: 'cw' });
    rotate.degrees.set(30);
    expect(bound.setRotation).toHaveBeenLastCalledWith({ amount: 'degrees', degrees: 30, direction: 'ccw' });
    // Normalised as every rotation is: the other way past a half turn, a preset at a preset's angle.
    rotate.degrees.set(300);
    expect(bound.setRotation).toHaveBeenLastCalledWith({ amount: 'degrees', degrees: 60, direction: 'cw' });
    rotate.degrees.set(180);
    expect(bound.setRotation).toHaveBeenLastCalledWith({ amount: 'half', direction: 'ccw' });
  });

  it('leaves the rotation as it is for a number that names no turn, and says the field will not take it', () => {
    const bound = verbs();
    const rotate = foldToolWindow(t, view({ amount: 'quarter', direction: 'cw' }), bound, HOST)!.rotate!;
    for (const typed of [0, 360, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(rotate.degrees.accepts(typed), String(typed)).toBe(false);
      rotate.degrees.set(typed);
    }
    expect(bound.setRotation).not.toHaveBeenCalled();
    expect(rotate.degrees.accepts(-15)).toBe(true);
  });

  it('chooses no preset while an exact angle is, and shows the angle in the field', () => {
    const rotate = foldToolWindow(t, view({ amount: 'degrees', degrees: 22.5, direction: 'ccw' }), verbs(), HOST)!.rotate!;
    expect(rotate.amount.value).toBeNull();
    expect(rotate.degrees.value).toBe(22.5);
    expect(rotate.direction.value).toBe('ccw');
  });

  it('waits for the turn to land, says a press of Enter is queued, and holds every control on a read-only sequence', () => {
    const landing = foldToolWindow(t, view({ amount: 'half', direction: 'cw' }, { preview: preview({ landing: true, queued: true }) }), verbs(), HOST)!;
    expect(landing.footer?.commit.disabled).toBe(true);
    expect(landing.instructions.notes).toContain('Folding as soon as the preview is ready…');
    const readOnly = foldToolWindow(t, view({ amount: 'half', direction: 'cw' }, { readOnly: 'newer' }), verbs(), HOST)!;
    expect(readOnly.rotate?.disabled).toBe(true);
    expect(readOnly.footer?.commit.disabled).toBe(true);
    // A finger has no keys: the window names the button instead.
    const touch = foldToolWindow(t, view({ amount: 'half', direction: 'cw' }), verbs(), { coarse: true, alt: 'Alt' })!;
    expect(touch.instructions.items.at(-1)).toBe('Tap Rotate to add the turn.');
    expect(touch.instructions.notes).not.toContain('Esc puts Rotate down without adding the turn.');
  });
});
