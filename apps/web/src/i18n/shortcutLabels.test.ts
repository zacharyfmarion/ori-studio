import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { getShortcutDefinition } from '../keyboard/shortcuts';
import { shortcutActionLabel } from './shortcutLabels';

// Answers with the key, so a label read from the catalogue is told apart from
// the registry's English fallback, which is the same words.
const keyOf = ((key: string) => key) as unknown as TFunction;

describe('shortcutActionLabel', () => {
  it('names the Simulate rail’s verbs with its buttons’ own words', () => {
    const label = (id: 'simulator.exportView' | 'simulator.setUpright') =>
      shortcutActionLabel(keyOf, getShortcutDefinition(id)!);
    expect(label('simulator.exportView')).toBe('panels:simulatorExport.trigger');
    expect(label('simulator.setUpright')).toBe('panels:simulator.setUpright');
  });
});
