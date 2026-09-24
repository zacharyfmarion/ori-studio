import { afterEach, describe, expect, it } from 'vitest';
import { UNAVAILABLE } from '../../lib/errorReport';
import { collectErrorContext, registerWorkspaceErrorFacts } from './errorContext';

afterEach(() => registerWorkspaceErrorFacts(null));

describe('collectErrorContext', () => {
  it('reports no workspace and no document before the workspace has loaded', () => {
    const context = collectErrorContext('landing');
    expect(context).toMatchObject({
      surface: 'landing',
      workspace: UNAVAILABLE,
      editingContext: UNAVAILABLE,
      document: 'none open',
    });
  });

  it('reads the workspace’s own facts once it has registered them', () => {
    registerWorkspaceErrorFacts({
      workspace: () => 'edit',
      editingContext: () => 'crease-pattern',
      document: () => 'crease pattern · 5 lines',
    });
    expect(collectErrorContext('panel')).toMatchObject({
      workspace: 'edit',
      editingContext: 'crease-pattern',
      document: 'crease pattern · 5 lines',
    });
  });

  it('degrades one failing fact without losing the rest', () => {
    registerWorkspaceErrorFacts({
      workspace: () => 'edit',
      editingContext: () => {
        throw new Error('selector broke');
      },
      document: () => 'none open',
    });
    expect(collectErrorContext('panel')).toMatchObject({
      workspace: 'edit',
      editingContext: UNAVAILABLE,
      document: 'none open',
    });
  });
});
