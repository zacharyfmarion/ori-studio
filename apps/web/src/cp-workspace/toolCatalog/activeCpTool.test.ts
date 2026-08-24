import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cpActionByOperation,
  DEFAULT_ORISTUDIO_CP_ACTION_ID,
} from '../../lib/oristudioCpActions';
import { activeCpToolGlyph } from './activeCpTool';
import { cpToolSurface, publishCpToolSurface, resetCpToolSurface } from './cpToolSurface';

/** The Eraser's rail button. Ids are the kernel operation, kebab-cased. */
const ERASER_ACTION_ID = 'cp.action.line-segment-delete';

describe('the active tool a Tools button draws', () => {
  it('draws the armed action', () => {
    const resolved = activeCpToolGlyph(ERASER_ACTION_ID, null);
    expect(resolved?.action.id).toBe(ERASER_ACTION_ID);
  });

  it('passes the active operation through, so a merged tool draws its variant', () => {
    // Copy is one rail button over two kernel operations, `CreaseCopy` and its
    // 4-point variant. `CpToolGlyph` prefers the operation it is handed, which
    // is how the mode is readable without opening the context panel.
    const host = cpActionByOperation('CreaseCopy');
    if (!host) throw new Error('no Copy action');

    const resolved = activeCpToolGlyph(host.id, 'CreaseCopy4p');

    expect(resolved?.action.id).toBe(host.id);
    expect(resolved?.glyphOperationId).toBe('CreaseCopy4p');
  });

  it('matches on the operation when only the operation is set', () => {
    // A command reached by shortcut or menu leaves `activeActionId` null. The
    // button must not fall back to the resting glyph while the canvas is armed
    // with something else.
    const resolved = activeCpToolGlyph(null, 'LineSegmentDelete');
    expect(resolved?.action.id).toBe(ERASER_ACTION_ID);
  });

  it('falls back to the resting tool, not to a neutral mark', () => {
    // Escape returns the panel to the resting tool, so that is what the next tap
    // on the canvas actually does — a generic icon here would be a lie.
    const resolved = activeCpToolGlyph(null, null);
    expect(resolved?.action.id).toBe(DEFAULT_ORISTUDIO_CP_ACTION_ID);
    expect(resolved?.glyphOperationId).toBeNull();
  });

  it('falls back rather than drawing nothing when the id is unknown', () => {
    const resolved = activeCpToolGlyph('cp.action.not-a-tool', null);
    expect(resolved?.action.id).toBe(DEFAULT_ORISTUDIO_CP_ACTION_ID);
  });
});

describe('the published tool surface', () => {
  afterEach(() => resetCpToolSurface());

  it('is null until a panel publishes one', () => {
    expect(cpToolSurface()).toBeNull();
  });

  it('lets a newer panel win, and an older teardown not undo it', () => {
    // Both panels exist at once on a workspace switch: the incoming one mounts
    // before the outgoing one runs its cleanup. Without the identity check the
    // late teardown clears the live registration and the Tools button vanishes
    // with a crease pattern open.
    const first = { onSelectAction: vi.fn() };
    const second = { onSelectAction: vi.fn() };
    const base = { activeActionId: null, activeOperationId: null, activeLineColor: 'Red1' } as const;

    const releaseFirst = publishCpToolSurface({ ...base, ...first });
    const releaseSecond = publishCpToolSurface({ ...base, ...second });

    releaseFirst();
    expect(cpToolSurface()?.onSelectAction).toBe(second.onSelectAction);

    releaseSecond();
    expect(cpToolSurface()).toBeNull();
  });
});
