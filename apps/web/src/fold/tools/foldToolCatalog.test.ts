import { describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import {
  FOLD_LINE_MODES,
  FOLD_LINE_MODE_SHORTCUTS,
  FOLD_MODEL_VERB_SHORTCUTS,
  FOLD_TOOL_SHORTCUTS,
  isFoldKind,
  isFoldLineMode,
  lineModeAxiom,
  lineModeSteps,
} from './foldToolCatalog';

const t = i18n.t.bind(i18n);

describe('the Fold tool catalog', () => {
  it('reads each axiom line mode as its axiom, and the other modes as none', () => {
    expect(FOLD_LINE_MODES.map(lineModeAxiom)).toEqual([1, 2, 3, 4, 5, 6, 7, null, null]);
    expect(isFoldLineMode('axiom-4')).toBe(true);
    expect(isFoldLineMode('axiom-8')).toBe(false);
  });

  it('gives every tool, line mode and model verb a key of its own', () => {
    const keys = [
      ...Object.values(FOLD_TOOL_SHORTCUTS),
      ...Object.values(FOLD_LINE_MODE_SHORTCUTS),
      ...Object.values(FOLD_MODEL_VERB_SHORTCUTS),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((key) => key.startsWith('fold.'))).toBe(true);
  });

  it('asks for as many clicks as each line mode takes references', () => {
    expect(FOLD_LINE_MODES.map((mode) => lineModeSteps(t, mode).length)).toEqual([2, 2, 2, 2, 3, 4, 3, 2, 1]);
  });

  it('knows a plain fold from the other tools', () => {
    expect((['valley', 'mountain', 'precrease', 'inside-reverse', 'divide-line'] as const).map(isFoldKind)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });
});
