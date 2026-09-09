import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useWindowTitle } from './useWindowTitle';
import { SITE_TITLE } from '../seo/siteMeta';
import {
  singleBoxPleatDesignTab,
  singleDesignTab,
  singleTreemakerDesignTab,
} from '../store/workspaceStore/designTabs';
import { useWorkspaceStore } from '../store/workspaceStore';
import { EDIT_PATH, WELCOME_PATH } from '../routing/paths';

/**
 * The window title names the **open file**, falling back to the **project** —
 * and in neither case the tree inside it.
 *
 * Both halves are here because both are store-field choices that look right and
 * are not:
 *
 * - Phase 2b split `workspaceTitle` out of `project.title`; this read was left
 *   on the tree's title, and `selectProject` answers with the frozen
 *   `EMPTY_PROJECT` — title `'Untitled'` — for any project with no tree in it.
 *   So a `.ori` opened with its own embedded title, and every box-pleat design,
 *   showed "Untitled". The tree cases are here too, because they are what hid
 *   it: they write the same string to both fields, so reading either one passes.
 * - The file half is gated on `currentFilePath`, never `currentFileName`, because
 *   the latter is always populated — `defaultNativeFilename` synthesizes
 *   `Untitled.osf` for a project that has never been saved.
 * - The route half is here because the store answers this question even where
 *   there is nothing to answer it about: on `/welcome` it holds a blank project
 *   called `Untitled`, and titling the landing page after it is what Google
 *   indexed the site as.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Probe() {
  useWindowTitle();
  return null;
}

/**
 * Publish a store state, then mount the hook against it at `path`.
 *
 * A real router rather than a mocked `useLocation`: the paths the hook treats as
 * the landing are the ones `appRouter` actually routes, and a mock would assert
 * agreement with itself.
 */
function mountWith(
  state: Partial<Parameters<typeof useWorkspaceStore.setState>[0]>,
  path = EDIT_PATH
) {
  act(() => {
    useWorkspaceStore.setState(state as never);
  });
  act(() =>
    root?.render(
      <MemoryRouter initialEntries={[path]}>
        <Probe />
      </MemoryRouter>
    )
  );
}

beforeEach(() => {
  container = window.document.createElement('div');
  window.document.body.append(container);
  root = createRoot(container);
  window.document.title = '';
  // What a project that has never been saved looks like: a synthesized filename
  // and no path. Reset per test so a case that opens a file cannot leak a path
  // into the next one — the store is a module-level singleton.
  act(() => {
    useWorkspaceStore.setState({
      currentFileName: 'Untitled.osf',
      currentFilePath: null,
    } as never);
  });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('useWindowTitle', () => {
  it('names a crease-pattern-only project from the file it was opened from', () => {
    // What a `.ori` carrying `"title": "folded model metadata"` leaves behind:
    // the project is named, and `discardAllDesigns` has put back one chooser tab
    // that has claimed no kind — so there is no tree to take a title from.
    mountWith({ workspaceTitle: 'folded model metadata', dirty: false, ...singleDesignTab(null) });
    expect(window.document.title).toBe('folded model metadata - Ori Studio');
  });

  it('names a box-pleat project, which has no tree to borrow a title from', () => {
    mountWith({ workspaceTitle: 'Sample BP', dirty: false, ...singleBoxPleatDesignTab() });
    expect(window.document.title).toBe('Sample BP - Ori Studio');
  });

  it('marks a dirty project and follows a rename', () => {
    mountWith({ workspaceTitle: 'Crane', dirty: true, ...singleTreemakerDesignTab() });
    expect(window.document.title).toBe('*Crane - Ori Studio');

    act(() => {
      useWorkspaceStore.setState({ workspaceTitle: 'Crane v2', dirty: false });
    });
    expect(window.document.title).toBe('Crane v2 - Ori Studio');
  });

  it('falls back to Untitled only when the project genuinely has no name', () => {
    mountWith({ workspaceTitle: '  ', dirty: false, ...singleTreemakerDesignTab() });
    expect(window.document.title).toBe('Untitled - Ori Studio');
  });

  it('names the window after the open file, not the project inside it', () => {
    mountWith({
      workspaceTitle: 'folded model metadata',
      dirty: false,
      currentFileName: 'dragon.osf',
      currentFilePath: '/Users/someone/Documents/dragon.osf',
      ...singleDesignTab(null),
    });
    expect(window.document.title).toBe('dragon.osf - Ori Studio');
  });

  /**
   * The case that separates `currentFilePath` from `currentFileName`, and the
   * reason the gate is the former. A never-saved project still carries a
   * filename — `defaultNativeFilename` synthesizes `Untitled.osf` — so a
   * name-based check would title this window after a file nobody created.
   */
  it('does not name a never-saved project after its synthesized filename', () => {
    mountWith({
      workspaceTitle: 'Untitled',
      dirty: false,
      currentFileName: 'Untitled.osf',
      currentFilePath: null,
      ...singleTreemakerDesignTab(),
    });
    expect(window.document.title).toBe('Untitled - Ori Studio');
  });

  /**
   * The regression that put "Ori Studio: Untitled" in Google's result for the
   * site.
   *
   * `index.html` and the prerendered copy both carry `SITE_TITLE`, but Googlebot
   * crawls and *renders* separately, and it indexes what the render produced.
   * The render ran this hook, which named the landing page after the blank
   * project the store holds behind it, so the title Google saw was the one no
   * page was written to have.
   *
   * The store is deliberately loaded with a real project here: what makes the
   * landing not a document is the route, not an empty store.
   */
  it('titles the landing page for the site, not for the project behind it', () => {
    mountWith(
      { workspaceTitle: 'Crane', dirty: true, ...singleTreemakerDesignTab() },
      WELCOME_PATH
    );
    expect(window.document.title).toBe(SITE_TITLE);
  });

  it('titles the landing the same way when a trailing slash comes back from Pages', () => {
    // The deploy 308s `/welcome` to `/welcome/`, because the prerender writes a
    // real `dist/welcome/index.html`. So the trailing form is the one a crawler
    // fetching that URL directly ends up on.
    mountWith({ workspaceTitle: 'Crane', dirty: false, ...singleTreemakerDesignTab() }, '/welcome/');
    expect(window.document.title).toBe(SITE_TITLE);
  });

  it('takes the document title back on the way into a workspace', () => {
    mountWith({ workspaceTitle: 'Crane', dirty: false, ...singleTreemakerDesignTab() }, EDIT_PATH);
    expect(window.document.title).toBe('Crane - Ori Studio');
  });

  it('follows a Save As onto the new filename', () => {
    mountWith({
      workspaceTitle: 'Crane',
      dirty: true,
      currentFileName: 'crane.osf',
      currentFilePath: '/tmp/crane.osf',
      ...singleTreemakerDesignTab(),
    });
    expect(window.document.title).toBe('*crane.osf - Ori Studio');

    act(() => {
      useWorkspaceStore.setState({
        currentFileName: 'crane-v2.osf',
        currentFilePath: '/tmp/crane-v2.osf',
        dirty: false,
      });
    });
    expect(window.document.title).toBe('crane-v2.osf - Ori Studio');
  });
});
