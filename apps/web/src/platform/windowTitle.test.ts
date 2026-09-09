import { describe, expect, it } from 'vitest';
import { SITE_NAME, SITE_TITLE } from '../seo/siteMeta';
import { formatWindowTitle } from './windowTitle';

describe('window title formatting', () => {
  it('formats clean web titles', () => {
    expect(
      formatWindowTitle({ projectTitle: 'Crane base', dirty: false, surface: 'web' })
    ).toBe('Crane base - Ori Studio');
  });

  it('marks dirty desktop titles', () => {
    expect(
      formatWindowTitle({ projectTitle: 'Crane base', dirty: true, surface: 'desktop' })
    ).toBe('*Crane base - Ori Studio');
  });

  it('names the open file rather than the project, extension included', () => {
    expect(
      formatWindowTitle({
        projectTitle: 'folded model metadata',
        dirty: false,
        fileName: 'dragon.osf',
        filePath: '/Users/someone/Documents/dragon.osf',
      })
    ).toBe('dragon.osf - Ori Studio');
  });

  it('still marks the file title dirty', () => {
    expect(
      formatWindowTitle({
        projectTitle: 'Dragon',
        dirty: true,
        fileName: 'dragon.osf',
        filePath: '/tmp/dragon.osf',
      })
    ).toBe('*dragon.osf - Ori Studio');
  });

  /**
   * The reason the gate is the path and not the name. `currentFileName` is never
   * empty — a project that has never been saved carries the *synthesized*
   * `Untitled.osf` from `defaultNativeFilename` — so a name-based check would
   * title the window after a file that does not exist.
   */
  it('ignores a synthesized filename when nothing has been written to disk', () => {
    expect(
      formatWindowTitle({
        projectTitle: 'Untitled',
        dirty: false,
        fileName: 'Untitled.osf',
        filePath: null,
      })
    ).toBe('Untitled - Ori Studio');
  });

  /**
   * On the landing there is no document to name, and the two surfaces want
   * genuinely different strings for it.
   *
   * The web one is the search result, so it has to be the sentence `index.html`
   * already serves — `useWindowTitle` running on `/welcome` and overwriting that
   * with the blank project's name is what Google indexed as
   * "Ori Studio: Untitled". A title bar is not a search result and not a tab, so
   * desktop takes the name alone rather than a seventy-character sentence.
   *
   * The project fields are populated in both cases: what makes this page not a
   * document is the route, not an empty store.
   */
  it('titles the landing for the site on web', () => {
    expect(
      formatWindowTitle({
        projectTitle: 'Crane base',
        dirty: true,
        landing: true,
        surface: 'web',
      })
    ).toBe(SITE_TITLE);
  });

  it('titles the landing with just the app name on desktop', () => {
    expect(
      formatWindowTitle({
        projectTitle: 'Crane base',
        dirty: true,
        landing: true,
        surface: 'desktop',
      })
    ).toBe(SITE_NAME);
  });

  it('keeps naming the project on web, where no path is ever produced', () => {
    expect(
      formatWindowTitle({
        projectTitle: 'Crane base',
        dirty: false,
        fileName: 'crane.osf',
        filePath: null,
        surface: 'web',
      })
    ).toBe('Crane base - Ori Studio');
  });
});
