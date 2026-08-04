import { describe, expect, it } from 'vitest';
import { designLayoutVariant } from './designVariant';

/**
 * The point of the single field is what these tests cannot express: there is no
 * "choice pending" input to combine with a method, so no call can describe a
 * Design workspace that is both showing the chooser and authoring box-pleat.
 * That combination is what put the chooser on top of a design that was already
 * open.
 */
describe('designLayoutVariant', () => {
  it('shows the method chooser when no method has been picked', () => {
    expect(designLayoutVariant('none')).toBe('nux');
  });

  it('maps each method to its own layout', () => {
    expect(designLayoutVariant('treemaker')).toBe('treemaker');
    expect(designLayoutVariant('box-pleat')).toBe('box-pleat');
  });
});
