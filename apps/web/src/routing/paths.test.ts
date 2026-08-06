import { describe, expect, it } from 'vitest';
import {
  DESIGN_PATH,
  EDIT_PATH,
  LEGACY_DESIGN_PATHS,
  SIMULATE_PATH,
  WELCOME_PATH,
  parseWorkspacePath,
  workspacePath,
} from './paths';

describe('workspacePath', () => {
  it('returns the one design path', () => {
    // The Design workspace used to have a path per method. With tabs there is no
    // single method to name: a circle-packed design can sit beside a box-pleat
    // one, and the URL cannot say which the workspace "is".
    expect(workspacePath('design')).toBe(DESIGN_PATH);
  });

  it('returns the single path for non-design workspaces', () => {
    expect(workspacePath('edit')).toBe(EDIT_PATH);
    expect(workspacePath('simulate')).toBe(SIMULATE_PATH);
  });
});

describe('parseWorkspacePath', () => {
  it('parses each workspace path', () => {
    expect(parseWorkspacePath(EDIT_PATH)).toEqual({ workspace: 'edit' });
    expect(parseWorkspacePath(SIMULATE_PATH)).toEqual({ workspace: 'simulate' });
    expect(parseWorkspacePath(DESIGN_PATH)).toEqual({ workspace: 'design' });
  });

  it('still resolves the retired design sub-paths', () => {
    // The router redirects them, but the shell reads the URL to decide which
    // layout to build on its very first render — before the redirect lands. A
    // null here would build the Design workspace as Edit for one frame.
    for (const path of LEGACY_DESIGN_PATHS) {
      expect(parseWorkspacePath(path)).toEqual({ workspace: 'design' });
    }
  });

  it('returns null for non-workspace paths', () => {
    expect(parseWorkspacePath(WELCOME_PATH)).toBeNull();
    expect(parseWorkspacePath('/nonsense')).toBeNull();
  });

  it('round-trips with workspacePath', () => {
    for (const workspace of ['design', 'edit', 'simulate'] as const) {
      expect(parseWorkspacePath(workspacePath(workspace))).toEqual({ workspace });
    }
  });
});
