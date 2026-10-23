import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { diagramStepMenuItems } from './diagramContextMenu';
import { turnCardWords, turnName } from '../../lib/steps/turnWords';
import { buildDiagramTurnActions, type DiagramTurnActionState } from './diagramTurnActions';

const t = ((_key: string, fallback: string, values?: Record<string, unknown>) =>
  fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? ''))) as unknown as TFunction;

function build(state: Partial<DiagramTurnActionState> = {}) {
  const deps = { t, set: vi.fn(), move: vi.fn(), remove: vi.fn() };
  const actions = buildDiagramTurnActions(
    { turn: { kind: 'turn-over', axis: 'vertical' }, index: 1, count: 3, readOnly: false, ...state },
    deps
  );
  return { actions, deps };
}

describe('a turn’s verbs (D22)', () => {
  it('offers what it is, how it turns, moving it and deleting it, in the menu’s order', () => {
    const items = diagramStepMenuItems(build().actions);
    expect(items.map((item) => (item.kind === 'separator' ? '—' : item.kind === 'submenu' ? item.id : `${item.id}`))).toEqual([
      'turn-over',
      'rotate',
      '—',
      'axis-vertical',
      'axis-horizontal',
      '—',
      'move-earlier',
      'move-later',
      '—',
      'delete',
    ]);
  });

  it('marks what it is and how it turns, and makes it another', () => {
    const { actions, deps } = build();
    const command = (id: string) => {
      const found = actions.find((action) => action.kind === 'command' && action.id === id);
      if (found?.kind !== 'command') throw new Error(`no ${id}`);
      return found;
    };
    expect(command('turn-over')).toMatchObject({ checked: true });
    expect(command('axis-vertical')).toMatchObject({ checked: true });
    command('rotate').run();
    // A rotation, a quarter clockwise unless it was one already.
    expect(deps.set).toHaveBeenCalledWith({ kind: 'rotate', rotate: { amount: 'quarter', direction: 'cw' } });
  });

  it('offers a rotation’s amount and direction, keeping the other as it is', () => {
    const { actions, deps } = build({ turn: { kind: 'rotate', rotate: { amount: 'eighth', direction: 'ccw' } } });
    const ids = actions.flatMap((action) => (action.kind === 'command' ? [action.id] : []));
    expect(ids).toEqual(['turn-over', 'rotate', 'rotate-eighth', 'rotate-quarter', 'rotate-half', 'rotate-cw', 'rotate-ccw', 'move-earlier', 'move-later', 'delete']);
    const half = actions.find((action) => action.kind === 'command' && action.id === 'rotate-half');
    if (half?.kind === 'command') half.run();
    expect(deps.set).toHaveBeenCalledWith({ kind: 'rotate', rotate: { amount: 'half', direction: 'ccw' } });
  });

  it('lists a rotation by an exact angle as its angle, chosen, beside the presets; a preset or a direction keeps the rest', () => {
    const { actions, deps } = build({ turn: { kind: 'rotate', rotate: { amount: 'degrees', degrees: 30, direction: 'cw' } } });
    const command = (id: string) => {
      const found = actions.find((action) => action.kind === 'command' && action.id === id);
      if (found?.kind !== 'command') throw new Error(`no ${id}`);
      return found;
    };
    expect(command('rotate-custom')).toMatchObject({ label: '30°', checked: true });
    for (const preset of ['rotate-eighth', 'rotate-quarter', 'rotate-half']) expect(command(preset).checked).toBe(false);
    command('rotate-ccw').run();
    expect(deps.set).toHaveBeenLastCalledWith({ kind: 'rotate', rotate: { amount: 'degrees', degrees: 30, direction: 'ccw' } });
    command('rotate-half').run();
    expect(deps.set).toHaveBeenLastCalledWith({ kind: 'rotate', rotate: { amount: 'half', direction: 'cw' } });
    // A preset turn lists no angle of its own.
    const preset = build({ turn: { kind: 'rotate', rotate: { amount: 'quarter', direction: 'cw' } } }).actions;
    expect(preset.some((action) => action.kind === 'command' && action.id === 'rotate-custom')).toBe(false);
  });

  it('cannot move past either end, and changes nothing on a read-only diagram', () => {
    const first = build({ index: 0 }).actions;
    expect(first.find((action) => action.kind === 'command' && action.id === 'move-earlier')).toMatchObject({ disabled: true });
    const readOnly = build({ readOnly: true }).actions.filter((action) => action.kind === 'command');
    expect(readOnly.every((action) => action.kind === 'command' && action.disabled)).toBe(true);
  });

  it('draws what it is and how it turns as one of a set, in its menu', () => {
    const items = diagramStepMenuItems(build({ turn: { kind: 'rotate', rotate: { amount: 'quarter', direction: 'cw' } } }).actions);
    const rows = items.flatMap((item) => (item.kind === 'separator' || item.kind === 'submenu' ? [] : [`${item.kind} ${item.id}`]));
    expect(rows).toEqual([
      'radio turn-over',
      'radio rotate',
      'radio rotate-eighth',
      'radio rotate-quarter',
      'radio rotate-half',
      'radio rotate-cw',
      'radio rotate-ccw',
      'action move-earlier',
      'action move-later',
      'action delete',
    ]);
  });

  it('draws its verbs with the icons a step’s same verbs have, and its ways with their checks', () => {
    const items = diagramStepMenuItems(build().actions);
    const icons = items.flatMap((item) => (item.kind === 'action' ? [[item.id, item.icon != null]] : []));
    expect(icons).toEqual([
      ['move-earlier', true],
      ['move-later', true],
      ['delete', true],
    ]);
  });

  it('offers only its moves and Delete when a newer build made it', () => {
    const { actions } = build({ turn: { kind: 'turn-over', axis: 'vertical', unknown: { id: 'turn-9', kind: 'spin' } } });
    expect(diagramStepMenuItems(actions).flatMap((item) => (item.kind === 'separator' ? [] : [item.kind === 'submenu' ? item.id : item.id]))).toEqual([
      'move-earlier',
      'move-later',
      'delete',
    ]);
    expect(turnName({ kind: 'turn-over', axis: 'vertical', unknown: {} }, t)).toBe('Turn from a newer Ori Studio');
  });

  it('names itself by how it turns', () => {
    expect(turnName({ kind: 'turn-over', axis: 'horizontal' }, t)).toBe('Turn over, top to bottom');
    expect(turnName({ kind: 'rotate', rotate: { amount: 'half', direction: 'cw' } }, t)).toBe('Rotate 1/2 turn clockwise');
  });

  describe('an angle of its own', () => {
    const angle = (degrees: number, direction: 'cw' | 'ccw' = 'cw') => ({ kind: 'rotate' as const, rotate: { amount: 'degrees' as const, degrees, direction } });

    it('names itself, and says how on its card, by its degrees', () => {
      expect(turnName(angle(135), t)).toBe('Rotate 135° clockwise');
      expect(turnName(angle(22.5, 'ccw'), t)).toBe('Rotate 22.5° counterclockwise');
      expect(turnCardWords(angle(135), t)).toEqual({ title: 'Rotate', how: '135° clockwise' });
      expect(turnCardWords(angle(90, 'ccw'), t)).toEqual({ title: 'Rotate', how: '90° counterclockwise' });
      // A preset keeps its words.
      expect(turnCardWords({ kind: 'rotate', rotate: { amount: 'quarter', direction: 'cw' } }, t)).toEqual({
        title: 'Rotate',
        how: '1/4 turn clockwise',
      });
    });

    it('shows its angle in its menu as one more of the set, checked, after the presets', () => {
      const { actions, deps } = build({ turn: angle(135, 'ccw') });
      const rows = diagramStepMenuItems(actions).flatMap((item) =>
        item.kind === 'radio' ? [`${item.id} ${item.label}${item.checked ? ' ✓' : ''}`] : []
      );
      expect(rows).toEqual([
        'turn-over Turn Over',
        'rotate Rotate ✓',
        'rotate-eighth 1/8 Turn',
        'rotate-quarter 1/4 Turn',
        'rotate-half 1/2 Turn',
        'rotate-custom 135° ✓',
        'rotate-cw Clockwise',
        'rotate-ccw Counterclockwise ✓',
      ]);
      // A preset is still chosen from it, and drops the angle; the other way keeps it.
      const command = (id: string) => {
        const found = actions.find((action) => action.kind === 'command' && action.id === id);
        if (found?.kind !== 'command') throw new Error(`no ${id}`);
        return found;
      };
      command('rotate-half').run();
      expect(deps.set).toHaveBeenLastCalledWith({ kind: 'rotate', rotate: { amount: 'half', direction: 'ccw' } });
      command('rotate-cw').run();
      expect(deps.set).toHaveBeenLastCalledWith({ kind: 'rotate', rotate: { amount: 'degrees', degrees: 135, direction: 'cw' } });
    });

    it('has no such row while it is a preset', () => {
      const ids = build({ turn: { kind: 'rotate', rotate: { amount: 'half', direction: 'cw' } } }).actions.flatMap((action) =>
        action.kind === 'command' ? [action.id] : []
      );
      expect(ids).not.toContain('rotate-custom');
      expect(ids).toEqual(expect.arrayContaining(['rotate-eighth', 'rotate-quarter', 'rotate-half']));
    });
  });
});
