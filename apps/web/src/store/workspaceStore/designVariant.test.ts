import { describe, expect, it } from 'vitest';
import { deriveDesignVariant } from './designVariant';

describe('deriveDesignVariant', () => {
  it('is the NUX chooser while a method choice is pending', () => {
    expect(deriveDesignVariant({ pendingDesignChoice: true, workflowTarget: 'treemaker' })).toBe(
      'nux'
    );
    expect(deriveDesignVariant({ pendingDesignChoice: true, workflowTarget: 'box-pleat' })).toBe(
      'nux'
    );
  });

  it('follows the workflow target once a method is chosen', () => {
    expect(deriveDesignVariant({ pendingDesignChoice: false, workflowTarget: 'treemaker' })).toBe(
      'treemaker'
    );
    expect(deriveDesignVariant({ pendingDesignChoice: false, workflowTarget: 'box-pleat' })).toBe(
      'box-pleat'
    );
  });
});
