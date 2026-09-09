import { describe, expect, it } from 'vitest';
import {
  DESIGN_PATH,
  EDIT_PATH,
  LEGACY_DESIGN_PATHS,
  SIMULATE_PATH,
  WELCOME_PATH,
  isLandingPath,
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

/**
 * What separates the marketing page from a document, which is what decides
 * whether the tab is titled for the site or for the open project. Getting this
 * wrong is not a cosmetic bug — the title the app renders is the one Google
 * indexes, so a `/welcome` that answers `false` here shows up in the result.
 */
describe('isLandingPath', () => {
  it('matches both paths that hold the landing page', () => {
    expect(isLandingPath('/')).toBe(true);
    expect(isLandingPath(WELCOME_PATH)).toBe(true);
  });

  it('matches the trailing-slash form the deploy redirects to', () => {
    // Pages 308s `/welcome` to `/welcome/`, because the prerender writes a real
    // `dist/welcome/index.html` for it — so this is the URL a crawler fetching
    // that path directly actually lands on, and what the router then reports.
    expect(isLandingPath('/welcome/')).toBe(true);
  });

  it('does not match a workspace, which has a document to be named after', () => {
    expect(isLandingPath(EDIT_PATH)).toBe(false);
    expect(isLandingPath(DESIGN_PATH)).toBe(false);
    expect(isLandingPath(SIMULATE_PATH)).toBe(false);
  });

  it('does not match a path that merely starts with one', () => {
    expect(isLandingPath('/welcome-back')).toBe(false);
  });
});
