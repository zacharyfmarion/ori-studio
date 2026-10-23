import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { FOLD_IMPORT_REFUSAL_CODES } from '../engine/foldEngineIoWire';
import type { FoldRefusalBody } from '../engine/foldEngineWire';
import { foldImportNotice, type FoldImportLocalCode } from './foldImportRefusal';

/** `t` as the catalog reads it: the English default, its placeholders filled (a format, `{{n, number}}`, left unapplied). */
const t = ((_key: string, english: string, values?: Record<string, unknown>) =>
  english.replace(/\{\{(\w+)(?:, *\w+)?\}\}/g, (_match, name: string) => String(values?.[name] ?? ''))) as unknown as TFunction;

const engine = (refusal: Record<string, unknown>) =>
  foldImportNotice(t, { kind: 'engine', refused: { refusal: refusal as FoldRefusalBody } }, { searchLonger: vi.fn() });

describe('an import that did not land, as the dialog says it', () => {
  it('words every refusal the engine and the bridge can give', () => {
    for (const code of FOLD_IMPORT_REFUSAL_CODES) {
      const notice = engine({ code });
      expect(notice.code).toBe(code);
      expect(notice.title.length, code).toBeGreaterThan(0);
      expect(notice.text.length, code).toBeGreaterThan(0);
    }
  });

  it('names the format a file failed to read as, and the two sheets that disagree', () => {
    expect(engine({ code: 'import_unreadable', format: 'cp' }).text).toBe(
      'The file could not be read as a .cp crease pattern.'
    );
    expect(engine({ code: 'import_shape_mismatch', expected: [1, 1], found: [1, Math.SQRT1_2] }).text).toBe(
      'This sequence folds a 1 : 1 sheet, and the pattern is on a 1 : 1.414 sheet. Import it into an empty sequence instead.'
    );
    // Without the sheets, it still says what to do.
    expect(engine({ code: 'import_shape_mismatch' }).text).toMatch(/empty sequence/);
  });

  it('names how many faces a pattern over the cap has, and the cap, with nothing to retry', () => {
    const notice = engine({ code: 'import_too_many_faces', face_count: 10000, limit: 4096 });
    expect(notice).toMatchObject({
      code: 'import_too_many_faces',
      title: 'Too many faces',
      text: 'This crease pattern has 10000 faces, and Fold folds patterns of up to 4096. Import a simpler pattern.',
      actions: [],
    });
    // Without its counts, it is still refused plainly.
    expect(engine({ code: 'import_too_many_faces' }).title).toBe('Could not import');
  });

  it('names how deep a pattern stacked past the cap stacks, with nothing to retry', () => {
    const notice = engine({ code: 'import_stacked_too_deep', deepest: 290, triples: 4_022_880, limit: 4_000_000 });
    expect(notice).toMatchObject({
      code: 'import_stacked_too_deep',
      title: 'Layers stacked too deep',
      text: 'This crease pattern stacks its layers too deeply for Fold to work out their order, up to 290 on top of each other. Import a simpler pattern.',
      actions: [],
    });
    expect(engine({ code: 'import_stacked_too_deep' }).title).toBe('Could not import');
  });

  it('offers to search longer when the layer-order search ran out, and nothing else', () => {
    const searchLonger = vi.fn();
    const notice = foldImportNotice(
      t,
      { kind: 'engine', refused: { refusal: { code: 'import_budget_exceeded' } as FoldRefusalBody } },
      { searchLonger }
    );
    expect(notice.actions.map((action) => action.label)).toEqual(['Search longer']);
    notice.actions[0]!.run();
    expect(searchLonger).toHaveBeenCalledOnce();
    expect(engine({ code: 'import_no_order' }).actions).toEqual([]);
  });

  it('words the dialog’s own reasons, naming the file where there is one', () => {
    const codes: FoldImportLocalCode[] = [
      'unsupported_file',
      'unreadable_file',
      'no_folded_figure',
      'no_state',
      'read_only',
      'changed',
    ];
    for (const code of codes) {
      const notice = foldImportNotice(t, { kind: 'local', code, name: 'crane.svg' }, { searchLonger: vi.fn() });
      expect(notice.code).toBe(code);
      expect(notice.title.length).toBeGreaterThan(0);
      expect(notice.actions).toEqual([]);
    }
    expect(
      foldImportNotice(t, { kind: 'local', code: 'unsupported_file', name: 'crane.svg' }, { searchLonger: vi.fn() }).text
    ).toBe('crane.svg is not a crease pattern Fold can import. Use a .cp, .fold, .ori or .orh file.');
  });
});
