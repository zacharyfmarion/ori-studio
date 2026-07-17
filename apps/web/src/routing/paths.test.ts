import { describe, expect, it } from 'vitest';
import {
  DESIGN_BP_PATH,
  DESIGN_PATH,
  DESIGN_TREEMAKER_PATH,
  EDIT_PATH,
  SIMULATE_PATH,
  designVariantPath,
  workspacePath,
} from './paths';

describe('designVariantPath', () => {
  it('maps each design variant to its sub-path', () => {
    expect(designVariantPath('nux')).toBe(DESIGN_PATH);
    expect(designVariantPath('treemaker')).toBe(DESIGN_TREEMAKER_PATH);
    expect(designVariantPath('box-pleat')).toBe(DESIGN_BP_PATH);
  });
});

describe('workspacePath', () => {
  it('returns the design chooser without a variant', () => {
    expect(workspacePath('design')).toBe(DESIGN_PATH);
  });

  it('returns the design sub-path for a variant', () => {
    expect(workspacePath('design', 'treemaker')).toBe(DESIGN_TREEMAKER_PATH);
    expect(workspacePath('design', 'box-pleat')).toBe(DESIGN_BP_PATH);
    expect(workspacePath('design', 'nux')).toBe(DESIGN_PATH);
  });

  it('returns the single path for non-design workspaces', () => {
    expect(workspacePath('edit')).toBe(EDIT_PATH);
    expect(workspacePath('simulate')).toBe(SIMULATE_PATH);
  });
});
